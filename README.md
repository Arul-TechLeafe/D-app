# Dapp New

A React Native (Expo) dApp: connect MetaMask or Trust Wallet, check your balance, send and receive ETH, and call a Solidity contract on an EVM test chain.

```
React Native app (mobile/)          Home · Connect Wallet · Balance · Send · Receive · Contract Functions
        │
Wallet (MetaMask / Trust Wallet)    Reown AppKit (WalletConnect) — mobile/src/config/appkit.ts
        │
ethers.js v6                        reads: JsonRpcProvider · writes: BrowserProvider(wallet) — mobile/src/hooks/useWallet.ts
        │
Smart contract (contracts/)         DappContract.sol — message, counter, ETH deposit/withdraw
        │
EVM test chain                      Hardhat local node (31337) or Sepolia (11155111)
```

## Layout

| Path | What it is |
|---|---|
| `contracts/contracts/DappContract.sol` | The Solidity contract |
| `contracts/test/DappContract.js` | Mocha + ethers tests |
| `contracts/scripts/deploy.js` | Deploys, then writes the ABI and address into `mobile/src/models/contracts/` |
| `mobile/src/app/` | Expo Router routes only (one-line files that render a screen from `views/`) |
| `mobile/src/models/` | **Model**: contract ABI/address + chain reads, network/env/AppKit config, types, formatters |
| `mobile/src/controllers/` | **Controller**: hooks with the logic — `useWallet`, `useBalance`, `useTransaction`, `useDappContract`, test wallet |
| `mobile/src/views/` | **View**: `screens/` (Home, Connect, Balance, Send, Receive, Contract) and shared `components/` |

## 1. Contracts

```bash
cd contracts
npm install
npm test                 # compile + run tests
npm run node             # terminal 1: local chain on 0.0.0.0:8545, prints 20 funded test accounts
npm run deploy:local     # terminal 2: deploy + export ABI/address to the app
```

Sepolia (optional):

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY   # a throwaway test key with Sepolia ETH
npm run deploy:sepolia
```

Each deploy updates `mobile/src/models/contracts/addresses.json` (keyed by chain id).

### Testnet cross-network order records

`DappContract` can record indicative demo orders in any direction between Sepolia
ETH, Bitcoin Testnet4, and Solana Devnet using `createTestnetExchangeOrder`.
BTC amounts use sats; SOL amounts use lamports.
`getCrossNetworkOrder` reads an order. For non-EVM source orders, the contract
owner records the source transaction with `recordCrossNetworkSourceTx` before
recording the payout transaction using `fulfillCrossNetworkOrder`. The mobile
Contract Functions screen displays recorded cross-network orders and their
source/payout transaction IDs.

These calls are **tracking only**: they do not escrow or convert ETH, obtain a
trusted exchange quote, or broadcast a Bitcoin/Solana transaction. Price-based
amounts must be calculated by a client/service, and the destination transfer must
be sent and verified separately. Only use testnet funds and clearly treat quotes
as indicative. A production bridge needs audited settlement, liquidity, price
verification, and cross-chain confirmation handling.

The mobile app's Contract Functions screen lets a user select any source and
destination pair among the three testnets, enter a source amount, and view an
indicative output estimate based on current ETH/BTC/SOL market prices. It records
both amounts on the configured EVM testnet. Non-EVM source orders require an
owner-recorded source transaction ID before payout can be recorded. Source and
destination IDs are operator assertions, not independently verified cross-chain
proofs; a successful order record is not proof that either transfer occurred.

## 2. Mobile app

```bash
cd mobile
npm install
cp .env.example .env     # then fill it in
```

- `EXPO_PUBLIC_REOWN_PROJECT_ID`: a free project id from https://dashboard.reown.com (required for WalletConnect).
- `EXPO_PUBLIC_LOCAL_RPC_URL`: your computer's **LAN IP**, e.g. `http://192.168.1.10:8545`. `127.0.0.1` won't work from a phone. The Android emulator uses `http://10.0.2.2:8545`.

AppKit and crypto modules use native libraries, so this app runs as a **development build** (`expo-dev-client`) rather than standard Expo Go.

### Mobile Installation & Build Guide

