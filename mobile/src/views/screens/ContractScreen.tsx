import { formatUnits } from 'ethers';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { IN_APP_NETWORKS, useInAppWallet } from '../../controllers/InAppWallet';
import { useDappContract } from '../../controllers/useDappContract';
import { usePrices } from '../../controllers/usePrices';
import { useWalletStore } from '../../controllers/WalletStore';
import { getAsset } from '../../models/config/assets';
import { isValidAssetAddress, parseAssetAmount } from '../../models/assetAmounts';
import { errorMessage, formatEth, shortAddress } from '../../models/format';
import { formatBtc } from '../../models/services/bitcoinService';
import { formatSol } from '../../models/services/solanaService';
import { RequireWallet } from '../components/RequireWallet';
import { Button, Card, Field, Muted, Row, Screen, StatusMessage, colors } from '../components/ui';

const HISTORY_LIMIT = 10;
type TestnetAssetId = 'sepolia' | 'btc' | 'sol';
type TestnetNetwork = 'ETH_TESTNET' | 'BTC_TESTNET4' | 'SOLANA_DEVNET';
const TESTNET_ASSETS: { id: TestnetAssetId; label: string; network: TestnetNetwork }[] = [
  { id: 'sepolia', label: 'Sepolia ETH', network: 'ETH_TESTNET' },
  { id: 'btc', label: 'Bitcoin Testnet4', network: 'BTC_TESTNET4' },
  { id: 'sol', label: 'Solana Devnet', network: 'SOLANA_DEVNET' },
];

function priceForAsset(prices: ReturnType<typeof usePrices>['prices'], assetId: TestnetAssetId) {
  if (!prices) return undefined;
  if (assetId === 'btc') return prices.btc.price;
  if (assetId === 'sol') return prices.sol.price;
  return prices.eth.price;
}

function decimalsForAsset(assetId: TestnetAssetId) {
  return assetId === 'btc' ? 8 : assetId === 'sol' ? 9 : 18;
}

function networkLabel(network: string) {
  if (network === 'ETH_TESTNET' || network === 'EVM_TESTNET') return 'Sepolia Ethereum';
  if (network === 'BTC_TESTNET4') return 'Bitcoin Testnet4';
  if (network === 'SOLANA_DEVNET') return 'Solana Devnet';
  return network;
}

export default function ContractScreen() {
  return (
    <RequireWallet>
      <ContractFunctions />
    </RequireWallet>
  );
}

