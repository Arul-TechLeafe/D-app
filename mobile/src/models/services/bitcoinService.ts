import * as ecc from '@bitcoinerlab/secp256k1';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import { Psbt, address as btcAddress, networks, payments } from 'bitcoinjs-lib';
import { Mnemonic, getBytes } from 'ethers';

import { BITCOIN_MAINNET_DERIVATION_PATH, BITCOIN_TESTNET4 } from '../config/bitcoin';
import {
  broadcastTx,
  broadcastMainnetTx,
  fetchAddress,
  fetchAddressTxs,
  fetchAddressUtxos,
  fetchFees,
  fetchMainnetAddress,
  fetchMainnetAddressTxs,
  fetchMainnetAddressUtxos,
  fetchMainnetFees,
  type ApiAddressStats,
  type ApiTx,
} from './bitcoinApi';

// ---------------------------------------------------------------------------
// Bitcoin wallet service. Testnet4 and mainnet accounts are derived from the
// active wallet recovery phrase using their respective BIP84 coin types.
// ---------------------------------------------------------------------------

const bip32 = BIP32Factory(ecc);
/** Testnet4 uses the same address/key format as testnet3 ("tb1…" bech32). */
const NETWORK = networks.testnet;
/** Outputs below this are rejected by nodes as dust. */
export const DUST_LIMIT_SATS = 546n;
export const SATS_PER_BTC = 100_000_000n;

export type BitcoinAccount = { address: string; path: string };
export type BitcoinBalance = { confirmed: bigint; unconfirmed: bigint };
export type BitcoinTx = {
  txid: string;
  confirmed: boolean;
  /** Unix seconds; undefined while in the mempool. */
  time?: number;
  /** Net effect on this address in sats: positive = received, negative = sent. */
  amount: bigint;
  fee: bigint;
};
export type FeeRates = { slow: number; normal: number; fast: number };
export type BitcoinUtxo = { txid: string; vout: number; value: bigint; confirmed: boolean };

// ---- keys --------------------------------------------------------------------

const nodeCache = new Map<string, BIP32Interface>();

/** BIP39 seed (PBKDF2, slow-ish) → BIP84 key. Cached per phrase. */
function deriveNode(mnemonic: string): BIP32Interface {
  const cacheKey = `${mnemonic}:${BITCOIN_TESTNET4.derivationPath}`;
  let node = nodeCache.get(cacheKey);
  if (!node) {
    const seed = getBytes(Mnemonic.fromPhrase(mnemonic).computeSeed());
    node = bip32.fromSeed(seed, NETWORK).derivePath(BITCOIN_TESTNET4.derivationPath);
    nodeCache.set(cacheKey, node);
  }
  return node;
}

function deriveMainnetNode(mnemonic: string): BIP32Interface {
  const cacheKey = `${mnemonic}:${BITCOIN_MAINNET_DERIVATION_PATH}`;
  let node = nodeCache.get(cacheKey);
  if (!node) {
    const seed = getBytes(Mnemonic.fromPhrase(mnemonic).computeSeed());
    node = bip32.fromSeed(seed, networks.bitcoin).derivePath(BITCOIN_MAINNET_DERIVATION_PATH);
    nodeCache.set(cacheKey, node);
  }
  return node;
}

function outputScript(node: BIP32Interface, network: typeof NETWORK | typeof networks.bitcoin = NETWORK) {
  return payments.p2wpkh({ pubkey: node.publicKey, network });
}

export function deriveBitcoinAccount(mnemonic: string): BitcoinAccount {
  return { address: outputScript(deriveNode(mnemonic), NETWORK).address!, path: BITCOIN_TESTNET4.derivationPath };
}

/** Derives the first native SegWit mainnet address from the wallet recovery phrase. */
export function deriveMainnetBitcoinAccount(mnemonic: string): BitcoinAccount {
  return {
    address: outputScript(deriveMainnetNode(mnemonic), networks.bitcoin).address!,
    path: BITCOIN_MAINNET_DERIVATION_PATH,
  };
}

export function isValidBitcoinAddress(value: string) {
  try {
    btcAddress.toOutputScript(value.trim(), NETWORK);
    return true;
  } catch {
    return false;
  }
}

