import { router, useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAssets } from '../../controllers/useAssets';
import { useBitcoinUtxos } from '../../controllers/useBitcoinUtxos';
import { useHistory } from '../../controllers/useHistory';
import { usePrices } from '../../controllers/usePrices';
import { formatAssetAmount } from '../../models/assetAmounts';
import type { MarketCoinId } from '../../models/services/marketApi';
import { bitcoinTxUrl } from '../../models/config/bitcoin';
import { getAsset } from '../../models/config/assets';
import { formatBtc } from '../../models/services/bitcoinService';
import { shortAddress } from '../../models/format';
import { HistoryList } from '../components/HistoryList';
import { MiniPriceChart } from '../components/MiniPriceChart';
import { Button, Card, Muted, Screen, StatusMessage, colors } from '../components/ui';
import { ActionButton, CoinBadge } from '../components/wallet';

/** One coin: balance, Send / Receive / Swap, faucet and its history. */
export default function CoinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const asset = getAsset(id);
  const { byId, loading, refresh } = useAssets();
  const { getFiatValue, refresh: refreshPrices, loading: pricesLoading } = usePrices();
  const { items: historyItems, loading: historyLoading, error: historyError, refresh: refreshHistory } = useHistory(asset?.id);
  const { utxos: bitcoinUtxos, error: utxoError, refresh: refreshUtxos } = useBitcoinUtxos(asset?.id === 'btc');
  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshPrices();
      refreshHistory();
      refreshUtxos();
      const timer = setInterval(() => {
        refresh();
        refreshHistory();
        refreshUtxos();
      }, 30_000);
      return () => clearInterval(timer);
    }, [refresh, refreshPrices, refreshHistory, refreshUtxos])
  );
  if (!asset) return <Screen><Muted>Unknown coin.</Muted></Screen>;
  const b = byId(asset.id);
  const marketCoin: MarketCoinId = asset.kind === 'bitcoin' ? 'btc' : asset.kind === 'solana' ? 'sol' : 'eth';

  return (
    <Screen
      refreshing={loading || historyLoading || pricesLoading}
      onRefresh={() => {
        refresh();
        refreshHistory();
        refreshUtxos();
        refreshPrices();
      }}
    >
      <Stack.Screen options={{ title: `${asset.name} (${asset.networkName})` }} />

      {asset.mainnet ? (
        <Card title={`Your ${asset.name} mainnet address`}>
          <Muted>
            Derived from the active wallet. Mainnet transfers use real funds and cannot be reversed; confirm the
            network and recipient carefully before sending. The recovery phrase controls these funds, and this
            app’s send support is limited to native coins.
          </Muted>
          <Text selectable style={s.addressFull}>{b?.address ?? 'Preparing wallet address…'}</Text>
          <Button
            title="Copy address"
            variant="secondary"
            onPress={() => b?.address && Clipboard.setStringAsync(b.address)}
          />
        </Card>
      ) : null}

      <View style={s.hero}>
        <CoinBadge asset={asset} size={64} />
        <Text style={s.balance} numberOfLines={1} adjustsFontSizeToFit>
          {b?.balance !== undefined ? `${formatAssetAmount(asset, b.balance, 8)} ${asset.symbol}` : (b?.error ?? '…')}
        </Text>
        {b?.balance !== undefined ? (
          <Text style={s.fiatBalance}>≈ {getFiatValue(asset.id, b.balance)}</Text>
        ) : null}
        {b?.pending ? (
          <Muted>{`Pending: ${formatAssetAmount(asset, b.pending, 8)} ${asset.symbol}`}</Muted>
        ) : null}
        <Text style={s.address}>{shortAddress(b?.address, 8)}</Text>
      </View>

      <MiniPriceChart
        coinId={marketCoin}
        onPress={() => router.push({ pathname: '/coin-market/[id]', params: { id: asset.id } })}
      />

      {!asset.readOnly ? (
        <View style={s.actions}>
          <ActionButton
            icon="arrow-up"
            label="Send"
            onPress={() => router.push({ pathname: '/send/[id]', params: { id: asset.id } })}
          />
          <ActionButton
            icon="arrow-down"
            label="Receive"
            onPress={() => router.push({ pathname: '/receive/[id]', params: { id: asset.id } })}
          />
          {!asset.mainnet ? <ActionButton icon="swap-horizontal" label="Swap" onPress={() => router.push('/swap')} /> : null}
        </View>
      ) : null}

      {!asset.mainnet && asset.kind !== 'solana' ? (
        <Button
          title={`Buy / Sell ${asset.name}`}
          variant="secondary"
          onPress={() => router.push({ pathname: '/buy-sell', params: { mode: 'buy' } })}
        />
      ) : null}

      {asset.faucetUrl ? (
        <Button
          title={`Get free ${asset.symbol} (faucet)`}
          variant="secondary"
          onPress={() => Linking.openURL(asset.faucetUrl!)}
        />
      ) : null}

      {asset.id === 'btc' ? (
        <Card title={`UTXOs${bitcoinUtxos ? ` (${bitcoinUtxos.length})` : ''}`}>
          {utxoError ? <Muted>{utxoError}</Muted> : null}
          {bitcoinUtxos?.length === 0 ? <Muted>No unspent outputs yet.</Muted> : null}
          {bitcoinUtxos?.map((u) => (
            <Pressable key={`${u.txid}:${u.vout}`} onPress={() => Linking.openURL(bitcoinTxUrl(u.txid))} style={s.utxo}>
              <Text style={s.utxoId} numberOfLines={1}>{`${u.txid.slice(0, 10)}…${u.txid.slice(-6)}:${u.vout}`}</Text>
              <Text style={s.utxoValue}>{`${formatBtc(u.value)} ${asset.symbol}${u.confirmed ? '' : ' · pending'}`}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card title="History">
        <StatusMessage status={historyError ? { kind: 'error', text: historyError } : undefined} />
        <HistoryList
          items={historyItems}
          emptyText={
            asset.kind === 'bitcoin' || asset.kind === 'solana'
              ? 'No transactions yet.'
              : 'No transactions sent from this app yet. (Incoming ETH shows in your balance.)'
          }
        />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  balance: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 6 },
  fiatBalance: { color: colors.muted, fontSize: 16, fontWeight: '600', marginTop: -4 },
  address: { color: colors.muted, fontFamily: 'monospace', fontSize: 13 },
  addressFull: { color: colors.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 20, marginVertical: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  marketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  marketLabel: { color: colors.muted, fontSize: 14 },
  marketValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  utxo: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  utxoId: { color: colors.muted, fontFamily: 'monospace', fontSize: 12, flex: 1 },
  utxoValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
