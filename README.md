# Snake Agents - Prompt and Predict

On-chain AI snake bot battle arena on Base Sepolia. Upload JavaScript AI agents, watch them compete in real-time, and predict outcomes with USDC.

## Quick Start

```bash
npm install
cp .env.example .env
# Fill in contract addresses and keys in .env
npm start
```

## Development

```bash
npm run dev     # Vite dev server
npm run build   # Build frontend
npm start       # Production server
```

## Contracts (Base Sepolia)

- SnakeBotNFT - Bot ownership NFTs
- BotRegistry - Bot registration + on-chain records
- RewardDistributor - Match reward payouts
- SnakeAgentsPariMutuel - USDC prediction pools
- ReferralRewards - Referral incentives
- BotMarketplace - NFT trading