/** Validates a real Bitcoin MAINNET address (starts "bc1", "1" or "3"). */
export function isValidMainnetBitcoinAddress(value: string) {
  try {
    btcAddress.toOutputScript(value.trim(), networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

// ---- amounts -----------------------------------------------------------------

/** "0.0001" → 10000n sats. Throws on bad input or more than 8 decimals. */
export function parseBtc(input: string): bigint {
  const value = input.trim();
  if (!/^\d+(\.\d{0,8})?$/.test(value)) throw new Error('Enter an amount like 0.0001 (max 8 decimals)');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SATS_PER_BTC + BigInt(fraction.padEnd(8, '0'));
}

/** 10000n sats → "0.0001". */
export function formatBtc(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BTC;
  const fraction = (abs % SATS_PER_BTC).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

// ---- data from the Blockchain API (Axios client in bitcoinApi.ts) -----------------

export async function getBitcoinBalance(address: string): Promise<BitcoinBalance> {
  const data = await fetchAddress(address);
  const net = (s: ApiAddressStats) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  return { confirmed: net(data.chain_stats), unconfirmed: net(data.mempool_stats) };
}

/** Unspent outputs, largest first. */
export async function getBitcoinUtxos(address: string): Promise<BitcoinUtxo[]> {
  const utxos = await fetchAddressUtxos(address);
  return utxos
    .map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: u.status.confirmed }))
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
}

function mapApiTx(tx: ApiTx, address: string): BitcoinTx {
  const received = tx.vout
    .filter((o) => o.scriptpubkey_address === address)
    .reduce((sum, o) => sum + BigInt(o.value), 0n);
  const sent = tx.vin
    .filter((i) => i.prevout?.scriptpubkey_address === address)
    .reduce((sum, i) => sum + BigInt(i.prevout!.value), 0n);
  return {
    txid: tx.txid,
    confirmed: tx.status.confirmed,
    time: tx.status.block_time,
    amount: received - sent,
    fee: BigInt(tx.fee),
  };
}

/** Latest transactions (mempool first, then up to 25 confirmed), newest first. */
export async function getBitcoinTransactions(address: string): Promise<BitcoinTx[]> {
  const txs = await fetchAddressTxs(address);
  return txs.map((tx) => mapApiTx(tx, address));
}

// ---- Bitcoin MAINNET --------------------------------------------------------------

export async function getMainnetBitcoinBalance(address: string): Promise<BitcoinBalance> {
  const data = await fetchMainnetAddress(address);
  const net = (s: ApiAddressStats) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  return { confirmed: net(data.chain_stats), unconfirmed: net(data.mempool_stats) };
}

/** Latest transactions (mempool first, then up to 25 confirmed), newest first. */
export async function getMainnetBitcoinTransactions(address: string): Promise<BitcoinTx[]> {
  const txs = await fetchMainnetAddressTxs(address);
  return txs.map((tx) => mapApiTx(tx, address));
}

async function getMainnetBitcoinUtxos(address: string): Promise<BitcoinUtxo[]> {
  const utxos = await fetchMainnetAddressUtxos(address);
  return utxos
    .map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: u.status.confirmed }))
    .filter((u) => u.confirmed)
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
}

/** Recommended fee rates in sat/vB. */
export async function getFeeRates(): Promise<FeeRates> {
  const f = await fetchFees();
  return { slow: Math.max(1, f.hourFee), normal: Math.max(1, f.halfHourFee), fast: Math.max(1, f.fastestFee) };
}

export async function estimateBitcoinFee(params: {
  mnemonic: string;
  amountSats: bigint;
  feeRate: number;
}): Promise<bigint> {
  if (!Number.isFinite(params.feeRate) || params.feeRate <= 0) throw new Error('Invalid Bitcoin fee rate');
  if (params.amountSats < DUST_LIMIT_SATS) throw new Error(`Minimum amount is ${formatBtc(DUST_LIMIT_SATS)} tBTC`);
  const own = outputScript(deriveNode(params.mnemonic), NETWORK);
  const utxos = await getBitcoinUtxos(own.address!);
  if (!utxos.length) throw new Error('No spendable Bitcoin testnet outputs found for this wallet');
  return selectPaymentUtxos(utxos, params.amountSats, params.feeRate).fee;
}

export async function getMainnetFeeRates(): Promise<FeeRates> {
  const f = await fetchMainnetFees();
  return { slow: Math.max(1, f.hourFee), normal: Math.max(1, f.halfHourFee), fast: Math.max(1, f.fastestFee) };
}

// ---- sending -------------------------------------------------------------------

/** Virtual size of a P2WPKH transaction with the given input/output counts. */
function estimateVsize(inputs: number, outputs: number) {
  return Math.ceil(10.5 + inputs * 68 + outputs * 31);
}

function feeFor(inputs: number, outputs: number, feeRate: number) {
  return BigInt(Math.ceil(estimateVsize(inputs, outputs) * feeRate));
}

