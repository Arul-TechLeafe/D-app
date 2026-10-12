import axios, { AxiosError } from 'axios';

import { BITCOIN_MAINNET, BITCOIN_TESTNET4 } from '../config/bitcoin';

// ---------------------------------------------------------------------------
// Blockchain API client (Axios → mempool.space Esplora API).
//
//   React Native app ──Axios──▶ Esplora API ──▶ Bitcoin network
//                                ├─ address info / balance
//                                ├─ transactions
//                                ├─ UTXOs
//                                └─ fees, broadcast
//
// Same Esplora API shape on testnet4 and mainnet. Mainnet transfers use the
// active wallet's locally derived key and require PIN approval in the UI.
// Raw API shapes live here; bitcoinService turns them into app types (bigint sats).
// ---------------------------------------------------------------------------

type RetryConfig = AxiosError['config'] & { __retryCount?: number };

function createEsploraClient(baseURL: string, label: string) {
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { Accept: 'application/json' },
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
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
          await new Promise((resolve) => setTimeout(resolve, nextRetry * 1200));
          return client.request(config);
        }
      }

      if (error.response) {
        const body = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
        return Promise.reject(new Error(`${label} ${error.response.status}: ${body.slice(0, 200)}`));
      }
      if (error.code === 'ECONNABORTED') return Promise.reject(new Error(`${label} timeout`));
      return Promise.reject(new Error(`${label} unreachable: ${error.message}`));
    },
  );

  return client;
}

export const bitcoinApi = createEsploraClient(BITCOIN_TESTNET4.apiUrl, 'Bitcoin API');
export const bitcoinMainnetApi = createEsploraClient(BITCOIN_MAINNET.apiUrl, 'Bitcoin Mainnet API');

export type ApiAddressStats = {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
};

export type ApiAddress = {
  address: string;
  chain_stats: ApiAddressStats;
  mempool_stats: ApiAddressStats;
};

export type ApiTx = {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { txid: string; vout: number; prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
};

export type ApiUtxo = {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
};

export type ApiFees = {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
};

/** GET /address/:address — funded/spent totals (confirmed and mempool). Testnet4. */
export async function fetchAddress(address: string): Promise<ApiAddress> {
  const { data } = await bitcoinApi.get<ApiAddress>(`/address/${address}`);
  return data;
}

/** GET /address/:address/txs — mempool txs, then the latest 25 confirmed. Testnet4. */
export async function fetchAddressTxs(address: string): Promise<ApiTx[]> {
  const { data } = await bitcoinApi.get<ApiTx[]>(`/address/${address}/txs`);
  return data;
}

/** GET /address/:address/utxo — unspent outputs owned by the address. Testnet4. */
export async function fetchAddressUtxos(address: string): Promise<ApiUtxo[]> {
  const { data } = await bitcoinApi.get<ApiUtxo[]>(`/address/${address}/utxo`);
  return data;
}

/** GET /v1/fees/recommended — fee rates in sat/vB. Testnet4. */
export async function fetchFees(): Promise<ApiFees> {
  const { data } = await bitcoinApi.get<ApiFees>('/v1/fees/recommended');
  return data;
}

/** POST /tx — broadcasts a signed raw transaction (hex). Returns the txid. Testnet4. */
export async function broadcastTx(hex: string): Promise<string> {
  const { data } = await bitcoinApi.post<string>('/tx', hex, {
    headers: { 'Content-Type': 'text/plain', Accept: 'text/plain' },
    transformResponse: (raw) => raw,
  });
  return String(data).trim();
}

/** GET /address/:address — funded/spent totals (confirmed and mempool). Mainnet. */
export async function fetchMainnetAddress(address: string): Promise<ApiAddress> {
  const { data } = await bitcoinMainnetApi.get<ApiAddress>(`/address/${address}`);
  return data;
}

/** GET /address/:address/txs — mempool txs, then the latest 25 confirmed. Mainnet. */
export async function fetchMainnetAddressTxs(address: string): Promise<ApiTx[]> {
  const { data } = await bitcoinMainnetApi.get<ApiTx[]>(`/address/${address}/txs`);
  return data;
}

export async function fetchMainnetAddressUtxos(address: string): Promise<ApiUtxo[]> {
  const { data } = await bitcoinMainnetApi.get<ApiUtxo[]>(`/address/${address}/utxo`);
  return data;
}

export async function fetchMainnetFees(): Promise<ApiFees> {
  const { data } = await bitcoinMainnetApi.get<ApiFees>('/v1/fees/recommended');
  return data;
}

export async function broadcastMainnetTx(hex: string): Promise<string> {
  const { data } = await bitcoinMainnetApi.post<string>('/tx', hex, {
    headers: { 'Content-Type': 'text/plain', Accept: 'text/plain' },
    transformResponse: (raw) => raw,
  });
  return String(data).trim();
}
