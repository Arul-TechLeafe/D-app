/**
 * Bitcoin TESTNET4. Test coins (tBTC) have no real value. Addresses start with "tb1".
 * Data and broadcasting go through the public mempool.space Esplora API.
 */
export const BITCOIN_TESTNET4 = {
  name: 'Bitcoin Testnet4',
  symbol: 'tBTC',
  apiUrl: 'https://mempool.space/testnet4/api',
  explorerUrl: 'https://mempool.space/testnet4',
  faucetUrl: 'https://mempool.space/testnet4/faucet',
  /** BIP84 native SegWit, testnet coin type 1, first receive address. */
  derivationPath: "m/84'/1'/0'/0/0",
} as const;

/** BIP84 native SegWit, Bitcoin mainnet coin type 0, first receive address. */
export const BITCOIN_MAINNET_DERIVATION_PATH = "m/84'/0'/0'/0/0";

export function bitcoinTxUrl(txid: string) {
  return `${BITCOIN_TESTNET4.explorerUrl}/tx/${txid}`;
}

export function bitcoinAddressUrl(address: string) {
  return `${BITCOIN_TESTNET4.explorerUrl}/address/${address}`;
}

/**
 * Bitcoin MAINNET. Real BTC, real value. Native sends are locally signed with
 * the active wallet's BIP84 mainnet key after explicit review and PIN approval.
 */
export const BITCOIN_MAINNET = {
  name: 'Bitcoin',
  symbol: 'BTC',
  apiUrl: 'https://mempool.space/api',
  explorerUrl: 'https://mempool.space',
} as const;

export function bitcoinMainnetTxUrl(txid: string) {
  return `${BITCOIN_MAINNET.explorerUrl}/tx/${txid}`;
}

export function bitcoinMainnetAddressUrl(address: string) {
  return `${BITCOIN_MAINNET.explorerUrl}/address/${address}`;
}