function selectPaymentUtxos(utxos: BitcoinUtxo[], amountSats: bigint, feeRate: number, symbol = 'BTC') {
  const selected: BitcoinUtxo[] = [];
  let total = 0n;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.value;
    if (total >= amountSats + feeFor(selected.length, 2, feeRate)) break;
  }

  const change = total - amountSats - feeFor(selected.length, 2, feeRate);
  if (change < DUST_LIMIT_SATS) {
    const minimumFee = feeFor(selected.length, 1, feeRate);
    if (total < amountSats + minimumFee) {
      throw new Error(`Insufficient ${symbol}: have ${formatBtc(total)}, need ${formatBtc(amountSats + minimumFee)} including fee`);
    }
    return { selected, fee: total - amountSats, change: 0n };
  }

  const fee = feeFor(selected.length, 2, feeRate);
  if (total < amountSats + fee) {
    throw new Error(`Insufficient ${symbol}: have ${formatBtc(total)}, need ${formatBtc(amountSats + fee)} including fee`);
  }
  return { selected, fee, change };
}

/**
 * Builds, signs and broadcasts a tBTC payment. Spends the largest UTXOs first and
 * returns change to the same address. Resolves with the txid once broadcast.
 */
export async function sendBitcoin(params: {
  mnemonic: string;
  to: string;
  amountSats: bigint;
  feeRate: number;
}): Promise<{ txid: string; fee: bigint }> {
  const { mnemonic, to, amountSats, feeRate } = params;
  if (!isValidBitcoinAddress(to)) throw new Error('Invalid testnet address (should start with tb1)');
  if (amountSats < DUST_LIMIT_SATS) throw new Error(`Minimum amount is ${formatBtc(DUST_LIMIT_SATS)} tBTC`);

  const node = deriveNode(mnemonic);
  const own = outputScript(node);
  const utxos = await getBitcoinUtxos(own.address!);

  const { selected, fee, change } = selectPaymentUtxos(utxos, amountSats, feeRate, 'tBTC');

  const psbt = new Psbt({ network: NETWORK });
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: own.output!, value: utxo.value },
    });
  }
  psbt.addOutput({ address: to.trim(), value: amountSats });
  if (change > 0n) psbt.addOutput({ address: own.address!, value: change });

  psbt.signAllInputs(node);
  psbt.finalizeAllInputs();
  const hex = psbt.extractTransaction().toHex();

  const txid = await broadcastTx(hex);
  return { txid, fee };
}

export async function estimateMainnetBitcoinFee(params: {
  mnemonic: string;
  amountSats: bigint;
  feeRate: number;
}): Promise<bigint> {
  if (!Number.isFinite(params.feeRate) || params.feeRate <= 0) throw new Error('Invalid Bitcoin fee rate');
  if (params.amountSats < DUST_LIMIT_SATS) throw new Error(`Minimum amount is ${formatBtc(DUST_LIMIT_SATS)} BTC`);
  const own = outputScript(deriveMainnetNode(params.mnemonic), networks.bitcoin);
  const utxos = await getMainnetBitcoinUtxos(own.address!);
  if (!utxos.length) throw new Error('No spendable Bitcoin mainnet outputs found for this wallet');
  return selectPaymentUtxos(utxos, params.amountSats, params.feeRate).fee;
}

export async function sendMainnetBitcoin(params: {
  mnemonic: string;
  to: string;
  amountSats: bigint;
  feeRate: number;
  maxFeeSats?: bigint;
}): Promise<{ txid: string; fee: bigint }> {
  const { mnemonic, to, amountSats, feeRate } = params;
  if (!isValidMainnetBitcoinAddress(to)) throw new Error('Invalid Bitcoin mainnet address');
  if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('Invalid Bitcoin fee rate');
  if (amountSats < DUST_LIMIT_SATS) throw new Error(`Minimum amount is ${formatBtc(DUST_LIMIT_SATS)} BTC`);

  const own = outputScript(deriveMainnetNode(mnemonic), networks.bitcoin);
  const utxos = await getMainnetBitcoinUtxos(own.address!);
  if (!utxos.length) throw new Error('No spendable Bitcoin mainnet outputs found for this wallet');
  const { selected, fee, change } = selectPaymentUtxos(utxos, amountSats, feeRate);
  if (params.maxFeeSats !== undefined && fee > params.maxFeeSats) {
    throw new Error('Bitcoin network fee increased; estimate the fee and review the transaction again');
  }

  const psbt = new Psbt({ network: networks.bitcoin });
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: own.output!, value: utxo.value },
    });
  }
  psbt.addOutput({ address: to.trim(), value: amountSats });
  if (change > 0n) psbt.addOutput({ address: own.address!, value: change });
  psbt.signAllInputs(deriveMainnetNode(mnemonic));
  psbt.finalizeAllInputs();

  const txid = await broadcastMainnetTx(psbt.extractTransaction().toHex());
  return { txid, fee };
}
