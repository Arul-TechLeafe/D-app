import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { HistoryItem } from '../../controllers/useHistory';
import { shortAddress } from '../../models/format';
import { Muted, colors } from './ui';
import { CoinBadge } from './wallet';

/** Transaction rows: direction, coin, amount, time/pending. Tapping opens the explorer. */
export function HistoryList({ items, emptyText }: { items?: HistoryItem[]; emptyText: string }) {
  if (items && items.length === 0) return <Muted>{emptyText}</Muted>;
  return (
    <View>
      {items?.map((item) => {
        const incoming = item.direction === 'in';
        return (
          <Pressable
            key={item.key}
            disabled={!item.url}
            onPress={() => item.url && Linking.openURL(item.url)}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.card }]}
          >
            <View>
              <CoinBadge asset={item.asset} size={38} />
              <View style={[s.arrow, { backgroundColor: incoming ? colors.success : colors.danger }]}>
                <Ionicons name={incoming ? 'arrow-down' : 'arrow-up'} size={10} color="#fff" />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{incoming ? 'Received' : 'Sent'}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {item.pending
                  ? 'Pending…'
                  : [
                      item.time ? new Date(item.time).toLocaleString() : undefined,
                      item.counterparty
                        ? `${incoming ? 'from' : 'to'} ${shortAddress(item.counterparty)}`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Text>
            </View>
            <Text style={[s.amount, { color: incoming ? colors.success : colors.text }]}>
              {`${incoming ? '+' : '−'}${item.amount} ${item.asset.symbol}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 12 },
  arrow: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '600', maxWidth: '45%', textAlign: 'right' },
});
