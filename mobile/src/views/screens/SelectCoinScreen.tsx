import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ASSETS, type Asset } from '../../models/config/assets';
import { Screen, colors } from '../components/ui';
import { CoinBadge } from '../components/wallet';

/** "Choose a coin" step before Send or Receive. */
export default function SelectCoinScreen() {
  const { action } = useLocalSearchParams<{ action?: 'send' | 'receive' }>();
  const target = action === 'receive' ? '/receive/[id]' : '/send/[id]';
  const assets = action === 'send' || action === 'receive' ? ASSETS.filter((a) => !a.readOnly) : ASSETS;
  const testnetAssets = assets.filter((a) => !a.mainnet);
  const mainnetAssets = assets.filter((a) => a.mainnet);

  const renderRow = (asset: Asset) => (
    <Pressable
      key={asset.id}
      onPress={() => router.replace({ pathname: target, params: { id: asset.id } })}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <CoinBadge asset={asset} />
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{asset.name}</Text>
        <Text style={s.network}>{`${asset.networkName} · ${asset.symbol}`}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );

  return (
    <Screen>
      <Text style={s.hint}>{action === 'receive' ? 'Which coin do you want to receive?' : 'Which coin do you want to send?'}</Text>

      <Text style={s.sectionTitle}>Testnet</Text>
      {testnetAssets.map(renderRow)}

      {mainnetAssets.length > 0 ? (
        <>
          <Text style={s.sectionTitle}>Mainnet · Real funds</Text>
          {mainnetAssets.map(renderRow)}
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 15 },
  sectionTitle: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  network: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
