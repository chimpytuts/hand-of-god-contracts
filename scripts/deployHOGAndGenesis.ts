import { ethers } from "hardhat";
import addresses from "../config/addresses.json";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Using daoFund address:", addresses.daoFund);

  // Deploy HOG token first
  const HOG = await ethers.getContractFactory("HOG");
  const hog = await HOG.deploy();
  await hog.waitForDeployment();
  console.log("HOG deployed to:", await hog.getAddress());

  // Calculate start time (1 hour from now)
  const startTime = Math.floor(Date.now() / 1000) + 3600; // current time + 1 hour

  // Deploy HogGenesisRewardPool
  const HogGenesisRewardPool = await ethers.getContractFactory("HogGenesisRewardPool");
  const genesisPool = await HogGenesisRewardPool.deploy(
    await hog.getAddress(),    // HOG token address
    addresses.devFund,         // devFund address from config
    startTime                  // pool start time
  );
  await genesisPool.waitForDeployment();
  console.log("HogGenesisRewardPool deployed to:", await genesisPool.getAddress());

  // Distribute Genesis rewards from HOG token to the Genesis pool
  console.log("Distributing genesis rewards...");
  const distributeRewardTx = await hog.distributeReward(
    addresses.daoFund,                    // daoFund address from config
    await genesisPool.getAddress()        // genesis pool address
  );
  await distributeRewardTx.wait();
  console.log("Genesis rewards distributed");

  // Print deployment summary
  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("HOG Token:", await hog.getAddress());
  console.log("Genesis Pool:", await genesisPool.getAddress());
  console.log("DAO Fund:", addresses.daoFund);
  console.log("Dev Fund:", addresses.devFund);
  console.log("Start Time:", new Date(startTime * 1000).toLocaleString());
  console.log("\nVerification Commands:");
  console.log("==================");
  console.log(`npx hardhat verify ${await hog.getAddress()}`);
  console.log(`npx hardhat verify ${await genesisPool.getAddress()} ${await hog.getAddress()} ${addresses.devFund} ${startTime}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
