import { useCallback, useState } from 'react';

import type { Asset } from '../models/config/assets';
import { formatAssetAmount, isValidAssetAddress, parseAssetAmount } from '../models/assetAmounts';
import { errorMessage } from '../models/format';
import {
  estimateBitcoinFee,
  estimateMainnetBitcoinFee,
  getFeeRates,
  getMainnetFeeRates,
  sendBitcoin,
  sendMainnetBitcoin,
  type FeeRates,
} from '../models/services/bitcoinService';
import { estimateEvmTransferFee, sendEvm } from '../models/services/ethereumService';
import { estimateSolanaTransferFee, sendSolana } from '../models/services/solanaService';
import { recordActivity } from '../models/services/walletStorage';
import type { Status } from '../models/types';
import { useWalletStore } from './WalletStore';

export type FeeSpeed = keyof FeeRates;

/** Validated send for any coin: ETH on an EVM network (ethers.js) or tBTC (bitcoinjs). */
export function useSendAsset(asset: Asset | undefined) {
  const { active } = useWalletStore();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [txUrl, setTxUrl] = useState<string>();

  /** Checks input without sending; returns the parsed amount or undefined (and sets an error). */
  const validate = useCallback(
    (to: string, amount: string, balance?: bigint) => {
      if (!asset) return undefined;
      if (asset.readOnly) {
        setStatus({ kind: 'error', text: 'This coin is read-only — sending isn’t available yet.' });
        return undefined;
      }
      if (!isValidAssetAddress(asset, to)) {
        setStatus({
          kind: 'error',
          text:
            asset.kind === 'bitcoin'
              ? asset.mainnet ? 'Enter a valid Bitcoin mainnet address' : 'Enter a testnet address (tb1…)'
              : asset.kind === 'solana'
                ? 'Enter a valid Solana address'
                : 'Enter a valid 0x… address',
        });
        return undefined;
      }
      let value: bigint;
      try {
        value = parseAssetAmount(asset, amount);
      } catch (e) {
        setStatus({ kind: 'error', text: errorMessage(e) });
        return undefined;
      }
      if (value <= 0n) {
        setStatus({ kind: 'error', text: 'Amount must be greater than zero' });
        return undefined;
      }
      if (balance !== undefined && value > balance) {
        setStatus({ kind: 'error', text: `Not enough ${asset.symbol} (balance ${formatAssetAmount(asset, balance)})` });
        return undefined;
      }
      setStatus(undefined);
      return value;
    },
    [asset],
  );

  const estimateFee = useCallback(
    async (to: string, amount: bigint, speed: FeeSpeed = 'normal') => {
      if (!asset || !active) throw new Error('Wallet is not ready');
      if (asset.kind === 'bitcoin') {
        const mnemonic = active.keys.mnemonic;
        if (!mnemonic) throw new Error('Bitcoin sending requires a wallet recovery phrase');
        const rates = asset.mainnet ? await getMainnetFeeRates() : await getFeeRates();
        const estimate = asset.mainnet ? estimateMainnetBitcoinFee : estimateBitcoinFee;
        return estimate({ mnemonic, amountSats: amount, feeRate: rates[speed] });
      }
      if (asset.kind === 'solana') {
        return estimateSolanaTransferFee({
          from: active.solAddress,
          to: to.trim(),
          amountLamports: amount,
          mainnet: asset.mainnet,
        });
      }
      return estimateEvmTransferFee({
        from: active.keys.address,
        network: asset.chain,
        to: to.trim(),
        amountWei: amount,
      });
    },
    [asset, active],
  );

  const send = useCallback(
    async (to: string, amount: bigint, speed: FeeSpeed = 'normal', approvedFee?: bigint) => {
      if (!asset || !active) return false;
      if (asset.readOnly) {
        setStatus({ kind: 'error', text: 'This coin is read-only — sending isn’t available yet.' });
        return false;
      }
      if (asset.mainnet && approvedFee === undefined) {
        setStatus({ kind: 'error', text: 'Estimate and review the mainnet network fee before sending' });
        return false;
      }
      setSending(true);
      setTxUrl(undefined);
      setStatus({
        kind: 'info',
        text: 'Signing and broadcasting…',
      });
      try {
        let hash: string;
        if (asset.kind === 'bitcoin') {
          const mnemonic = active.keys.mnemonic;
          if (!mnemonic) throw new Error('Bitcoin sending requires a wallet recovery phrase');
          const fees = asset.mainnet ? await getMainnetFeeRates() : await getFeeRates();
          if (asset.mainnet) {
            ({ txid: hash } = await sendMainnetBitcoin({
              mnemonic,
              to,
              amountSats: amount,
              feeRate: fees[speed],
              maxFeeSats: approvedFee,
            }));
          } else {
            ({ txid: hash } = await sendBitcoin({ mnemonic, to, amountSats: amount, feeRate: fees[speed] }));
          }
        } else if (asset.kind === 'solana') {
          const mnemonic = active.keys.mnemonic;
          if (!mnemonic) throw new Error('Solana sending requires a wallet recovery phrase');
          ({ signature: hash } = await sendSolana({
            mnemonic,
            to: to.trim(),
            amountLamports: amount,
            mainnet: asset.mainnet,
            maxFeeLamports: approvedFee,
          }));
        } else {
          ({ hash } = await sendEvm({
            privateKey: active.keys.privateKey,
            network: asset.chain,
            to: to.trim(),
            amountWei: amount,
            maxFeeWei: approvedFee,
          }));
        }
        await recordActivity({
          walletId: active.id,
          asset: asset.id,
          hash,
          to: to.trim(),
          amount: formatAssetAmount(asset, amount, 8),
        });
        setTxUrl(asset.txUrl?.(hash));
        setStatus({
          kind: 'success',
          text:
            asset.kind === 'bitcoin' || asset.kind === 'solana'
              ? `Sent! ${hash.slice(0, 12)}… confirms shortly`
              : `Sent and confirmed: ${hash.slice(0, 12)}…`,
        });
        return true;
      } catch (e) {
        setStatus({ kind: 'error', text: errorMessage(e) });
        return false;
      } finally {
        setSending(false);
      }
    },
    [asset, active],
  );

  return { validate, estimateFee, send, sending, status, setStatus, txUrl };
}
