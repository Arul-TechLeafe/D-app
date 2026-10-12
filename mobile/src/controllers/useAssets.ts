import { useCallback } from 'react';
import { isAddress } from 'ethers';

import { ASSETS, type Asset, type AssetId } from '../models/config/assets';
import { errorMessage } from '../models/format';
import { getBitcoinBalance, getMainnetBitcoinBalance } from '../models/services/bitcoinService';
import { getEvmBalance } from '../models/services/ethereumService';
import { getMainnetSolanaBalance, getSolanaBalance } from '../models/services/solanaService';
import { useAsync } from './useAsync';
import { useWalletStore } from './WalletStore';

export type AssetBalance = {
  asset: Asset;
  address: string;
  /** Confirmed + pending, in sats / wei. Undefined when the network couldn't be reached. */
  balance?: bigint;
  /** Bitcoin only: incoming/outgoing amount still in the mempool. */
  pending?: bigint;
  error?: string;
};

/** An unreachable RPC (e.g. Hardhat not running) would otherwise hang for minutes. */
const BALANCE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Network timeout')), BALANCE_TIMEOUT_MS)),
  ]);
}

async function loadBalance(asset: Asset, evmAddress: string, btcAddress: string, solAddress: string): Promise<AssetBalance> {
  const address = asset.kind === 'bitcoin' ? btcAddress : asset.kind === 'solana' ? solAddress : evmAddress;
  try {
    if (asset.kind === 'bitcoin') {
      const { confirmed, unconfirmed } = await withTimeout(getBitcoinBalance(address));
      return { asset, address, balance: confirmed + unconfirmed, pending: unconfirmed };
    }
    if (asset.kind === 'solana') {
      return { asset, address, balance: await withTimeout(getSolanaBalance(address)) };
    }
    return { asset, address, balance: await withTimeout(getEvmBalance(address, asset.chain)) };
  } catch (e) {
    return { asset, address, error: errorMessage(e) };
  }
}

/** Mainnet ETH balance lookup for the address derived from the active wallet. */
async function loadMainnetEvmBalance(asset: Asset & { kind: 'evm' }, address: string): Promise<AssetBalance> {
  if (!isAddress(address)) return { asset, address, error: 'Derived Ethereum address is invalid' };
  try {
    return { asset, address, balance: await withTimeout(getEvmBalance(address, asset.chain)) };
  } catch (e) {
    return { asset, address, error: errorMessage(e) };
  }
}

/** Mainnet BTC balance lookup for the address derived from the active wallet. */
async function loadWatchedBitcoinBalance(asset: Asset, address: string): Promise<AssetBalance> {
  try {
    const { confirmed, unconfirmed } = await withTimeout(getMainnetBitcoinBalance(address));
    return { asset, address, balance: confirmed + unconfirmed, pending: unconfirmed };
  } catch (e) {
    return { asset, address, error: errorMessage(e) };
  }
}

/** Mainnet SOL balance lookup for the address derived from the active wallet. */
async function loadWatchedSolanaBalance(asset: Asset, address: string): Promise<AssetBalance> {
  try {
    return { asset, address, balance: await withTimeout(getMainnetSolanaBalance(address)) };
  } catch (e) {
    return { asset, address, error: errorMessage(e) };
  }
}

/** Balances of every coin for the active wallet. Each coin loads independently. */
export function useAssets() {
  const { active } = useWalletStore();
  const evm = active?.keys.address;
  const btc = active?.btcAddress;
  const btcMainnet = active?.btcMainnetAddress;
  const sol = active?.solAddress;

  const load = useCallback(
    () =>
      Promise.all(
        ASSETS.map((asset) => {
          if (asset.kind === 'evm' && asset.mainnet) return loadMainnetEvmBalance(asset, evm!);
          if (asset.kind === 'bitcoin' && asset.mainnet) return loadWatchedBitcoinBalance(asset, btcMainnet!);
          if (asset.kind === 'solana' && asset.mainnet) return loadWatchedSolanaBalance(asset, sol!);
          return loadBalance(asset, evm!, btc!, sol!);
        }),
      ),
    [evm, btc, btcMainnet, sol],
  );
  const { data, loading, refresh } = useAsync(evm && btc && btcMainnet && sol ? load : undefined);

  const byId = (id: AssetId) => data?.find((b) => b.asset.id === id);
  return {
    balances: data,
    byId,
    loading,
    refresh,
  };
}