#### 1. Configure Environment
Before building, ensure `mobile/.env` is set up:
```bash
cd mobile
cp .env.example .env
```
Fill in the following variables:
- `EXPO_PUBLIC_REOWN_PROJECT_ID`: Get a free project ID from [Reown Cloud](https://dashboard.reown.com) (required for WalletConnect/AppKit).
- `EXPO_PUBLIC_LOCAL_RPC_URL`:
  - **Android Emulator**: `http://10.0.2.2:8545`
  - **Physical Phone**: `http://<YOUR_PC_LAN_IP>:8545` (e.g. `http://192.168.1.10:8545`). *`127.0.0.1` will not work from a phone.*
- `EXPO_PUBLIC_SEPOLIA_RPC_URL` & `EXPO_PUBLIC_SEPOLIA_CONTRACT_ADDRESS`: If testing with Sepolia testnet.
- `EXPO_PUBLIC_SOLANA_MAINNET_RPC_URL`: Optional primary Solana Mainnet RPC; defaults to the Solana public endpoint.
- `EXPO_PUBLIC_SOLANA_MAINNET_RPC_FALLBACK_URL`: Optional fallback used when the primary returns HTTP/RPC 403; defaults to `https://solana-rpc.publicnode.com`.

---

#### 2. Android Installation

##### Option A: Local Build (Windows / macOS / Linux)
**Prerequisites:** Android Studio, Android SDK, and JDK 17 installed with `ANDROID_HOME` configured.

1. **Connect device or start emulator:**
   - **Physical Device:** Enable *Developer Options* → *USB Debugging* on your phone, plug in via USB, and verify with `adb devices`.
   - **Emulator:** Start an Android Virtual Device (AVD) from Android Studio.
2. **Build and install:**
   ```bash
   cd mobile
   npm run android
   ```
   *(This triggers `expo run:android`, builds the `android/` directory, and installs the app onto the connected device).*
3. **Subsequent launches:** After the initial install, you only need to start the Metro bundler:
   ```bash
   npm run start
   ```

##### Option B: Cloud Build (Direct APK via EAS — No Android Studio Needed)
To generate a standalone `.apk` directly from the cloud:
```bash
cd mobile
npx eas-cli login
npx eas-cli build -p android --profile preview
```
EAS will output a QR code and URL to download and install the `.apk` directly onto any Android phone.

---

#### 3. iOS Installation

> **Note for Windows users:** iOS cannot be compiled locally on Windows (macOS + Xcode is required). Windows users should use **EAS Cloud Build**.

##### Method A: EAS Cloud Build (From Windows / Any OS)
1. **Log in to EAS and initialize:**
   ```bash
   cd mobile
   npx eas-cli login
   npx eas-cli init
   ```
2. **Register your iPhone (one-time setup):**
   ```bash
   npx eas-cli device:create
   ```
3. **Trigger development build:**
   ```bash
   npx eas-cli build -p ios --profile development
   ```
   *(Note: Requires an Apple Developer Account for ad-hoc / internal device distribution).*
4. **Install and run:**
   - Scan the QR code or open the link on your iPhone to install the `.ipa`.
   - On iOS 16+, enable **Settings → Privacy & Security → Developer Mode**.
   - Start the Metro server on your PC:
     ```bash
     npm run start
     ```
   - Open the app on your iPhone; it will automatically connect to Metro over Wi-Fi.

##### Method B: Local Build (macOS with Xcode only)
```bash
cd mobile
npm install
npm run ios:dev
```

---

#### 4. Quick Command Reference

| Action | Command |
|---|---|
| **Start Metro Bundler** | `cd mobile && npm run start` |
| **Android Local Build** | `cd mobile && npm run android` |
| **Android APK (Cloud)** | `cd mobile && npx eas-cli build -p android --profile preview` |
| **iOS Build (Cloud)** | `cd mobile && npx eas-cli build -p ios --profile development` |
| **iOS Local Build (Mac)** | `cd mobile && npm run ios:dev` |

---

### Using the local Hardhat chain with MetaMask

1. In MetaMask mobile, add a network: RPC `http://<LAN-IP>:8545`, chain id `31337`, symbol `ETH`.
2. Import one of the private keys printed by `npm run node`. **These keys are public; never use them on a real network.**
3. In the app: Connect Wallet, then Switch to Hardhat Local.

Trust Wallet can't add custom local chains easily, so use **Sepolia** with Trust Wallet and get test ETH from a faucet.


## Checks

```bash
cd contracts && npm test
cd mobile && npm run typecheck && npm run lint && npx expo-doctor
```

## Bitcoin (Testnet4)

The **Bitcoin** screen is an in-app tBTC wallet derived from the same 12-word phrase as the in-app
Ethereum wallet (BIP84 native SegWit, `m/84'/1'/0'/0/0`, `tb1…` addresses). It shows balance,
receive QR, history, and sends tBTC with slow/normal/fast fees. Data and broadcasting use the public
mempool.space testnet4 API; free coins: https://mempool.space/testnet4/faucet.

- Code: `models/config/bitcoin.ts`, `models/services/bitcoinService.ts`, `controllers/useBitcoin.ts`,
  `views/screens/BitcoinScreen.tsx`.
- Needs a wallet created or imported **with a recovery phrase** (not a raw private key).
- Mainnet BTC uses the separate BIP84 mainnet path shown in the mainnet section below.

## Mainnet portfolio and native transfers

Ethereum, Bitcoin, and Solana mainnet addresses are derived from the active
wallet's recovery phrase. Native-coin transfers are supported with amount and
network-fee review plus PIN approval. Bitcoin uses BIP84 path
`m/84'/0'/0'/0/0`; Ethereum and Solana use the same keys as their test networks.
Mainnet transfers are irreversible and use real funds. Back up the recovery
phrase securely, verify the full recipient and network, and send a small test
amount first. Only native ETH, BTC, and SOL transfers are supported; this does
not enable token transfers or cross-chain swaps. This wallet implementation has
not been professionally audited and should not be treated as a production-safe
cold wallet.

## Wallet app flow (Trust-style)

1. **Welcome** → *Create a new wallet* or *I already have a wallet*.
2. **6-digit PIN** → enter, then confirm.
3. **Create:** recovery phrase (tap to reveal, write down) → **verify** 3 words → dashboard.
   **Import:** paste 12/24-word phrase → dashboard.
4. **Dashboard:** ☰ menu (left: History, Settings, Recover wallet, Contract Functions, Lock) ·
   wallet switcher (right: Wallet 1, 2… · create / add wallet) · wallet card with balance ·
   **Send / Receive / Swap / Add wallet** · coin list (Bitcoin Testnet4, Ethereum Sepolia, Hardhat Local).
5. Sends are reviewed and **approved with the PIN**. Swap is shown but disabled on testnets.

Recovery phrases and the PIN hash are stored in the OS keystore via `expo-secure-store`
(`models/services/walletStorage.ts`); state lives in `controllers/WalletStore.tsx`.
