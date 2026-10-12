import { useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import { BrowserProvider, type Eip1193Provider, type Signer } from 'ethers';
import { useCallback, useMemo } from 'react';

import { findNetwork } from '../models/config/networks';
import { getInAppSigner, getProvider } from '../models/services/ethereumService';
import { useInAppWallet } from './InAppWallet';

/**
 * Single entry point for wallet state in the app.
 * - `readProvider` talks straight to the network RPC (fast, no wallet round-trip).
 * - `getSigner()` signs in-app (`kind === 'inapp'`, ethers Wallet) or routes through
 *   MetaMask / Trust Wallet via WalletConnect (`kind === 'walletconnect'`).
 *   Native mainnet sends in this app use the active in-app key after PIN approval.
 */
export function useWallet() {
  const account = useAccount();
  const { provider } = useProvider();
  const appKit = useAppKit();
  const inApp = useInAppWallet();

  const isInApp = !!inApp.keys;
  const kind = isInApp ? 'inapp' : account.isConnected ? 'walletconnect' : undefined;
  const address = isInApp ? inApp.keys!.address : account.address;
  const isConnected = isInApp || account.isConnected;
  const network = isInApp ? inApp.network : findNetwork(account.chainId);
  const chainId = isInApp ? String(inApp.network.id) : account.chainId;

  const readProvider = useMemo(() => (network ? getProvider(network) : undefined), [network]);

  const getSigner = useCallback(async (): Promise<Signer> => {
    if (inApp.keys) return getInAppSigner(inApp.keys.privateKey, inApp.network);
    if (!provider || !address) throw new Error('Connect a wallet first');
    const browserProvider = new BrowserProvider(provider as unknown as Eip1193Provider);
    return browserProvider.getSigner(address);
  }, [inApp.keys, inApp.network, provider, address]);

  const disconnect = useCallback(async () => {
    if (isInApp) inApp.disconnect();
    else await appKit.disconnect();
  }, [isInApp, inApp, appKit]);

  const switchNetwork = useCallback(
    async (target: NonNullable<typeof network>) => {
      if (isInApp) inApp.setNetwork(target);
      else await appKit.switchNetwork(target);
    },
    [isInApp, inApp, appKit],
  );

  return {
    kind,
    address,
    isConnected,
    chainId,
    network,
    isSupportedNetwork: !!network,
    readProvider,
    getSigner,
    open: appKit.open,
    disconnect,
    switchNetwork,
  };
}

/**
 * Signer for a connected EXTERNAL wallet only (MetaMask/Trust via WalletConnect) —
 * never the in-app key. Use this only for flows that explicitly require an
 * external wallet (for example, connected-wallet dApp interactions).
 */
export function useExternalSigner() {
  const account = useAccount();
  const { provider } = useProvider();

  const getSigner = useCallback(async (): Promise<Signer> => {
    if (!provider || !account.address) throw new Error('Connect a wallet first');
    const browserProvider = new BrowserProvider(provider as unknown as Eip1193Provider);
    return browserProvider.getSigner(account.address);
  }, [provider, account.address]);

  return {
    address: account.address,
    isConnected: account.isConnected,
    network: findNetwork(account.chainId),
    getSigner,
  };
}
