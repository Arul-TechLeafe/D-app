import { parseEther } from 'ethers';
import { useCallback, useMemo } from 'react';

import { getDappContract, getDappContractAddress, readContractState } from '../models/contracts';
import { useAsync } from './useAsync';
import { useTransaction } from './useTransaction';
import { useWallet } from './useWallet';

type CrossNetworkOrder = {
  user: string;
  ethAmountWei: bigint;
  btcAmountSats: bigint;
  btcAddress: string;
  quoteId: string;
  bitcoinTxId: string;
  timestamp: bigint;
  fulfilled: boolean;
  targetNetwork: string;
  targetAmount: bigint;
  targetAddress: string;
  targetTxId: string;
  sourceNetwork: string;
  sourceAmount: bigint;
  sourceAddress: string;
  sourceTxId: string;
};

/**
 * Controller for DappContract: loads on-chain state for the connected account and
 * exposes validated write actions. Each action resolves to true when the tx confirmed.
 */
export function useDappContract() {
  const { address, chainId, network, readProvider } = useWallet();
  const contractAddress = getDappContractAddress(chainId);
  const { run, pending, status, setStatus, explorerUrl } = useTransaction();
  const symbol = network?.nativeCurrency.symbol ?? 'ETH';

  const reader = useMemo(
    () => (contractAddress && readProvider ? getDappContract(contractAddress, readProvider) : undefined),
    [contractAddress, readProvider],
  );

  const load = useCallback(() => readContractState(reader!, address!), [reader, address]);
  const { data: state, loading, error: readError, refresh } = useAsync(reader && address ? load : undefined);
  const loadOrders = useCallback(async () => {
    if (!reader || !address) return [];
    return reader.getCrossNetworkSwaps(address) as Promise<CrossNetworkOrder[]>;
  }, [reader, address]);
  const {
    data: crossNetworkOrders,
    loading: ordersLoading,
    error: ordersError,
    refresh: refreshOrders,
  } = useAsync(reader && address ? loadOrders : undefined);

  const write = useCallback(
    async (fn: string, args: unknown[] = [], value?: bigint) => {
      if (!contractAddress) return false;
      const receipt = await run(async (signer) => {
        const contract = getDappContract(contractAddress, signer);
        return contract[fn](...args, value !== undefined ? { value } : {});
      });
      if (receipt) {
        refresh();
        refreshOrders();
      }
      return !!receipt;
    },
    [contractAddress, run, refresh, refreshOrders],
  );

  const parseAmount = useCallback(
    (input: string) => {
      try {
        const value = parseEther(input.trim());
        if (value > 0n) return value;
      } catch {
        // fall through
      }
      setStatus({ kind: 'error', text: `Enter a positive amount in ${symbol}` });
      return undefined;
    },
    [setStatus, symbol],
  );

  const setMessage = useCallback(
    (text: string) => {
      if (!text.trim()) {
        setStatus({ kind: 'error', text: 'Message cannot be empty' });
        return Promise.resolve(false);
      }
      return write('setMessage', [text.trim()]);
    },
    [write, setStatus],
  );

  const increment = useCallback(() => write('increment'), [write]);

  const deposit = useCallback(
    (amount: string) => {
      const value = parseAmount(amount);
      return value ? write('deposit', [], value) : Promise.resolve(false);
    },
    [parseAmount, write],
  );

  const withdraw = useCallback(
    (amount: string) => {
      const value = parseAmount(amount);
      return value ? write('withdraw', [value]) : Promise.resolve(false);
    },
    [parseAmount, write],
  );

  const createCrossNetworkOrder = useCallback(
    (ethAmountWei: bigint, targetNetwork: 'BTC_TESTNET4' | 'SOLANA_DEVNET', targetAmount: bigint, targetAddress: string, quoteId: string) => {
      if (!network?.testnet) {
        setStatus({ kind: 'error', text: 'Cross-network demo orders are available only on an EVM testnet.' });
        return Promise.resolve(false);
      }
      if (ethAmountWei <= 0n || targetAmount <= 0n || !targetAddress.trim() || !quoteId.trim()) {
        setStatus({ kind: 'error', text: 'Enter a valid amount, destination address, and quote.' });
        return Promise.resolve(false);
      }
      return write('createCrossNetworkOrder', [
        ethAmountWei,
        targetNetwork,
        targetAmount,
        targetAddress.trim(),
        quoteId,
      ]);
    },
    [network?.testnet, setStatus, write],
  );

  const createBitcoinToEthOrder = useCallback(
    (btcAmountSats: bigint, btcSenderAddress: string, ethAmountWei: bigint, ethRecipient: string, quoteId: string) => {
      if (!network?.testnet) {
        setStatus({ kind: 'error', text: 'Cross-network demo orders are available only on an EVM testnet.' });
        return Promise.resolve(false);
      }
      if (btcAmountSats <= 0n || ethAmountWei <= 0n || !btcSenderAddress.trim() || !quoteId.trim()) {
        setStatus({ kind: 'error', text: 'Enter valid BTC and ETH amounts, source address, and quote.' });
        return Promise.resolve(false);
      }
      return write('createBitcoinToEthOrder', [
        btcAmountSats,
        btcSenderAddress.trim(),
        ethAmountWei,
        ethRecipient,
        quoteId,
      ]);
    },
    [network?.testnet, setStatus, write],
  );

  const createTestnetExchangeOrder = useCallback(
    (
      sourceNetwork: 'ETH_TESTNET' | 'BTC_TESTNET4' | 'SOLANA_DEVNET',
      sourceAmount: bigint,
      sourceAddress: string,
      targetNetwork: 'ETH_TESTNET' | 'BTC_TESTNET4' | 'SOLANA_DEVNET',
      targetAmount: bigint,
      targetAddress: string,
      quoteId: string,
    ) => {
      if (!network?.testnet) {
        setStatus({ kind: 'error', text: 'Cross-network demo orders are available only on an EVM testnet.' });
        return Promise.resolve(false);
      }
      if (sourceNetwork === targetNetwork) {
        setStatus({ kind: 'error', text: 'Choose two different test networks.' });
        return Promise.resolve(false);
      }
      if (
        sourceAmount <= 0n ||
        targetAmount <= 0n ||
        !sourceAddress.trim() ||
        !targetAddress.trim() ||
        !quoteId.trim()
      ) {
        setStatus({ kind: 'error', text: 'Enter valid amounts and source/destination addresses.' });
        return Promise.resolve(false);
      }
      return write('createTestnetExchangeOrder', [{
        sourceNetwork,
        sourceAmount,
        sourceAddress: sourceAddress.trim(),
        targetNetwork,
        targetAmount,
        targetAddress: targetAddress.trim(),
        quoteId,
      }]);
    },
    [network?.testnet, setStatus, write],
  );

  const recordCrossNetworkSourceTx = useCallback(
    (orderIndex: string, sourceTxId: string) => {
      if (!address) {
        setStatus({ kind: 'error', text: 'Connect an EVM wallet first.' });
        return Promise.resolve(false);
      }
      let index: bigint;
      try {
        if (!/^\d+$/.test(orderIndex.trim())) throw new Error('invalid index');
        index = BigInt(orderIndex.trim());
      } catch {
        setStatus({ kind: 'error', text: 'Enter a valid order index.' });
        return Promise.resolve(false);
      }
      if (!sourceTxId.trim()) {
        setStatus({ kind: 'error', text: 'Enter the Bitcoin Testnet4 source transaction ID.' });
        return Promise.resolve(false);
      }
      return write('recordCrossNetworkSourceTx', [address, index, sourceTxId.trim()]);
    },
    [address, setStatus, write],
  );

  const fulfillCrossNetworkOrder = useCallback(
    (orderIndex: string, targetTxId: string) => {
      if (!address) {
        setStatus({ kind: 'error', text: 'Connect an EVM wallet first.' });
        return Promise.resolve(false);
      }
      let index: bigint;
      try {
        if (!/^\d+$/.test(orderIndex.trim())) throw new Error('invalid index');
        index = BigInt(orderIndex.trim());
      } catch {
        setStatus({ kind: 'error', text: 'Enter a valid order index.' });
        return Promise.resolve(false);
      }
      if (!targetTxId.trim()) {
        setStatus({ kind: 'error', text: 'Enter the destination-chain transaction ID.' });
        return Promise.resolve(false);
      }
      return write('fulfillCrossNetworkOrder', [address, index, targetTxId.trim()]);
    },
    [address, setStatus, write],
  );

  const getCrossNetworkOrderCount = useCallback(async () => {
    if (!reader || !address) throw new Error('Connect to a deployed EVM testnet contract first.');
    return BigInt(await reader.getCrossNetworkSwapCount(address));
  }, [reader, address]);

  return {
    contractAddress,
    chainId,
    network,
    symbol,
    state,
    crossNetworkOrders,
    ordersLoading,
    ordersError,
    loading,
    readError,
    refresh,
    pending,
    status,
    setStatus,
    explorerUrl,
    setMessage,
    increment,
    deposit,
    withdraw,
    createCrossNetworkOrder,
    createBitcoinToEthOrder,
    createTestnetExchangeOrder,
    recordCrossNetworkSourceTx,
    fulfillCrossNetworkOrder,
    getCrossNetworkOrderCount,
  };
}