function ContractFunctions() {
  const dapp = useDappContract();
  const { active } = useWalletStore();
  const { state, symbol } = dapp;

  const [newMessage, setNewMessage] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [sourceAssetId, setSourceAssetId] = useState<TestnetAssetId>('sepolia');
  const [targetAssetId, setTargetAssetId] = useState<TestnetAssetId>('btc');
  const [sourceAmountInput, setSourceAmountInput] = useState('');
  const [targetAddress, setTargetAddress] = useState('');
  const [orderIndex, setOrderIndex] = useState('');
  const [targetTxId, setTargetTxId] = useState('');
  const [sourceTxId, setSourceTxId] = useState('');
  const prices = usePrices();

  if (!dapp.contractAddress) {
    return (
      <Screen>
        <Card title="Contract not deployed">
          <Muted>
            {`No DappContract address for ${dapp.network?.name} (chain ${dapp.chainId}).\n\n` +
              (dapp.chainId === '11155111'
                ? 'Deploy DappContract.sol on Sepolia from Remix (Injected Provider - MetaMask), then put the ' +
                  'contract address in mobile/.env as EXPO_PUBLIC_SEPOLIA_CONTRACT_ADDRESS and restart ' +
                  '"npx expo start --clear".'
                : 'In the contracts folder run "npm run node", then "npm run deploy:local", and reload the app.')}
          </Muted>
        </Card>
        <NetworkSwitch />
      </Screen>
    );
  }

  const eth = (wei: bigint) => `${formatEth(wei, 6)} ${symbol}`;
  const sourceAsset = getAsset(sourceAssetId)!;
  const targetAsset = getAsset(targetAssetId)!;
  const sourceNetwork = TESTNET_ASSETS.find((asset) => asset.id === sourceAssetId)!.network;
  const targetNetwork = TESTNET_ASSETS.find((asset) => asset.id === targetAssetId)!.network;
  const sourceDecimals = decimalsForAsset(sourceAssetId);
  const targetDecimals = decimalsForAsset(targetAssetId);
  const sourcePrice = priceForAsset(prices.prices, sourceAssetId);
  const targetPrice = priceForAsset(prices.prices, targetAssetId);
  let sourceAmount: bigint | undefined;
  let quotedTargetAmount: bigint | undefined;
  try {
    if (sourceAmountInput.trim() && sourcePrice && targetPrice && sourcePrice > 0 && targetPrice > 0) {
      sourceAmount = parseAssetAmount(sourceAsset, sourceAmountInput);
      const sourceUsdMicros = BigInt(Math.round(sourcePrice * 1_000_000));
      const targetUsdMicros = BigInt(Math.round(targetPrice * 1_000_000));
      if (sourceAmount > 0n && sourceUsdMicros > 0n && targetUsdMicros > 0n) {
        quotedTargetAmount =
          (sourceAmount * sourceUsdMicros * 10n ** BigInt(targetDecimals)) /
          (10n ** BigInt(sourceDecimals) * targetUsdMicros);
      }
    }
  } catch {
    sourceAmount = undefined;
    quotedTargetAmount = undefined;
  }
  const sourceWalletAddress =
    sourceAssetId === 'btc' ? active?.btcAddress : sourceAssetId === 'sol' ? active?.solAddress : active?.keys.address;
  const targetWalletAddress =
    targetAssetId === 'btc' ? active?.btcAddress : targetAssetId === 'sol' ? active?.solAddress : active?.keys.address;

  return (
    <Screen refreshing={dapp.loading} onRefresh={dapp.refresh}>
      <Card title="DappContract">
        <Row label="Address" value={shortAddress(dapp.contractAddress, 6)} mono />
        <Row label="Network" value={dapp.network?.name} />
      </Card>
      <NetworkSwitch />

      <Card title="Read">
        <Row label="message()" value={state ? `"${state.message}"` : '…'} />
        <Row label="counter()" value={state?.counter.toString() ?? '…'} />
        <Row label="totalDeposits()" value={state ? eth(state.totalDeposits) : '…'} />
        <StatusMessage status={dapp.readError ? { kind: 'error', text: dapp.readError } : undefined} />
        <Button title="Refresh" variant="secondary" loading={dapp.loading} onPress={dapp.refresh} />
      </Card>

      <Card title="Account summary">
        <Row label="Balance in contract" value={state ? eth(state.summary.balance) : '…'} />
        <Row label="Total deposited" value={state ? eth(state.summary.deposited) : '…'} />
        <Row label="Total withdrawn" value={state ? eth(state.summary.withdrawn) : '…'} />
        <Row label="Transactions" value={state?.summary.transactions.toString() ?? '…'} />
      </Card>

      <Card title="Transaction history">
        {state && state.history.length === 0 ? <Muted>No deposits or withdrawals yet.</Muted> : null}
        {state?.history.slice(0, HISTORY_LIMIT).map((tx, i) => (
          <View key={`${tx.blockNumber}-${i}`} style={historyStyles.item}>
            <View style={historyStyles.line}>
              <Text
                style={[
                  historyStyles.type,
                  { color: tx.transactionType === 'DEPOSIT' ? colors.success : colors.danger },
                ]}
              >
                {tx.transactionType}
              </Text>
              <Text style={historyStyles.amount}>
                {`${tx.transactionType === 'DEPOSIT' ? '+' : '−'}${eth(tx.amount)}`}
              </Text>
            </View>
            <Muted>{`Block ${tx.blockNumber} · ${new Date(Number(tx.timestamp) * 1000).toLocaleString()}`}</Muted>
          </View>
        ))}
        {state && state.history.length > HISTORY_LIMIT ? (
          <Muted>{`Showing latest ${HISTORY_LIMIT} of ${state.history.length}.`}</Muted>
        ) : null}
      </Card>

      <Card title="Testnet coin quote and order">
        <Muted>
          Select any two testnet coins to calculate a current indicative quote and record the amounts. This does not
          transfer, exchange, or lock funds. Source and payout transactions must be sent separately.
        </Muted>
        <Muted>Source coin</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {TESTNET_ASSETS.map((coin) => (
            <View key={`source-${coin.id}`} style={{ flex: 1 }}>
              <Button
                title={coin.label}
                size="sm"
                variant={sourceAssetId === coin.id ? 'primary' : 'secondary'}
                onPress={() => {
                  setSourceAssetId(coin.id);
                  setSourceAmountInput('');
                  if (targetAssetId === coin.id) {
                    setTargetAssetId(TESTNET_ASSETS.find((candidate) => candidate.id !== coin.id)!.id);
                    setTargetAddress('');
                  }
                }}
              />
            </View>
          ))}
        </View>
        <Muted>Destination coin</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {TESTNET_ASSETS.map((coin) => (
            <View key={`target-${coin.id}`} style={{ flex: 1 }}>
              <Button
                title={coin.label}
                size="sm"
                variant={targetAssetId === coin.id ? 'primary' : 'secondary'}
                disabled={sourceAssetId === coin.id}
                onPress={() => {
                  setTargetAssetId(coin.id);
                  setTargetAddress('');
                }}
              />
            </View>
          ))}
        </View>
        <Field
          label={`${sourceAsset.symbol} amount (quote reference)`}
          placeholder={sourceAssetId === 'btc' ? '0.001' : '0.01'}
          keyboardType="decimal-pad"
          value={sourceAmountInput}
          onChangeText={setSourceAmountInput}
        />
        <Row label="Source wallet address" value={sourceWalletAddress ?? 'Wallet loading…'} mono />
        <Field
          label={`${targetAsset.networkName} destination address`}
          placeholder={targetAssetId === 'btc' ? 'tb1…' : targetAssetId === 'sol' ? 'Solana address' : '0x…'}
          value={targetAddress || targetWalletAddress || ''}
          onChangeText={setTargetAddress}
          autoCapitalize="none"
        />
        <Row
          label={`Current ${sourceAsset.symbol} amount`}
          value={sourceAmount && sourceAmount > 0n ? `${formatUnits(sourceAmount, sourceDecimals)} ${sourceAsset.symbol}` : 'Enter a positive amount'}
        />
        <Row
          label={`Estimated ${targetAsset.symbol} amount`}
          value={
            prices.loading
              ? 'Loading prices…'
              : quotedTargetAmount && quotedTargetAmount > 0n
                ? `${formatUnits(quotedTargetAmount, targetDecimals)} ${targetAsset.symbol}`
                : prices.error
                  ? 'Price unavailable'
                    : !sourcePrice || sourcePrice <= 0 || !targetPrice || targetPrice <= 0
                      ? 'Current market quote unavailable'
                      : 'Enter a positive source amount'
          }
        />
        <Muted>
          {`Indicative market rates: ${sourceAsset.symbol} $${sourcePrice?.toFixed(2) ?? '—'} · ${targetAsset.symbol} $${targetPrice?.toFixed(2) ?? '—'}.`}
        </Muted>
        {prices.error ? <Muted>{`Could not load market prices: ${prices.error}`}</Muted> : null}
        <Button
          title="Record testnet order"
          loading={dapp.pending}
          onPress={async () => {
            if (!sourceAmount || sourceAmount <= 0n || !quotedTargetAmount || quotedTargetAmount <= 0n) {
              dapp.setStatus({ kind: 'error', text: 'Enter a valid source amount and wait for a current market quote.' });
              return;
            }
            const resolvedTargetAddress = targetAddress.trim() || targetWalletAddress || '';
            if (!sourceWalletAddress || !isValidAssetAddress(targetAsset, resolvedTargetAddress)) {
              dapp.setStatus({
                kind: 'error',
                text: targetAssetId === 'btc'
                  ? 'Enter a valid Bitcoin Testnet4 destination address.'
                  : targetAssetId === 'sol'
                    ? 'Enter a valid Solana Devnet destination address.'
                    : 'Enter a valid EVM testnet destination address.',
              });
              return;
            }
            const created = await dapp.createTestnetExchangeOrder(
              sourceNetwork,
              sourceAmount,
              sourceWalletAddress,
              targetNetwork,
              quotedTargetAmount,
              resolvedTargetAddress,
              `${sourceNetwork}-${targetNetwork}-${Date.now()}`,
            );
            if (created) {
              try {
                const count = await dapp.getCrossNetworkOrderCount();
                if (count > 0n) setOrderIndex((count - 1n).toString());
              } catch (error) {
                dapp.setStatus({ kind: 'error', text: errorMessage(error) });
              }
            }
          }}
        />
        <Field
          label="Order index"
          placeholder="0"
          keyboardType="number-pad"
          value={orderIndex}
          onChangeText={setOrderIndex}
        />
        {sourceAssetId !== 'sepolia' ? (
          <>
            <Field
              label={`${sourceAsset.networkName} source transaction ID / signature`}
              placeholder="Enter after sending source test coins"
              value={sourceTxId}
              onChangeText={setSourceTxId}
              autoCapitalize="none"
            />
            <Button
              title="Owner: record source transaction"
              variant="secondary"
              loading={dapp.pending}
              onPress={() => dapp.recordCrossNetworkSourceTx(orderIndex, sourceTxId)}
            />
          </>
        ) : null}
        <Field
          label={`${targetAsset.networkName} payout transaction ID / signature`}
          placeholder="Enter after sending destination test coins"
          value={targetTxId}
          onChangeText={setTargetTxId}
          autoCapitalize="none"
        />
        <Button
          title="Owner: record payout transaction and complete"
          variant="secondary"
          loading={dapp.pending}
          onPress={() => dapp.fulfillCrossNetworkOrder(orderIndex, targetTxId)}
        />
        <StatusMessage status={dapp.status} />
      </Card>

      <Card title="Recorded cross-network orders">
        {dapp.ordersLoading ? <Muted>Loading orders…</Muted> : null}
        {dapp.ordersError ? <Muted>{`Could not load orders: ${dapp.ordersError}`}</Muted> : null}
        {!dapp.ordersLoading && !dapp.ordersError && !dapp.crossNetworkOrders?.length ? (
          <Muted>No cross-network demo orders recorded for this wallet.</Muted>
        ) : null}
        {dapp.crossNetworkOrders?.slice().reverse().slice(0, 10).map((order, i) => {
          const formatAmount = (chain: string, amount: bigint) => {
            if (chain.includes('BTC')) return `${formatBtc(amount)} BTC`;
            if (chain.includes('SOLANA')) return `${formatSol(amount, 6)} SOL`;
            return `${formatEth(amount, 8)} ETH`;
          };
          const direction =
            `${networkLabel(order.sourceNetwork)} → ${networkLabel(order.targetNetwork)}`;
          return (
            <View key={`${order.quoteId}-${i}`} style={historyStyles.item}>
              <Text style={historyStyles.type}>
                {`${direction} · ${order.fulfilled ? 'PAYOUT RECORDED' : 'PENDING'}`}
              </Text>
              <Muted>{`Source amount: ${formatAmount(order.sourceNetwork, order.sourceAmount)}`}</Muted>
              <Muted>{`Estimated destination amount: ${formatAmount(order.targetNetwork, order.targetAmount)}`}</Muted>
              <Muted>{`Destination: ${shortAddress(order.targetAddress, 8)}`}</Muted>
              {order.sourceTxId ? <Muted>{`Source tx: ${shortAddress(order.sourceTxId, 8)}`}</Muted> : null}
              {order.targetTxId ? <Muted>{`Payout tx: ${shortAddress(order.targetTxId, 8)}`}</Muted> : null}
              <Muted>{`Quote: ${order.quoteId}`}</Muted>
            </View>
          );
        })}
      </Card>

      <Card title="Write">
        <StatusMessage status={dapp.status} />
        {dapp.explorerUrl ? (
          <Button
            title="View last tx on explorer"
            variant="secondary"
            onPress={() => Linking.openURL(dapp.explorerUrl!)}
          />
        ) : null}

        <Field label="setMessage(string)" placeholder="gm" value={newMessage} onChangeText={setNewMessage} />
        <Button
          title="Set message"
          loading={dapp.pending}
          onPress={async () => {
            if (await dapp.setMessage(newMessage)) setNewMessage('');
          }}
        />

        <Button title="increment()" loading={dapp.pending} onPress={dapp.increment} />

        <Field
          label={`deposit() payable (${symbol})`}
          placeholder="0.01"
          keyboardType="decimal-pad"
          value={depositAmount}
          onChangeText={setDepositAmount}
        />
        <Button
          title="Deposit"
          loading={dapp.pending}
          onPress={async () => {
            if (await dapp.deposit(depositAmount)) setDepositAmount('');
          }}
        />

        <Field
          label={`withdraw(uint256) (${symbol})`}
          placeholder="0.01"
          keyboardType="decimal-pad"
          value={withdrawAmount}
          onChangeText={setWithdrawAmount}
        />
        <Button
          title="Withdraw"
          loading={dapp.pending}
          onPress={async () => {
            if (await dapp.withdraw(withdrawAmount)) setWithdrawAmount('');
          }}
        />
      </Card>
    </Screen>
  );
}

const historyStyles = StyleSheet.create({
  item: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 2,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  amount: { color: colors.text, fontSize: 15, fontWeight: '600' },
});

/** Which network the built-in wallet uses for this dApp. */
function NetworkSwitch() {
  const { network, setNetwork } = useInAppWallet();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {IN_APP_NETWORKS.map((n) => (
        <View key={n.id} style={{ flex: 1 }}>
          <Button
            title={n.name}
            variant={n.id === network.id ? 'primary' : 'secondary'}
            onPress={() => setNetwork(n)}
          />
        </View>
      ))}
    </View>
  );
}
