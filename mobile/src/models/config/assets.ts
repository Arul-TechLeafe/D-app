import type { AppKitNetwork } from '@reown/appkit-react-native';

import { BITCOIN_MAINNET, BITCOIN_TESTNET4, bitcoinAddressUrl, bitcoinMainnetAddressUrl, bitcoinMainnetTxUrl, bitcoinTxUrl } from './bitcoin';
import { SEPOLIA_FAUCET_URL, mainnet, sepolia } from './networks';
import { SOLANA_DEVNET, solanaDevnetAddressUrl, solanaDevnetTxUrl, solanaMainnetAddressUrl, solanaMainnetTxUrl } from './solana';

export type AssetId = 'btc' | 'btc-mainnet' | 'sepolia' | 'ethereum' | 'sol' | 'solana-mainnet';

type AssetBase = {
  id: AssetId;
  name: string;
  networkName: string;
  symbol: string;
  /** Brand-ish color for the coin badge. */
  color: string;
  /** Short text shown inside the coin badge. */
  badge: string;
  faucetUrl?: string;
  txUrl?: (hash: string) => string;
  addressUrl?: (address: string) => string;
  /** Real funds; mainnet transfers require explicit review and PIN approval. */
  mainnet?: boolean;
  /** Asset is display-only. */
  readOnly?: boolean;
};

export type Asset =
  | (AssetBase & { kind: 'bitcoin' })
  | (AssetBase & { kind: 'evm'; chain: AppKitNetwork })
  | (AssetBase & { kind: 'solana' });

/** Mainnet entries use addresses derived from the active wallet and support native-coin transfers. */
export const ASSETS: Asset[] = [
  {
    id: 'btc',
    kind: 'bitcoin',
    name: 'Bitcoin',
    networkName: 'Testnet4',
    symbol: BITCOIN_TESTNET4.symbol,
    color: '#F7931A',
    badge: '₿',
    faucetUrl: BITCOIN_TESTNET4.faucetUrl,
    txUrl: bitcoinTxUrl,
    addressUrl: bitcoinAddressUrl,
  },
  {
    id: 'sepolia',
    kind: 'evm',
    chain: sepolia,
    name: 'Ethereum',
    networkName: 'Sepolia',
    symbol: 'SepoliaETH',
    color: '#627EEA',
    badge: 'Ξ',
    faucetUrl: SEPOLIA_FAUCET_URL,
    txUrl: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
    addressUrl: (address) => `https://sepolia.etherscan.io/address/${address}`,
  },
  {
    id: 'ethereum',
    kind: 'evm',
    chain: mainnet,
    name: 'Ethereum',
    networkName: 'Mainnet',
    symbol: 'ETH',
    color: '#627EEA',
    badge: 'Ξ',
    mainnet: true,
    txUrl: (hash) => `https://etherscan.io/tx/${hash}`,
    addressUrl: (address) => `https://etherscan.io/address/${address}`,
  },
  {
    id: 'btc-mainnet',
    kind: 'bitcoin',
    name: 'Bitcoin',
    networkName: 'Mainnet',
    symbol: BITCOIN_MAINNET.symbol,
    color: '#F7931A',
    badge: '₿',
    mainnet: true,
    txUrl: bitcoinMainnetTxUrl,
    addressUrl: bitcoinMainnetAddressUrl,
  },
  {
    id: 'sol',
    kind: 'solana',
    name: 'Solana',
    networkName: 'Devnet',
    symbol: SOLANA_DEVNET.symbol,
    color: '#9945FF',
    badge: 'S',
    faucetUrl: SOLANA_DEVNET.faucetUrl,
    txUrl: solanaDevnetTxUrl,
    addressUrl: solanaDevnetAddressUrl,
  },
  {
    id: 'solana-mainnet',
    kind: 'solana',
    name: 'Solana',
    networkName: 'Mainnet',
    symbol: 'SOL',
    color: '#9945FF',
    badge: 'S',
    mainnet: true,
    txUrl: solanaMainnetTxUrl,
    addressUrl: solanaMainnetAddressUrl,
  },
];

export function getAsset(id: string | undefined): Asset | undefined {
  return ASSETS.find((a) => a.id === id);
}
