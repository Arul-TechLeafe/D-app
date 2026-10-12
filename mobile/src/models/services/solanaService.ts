import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import bs58 from 'bs58';
import { formatUnits, getBytes, Mnemonic, parseUnits } from 'ethers';

import { SOLANA_DEVNET } from '../config/solana';
import {
  fetchBalance,
  fetchFeeForMessage,
  fetchLatestBlockhash,
  fetchSignaturesForAddress,
  fetchTransaction,
  requestAirdrop,
  sendRawTransaction,
  solanaDevnetClient,
  solanaMainnetClient,
  type SolanaClient,
} from './solanaApi';

// ---------------------------------------------------------------------------
// Solana wallet service. The key is derived from the same 12-word recovery
// phrase as the in-app Bitcoin/Ethereum wallets (SLIP-0010 ed25519,
// m/44'/501'/0'/0'). Mainnet and devnet share this key; both support native SOL.
//
// Built on @noble/curves + @noble/hashes + bs58 directly (no @solana/web3.js):
// those are pure-Uint8Array, audited primitives already in this app's
// dependency tree, so this needs no Buffer/stream polyfills to run on RN.
// ---------------------------------------------------------------------------

export type SolanaAccount = { address: string; path: string };
export type SolanaTx = {
  signature: string;
  confirmed: boolean;
  /** Unix seconds; undefined if not yet available. */
  time?: number;
  /** Net effect on this address in lamports: positive = received, negative = sent. */
  amount: bigint;
  fee: bigint;
};

export const LAMPORTS_PER_SOL = 1_000_000_000n;

// ---- keys --------------------------------------------------------------------

const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const nodeCache = new Map<string, Uint8Array>();

/** SLIP-0010 ed25519 HD derivation. Every level must be hardened (ed25519 has no unhardened derivation). */
function slip10DeriveEd25519(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32, 64);

  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => {
      if (!segment.endsWith("'")) throw new Error("SLIP-0010 ed25519 requires an all-hardened path (e.g. \"44'\")");
      return (parseInt(segment.slice(0, -1), 10) | 0x80000000) >>> 0;
    });

  for (const index of segments) {
    const data = new Uint8Array(1 + 32 + 4);
    data.set(key, 1);
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;
    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32, 64);
  }

  return key;
}

/** BIP39 seed (PBKDF2, slow-ish) → SLIP-0010 ed25519 key. Cached per phrase. */
function deriveSolanaPrivateKey(mnemonic: string): Uint8Array {
  let key = nodeCache.get(mnemonic);
  if (!key) {
    const seed = getBytes(Mnemonic.fromPhrase(mnemonic).computeSeed());
    key = slip10DeriveEd25519(seed, SOLANA_DEVNET.derivationPath);
    nodeCache.set(mnemonic, key);
  }
  return key;
}

export function deriveSolanaAccount(mnemonic: string): SolanaAccount {
  const priv = deriveSolanaPrivateKey(mnemonic);
  const pub = ed25519.getPublicKey(priv);
  return { address: bs58.encode(pub), path: SOLANA_DEVNET.derivationPath };
}

export function isValidSolanaAddress(value: string): boolean {
  try {
    return bs58.decode(value.trim()).length === 32;
  } catch {
    return false;
  }
}

// ---- amounts -----------------------------------------------------------------

/** "0.01" → 10000000n lamports. Throws on bad input or more than 9 decimals. */
export function parseSol(input: string): bigint {
  try {
    return parseUnits(input.trim(), 9);
  } catch {
    throw new Error('Enter an amount like 0.01 SOL (max 9 decimals)');
  }
}

/** 10000000n lamports → "0.01". */
export function formatSol(lamports: bigint, decimals = 6): string {
  const [whole, fraction = ''] = formatUnits(lamports, 9).split('.');
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

// ---- data from the Solana RPC (Axios client in solanaApi.ts) ---------------------

export async function getSolanaBalance(address: string): Promise<bigint> {
  return fetchBalance(solanaDevnetClient, address);
}

export async function getMainnetSolanaBalance(address: string): Promise<bigint> {
  return fetchBalance(solanaMainnetClient, address);
}

async function mapSignature(client: SolanaClient, address: string, sig: { signature: string; blockTime: number | null; err: unknown }): Promise<SolanaTx> {
  const tx = await fetchTransaction(client, sig.signature);
  if (!tx?.meta) throw new Error(`Transaction details are unavailable for ${sig.signature}`);
  const idx = tx.transaction.message.accountKeys.findIndex(
    (k) => (typeof k === 'string' ? k : k.pubkey) === address,
  );
  if (idx < 0) throw new Error(`Wallet address was not found in transaction ${sig.signature}`);
  const pre = tx.meta.preBalances[idx];
  const post = tx.meta.postBalances[idx];
  if (pre === undefined || post === undefined) throw new Error(`Balance changes are unavailable for ${sig.signature}`);
  return {
    signature: sig.signature,
    confirmed: !sig.err,
    time: sig.blockTime ?? undefined,
    amount: BigInt(post - pre),
    fee: BigInt(tx.meta.fee),
  };
}

/** Latest transactions, newest first. */
export async function getSolanaTransactions(address: string): Promise<SolanaTx[]> {
  const sigs = await fetchSignaturesForAddress(solanaDevnetClient, address);
  return Promise.all(sigs.map((s) => mapSignature(solanaDevnetClient, address, s)));
}

export async function getMainnetSolanaTransactions(address: string): Promise<SolanaTx[]> {
  const sigs = await fetchSignaturesForAddress(solanaMainnetClient, address);
  return Promise.all(sigs.map((s) => mapSignature(solanaMainnetClient, address, s)));
}

/** Devnet only: requests 1 SOL of free test coin from the cluster faucet. */
export async function requestSolanaAirdrop(address: string): Promise<string> {
  return requestAirdrop(solanaDevnetClient, address, LAMPORTS_PER_SOL);
}

// ---- native SOL transfers ----------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return out;
}

