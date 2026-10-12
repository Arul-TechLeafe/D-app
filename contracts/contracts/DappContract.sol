// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract DappContract {
    address public immutable owner;

    string public message;
    uint256 public counter;

    mapping(address => uint256) public balances;

    struct Transaction {
        address from;
        address to;
        uint256 amount;
        uint256 timestamp;
        uint256 blockNumber;
        string transactionType;
    }

    struct CrossNetworkSwap {
        address user;
        uint256 ethAmountWei;
        uint256 btcAmountSats;
        string btcAddress;
        string quoteId;
        string bitcoinTxId;
        uint256 timestamp;
        bool fulfilled;
        string targetNetwork;
        uint256 targetAmount;
        string targetAddress;
        string targetTxId;
        string sourceNetwork;
        uint256 sourceAmount;
        string sourceAddress;
        string sourceTxId;
    }

    struct TestnetExchangeOrder {
        string sourceNetwork;
        uint256 sourceAmount;
        string sourceAddress;
        string targetNetwork;
        uint256 targetAmount;
        string targetAddress;
        string quoteId;
    }

    mapping(address => Transaction[]) private transactionHistory;
    mapping(address => CrossNetworkSwap[]) private crossNetworkHistory;

    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalWithdrawn;
    mapping(address => uint256) public transactionCount;

    event MessageChanged(address indexed by, string newMessage);
    event CounterIncremented(address indexed by, uint256 newValue);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event DirectEtherReceived(address indexed account, uint256 amount);
    event CrossNetworkSwapCreated(
        address indexed user,
        uint256 ethAmountWei,
        uint256 btcAmountSats,
        string btcAddress,
        string quoteId,
        uint256 timestamp
    );
    event CrossNetworkSwapFulfilled(
        address indexed user,
        uint256 ethAmountWei,
        uint256 btcAmountSats,
        string bitcoinTxId,
        uint256 timestamp
    );
    event CrossNetworkOrderCreated(
        address indexed user,
        uint256 ethAmountWei,
        string targetNetwork,
        uint256 targetAmount,
        string targetAddress,
        string quoteId,
        uint256 timestamp
    );
    event CrossNetworkOrderFulfilled(
        address indexed user,
        uint256 ethAmountWei,
        string targetNetwork,
        uint256 targetAmount,
        string targetTxId,
        uint256 timestamp
    );
    event CrossNetworkSourceRecorded(
        address indexed user,
        string sourceNetwork,
        string sourceTxId,
        uint256 timestamp
    );
    event TestnetExchangeOrderCreated(
        address indexed user,
        bytes32 indexed orderId,
        string quoteId,
        uint256 timestamp
    );

    error InvalidAddress();
    error SelfAddressNotAllowed();
    error EmptyMessage();
    error EmptyInitialMessage();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error InsufficientContractBalance(uint256 requested, uint256 available);
    error TransferFailed();
    error InvalidTransactionIndex();
    error UnsupportedTargetNetwork();
    error AlreadyFulfilled();
    error SourceTransactionAlreadyRecorded();
    error SourceTransactionRequired();
    error SameNetworkNotAllowed();
    error InvalidSourceNetwork();

    constructor(string memory initialMessage) {
        if (bytes(initialMessage).length == 0) {
            revert EmptyInitialMessage();
        }
        owner = msg.sender;
        message = initialMessage;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function _validateAddress(address account) internal view {
        if (account == address(0)) {
            revert InvalidAddress();
        }

        if (account == address(this)) {
            revert SelfAddressNotAllowed();
        }
    }

    function setMessage(string calldata newMessage) external {
        if (bytes(newMessage).length == 0) {
            revert EmptyMessage();
        }

        message = newMessage;

        emit MessageChanged(msg.sender, newMessage);
    }

    function increment() external {
        counter += 1;

        emit CounterIncremented(msg.sender, counter);
    }

    function deposit() external payable {
        if (msg.value == 0) {
            revert ZeroAmount();
        }

        balances[msg.sender] += msg.value;
        totalDeposited[msg.sender] += msg.value;
        transactionCount[msg.sender] += 1;

        transactionHistory[msg.sender].push(
            Transaction({
                from: msg.sender,
                to: address(this),
                amount: msg.value,
                timestamp: block.timestamp,
                blockNumber: block.number,
                transactionType: "DEPOSIT"
            })
        );

        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 available = balances[msg.sender];

        if (amount > available) {
            revert InsufficientBalance(amount, available);
        }

        uint256 contractBalance = address(this).balance;

        if (amount > contractBalance) {
            revert InsufficientContractBalance(
                amount,
                contractBalance
            );
        }

        balances[msg.sender] = available - amount;
        totalWithdrawn[msg.sender] += amount;
        transactionCount[msg.sender] += 1;

        transactionHistory[msg.sender].push(
            Transaction({
                from: address(this),
                to: msg.sender,
                amount: amount,
                timestamp: block.timestamp,
                blockNumber: block.number,
                transactionType: "WITHDRAW"
            })
        );

        emit Withdrawn(msg.sender, amount);

        (bool success, ) =
            payable(msg.sender).call{value: amount}("");

        if (!success) {
            revert TransferFailed();
        }
    }

    function getAccountBalance()
        external
        view
        returns (uint256)
    {
        return balances[msg.sender];
    }

    function getBalance(address account)
        external
        view
        returns (uint256)
    {
        _validateAddress(account);

        return balances[account];
    }

    function totalDeposits()
        external
        view
        returns (uint256)
    {
        return address(this).balance;
    }

    function getAccountSummary(address account)
        external
        view
        returns (
            uint256 balance,
            uint256 deposited,
            uint256 withdrawn,
            uint256 transactions
        )
    {
        _validateAddress(account);

        return (
            balances[account],
            totalDeposited[account],
            totalWithdrawn[account],
            transactionCount[account]
        );
    }

    function getTransactionCount(address account)
        external
        view
        returns (uint256)
    {
        _validateAddress(account);

        return transactionHistory[account].length;
    }

    function getTransaction(
        address account,
        uint256 index
    )
        external
        view
        returns (
            address from,
            address to,
            uint256 amount,
            uint256 timestamp,
            uint256 blockNumber,
            string memory transactionType
        )
    {
        _validateAddress(account);

        if (index >= transactionHistory[account].length) {
            revert InvalidTransactionIndex();
        }

        Transaction memory txData =
            transactionHistory[account][index];

        return (
            txData.from,
            txData.to,
            txData.amount,
            txData.timestamp,
            txData.blockNumber,
            txData.transactionType
        );
    }

    function getTransactions(address account)
        external
        view
        returns (Transaction[] memory)
    {
        _validateAddress(account);

        return transactionHistory[account];
    }

    function createCrossNetworkSwap(
        uint256 ethAmountWei,
        uint256 btcAmountSats,
        string calldata btcAddress,
        string calldata quoteId
    ) external {
        _createCrossNetworkOrder(
            msg.sender,
            ethAmountWei,
            "BTC_TESTNET4",
            btcAmountSats,
            btcAddress,
            quoteId
        );
    }

    /**
     * Records a testnet cross-network order only. This does not escrow ETH,
     * calculate a trustworthy exchange rate, or send funds on the target chain.
     * targetAmount is in the destination chain's smallest unit (sats or lamports).
     */
    function createCrossNetworkOrder(
        uint256 ethAmountWei,
        string calldata targetNetwork,
        uint256 targetAmount,
        string calldata targetAddress,
        string calldata quoteId
    ) external {
        _createCrossNetworkOrder(
            msg.sender,
            ethAmountWei,
            targetNetwork,
            targetAmount,
            targetAddress,
            quoteId
        );
    }

    /**
     * Records a BTC Testnet4 -> EVM testnet demo order.
     * This is tracking only; it does not accept BTC or transfer ETH.
     */
    function createBitcoinToEthOrder(
        uint256 btcAmountSats,
        string calldata btcSenderAddress,
        uint256 ethAmountWei,
        address ethRecipient,
        string calldata quoteId
    ) external {
        if (btcAmountSats == 0 || ethAmountWei == 0) revert ZeroAmount();
        if (bytes(btcSenderAddress).length == 0) revert InvalidAddress();
        if (ethRecipient == address(0)) revert InvalidAddress();
        if (bytes(quoteId).length == 0) revert EmptyMessage();

        string memory recipient = _addressToString(ethRecipient);
        crossNetworkHistory[msg.sender].push(
            CrossNetworkSwap({
                user: msg.sender,
                ethAmountWei: ethAmountWei,
                btcAmountSats: btcAmountSats,
                btcAddress: btcSenderAddress,
                quoteId: quoteId,
                bitcoinTxId: "",
                timestamp: block.timestamp,
                fulfilled: false,
                targetNetwork: "ETH_TESTNET",
                targetAmount: ethAmountWei,
                targetAddress: recipient,
                targetTxId: "",
                sourceNetwork: "BTC_TESTNET4",
                sourceAmount: btcAmountSats,
                sourceAddress: btcSenderAddress,
                sourceTxId: ""
            })
        );

        emit CrossNetworkOrderCreated(
            msg.sender,
            ethAmountWei,
            "ETH_TESTNET",
            ethAmountWei,
            recipient,
            quoteId,
            block.timestamp
        );
    }

    /**
     * Stores an indicative order between any two supported testnets.
     * This only records data on the EVM testnet and does not move source or target funds.
     */
    function createTestnetExchangeOrder(TestnetExchangeOrder calldata order) external {
        if (order.sourceAmount == 0 || order.targetAmount == 0) revert ZeroAmount();
        if (bytes(order.sourceAddress).length == 0 || bytes(order.targetAddress).length == 0) {
            revert InvalidAddress();
        }
        if (bytes(order.quoteId).length == 0) revert EmptyMessage();

        if (!_isTestnetNetwork(order.sourceNetwork)) revert InvalidSourceNetwork();
        if (!_isTestnetNetwork(order.targetNetwork)) revert UnsupportedTargetNetwork();
        if (keccak256(bytes(order.sourceNetwork)) == keccak256(bytes(order.targetNetwork))) {
            revert SameNetworkNotAllowed();
        }

        bytes32 sourceHash = keccak256(bytes(order.sourceNetwork));
        bytes32 targetHash = keccak256(bytes(order.targetNetwork));
        uint256 ethAmountWei = sourceHash == keccak256(bytes("ETH_TESTNET"))
            ? order.sourceAmount
            : (targetHash == keccak256(bytes("ETH_TESTNET")) ? order.targetAmount : 0);
        uint256 btcAmountSats = sourceHash == keccak256(bytes("BTC_TESTNET4"))
            ? order.sourceAmount
            : (targetHash == keccak256(bytes("BTC_TESTNET4")) ? order.targetAmount : 0);
        string memory btcAddress = sourceHash == keccak256(bytes("BTC_TESTNET4"))
            ? order.sourceAddress
            : (targetHash == keccak256(bytes("BTC_TESTNET4")) ? order.targetAddress : "");

        crossNetworkHistory[msg.sender].push(
            CrossNetworkSwap({
                user: msg.sender,
                ethAmountWei: ethAmountWei,
                btcAmountSats: btcAmountSats,
                btcAddress: btcAddress,
                quoteId: order.quoteId,
                bitcoinTxId: "",
                timestamp: block.timestamp,
                fulfilled: false,
                targetNetwork: order.targetNetwork,
                targetAmount: order.targetAmount,
                targetAddress: order.targetAddress,
                targetTxId: "",
                sourceNetwork: order.sourceNetwork,
                sourceAmount: order.sourceAmount,
                sourceAddress: order.sourceAddress,
                sourceTxId: ""
            })
        );

        emit TestnetExchangeOrderCreated(
            msg.sender,
            keccak256(abi.encode(order)),
            order.quoteId,
            block.timestamp
        );
    }

    function _isTestnetNetwork(string memory networkName) private pure returns (bool) {
        bytes32 networkHash = keccak256(bytes(networkName));
        return
            _isEvmTestnet(networkName) ||
            networkHash == keccak256(bytes("BTC_TESTNET4")) ||
            networkHash == keccak256(bytes("SOLANA_DEVNET"));
    }

    function _isEvmTestnet(string memory networkName) private pure returns (bool) {
        bytes32 networkHash = keccak256(bytes(networkName));
        return
            networkHash == keccak256(bytes("ETH_TESTNET")) ||
            networkHash == keccak256(bytes("EVM_TESTNET"));
    }

    function _createCrossNetworkOrder(
        address account,
        uint256 ethAmountWei,
        string memory targetNetwork,
        uint256 targetAmount,
        string memory targetAddress,
        string memory quoteId
    ) internal {
        if (ethAmountWei == 0 || targetAmount == 0) revert ZeroAmount();
        if (bytes(targetAddress).length == 0) revert InvalidAddress();
        if (bytes(quoteId).length == 0) revert EmptyMessage();

        bool isBitcoin = keccak256(bytes(targetNetwork)) == keccak256(bytes("BTC_TESTNET4"));
        bool isSolana = keccak256(bytes(targetNetwork)) == keccak256(bytes("SOLANA_DEVNET"));
        if (!isBitcoin && !isSolana) revert UnsupportedTargetNetwork();

        crossNetworkHistory[account].push(
            CrossNetworkSwap({
                user: account,
                ethAmountWei: ethAmountWei,
                btcAmountSats: isBitcoin ? targetAmount : 0,
                btcAddress: isBitcoin ? targetAddress : "",
                quoteId: quoteId,
                bitcoinTxId: "",
                timestamp: block.timestamp,
                fulfilled: false,
                targetNetwork: targetNetwork,
                targetAmount: targetAmount,
                targetAddress: targetAddress,
                targetTxId: "",
                sourceNetwork: "EVM_TESTNET",
                sourceAmount: ethAmountWei,
                sourceAddress: _addressToString(account),
                sourceTxId: ""
            })
        );

        emit CrossNetworkOrderCreated(
            account,
            ethAmountWei,
            targetNetwork,
            targetAmount,
            targetAddress,
            quoteId,
            block.timestamp
        );

        if (isBitcoin) {
            emit CrossNetworkSwapCreated(
                account,
                ethAmountWei,
                targetAmount,
                targetAddress,
                quoteId,
                block.timestamp
            );
        }
    }

    function fulfillCrossNetworkSwap(
        address account,
        uint256 index,
        string calldata bitcoinTxId
    ) external onlyOwner {
        _fulfillCrossNetworkOrder(account, index, bitcoinTxId);
    }

    function fulfillCrossNetworkOrder(
        address account,
        uint256 index,
        string calldata targetTxId
    ) external onlyOwner {
        _fulfillCrossNetworkOrder(account, index, targetTxId);
    }

    function recordCrossNetworkSourceTx(
        address account,
        uint256 index,
        string calldata sourceTxId
    ) external onlyOwner {
        _validateAddress(account);
        if (bytes(sourceTxId).length == 0) revert EmptyMessage();

        CrossNetworkSwap[] storage swaps = crossNetworkHistory[account];
        if (index >= swaps.length) revert InvalidTransactionIndex();

        CrossNetworkSwap storage swap = swaps[index];
        if (swap.fulfilled) revert AlreadyFulfilled();
        if (_isEvmTestnet(swap.sourceNetwork)) revert InvalidSourceNetwork();
        if (bytes(swap.sourceTxId).length != 0) revert SourceTransactionAlreadyRecorded();

        swap.sourceTxId = sourceTxId;
        emit CrossNetworkSourceRecorded(
            account,
            swap.sourceNetwork,
            sourceTxId,
            block.timestamp
        );
    }

    function _fulfillCrossNetworkOrder(
        address account,
        uint256 index,
        string memory targetTxId
    ) internal {
        _validateAddress(account);

        CrossNetworkSwap[] storage swaps = crossNetworkHistory[account];
        if (index >= swaps.length) {
            revert InvalidTransactionIndex();
        }

        CrossNetworkSwap storage swap = swaps[index];
        if (swap.fulfilled) revert AlreadyFulfilled();
        if (
            !_isEvmTestnet(swap.sourceNetwork) &&
            bytes(swap.sourceTxId).length == 0
        ) revert SourceTransactionRequired();
        if (bytes(targetTxId).length == 0) {
            revert EmptyMessage();
        }

        swap.targetTxId = targetTxId;
        if (keccak256(bytes(swap.targetNetwork)) == keccak256(bytes("BTC_TESTNET4"))) {
            swap.bitcoinTxId = targetTxId;
        }
        swap.fulfilled = true;

        emit CrossNetworkOrderFulfilled(
            account,
            swap.ethAmountWei,
            swap.targetNetwork,
            swap.targetAmount,
            targetTxId,
            block.timestamp
        );

        if (keccak256(bytes(swap.targetNetwork)) == keccak256(bytes("BTC_TESTNET4"))) {
            emit CrossNetworkSwapFulfilled(
                account,
                swap.ethAmountWei,
                swap.btcAmountSats,
                targetTxId,
                block.timestamp
            );
        }
    }

    function getCrossNetworkSwapCount(address account)
        external
        view
        returns (uint256)
    {
        _validateAddress(account);
        return crossNetworkHistory[account].length;
    }

    function getCrossNetworkSwap(address account, uint256 index)
        external
        view
        returns (
            address user,
            uint256 ethAmountWei,
            uint256 btcAmountSats,
            string memory btcAddress,
            string memory quoteId,
            string memory bitcoinTxId,
            uint256 timestamp,
            bool fulfilled
        )
    {
        _validateAddress(account);

        if (index >= crossNetworkHistory[account].length) {
            revert InvalidTransactionIndex();
        }

        CrossNetworkSwap storage swap = crossNetworkHistory[account][index];

        return (
            swap.user,
            swap.ethAmountWei,
            swap.btcAmountSats,
            swap.btcAddress,
            swap.quoteId,
            swap.bitcoinTxId,
            swap.timestamp,
            swap.fulfilled
        );
    }

    function getCrossNetworkSwaps(address account)
        external
        view
        returns (CrossNetworkSwap[] memory)
    {
        _validateAddress(account);
        return crossNetworkHistory[account];
    }

    function getCrossNetworkOrder(address account, uint256 index)
        external
        view
        returns (CrossNetworkSwap memory)
    {
        _validateAddress(account);
        if (index >= crossNetworkHistory[account].length) {
            revert InvalidTransactionIndex();
        }
        return crossNetworkHistory[account][index];
    }

    function _addressToString(address account) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes20 value = bytes20(account);
        bytes memory output = new bytes(42);
        output[0] = "0";
        output[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            output[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            output[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(output);
    }

    receive() external payable {
        if (msg.value == 0) {
            revert ZeroAmount();
        }

        emit DirectEtherReceived(
            msg.sender,
            msg.value
        );
    }

    fallback() external payable {
        if (msg.value == 0) {
            revert();
        }

        emit DirectEtherReceived(
            msg.sender,
            msg.value
        );
    }
}
