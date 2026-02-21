/**
 * deploy-all.js — One-shot deployment of all Snake Agents contracts to Base Sepolia
 *
 * Prerequisites:
 *   npx hardhat compile          (generates artifacts/)
 *
 * Usage:
 *   BACKEND_PRIVATE_KEY=0x... node deploy-all.js
 */

import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = "https://sepolia.base.org";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const BACKEND_KEY = process.env.BACKEND_PRIVATE_KEY;
if (!BACKEND_KEY) {
  console.error("ERROR: BACKEND_PRIVATE_KEY env var is required");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(BACKEND_KEY, provider);

function loadArtifact(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function deploy(name, artifact, args = [], nonceVal) {
  console.log(`\nDeploying ${name}...`);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const tx = await factory.getDeployTransaction(...args);
  const sent = await wallet.sendTransaction({ ...tx, nonce: nonceVal, gasLimit: 5_000_000 });
  console.log(`  tx: ${sent.hash}`);
  const receipt = await sent.wait();
  const addr = receipt.contractAddress;
  console.log(`  ${name} deployed at: ${addr}`);
  return { address: addr, contract: new ethers.Contract(addr, artifact.abi, wallet) };
}

async function main() {
  console.log("Deployer:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log("Starting nonce:", nonce);

  // Load artifacts (must run `npx hardhat compile` first)
  const nftArtifact = loadArtifact("./artifacts/contracts/SnakeBotNFT.sol/SnakeBotNFT.json");
  const registryArtifact = loadArtifact("./artifacts/contracts/BotRegistry.sol/BotRegistry.json");
  const rewardArtifact = loadArtifact("./artifacts/contracts/RewardDistributor.sol/RewardDistributor.json");
  const pariArtifact = loadArtifact("./artifacts/contracts/SnakeAgentsPariMutuel.sol/SnakeAgentsPariMutuel.json");
  const referralArtifact = loadArtifact("./artifacts/contracts/ReferralRewards.sol/ReferralRewards.json");
  const marketArtifact = loadArtifact("./artifacts/contracts/BotMarketplace.sol/BotMarketplace.json");

  // 1. SnakeBotNFT — no deps
  const nft = await deploy("SnakeBotNFT", nftArtifact, [], nonce++);

  // 2. BotRegistry — no deps
  const registry = await deploy("BotRegistry", registryArtifact, [], nonce++);

  // 3. RewardDistributor(botRegistry)
  const reward = await deploy("RewardDistributor", rewardArtifact, [registry.address], nonce++);

  // 4. SnakeAgentsPariMutuel(usdc)
  const pari = await deploy("SnakeAgentsPariMutuel", pariArtifact, [USDC_ADDRESS], nonce++);

  // 5. ReferralRewards(signer = backend wallet)
  const referral = await deploy("ReferralRewards", referralArtifact, [wallet.address], nonce++);

  // 6. BotMarketplace(nftAddress)
  const market = await deploy("BotMarketplace", marketArtifact, [nft.address], nonce++);

  // --- Post-deploy configuration ---
  console.log("\n--- Post-deploy configuration ---");

  // BotRegistry.setNFTContract(nft)
  console.log("\nBotRegistry.setNFTContract...");
  const tx1 = await registry.contract.setNFTContract(nft.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx1.wait();
  console.log("  done");

  // SnakeBotNFT.setBotRegistry(registry) — so registry can mint
  console.log("SnakeBotNFT.setBotRegistry...");
  const tx2 = await nft.contract.setBotRegistry(registry.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx2.wait();
  console.log("  done");

  // BotRegistry.setBackendWallet(wallet)
  console.log("BotRegistry.setBackendWallet...");
  const tx3 = await registry.contract.setBackendWallet(wallet.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx3.wait();
  console.log("  done");

  // BotRegistry.setReferralContract(referral)
  console.log("BotRegistry.setReferralContract...");
  const tx4 = await registry.contract.setReferralContract(referral.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx4.wait();
  console.log("  done");

  // SnakeAgentsPariMutuel.authorizeOracle(backend wallet)
  console.log("SnakeAgentsPariMutuel.authorizeOracle...");
  const tx5 = await pari.contract.authorizeOracle(wallet.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx5.wait();
  console.log("  done");

  // Fund ReferralRewards with 0.01 ETH
  console.log("Funding ReferralRewards with 0.01 ETH...");
  const tx6 = await wallet.sendTransaction({
    to: referral.address,
    value: ethers.parseEther("0.01"),
    nonce: nonce++,
    gasLimit: 30_000,
  });
  await tx6.wait();
  console.log("  done");

  // --- Save deployment info ---
  const deployment = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: wallet.address,
    contracts: {
      SnakeBotNFT: nft.address,
      BotRegistry: registry.address,
      RewardDistributor: reward.address,
      SnakeAgentsPariMutuel: pari.address,
      ReferralRewards: referral.address,
      BotMarketplace: market.address,
    },
    usdc: USDC_ADDRESS,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
  console.log("\n=== ALL CONTRACTS DEPLOYED ===");
  console.log(JSON.stringify(deployment.contracts, null, 2));
  console.log("\nUpdate src/contracts.ts and .env with these addresses.");
}

main().catch((e) => {
  console.error("DEPLOY FAILED:", e.message);
  process.exit(1);
});