/** Solana "shortvec" compact-u16 encoding used throughout the wire format. */
function encodeShortU16(value: number): number[] {
  const out: number[] = [];
  let v = value;
  for (;;) {
    const byte = v & 0x7f;
    v >>>= 7;
    if (v === 0) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

/** Legacy Message for a single SystemProgram::Transfer instruction, one signer. */
function buildTransferMessage(params: { payer: Uint8Array; recipient: Uint8Array; lamports: bigint; recentBlockhash: Uint8Array }): Uint8Array {
  const systemProgramId = new Uint8Array(32); // all-zero pubkey = "11111111111111111111111111111111"
  const accountKeys = [params.payer, params.recipient, systemProgramId];

  // SystemProgram::Transfer = Borsh u32 instruction index (2) + u64 lamports, both little-endian.
  const instructionData = new Uint8Array(12);
  new DataView(instructionData.buffer).setUint32(0, 2, true);
  new DataView(instructionData.buffer).setBigUint64(4, params.lamports, true);

  const bytes: number[] = [
    1, 0, 1, // header: 1 required signature, 0 readonly-signed, 1 readonly-unsigned (SystemProgram)
    ...encodeShortU16(accountKeys.length),
    ...accountKeys.flatMap((k) => Array.from(k)),
    ...params.recentBlockhash,
    ...encodeShortU16(1), // 1 instruction
    2, // programIdIndex → systemProgramId
    ...encodeShortU16(2), // 2 instruction accounts
    0, 1, // payer, recipient (indices into accountKeys)
    ...encodeShortU16(instructionData.length),
    ...instructionData,
  ];
  return new Uint8Array(bytes);
}

export async function estimateSolanaTransferFee(params: {
  from: string;
  to: string;
  amountLamports: bigint;
  mainnet?: boolean;
}): Promise<bigint> {
  const payer = bs58.decode(params.from.trim());
  const recipient = bs58.decode(params.to.trim());
  if (payer.length !== 32 || recipient.length !== 32) throw new Error('Enter valid Solana addresses');
  if (params.from.trim() === params.to.trim()) throw new Error('Choose a recipient address different from your wallet');
  const client = params.mainnet ? solanaMainnetClient : solanaDevnetClient;
  const recentBlockhash = bs58.decode(await fetchLatestBlockhash(client));
  const message = buildTransferMessage({ payer, recipient, lamports: params.amountLamports, recentBlockhash });
  return fetchFeeForMessage(client, bytesToBase64(message));
}

export async function sendSolana(params: {
  mnemonic: string;
  to: string;
  amountLamports: bigint;
  mainnet?: boolean;
  maxFeeLamports?: bigint;
}): Promise<{ signature: string }> {
  const priv = deriveSolanaPrivateKey(params.mnemonic);
  const payer = ed25519.getPublicKey(priv);
  const recipient = bs58.decode(params.to.trim());
  if (recipient.length !== 32) throw new Error('Invalid Solana address');

  const client = params.mainnet ? solanaMainnetClient : solanaDevnetClient;
  const estimatedFee = await estimateSolanaTransferFee({
    from: bs58.encode(payer),
    to: params.to,
    amountLamports: params.amountLamports,
    mainnet: params.mainnet,
  });
  if (params.maxFeeLamports !== undefined && estimatedFee > params.maxFeeLamports) {
    throw new Error('Solana network fee increased; estimate the fee and review the transaction again');
  }
  const recentBlockhash = bs58.decode(await fetchLatestBlockhash(client));
  const message = buildTransferMessage({ payer, recipient, lamports: params.amountLamports, recentBlockhash });
  const signature = ed25519.sign(message, priv);

  const tx = new Uint8Array(1 + signature.length + message.length);
  tx[0] = 1; // shortvec(1 signature)
  tx.set(signature, 1);
  tx.set(message, 1 + signature.length);

  const sig = await sendRawTransaction(client, bytesToBase64(tx));
  return { signature: sig };
}
