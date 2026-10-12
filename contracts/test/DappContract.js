import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("DappContract", function () {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const dapp = await ethers.deployContract("DappContract", ["Hello, EVM!"]);
    return { dapp, owner, alice };
  }

  it("stores the initial message and owner", async function () {
    const { dapp, owner } = await deploy();
    expect(await dapp.message()).to.equal("Hello, EVM!");
    expect(await dapp.owner()).to.equal(owner.address);
  });

  it("updates the message and emits an event", async function () {
    const { dapp, alice } = await deploy();
    await expect(dapp.connect(alice).setMessage("gm"))
      .to.emit(dapp, "MessageChanged")
      .withArgs(alice.address, "gm");
    expect(await dapp.message()).to.equal("gm");
  });

  it("rejects an empty message", async function () {
    const { dapp } = await deploy();
    await expect(dapp.setMessage("")).to.be.revertedWithCustomError(dapp, "EmptyMessage");
  });

  it("increments the counter", async function () {
    const { dapp } = await deploy();
    await dapp.increment();
    await expect(dapp.increment()).to.emit(dapp, "CounterIncremented").withArgs(anyAddress(), 2n);
    expect(await dapp.counter()).to.equal(2n);
  });

  it("handles deposits and withdrawals", async function () {
    const { dapp, alice } = await deploy();
    const amount = ethers.parseEther("1");

    await expect(dapp.connect(alice).deposit({ value: amount }))
      .to.emit(dapp, "Deposited")
      .withArgs(alice.address, amount);
    expect(await dapp.balances(alice.address)).to.equal(amount);
    expect(await dapp.totalDeposits()).to.equal(amount);

    await expect(dapp.connect(alice).withdraw(amount)).to.changeEtherBalances(
      ethers,
      [alice, dapp],
      [amount, -amount],
    );
    expect(await dapp.balances(alice.address)).to.equal(0n);
  });

  it("rejects zero deposits and over-withdrawals", async function () {
    const { dapp, alice } = await deploy();
    await expect(dapp.deposit({ value: 0 })).to.be.revertedWithCustomError(dapp, "ZeroAmount");
    await expect(dapp.connect(alice).withdraw(1n))
      .to.be.revertedWithCustomError(dapp, "InsufficientBalance")
      .withArgs(1n, 0n);
  });

  it("rejects an empty initial message", async function () {
    const factory = await ethers.getContractFactory("DappContract");
    await expect(factory.deploy("")).to.be.revertedWithCustomError(factory, "EmptyInitialMessage");
  });

  it("records deposit and withdraw history", async function () {
    const { dapp, alice } = await deploy();
    const dappAddress = await dapp.getAddress();

    await dapp.connect(alice).deposit({ value: ethers.parseEther("2") });
    await dapp.connect(alice).withdraw(ethers.parseEther("0.5"));

    expect(await dapp.getTransactionCount(alice.address)).to.equal(2n);

    const history = await dapp.getTransactions(alice.address);
    expect(history.length).to.equal(2);
    expect(history[0].transactionType).to.equal("DEPOSIT");
    expect(history[0].from).to.equal(alice.address);
    expect(history[0].to).to.equal(dappAddress);
    expect(history[0].amount).to.equal(ethers.parseEther("2"));
    expect(history[1].transactionType).to.equal("WITHDRAW");
    expect(history[1].from).to.equal(dappAddress);
    expect(history[1].to).to.equal(alice.address);
    expect(history[1].amount).to.equal(ethers.parseEther("0.5"));

    const second = await dapp.getTransaction(alice.address, 1);
    expect(second.transactionType).to.equal("WITHDRAW");
    await expect(dapp.getTransaction(alice.address, 2)).to.be.revertedWithCustomError(
      dapp,
      "InvalidTransactionIndex",
    );
  });

  it("returns balance and account summary", async function () {
    const { dapp, alice } = await deploy();
    await dapp.connect(alice).deposit({ value: ethers.parseEther("3") });
    await dapp.connect(alice).withdraw(ethers.parseEther("1"));

    expect(await dapp.getBalance(alice.address)).to.equal(ethers.parseEther("2"));
    expect(await dapp.connect(alice).getAccountBalance()).to.equal(ethers.parseEther("2"));

    const summary = await dapp.getAccountSummary(alice.address);
    expect(summary.balance).to.equal(ethers.parseEther("2"));
    expect(summary.deposited).to.equal(ethers.parseEther("3"));
    expect(summary.withdrawn).to.equal(ethers.parseEther("1"));
    expect(summary.transactions).to.equal(2n);
  });

  it("rejects the zero address and the contract itself in views", async function () {
    const { dapp } = await deploy();
    await expect(dapp.getBalance(ethers.ZeroAddress)).to.be.revertedWithCustomError(dapp, "InvalidAddress");
    await expect(dapp.getAccountSummary(await dapp.getAddress())).to.be.revertedWithCustomError(
      dapp,
      "SelfAddressNotAllowed",
    );
  });

  it("accepts direct ETH without crediting a balance", async function () {
    const { dapp, alice } = await deploy();
    const amount = ethers.parseEther("1");

    await expect(alice.sendTransaction({ to: await dapp.getAddress(), value: amount }))
      .to.emit(dapp, "DirectEtherReceived")
      .withArgs(alice.address, amount);
    expect(await dapp.totalDeposits()).to.equal(amount);
    expect(await dapp.balances(alice.address)).to.equal(0n);

    await expect(alice.sendTransaction({ to: await dapp.getAddress(), value: 0 })).to.be.revertedWithCustomError(
      dapp,
      "ZeroAmount",
    );
  });

  it("records a cross-network swap request and marks it fulfilled", async function () {
    const { dapp, owner, alice } = await deploy();
    const ethAmount = ethers.parseEther("0.5");
    const btcAmountSats = 50000n;
    const btcAddress = "tb1qexampleaddress";
    const quoteId = "quote-123";

    await expect(dapp.connect(alice).createCrossNetworkSwap(ethAmount, btcAmountSats, btcAddress, quoteId))
      .to.emit(dapp, "CrossNetworkSwapCreated")
      .withArgs(alice.address, ethAmount, btcAmountSats, btcAddress, quoteId, anyBigInt());

    expect(await dapp.getCrossNetworkSwapCount(alice.address)).to.equal(1n);

    const swap = await dapp.getCrossNetworkSwap(alice.address, 0);
    expect(swap.user).to.equal(alice.address);
    expect(swap.ethAmountWei).to.equal(ethAmount);
    expect(swap.btcAmountSats).to.equal(btcAmountSats);
    expect(swap.btcAddress).to.equal(btcAddress);
    expect(swap.quoteId).to.equal(quoteId);
    expect(swap.fulfilled).to.equal(false);

    await expect(dapp.connect(owner).fulfillCrossNetworkSwap(alice.address, 0, "btcTxHash123"))
      .to.emit(dapp, "CrossNetworkSwapFulfilled")
      .withArgs(alice.address, ethAmount, btcAmountSats, "btcTxHash123", anyBigInt());

    const updated = await dapp.getCrossNetworkSwap(alice.address, 0);
    expect(updated.bitcoinTxId).to.equal("btcTxHash123");
    expect(updated.fulfilled).to.equal(true);
    await expect(dapp.connect(owner).fulfillCrossNetworkSwap(alice.address, 0, "duplicate"))
      .to.be.revertedWithCustomError(dapp, "AlreadyFulfilled");
  });

  it("records and fulfills an ETH-to-Solana-devnet demo order in lamports", async function () {
    const { dapp, owner, alice } = await deploy();
    const ethAmount = ethers.parseEther("0.1");
    const solAmountLamports = 25_000_000n;
    const solAddress = "11111111111111111111111111111111";
    const quoteId = "sol-quote-456";

    await expect(
      dapp.connect(alice).createCrossNetworkOrder(
        ethAmount,
        "SOLANA_DEVNET",
        solAmountLamports,
        solAddress,
        quoteId,
      ),
    )
      .to.emit(dapp, "CrossNetworkOrderCreated")
      .withArgs(
        alice.address,
        ethAmount,
        "SOLANA_DEVNET",
        solAmountLamports,
        solAddress,
        quoteId,
        anyBigInt(),
      );

    const order = await dapp.getCrossNetworkOrder(alice.address, 0);
    expect(order.user).to.equal(alice.address);
    expect(order.ethAmountWei).to.equal(ethAmount);
    expect(order.targetNetwork).to.equal("SOLANA_DEVNET");
    expect(order.targetAmount).to.equal(solAmountLamports);
    expect(order.targetAddress).to.equal(solAddress);
    expect(order.btcAmountSats).to.equal(0n);
    expect(order.fulfilled).to.equal(false);

    await expect(dapp.connect(owner).fulfillCrossNetworkOrder(alice.address, 0, "solanaDevnetSignature"))
      .to.emit(dapp, "CrossNetworkOrderFulfilled")
      .withArgs(
        alice.address,
        ethAmount,
        "SOLANA_DEVNET",
        solAmountLamports,
        "solanaDevnetSignature",
        anyBigInt(),
      );

    const settled = await dapp.getCrossNetworkOrder(alice.address, 0);
    expect(settled.targetTxId).to.equal("solanaDevnetSignature");
    expect(settled.fulfilled).to.equal(true);
    await expect(dapp.connect(owner).fulfillCrossNetworkOrder(alice.address, 0, "duplicate"))
      .to.be.revertedWithCustomError(dapp, "AlreadyFulfilled");
  });

  it("tracks a Bitcoin Testnet4-to-EVM testnet order and requires its source tx before settlement", async function () {
    const { dapp, owner, alice } = await deploy();
    const btcAmountSats = 125000n;
    const ethAmountWei = ethers.parseEther("0.025");
    const btcSender = "tb1qexampleaddress";
    const ethRecipient = alice.address;
    const quoteId = "btc-eth-quote-789";

    await expect(
      dapp.connect(alice).createBitcoinToEthOrder(
        btcAmountSats,
        btcSender,
        ethAmountWei,
        ethRecipient,
        quoteId,
      ),
    )
      .to.emit(dapp, "CrossNetworkOrderCreated")
      .withArgs(
        alice.address,
        ethAmountWei,
        "ETH_TESTNET",
        ethAmountWei,
        ethRecipient.toLowerCase(),
        quoteId,
        anyBigInt(),
      );

    const order = await dapp.getCrossNetworkOrder(alice.address, 0);
    expect(order.sourceNetwork).to.equal("BTC_TESTNET4");
    expect(order.sourceAmount).to.equal(btcAmountSats);
    expect(order.sourceAddress).to.equal(btcSender);
    expect(order.sourceTxId).to.equal("");
    expect(order.targetNetwork).to.equal("ETH_TESTNET");
    expect(order.targetAmount).to.equal(ethAmountWei);
    expect(order.targetAddress.toLowerCase()).to.equal(ethRecipient.toLowerCase());

    await expect(dapp.connect(owner).fulfillCrossNetworkOrder(alice.address, 0, "payout-hash"))
      .to.be.revertedWithCustomError(dapp, "SourceTransactionRequired");

    await expect(dapp.connect(owner).recordCrossNetworkSourceTx(alice.address, 0, "bitcoin-testnet4-txid"))
      .to.emit(dapp, "CrossNetworkSourceRecorded")
      .withArgs(alice.address, "BTC_TESTNET4", "bitcoin-testnet4-txid", anyBigInt());

    await expect(dapp.connect(owner).recordCrossNetworkSourceTx(alice.address, 0, "another-txid"))
      .to.be.revertedWithCustomError(dapp, "SourceTransactionAlreadyRecorded");

    await expect(dapp.connect(owner).fulfillCrossNetworkOrder(alice.address, 0, "sepolia-payout-hash"))
      .to.emit(dapp, "CrossNetworkOrderFulfilled")
      .withArgs(
        alice.address,
        ethAmountWei,
        "ETH_TESTNET",
        ethAmountWei,
        "sepolia-payout-hash",
        anyBigInt(),
      );

    const settled = await dapp.getCrossNetworkOrder(alice.address, 0);
    expect(settled.sourceTxId).to.equal("bitcoin-testnet4-txid");
    expect(settled.targetTxId).to.equal("sepolia-payout-hash");
    expect(settled.fulfilled).to.equal(true);
  });

  it("creates and settles generic orders in every direction across all supported testnets", async function () {
    const { dapp, owner, alice } = await deploy();
    const networks = [
      { id: "ETH_TESTNET", amount: 1_000_000_000_000_000_000n, address: alice.address },
      { id: "BTC_TESTNET4", amount: 100_000_000n, address: "tb1qtestsource" },
      { id: "SOLANA_DEVNET", amount: 1_000_000_000n, address: "SolanaTestSource111111111111111111111111" },
    ];

    for (const source of networks) {
      for (const target of networks) {
        if (source.id === target.id) continue;
        const countBefore = await dapp.getCrossNetworkSwapCount(alice.address);
        const index = Number(countBefore);
        const sourceAddress = source.id === "ETH_TESTNET" ? alice.address : source.address;
        const targetAddress = target.id === "ETH_TESTNET" ? alice.address : target.address;

        await dapp.connect(alice).createTestnetExchangeOrder({
          sourceNetwork: source.id,
          sourceAmount: source.amount,
          sourceAddress,
          targetNetwork: target.id,
          targetAmount: target.amount,
          targetAddress,
          quoteId: `${source.id}-${target.id}`,
        });

        const order = await dapp.getCrossNetworkOrder(alice.address, index);
        expect(order.sourceNetwork).to.equal(source.id);
        expect(order.sourceAmount).to.equal(source.amount);
        expect(order.targetNetwork).to.equal(target.id);
        expect(order.targetAmount).to.equal(target.amount);

        if (source.id !== "ETH_TESTNET") {
          await dapp.connect(owner).recordCrossNetworkSourceTx(alice.address, index, `source-${index}`);
        }
        await dapp.connect(owner).fulfillCrossNetworkOrder(alice.address, index, `target-${index}`);
        expect((await dapp.getCrossNetworkOrder(alice.address, index)).fulfilled).to.equal(true);
      }
    }
  });

  it("rejects unsupported cross-network destinations", async function () {
    const { dapp, alice } = await deploy();
    await expect(
      dapp.connect(alice).createCrossNetworkOrder(
        ethers.parseEther("0.1"),
        "SOLANA_MAINNET",
        1n,
        "some-address",
        "quote",
      ),
    ).to.be.revertedWithCustomError(dapp, "UnsupportedTargetNetwork");
  });
});

function anyAddress() {
  return (value) => ethers.isAddress(value);
}

function anyBigInt() {
  return (value) => typeof value === 'bigint';
}
