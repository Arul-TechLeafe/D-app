import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAssets, type AssetBalance } from '../../controllers/useAssets';
import { usePrices } from '../../controllers/usePrices';
import { useWalletStore } from '../../controllers/WalletStore';
import { formatAssetAmount } from '../../models/assetAmounts';
import { shortAddress } from '../../models/format';
import { SideMenu } from '../components/SideMenu';
import { colors } from '../components/ui';
import { WalletSwitcher } from '../components/WalletSwitcher';
import { Logo } from '../components/Logo';
import { ActionButton, CoinBadge } from '../components/wallet';

export default function DashboardScreen() {
  const { active } = useWalletStore();
  const { balances, byId, loading, refresh } = useAssets();
  const { getCoinPrice, getFiatValue, getTotalFiatValue, refresh: refreshPrices, loading: pricesLoading } = usePrices();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet');

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshPrices();
      const timer = setInterval(() => {
        refresh();
        refreshPrices();
      }, 30_000);
      return () => clearInterval(timer);
    }, [refresh, refreshPrices])
  );
  const [selectedCoinId, setSelectedCoinId] = useState<string>('all');
  const [coinSwitcherOpen, setCoinSwitcherOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const activeBalances = balances?.filter((b) => (network === 'testnet' ? !b.asset.mainnet : b.asset.mainnet));
  const primary = network === 'testnet' ? byId('sepolia') : byId('ethereum');
  const secondary1 = network === 'testnet' ? byId('btc') : byId('btc-mainnet');
  const secondary2 = network === 'testnet' ? byId('sol') : byId('solana-mainnet');

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header: menu (left) · wallet switcher (right) */}
      <View style={s.header}>
        <Pressable accessibilityLabel="Menu" onPress={() => setMenuOpen(true)} style={s.iconButton}>
          <Ionicons name="menu" size={26} color={colors.text} />
        </Pressable>
        <View style={s.brandRow}>
          <Logo size={30} />
          <Text style={s.brand}>Coinstep</Text>
        </View>
        <Pressable onPress={() => setSwitcherOpen(true)} style={s.walletPill}>
          <Ionicons name="wallet" size={16} color={colors.primary} />
          <Text style={s.walletPillText} numberOfLines={1}>
            {active?.name ?? 'Wallet'}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={(loading || pricesLoading) && !!balances}
            onRefresh={() => {
              refresh();
              refreshPrices();
            }}
            tintColor={colors.muted}
          />
        }
      >
        {/* Wallet card */}
        <View style={s.card}>
          <View style={s.cardTop}>
            <Pressable
              onPress={() => setCoinSwitcherOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={s.cardName}>
                {selectedCoinId === 'all'
                  ? (active?.name ?? 'Wallet')
                  : (activeBalances?.find((b) => b.asset.id === selectedCoinId)?.asset.name ?? 'Wallet')}
              </Text>
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
            <View style={network === 'testnet' ? s.testnetChip : s.realChip}>
              <Text style={network === 'testnet' ? s.testnetText : s.realChipText}>
                {network === 'testnet' ? 'TESTNET' : 'REAL FUNDS'}
              </Text>
            </View>
          </View>
          {!active ? (
            <ActivityIndicator color="#fff" style={{ marginVertical: 18 }} />
          ) : (
            (() => {
              const selectedBalance = selectedCoinId === 'all' ? undefined : activeBalances?.find((b) => b.asset.id === selectedCoinId);
              const addressToCopy =
                selectedCoinId === 'all'
                  ? (network === 'mainnet' ? primary?.address : active.keys.address) ?? active.keys.address
                  : selectedBalance?.address ?? active.keys.address;
              
              return (
                <>
                  <Text style={s.cardBalance} numberOfLines={1} adjustsFontSizeToFit>
                    {selectedCoinId === 'all'
                      ? getTotalFiatValue(activeBalances)
                      : selectedBalance?.balance !== undefined
                        ? `${formatAssetAmount(selectedBalance.asset, selectedBalance.balance, 4)} ${selectedBalance.asset.symbol}`
                        : '—'}
                  </Text>
                  
                  {selectedCoinId !== 'all' ? (
                    <Text style={s.cardSub}>
                      {selectedBalance?.balance !== undefined ? getFiatValue(selectedCoinId as any, selectedBalance.balance) : '—'}
                    </Text>
                  ) : (
                    <Text style={s.cardSub}>
                      {primary?.balance !== undefined
                        ? `${formatAssetAmount(primary.asset, primary.balance, 4)} ${primary.asset.symbol}`
                        : '—'}
                      {'  ·  '}
                      {[secondary1, secondary2]
                        .filter((b): b is AssetBalance => !!b && b.balance !== undefined)
                        .map((b) => `${formatAssetAmount(b.asset, b.balance!, 4)} ${b.asset.symbol}`)
                        .join('  ·  ') || ''}
                    </Text>
                  )}

                  <Pressable
                    onPress={async () => {
                      await Clipboard.setStringAsync(addressToCopy);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    style={s.addressChip}
                  >
                    <Text style={s.addressText}>{copied ? 'Address copied' : shortAddress(addressToCopy, 6)}</Text>
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color="#fff" />
                  </Pressable>
                </>
              );
            })()
          )}
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <ActionButton
            icon="arrow-up"
            label="Send"
            onPress={() => router.push({ pathname: '/select-coin', params: { action: 'send' } })}
          />
          <ActionButton
            icon="arrow-down"
            label="Receive"
            onPress={() => router.push({ pathname: '/select-coin', params: { action: 'receive' } })}
          />
          <ActionButton icon="swap-horizontal" label="Swap" onPress={() => router.push('/swap')} />
          <ActionButton icon="card" label="Buy/Sell" onPress={() => router.push('/buy-sell')} />
          <ActionButton icon="add" label="Add wallet" onPress={() => setSwitcherOpen(true)} />
        </View>

        <View style={s.tabContainer}>
          <Pressable
            style={[s.tab, network === 'testnet' && s.tabActive]}
            onPress={() => setNetwork('testnet')}
          >
            <Text style={[s.tabText, network === 'testnet' && s.tabTextActive]}>Testnet</Text>
          </Pressable>
          <Pressable
            style={[s.tab, network === 'mainnet' && s.tabActive]}
            onPress={() => {
              setNetwork('mainnet');
              refresh();
              refreshPrices();
            }}
          >
            <Text style={[s.tabText, network === 'mainnet' && s.tabTextActive]}>Mainnet</Text>
          </Pressable>
        </View>

        {/* Coins list */}
        {(() => {
          const coins = activeBalances ?? [];

          const renderCoin = (b: AssetBalance) => {
            const coinPrice = getCoinPrice(b.asset.id);
            return (
              <Pressable
                key={b.asset.id}
                onPress={() => router.push({ pathname: '/coin/[id]', params: { id: b.asset.id } })}
                style={({ pressed }) => [s.coin, pressed && { backgroundColor: colors.card }]}
              >
                <CoinBadge asset={b.asset} />
                <View style={{ flex: 1 }}>
                  <Text style={s.coinName}>{b.asset.name}</Text>
                  <View style={s.coinMetaRow}>
                    <View style={s.networkTag}>
                      <Text style={s.networkText}>{b.asset.networkName}</Text>
                    </View>
                    {coinPrice ? (
                      <Text style={s.coinRate}>
                        ${coinPrice.price >= 1000
                          ? coinPrice.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
                          : coinPrice.price.toFixed(2)}
                        {' '}
                        <Text style={{ color: coinPrice.change24h >= 0 ? '#34C759' : '#FF3B30' }}>
                          {coinPrice.change24h >= 0 ? '+' : ''}{coinPrice.change24h.toFixed(1)}%
                        </Text>
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', maxWidth: '50%' }}>
                  {b.balance !== undefined ? (
                    <>
                      <Text style={s.coinBalance}>{formatAssetAmount(b.asset, b.balance, 4)} {b.asset.symbol}</Text>
                      <Text style={s.coinFiat}>{getFiatValue(b.asset.id, b.balance)}</Text>
                    </>
                  ) : (
                    <Text style={s.coinError} numberOfLines={1}>
                      {b.error ?? '…'}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          };

          return (
            <View style={s.list}>
              {coins.map(renderCoin)}
              {!balances || loading ? <ActivityIndicator color={colors.muted} style={{ marginTop: 24 }} /> : null}
            </View>
          );
        })()}
      </ScrollView>

      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <WalletSwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />

      <Modal visible={coinSwitcherOpen} transparent animationType="slide" onRequestClose={() => setCoinSwitcherOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setCoinSwitcherOpen(false)} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>Select Asset</Text>

          <Pressable
            style={[s.sheetItem, selectedCoinId === 'all' && s.sheetItemSelected]}
            onPress={() => {
              setSelectedCoinId('all');
              setCoinSwitcherOpen(false);
            }}
          >
            <View style={s.sheetIconHolder}>
              <Ionicons name="pie-chart" size={20} color="#fff" />
            </View>
            <Text style={s.sheetItemText}>Total Portfolio</Text>
            {selectedCoinId === 'all' ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
          </Pressable>

          {activeBalances?.map((b) => {
            const selected = selectedCoinId === b.asset.id;
            return (
              <Pressable
                key={b.asset.id}
                style={[s.sheetItem, selected && s.sheetItemSelected]}
                onPress={() => {
                  setSelectedCoinId(b.asset.id);
                  setCoinSwitcherOpen(false);
                }}
              >
                <CoinBadge asset={b.asset} />
                <Text style={s.sheetItemText}>{b.asset.name}</Text>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    ...(Platform.OS === 'web' ? { maxWidth: 480, width: '100%', alignSelf: 'center' as const } : {}),
  },
  iconButton: { padding: 6 },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '700' },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 180,
  },
  walletPillText: { color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  content: {
    padding: 16,
    gap: 20,
    paddingBottom: 40,
    ...(Platform.OS === 'web' ? { maxWidth: 480, width: '100%', alignSelf: 'center' as const } : {}),
  },
  card: { backgroundColor: colors.primary, borderRadius: 20, padding: 20, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  testnetChip: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  testnetText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  cardBalance: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 6 },
  cardSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  addressChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  addressText: { color: '#fff', fontSize: 13, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
    marginVertical: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: { backgroundColor: colors.card },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: colors.text },
  realChip: { backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  realChipText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  list: { gap: 2, marginTop: 4 },
  coin: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12 },
  coinName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  networkTag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  networkText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  coinMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  coinRate: { color: colors.muted, fontSize: 11, fontWeight: '500' },
  coinBalance: { color: colors.text, fontSize: 15, fontWeight: '600' },
  coinFiat: { color: colors.muted, fontSize: 12, marginTop: 2 },
  coinSymbol: { color: colors.muted, fontSize: 12, marginTop: 2 },
  coinError: { color: colors.muted, fontSize: 12 },
  
  // Coin Switcher Modal
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 4,
    ...(Platform.OS === 'web'
      ? { maxWidth: 480, marginHorizontal: 'auto', alignSelf: 'center' as const, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 1, borderColor: colors.border }
      : {}),
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 12, paddingBottom: 8 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  sheetItemSelected: { backgroundColor: colors.card },
  sheetIconHolder: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetItemText: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
});
