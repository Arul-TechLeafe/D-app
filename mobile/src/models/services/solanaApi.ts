import { create, isAxiosError, type AxiosError } from 'axios';

import { SOLANA_DEVNET, SOLANA_MAINNET } from '../config/solana';
import { SOLANA_MAINNET_RPC_FALLBACK_URL } from '../config/env';

// ---------------------------------------------------------------------------
// Solana JSON-RPC client (Axios → Solana cluster RPC endpoint).
//
//   React Native app ──Axios──▶ Solana RPC (single POST endpoint)
//                                ├─ getBalance / getSignaturesForAddress / getTransaction
//                                ├─ getLatestBlockhash
//                                └─ sendTransaction, requestAirdrop (devnet faucet)
// ---------------------------------------------------------------------------

type RpcError = { code: number; message: string };
type RpcResponse<T> = { result?: T; error?: RpcError };

type RetryConfig = AxiosError['config'] & { __retryCount?: number };

function createSolanaClient(rpcUrls: string[], label: string) {
  const clients = rpcUrls.map((rpcUrl) => {
    const client = create({
      baseURL: rpcUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });

    client.interceptors.response.use(undefined, async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      if (config) {
        config.__retryCount = config.__retryCount ?? 0;
        const status = error.response?.status;
        const isRetryable =
          !error.response ||
          status === 429 ||
          (status !== undefined && status >= 500) ||
          error.code === 'ECONNABORTED';

        const currentRetry = config.__retryCount ?? 0;
        if (isRetryable && currentRetry < 2) {
          const nextRetry = currentRetry + 1;
          config.__retryCount = nextRetry;
          await new Promise((resolve) => setTimeout(resolve, nextRetry * 1500));
          return client.request(config);
        }
      }
      return Promise.reject(error);
    });
    return client;
  });

  function formatRequestError(error: unknown): Error {
    if (!isAxiosError(error)) return error instanceof Error ? error : new Error(`${label} request failed`);
    if (error.response) {
      const body =
        typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
      return new Error(`${label} ${error.response.status}: ${body.slice(0, 200)}`);
    }
    if (error.code === 'ECONNABORTED') return new Error(`${label} timeout`);
    return new Error(`${label} unreachable: ${error.message}`);
  }

  let nextId = 1;
  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const payload = { jsonrpc: '2.0', id: nextId++, method, params };
    let forbidden = false;
    for (let i = 0; i < clients.length; i += 1) {
      let data: RpcResponse<T>;
      try {
        ({ data } = await clients[i].post<RpcResponse<T>>('', payload));
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403 && i < clients.length - 1) {
          forbidden = true;
          continue;
        }
        if (forbidden && isAxiosError(error) && error.response?.status === 403) {
          throw new Error(`${label} RPC access forbidden (403) on all configured endpoints`);
        }
        throw formatRequestError(error);
      }

      if (data.error) {
        if (data.error.code === 403 && i < clients.length - 1) {
          forbidden = true;
          continue;
        }
        if (forbidden && data.error.code === 403) {
          throw new Error(`${label} RPC access forbidden (403) on all configured endpoints`);
        }
        throw new Error(`${label}: ${data.error.message}`);
      }
      return data.result as T;
    }
    throw new Error(`${label} RPC access forbidden (403) on all configured endpoints`);
  }

  return { rpc };
}

export const solanaDevnetClient = createSolanaClient([SOLANA_DEVNET.rpcUrl], 'Solana Devnet');
export const solanaMainnetClient = createSolanaClient(
  Array.from(new Set([SOLANA_MAINNET.rpcUrl, SOLANA_MAINNET_RPC_FALLBACK_URL])),
  'Solana Mainnet',
);

export type SolanaClient = typeof solanaDevnetClient;

export type SolanaSignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

export type SolanaParsedTransaction = {
  transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
  meta: { fee: number; preBalances: number[]; postBalances: number[] } | null;
};

/** Balance in lamports. */
export async function fetchBalance(client: SolanaClient, address: string): Promise<bigint> {
  const { value } = await client.rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
  return BigInt(value);
}

export async function fetchLatestBlockhash(client: SolanaClient): Promise<string> {
  const { value } = await client.rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);
  return value.blockhash;
}

export async function fetchFeeForMessage(client: SolanaClient, encodedMessage: string): Promise<bigint> {
  const { value } = await client.rpc<{ value: number | null }>('getFeeForMessage', [
    encodedMessage,
    { commitment: 'confirmed' },
  ]);
  if (value === null) throw new Error('Solana RPC could not estimate the transaction fee');
  return BigInt(value);
}

/** Submits a base64-encoded signed transaction. Returns the signature. */
export async function sendRawTransaction(client: SolanaClient, base64Tx: string): Promise<string> {
  return client.rpc<string>('sendTransaction', [base64Tx, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
}

/** Latest signatures involving this address, newest first. */
export async function fetchSignaturesForAddress(
  client: SolanaClient,
  address: string,
  limit = 20,
): Promise<SolanaSignatureInfo[]> {
  return client.rpc<SolanaSignatureInfo[]>('getSignaturesForAddress', [address, { limit }]);
}

export async function fetchTransaction(client: SolanaClient, signature: string): Promise<SolanaParsedTransaction | null> {
  return client.rpc<SolanaParsedTransaction | null>('getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ]);
}

/** Devnet only: requests free SOL from the cluster's built-in faucet. Returns the signature. */
export async function requestAirdrop(client: SolanaClient, address: string, lamports: bigint): Promise<string> {
  return client.rpc<string>('requestAirdrop', [address, Number(lamports)]);
}
