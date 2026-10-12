import type { AppKitNetwork } from '@reown/appkit-react-native';

import { LOCAL_RPC_URL, MAINNET_RPC_URL, SEPOLIA_RPC_URL } from './env';

/** Local Hardhat node started with `npm run node` in /contracts. */
export const hardhatLocal: AppKitNetwork = {
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC_URL] } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:31337',
  testnet: true,
};

/**
 * Ethereum's Sepolia TESTNET. Test coins have no real value — they exist so
 * developers can try things out safely. Never use real (mainnet) keys here.
 */
export const sepolia: AppKitNetwork = {
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'SepoliaETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: Array.from(new Set([SEPOLIA_RPC_URL, 'https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co'])),
    },
  },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:11155111',
  testnet: true,
};

export const SEPOLIA_FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';

/**
 * Ethereum MAINNET. Real ETH, real value. Native transfers use the active
 * in-app wallet and require explicit review plus PIN approval.
 */
export const mainnet: AppKitNetwork = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: Array.from(new Set([MAINNET_RPC_URL, 'https://1rpc.io/eth', 'https://rpc.mevblocker.io', 'https://mainnet.gateway.tenderly.co'])),
    },
  },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:1',
  testnet: false,
};

export const networks = [sepolia, hardhatLocal, mainnet];

/** Where to get free test ETH for a network, if anywhere. */
export function faucetUrl(network?: AppKitNetwork) {
  return network?.id === sepolia.id ? SEPOLIA_FAUCET_URL : undefined;
}

export function findNetwork(chainId?: string | number) {
  if (chainId === undefined) return undefined;
  return networks.find((n) => String(n.id) === String(chainId));
}
