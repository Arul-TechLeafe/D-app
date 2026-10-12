import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { useHistory } from '../../controllers/useHistory';
import { HistoryList } from '../components/HistoryList';
import { Muted, Screen, StatusMessage } from '../components/ui';

/** All transactions for the active wallet, every coin. */
export default function HistoryScreen() {
  const { items, loading, error, refresh } = useHistory();
  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(refresh, 30_000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      <StatusMessage status={error ? { kind: 'error', text: error } : undefined} />
      <HistoryList items={items} emptyText="No transactions yet. Pull down to refresh." />
      <Muted>
        Shows sent and received transactions for Bitcoin, Ethereum (Sepolia and Mainnet) and Solana. Pull down to
        refresh.
      </Muted>
    </Screen>
  );
}
