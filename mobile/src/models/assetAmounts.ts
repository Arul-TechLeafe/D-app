import { isAddress, parseEther } from 'ethers';

import type { Asset } from './config/assets';
import { formatEth } from './format';
import { formatBtc, isValidBitcoinAddress, isValidMainnetBitcoinAddress, parseBtc } from './services/bitcoinService';
import { formatSol, isValidSolanaAddress, parseSol } from './services/solanaService';

/** Smallest units (sats / lamports / wei) → display string in the asset's unit. */
export function formatAssetAmount(asset: Asset, amount: bigint, decimals = 6): string {
  if (asset.kind === 'bitcoin') return formatBtc(amount);
  if (asset.kind === 'solana') return formatSol(amount, decimals);
  return formatEth(amount, decimals);
}

/** Display string → smallest units. Throws a readable error on bad input. */
export function parseAssetAmount(asset: Asset, input: string): bigint {
  const value = input.trim();
  if (asset.kind === 'bitcoin') return parseBtc(value);
  if (asset.kind === 'solana') return parseSol(value);
  try {
    return parseEther(value);
  } catch {
    throw new Error(`Enter an amount like 0.01 ${asset.symbol}`);
  }
}

export function isValidAssetAddress(asset: Asset, value: string): boolean {
  if (asset.kind === 'bitcoin') return asset.mainnet ? isValidMainnetBitcoinAddress(value) : isValidBitcoinAddress(value);
  if (asset.kind === 'solana') return isValidSolanaAddress(value);
  return isAddress(value.trim());
}

/** The receive address for `asset` given the wallet's EVM, Bitcoin and Solana addresses. */
export function assetAddress(
  asset: Asset,
  evmAddress: string,
  btcAddress: string,
  solAddress: string,
  btcMainnetAddress: string,
) {
  if (asset.kind === 'bitcoin') return asset.mainnet ? btcMainnetAddress : btcAddress;
  if (asset.kind === 'solana') return solAddress;
  return evmAddress;
}
