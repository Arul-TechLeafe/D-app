import type { AppKitNetwork } from '@reown/appkit-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { sepolia } from '../models/config/networks';
import { deriveBitcoinAccount, deriveMainnetBitcoinAccount } from '../models/services/bitcoinService';
import { createWallet, importFromMnemonic, type WalletKeys } from '../models/services/ethereumService';
import { deriveSolanaAccount } from '../models/services/solanaService';
import * as storage from '../models/services/walletStorage';
import type { WalletMeta } from '../models/services/walletStorage';

/**
 * - loading  : reading storage at startup
 * - empty    : no wallet yet → onboarding
 * - locked   : wallets exist, PIN required
 * - unlocked : dashboard
 */
export type AppStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

export type ActiveWallet = WalletMeta & {
  /** EVM keys (address, privateKey, mnemonic) — same address on every EVM network. */
  keys: WalletKeys;
  btcAddress: string;
  btcMainnetAddress: string;
  solAddress: string;
};

type WalletStoreValue = {
  status: AppStatus;
  wallets: WalletMeta[];
  /** Undefined while keys are being derived (a second or so after unlock/switch). */
  active?: ActiveWallet;
  /** Network used by EVM dApp screens (Contract Functions). */
  dappNetwork: AppKitNetwork;
  setDappNetwork: (network: AppKitNetwork) => void;

  /** Recovery phrase generated for the create flow, not saved until the backup is verified. */
  pendingMnemonic?: string;
  setupPin: (pin: string) => Promise<void>;
  beginCreate: () => string;
  finishCreate: () => Promise<void>;
  importWallet: (phrase: string) => Promise<void>;

  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  /** Unlocks after the OS has verified the user (biometrics). The PIN is not checked. */
  unlockVerified: () => void;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  revealPhrase: (pin: string) => Promise<string | null>;

  switchWallet: (id: string) => Promise<void>;
  renameWallet: (id: string, name: string) => Promise<void>;
  removeWallet: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
};

const WalletStoreContext = createContext<WalletStoreValue | undefined>(undefined);

type DerivedKeys = { id: string; keys: WalletKeys; btcAddress: string; btcMainnetAddress: string; solAddress: string };

/** Derives EVM + Bitcoin + Solana keys off the UI's critical path. */
function deriveKeys(id: string, mnemonic: string): Promise<DerivedKeys> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve({
          id,
          keys: importFromMnemonic(mnemonic),
          btcAddress: deriveBitcoinAccount(mnemonic).address,
          btcMainnetAddress: deriveMainnetBitcoinAccount(mnemonic).address,
          solAddress: deriveSolanaAccount(mnemonic).address,
        });
      } catch (e) {
        reject(e);
      }
    }, 0),
  );
}

export function WalletStoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [derived, setDerived] = useState<DerivedKeys>();
  const [pendingMnemonic, setPendingMnemonic] = useState<string>();
  const [dappNetwork, setDappNetwork] = useState<AppKitNetwork>(sepolia);

  const reloadIndex = useCallback(async () => {
    const index = await storage.loadWalletIndex();
    setWallets(index.wallets);
    setActiveId(index.activeId ?? index.wallets[0]?.id);
    return index;
  }, []);

  // Startup: decide between onboarding and the lock screen.
  useEffect(() => {
    (async () => {
      const index = await reloadIndex();
      setStatus(index.wallets.length === 0 ? 'empty' : 'locked');
    })().catch(() => setStatus('empty'));
  }, [reloadIndex]);

  // Load + derive keys whenever the active wallet changes while unlocked.
  useEffect(() => {
    if (status !== 'unlocked' || !activeId) return;
    let cancelled = false;
    (async () => {
      const mnemonic = await storage.loadMnemonic(activeId);
      if (!mnemonic || cancelled) return;
      const keys = await deriveKeys(activeId, mnemonic);
      if (!cancelled) setDerived(keys);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, activeId]);

  // Keys of a previous wallet are never exposed after switching / locking.
  const meta = wallets.find((w) => w.id === activeId);
  const active = useMemo<ActiveWallet | undefined>(
    () =>
      status === 'unlocked' && meta && derived?.id === meta.id
        ? {
            ...meta,
            keys: derived.keys,
            btcAddress: derived.btcAddress,
            btcMainnetAddress: derived.btcMainnetAddress,
            solAddress: derived.solAddress,
          }
        : undefined,
    [status, meta, derived],
  );

  const value = useMemo<WalletStoreValue>(() => {
    const afterAdd = async (meta: WalletMeta) => {
      await reloadIndex();
      setActiveId(meta.id);
      setStatus('unlocked');
    };

    return {
      status,
      wallets,
      active,
      dappNetwork,
      setDappNetwork,
      pendingMnemonic,

      setupPin: (pin) => storage.setPin(pin),

      beginCreate: () => {
        const { mnemonic } = createWallet();
        setPendingMnemonic(mnemonic!);
        return mnemonic!;
      },

      finishCreate: async () => {
        if (!pendingMnemonic) throw new Error('No wallet is being created');
        const meta = await storage.addWallet(`Wallet ${wallets.length + 1}`, pendingMnemonic);
        setPendingMnemonic(undefined);
        await afterAdd(meta);
      },

      importWallet: async (phrase) => {
        const { mnemonic } = importFromMnemonic(phrase); // validates the phrase
        const meta = await storage.addWallet(`Wallet ${wallets.length + 1}`, mnemonic!);
        await afterAdd(meta);
      },

      unlock: async (pin) => {
        const ok = await storage.verifyPin(pin);
        if (ok) setStatus('unlocked');
        return ok;
      },

      lock: () => {
        setDerived(undefined);
        setStatus('locked');
      },

      unlockVerified: () => setStatus('unlocked'),

      verifyPin: (pin) => storage.verifyPin(pin),

      changePin: async (oldPin, newPin) => {
        if (!(await storage.verifyPin(oldPin))) return false;
        await storage.setPin(newPin);
        return true;
      },

      revealPhrase: async (pin) => {
        if (!activeId || !(await storage.verifyPin(pin))) return null;
        return storage.loadMnemonic(activeId);
      },

      switchWallet: async (id) => {
        await storage.setActiveWallet(id);
        setActiveId(id);
      },

      renameWallet: async (id, name) => {
        await storage.renameWallet(id, name.trim() || 'Wallet');
        await reloadIndex();
      },

      removeWallet: async (id) => {
        await storage.removeWallet(id);
        const index = await reloadIndex();
        if (index.wallets.length === 0) {
          await storage.resetEverything();
          setDerived(undefined);
          setStatus('empty');
        }
      },

      resetAll: async () => {
        await storage.resetEverything();
        setWallets([]);
        setActiveId(undefined);
        setDerived(undefined);
        setPendingMnemonic(undefined);
        setStatus('empty');
      },
    };
  }, [status, wallets, active, activeId, dappNetwork, pendingMnemonic, reloadIndex]);

  return <WalletStoreContext.Provider value={value}>{children}</WalletStoreContext.Provider>;
}

export function useWalletStore() {
  const ctx = useContext(WalletStoreContext);
  if (!ctx) throw new Error('useWalletStore must be used inside WalletStoreProvider');
  return ctx;
}
