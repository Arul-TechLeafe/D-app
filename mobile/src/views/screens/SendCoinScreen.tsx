import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePrefs } from '../../controllers/PrefsStore';
import { useAssets } from '../../controllers/useAssets';
import { useSendAsset, type FeeSpeed } from '../../controllers/useSendAsset';
import { useWalletStore } from '../../controllers/WalletStore';
import { formatAssetAmount } from '../../models/assetAmounts';
import { getAsset } from '../../models/config/assets';
import { errorMessage } from '../../models/format';
import { PinPad } from '../components/PinPad';
import { Button, Card, Field, Muted, Row, Screen, StatusMessage, colors } from '../components/ui';
import { CoinBadge } from '../components/wallet';

const SPEEDS: { key: FeeSpeed; label: string }[] = [
  { key: 'slow', label: 'Slow' },
  { key: 'normal', label: 'Normal' },
  { key: 'fast', label: 'Fast' },
];

/** Send any coin: form → review → PIN → broadcast. */
export default function SendCoinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const asset = getAsset(id);
  const { verifyPin } = useWalletStore();
  const { byId, refresh } = useAssets();
  const { validate, estimateFee, send, sending, status, setStatus, txUrl } = useSendAsset(asset);
  const { contacts } = usePrefs();
  const saved = contacts.filter((c) => c.kind === asset?.kind);

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [speed, setSpeed] = useState<FeeSpeed>('normal');
  const [review, setReview] = useState<bigint>();
  const [estimatedFee, setEstimatedFee] = useState<bigint>();
  const [estimatingFee, setEstimatingFee] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string>();
  const [pinAttempt, setPinAttempt] = useState(0);
  const [done, setDone] = useState(false);

  if (!asset) return <Screen><Muted>Unknown coin.</Muted></Screen>;
  const balance = byId(asset.id)?.balance;

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: `Send ${asset.symbol}` }} />
        <View style={s.done}>
          <Ionicons name="checkmark-circle" size={72} color={colors.success} />
          <Text style={s.doneTitle}>Transaction sent</Text>
          <StatusMessage status={status} />
        </View>
        {txUrl ? <Button title="View on explorer" variant="secondary" onPress={() => Linking.openURL(txUrl)} /> : null}
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `Send ${asset.symbol}` }} />

      <View style={s.head}>
        <CoinBadge asset={asset} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={s.headTitle}>{`${asset.name} · ${asset.networkName}`}</Text>
          <Text style={s.headSub}>
            {balance !== undefined ? `Available ${formatAssetAmount(asset, balance, 8)} ${asset.symbol}` : 'Loading balance…'}
          </Text>
        </View>
      </View>

      <Field
        label="Recipient address"
        placeholder={asset.kind === 'bitcoin' ? (asset.mainnet ? 'bc1…' : 'tb1…') : asset.kind === 'solana' ? 'Base58 address' : '0x…'}
        value={to}
        onChangeText={setTo}
      />
      {saved.length > 0 ? (
        <View style={s.chips}>
          {saved.map((c) => (
            <Pressable key={c.id} onPress={() => setTo(c.address)} style={s.chip}>
              <Ionicons name="person-circle-outline" size={16} color={colors.primary} />
              <Text style={s.chipText}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Button
        title="Paste address"
        variant="secondary"
        onPress={async () => setTo((await Clipboard.getStringAsync()).trim())}
      />
      <Field
        label={`Amount (${asset.symbol})`}
        placeholder="0.001"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
      />

      {asset.kind === 'bitcoin' ? (
        <View style={s.speeds}>
          {SPEEDS.map((sp) => (
            <Pressable key={sp.key} onPress={() => setSpeed(sp.key)} style={[s.speed, speed === sp.key && s.speedActive]}>
              <Text style={s.speedText}>{sp.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <StatusMessage status={status} />
      <Button
        title="Estimate fee and review"
        loading={estimatingFee}
        onPress={async () => {
          if (balance === undefined) {
            setStatus({ kind: 'error', text: 'Wait for the wallet balance to load before sending' });
            return;
          }
          const value = validate(to, amount, balance);
          if (value === undefined) return;
          setEstimatingFee(true);
          setStatus(undefined);
          try {
            const fee = await estimateFee(to, value, speed);
            if (balance !== undefined && value + fee > balance) {
              setStatus({
                kind: 'error',
                text: `Not enough ${asset.symbol} to cover amount and estimated network fee`,
              });
              return;
            }
            setEstimatedFee(fee);
            setReview(value);
          } catch (e) {
            setStatus({ kind: 'error', text: errorMessage(e) });
          } finally {
            setEstimatingFee(false);
          }
        }}
      />

      {/* Review sheet */}
      <Modal visible={review !== undefined && !pinOpen} transparent animationType="slide" onRequestClose={() => setReview(undefined)}>
        <Pressable style={s.backdrop} onPress={() => setReview(undefined)} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Confirm transaction</Text>
          {review !== undefined ? (
            <Card>
              <Row label="Send" value={`${formatAssetAmount(asset, review, 8)} ${asset.symbol}`} />
              <Row label="Full recipient" value={to.trim()} mono />
              <Row label="Network" value={`${asset.name} ${asset.networkName}`} />
              <Row
                label="Estimated network fee"
                value={estimatedFee === undefined ? 'Unavailable' : `${formatAssetAmount(asset, estimatedFee, 8)} ${asset.symbol}`}
              />
              <Row
                label="Estimated total"
                value={`${formatAssetAmount(asset, review + (estimatedFee ?? 0n), 8)} ${asset.symbol}`}
              />
            </Card>
          ) : null}
          <Muted>
            {asset.mainnet
              ? 'REAL FUNDS: irreversible transfer. Verify the full recipient and network fee. Approving with your PIN signs using this app wallet.'
              : 'Testnet coins only — they have no real value.'}
          </Muted>
          <Button
            title="Confirm"
            loading={sending}
            onPress={async () => {
              setPinOpen(true);
            }}
          />
          <Button title="Cancel" variant="secondary" onPress={() => setReview(undefined)} />
        </View>
      </Modal>

      {/* PIN approval */}
      <Modal visible={pinOpen} animationType="slide" onRequestClose={() => setPinOpen(false)}>
        <PinPad
          title="Enter PIN to approve"
          subtitle={
            review !== undefined
              ? `Send ${formatAssetAmount(asset, review, 8)} ${asset.symbol} to ${to.trim()} on ${asset.networkName}`
              : undefined
          }
          error={pinError}
          busy={sending}
          resetKey={pinAttempt}
          onComplete={async (pin) => {
            if (!(await verifyPin(pin))) {
              setPinError('Wrong PIN');
              setPinAttempt((a) => a + 1);
              return;
            }
            setPinError(undefined);
            const ok = await send(to, review!, speed, estimatedFee);
            setPinOpen(false);
            setReview(undefined);
            if (ok) {
              setDone(true);
              refresh();
            }
          }}
        />
        <Pressable onPress={() => setPinOpen(false)} style={s.cancelPin}>
          <Text style={s.cancelPinText}>Cancel</Text>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  speeds: { flexDirection: 'row', gap: 8 },
  speed: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  speedActive: { borderColor: colors.primary, backgroundColor: '#1B2440' },
  speedText: { color: colors.text, fontWeight: '600' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  cancelPin: { position: 'absolute', top: 48, right: 20, padding: 8 },
  cancelPinText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  done: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
});
