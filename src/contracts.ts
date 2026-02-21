// Contract addresses - Base Sepolia (Snake Agents deployment 2026-02-21)
export const CONTRACTS = {
  botRegistry: '0x98B230509E2e825Ff94Ce69aA21662101E564FA2',
  rewardDistributor: '0x6c8d215606E23BBd353ABC5f531fbB0EaEeDe037',
  pariMutuel: '0x4bcf26A28919bBD30833a022244a3d2819317649',
  snakeBotNFT: '0x7aC014594957c47cD822ddEA6910655C1987B84C',
  botMarketplace: '0x690c4c95317cE4C3e4848440c4ADC751781138f8',
  // USDC on Base Sepolia
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // ReferralRewards contract
  referralRewards: '0xA89FBd57Dd34d89F7D54a1980e6875fee5F2B819',
};

// BotRegistry ABI
export const BOT_REGISTRY_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "address", "name": "_inviter", "type": "address" }], "name": "registerBot", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [], "name": "registrationFee", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "getBotById", "outputs": [{ "components": [{ "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "internalType": "string", "name": "botName", "type": "string" }, { "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "bool", "name": "registered", "type": "bool" }, { "internalType": "uint256", "name": "registeredAt", "type": "uint256" }, { "internalType": "uint256", "name": "matchesPlayed", "type": "uint256" }, { "internalType": "uint256", "name": "totalEarnings", "type": "uint256" }, { "internalType": "uint256", "name": "salePrice", "type": "uint256" }], "internalType": "struct BotRegistry.Bot", "name": "", "type": "tuple" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "getOwnerBots", "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }], "stateMutability": "view", "type": "function" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "indexed": true, "internalType": "address", "name": "owner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }], "name": "BotRegistered", "type": "event" }
] as const;

// RewardDistributor ABI
export const REWARD_DISTRIBUTOR_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "claimRewards", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32[]", "name": "_botIds", "type": "bytes32[]" }], "name": "claimRewardsBatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "pendingRewards", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "MIN_CLAIM_THRESHOLD", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

// SnakeAgentsPariMutuel ABI (USDC-based prediction)
export const PARI_MUTUEL_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "uint256", "name": "_amount", "type": "uint256" }], "name": "placeBet", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "uint256", "name": "_startTime", "type": "uint256" }], "name": "createMatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32[]", "name": "_winners", "type": "bytes32[]" }], "name": "settleMatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimWinnings", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimRefund", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "matches", "outputs": [{ "internalType": "uint256", "name": "matchId", "type": "uint256" }, { "internalType": "uint256", "name": "startTime", "type": "uint256" }, { "internalType": "uint256", "name": "endTime", "type": "uint256" }, { "internalType": "uint256", "name": "totalPool", "type": "uint256" }, { "internalType": "bool", "name": "settled", "type": "bool" }, { "internalType": "bool", "name": "cancelled", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }, { "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "botTotalBets", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "getCurrentOdds", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
] as const;

// ERC20 ABI (for USDC approve)
export const ERC20_ABI = [
  { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

// BotMarketplace ABI — NFT escrow marketplace
export const BOT_MARKETPLACE_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "list", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "buy", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "cancel", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "getActiveListings", "outputs": [{ "internalType": "uint256[]", "name": "tokenIds", "type": "uint256[]" }, { "internalType": "address[]", "name": "sellers", "type": "address[]" }, { "internalType": "uint256[]", "name": "prices", "type": "uint256[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "listings", "outputs": [{ "internalType": "address", "name": "seller", "type": "address" }, { "internalType": "uint256", "name": "price", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "feePercent", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "Listed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }, { "indexed": true, "internalType": "address", "name": "buyer", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "Sold", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }], "name": "Cancelled", "type": "event" }
] as const;

// SnakeBotNFT ABI — for approve + tokenId lookups
export const SNAKE_BOT_NFT_ABI = [
  { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "approve", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "getApproved", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "botToTokenId", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "tokenIdToBot", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "getBotsByOwner", "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "ownerOf", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
] as const;

// ReferralRewards ABI
export const REFERRAL_REWARDS_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "nonce", "type": "uint256" }, { "internalType": "bytes", "name": "signature", "type": "bytes" }], "name": "claim", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "user", "type": "address" }], "name": "getClaimed", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "user", "type": "address" }], "name": "getNonce", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
] as const;
