import { useCallback } from 'react';

import { ASSETS, getAsset, type Asset, type AssetId } from '../models/config/assets';
import { errorMessage, formatEth } from '../models/format';
import { getEvmTransactions } from '../models/services/evmHistoryService';
import { formatBtc, getBitcoinTransactions, getMainnetBitcoinTransactions } from '../models/services/bitcoinService';
import { formatSol, getMainnetSolanaTransactions, getSolanaTransactions, type SolanaTx } from '../models/services/solanaService';
import { loadActivity } from '../models/services/walletStorage';
import { useAsync } from './useAsync';
import { useWalletStore } from './WalletStore';

export type HistoryItem = {
  key: string;
  asset: Asset;
  direction: 'in' | 'out';
  /** Display amount in the asset's unit, without sign. */
  //testing
  amount: string;
  counterparty?: string;
  /** Milliseconds; undefined while pending. */
  time?: number;
  pending: boolean;
  url?: string;
};

/**
 * Transaction history for the active wallet:
 * - Bitcoin: full on-chain history from mempool.space (sent + received).
 * - Ethereum (Sepolia + Mainnet): full history from Blockscout, plus sends not yet indexed.
 */
const EXCLUDED_FROM_ACTIVITY_LOG: AssetId[] = ['btc', 'btc-mainnet', 'sol', 'solana-mainnet'];

async function loadHistoryOrEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (error) {
    if (/\b404\b/.test(errorMessage(error))) return [];
    throw error;
  }
}

export function useHistory(filter?: AssetId) {
  const { active } = useWalletStore();
  const walletId = active?.id;
  const btcAddress = active?.btcAddress;
  const btcMainnetAddress = active?.btcMainnetAddress;
  const evmAddress = active?.keys.address;
  const solAddress = active?.solAddress;

  const load = useCallback(async (): Promise<HistoryItem[]> => {
    const btc = ASSETS.find((a) => a.id === 'btc')!;
    const btcMainnet = ASSETS.find((a) => a.id === 'btc-mainnet')!;
    const sol = ASSETS.find((a) => a.id === 'sol')!;
    const solMainnet = ASSETS.find((a) => a.id === 'solana-mainnet')!;
    const evmAssets = (['sepolia', 'ethereum'] as const).filter((id) => !filter || filter === id);
    const [activity, evmTxs, btcTxs, btcMainnetTxs, solTxs, solMainnetTxs] = await Promise.all([
      loadActivity(),
      Promise.all(
        evmAssets.map((id) =>
          evmAddress
            ? loadHistoryOrEmpty(() => getEvmTransactions(id, evmAddress))
            : Promise.resolve([]),
        ),
      ),
      !filter || filter === 'btc' ? loadHistoryOrEmpty(() => getBitcoinTransactions(btcAddress!)) : Promise.resolve([]),
      (!filter || filter === 'btc-mainnet') && btcMainnetAddress
        ? loadHistoryOrEmpty(() => getMainnetBitcoinTransactions(btcMainnetAddress))
        : Promise.resolve([]),
      !filter || filter === 'sol' ? getSolanaTransactions(solAddress!) : Promise.resolve([]),
      (!filter || filter === 'solana-mainnet') && solAddress
        ? getMainnetSolanaTransactions(solAddress)
        : Promise.resolve([]),
    ]);

    // Full on-chain history (sent + received) from the explorer.
    const chainHashes = new Set<string>();
    const evmChainItems: HistoryItem[] = evmAssets.flatMap((id, i) => {
      const asset = getAsset(id)!;
      const accountAddress = evmAddress;
      if (!accountAddress) return [];
      return evmTxs[i].map((tx): HistoryItem => {
        chainHashes.add(tx.hash.toLowerCase());
        const out = tx.from.toLowerCase() === accountAddress.toLowerCase();
        return {
          key: `${id}-${tx.hash}`,
          asset,
          direction: out ? 'out' : 'in',
          amount: formatEth(tx.value),
          counterparty: out ? tx.to : tx.from,
          time: tx.time ? tx.time * 1000 : undefined,
          pending: !tx.confirmed,
          url: asset.txUrl?.(tx.hash),
        };
      });
    });

    // Sent from this app but not yet indexed by the explorer.
    const evmItems: HistoryItem[] = activity
      .filter(
        (a) =>
          a.walletId === walletId &&
          !EXCLUDED_FROM_ACTIVITY_LOG.includes(a.asset) &&
          (!filter || a.asset === filter) &&
          !chainHashes.has(a.hash.toLowerCase()),
      )
      .map((a) => {
        const asset = getAsset(a.asset)!;
        return {
          key: `evm-${a.id}`,
          asset,
          direction: 'out',
          amount: a.amount,
          counterparty: a.to,
          time: a.time,
          pending: false,
          url: asset.txUrl?.(a.hash),
        };
      });

    const mapBtcTx = (asset: Asset) => (tx: (typeof btcTxs)[number]): HistoryItem => ({
      key: `${asset.id}-${tx.txid}`,
      asset,
      direction: tx.amount >= 0n ? 'in' : 'out',
      amount: formatBtc(tx.amount >= 0n ? tx.amount : -tx.amount),
      time: tx.time ? tx.time * 1000 : undefined,
      pending: !tx.confirmed,
      url: asset.txUrl?.(tx.txid),
    });

    const mapSolTx = (asset: Asset) => (tx: SolanaTx): HistoryItem => ({
      key: `${asset.id}-${tx.signature}`,
      asset,
      direction: tx.amount >= 0n ? 'in' : 'out',
      amount: formatSol(tx.amount >= 0n ? tx.amount : -tx.amount),
      time: tx.time ? tx.time * 1000 : undefined,
      pending: !tx.confirmed,
      url: asset.txUrl?.(tx.signature),
    });

    const btcItems: HistoryItem[] = btcTxs.map(mapBtcTx(btc));
    const btcMainnetItems: HistoryItem[] = btcMainnetTxs.map(mapBtcTx(btcMainnet));
    const solItems: HistoryItem[] = solTxs.map(mapSolTx(sol));
    const solMainnetItems: HistoryItem[] = solMainnetTxs.map(mapSolTx(solMainnet));

    // Pending first, then newest first.
    return [...evmChainItems, ...evmItems, ...btcItems, ...btcMainnetItems, ...solItems, ...solMainnetItems].sort(
      (a, b) => (b.time ?? Infinity) - (a.time ?? Infinity),
    );
  }, [walletId, evmAddress, btcAddress, btcMainnetAddress, solAddress, filter]);

  const { data, loading, error, refresh } = useAsync(walletId && btcAddress && solAddress ? load : undefined);
  return { items: data, loading, error, refresh };
}
