import { ethers } from "hardhat";

async function main() {
  // Get the contract factories
  const HOG = await ethers.getContractFactory("HOG");
  const BHOG = await ethers.getContractFactory("BHOG");
  const GHOG = await ethers.getContractFactory("GHOG");

  console.log("Starting deployments...");

  // Deploy HOG
  const hog = await HOG.deploy();
  await hog.waitForDeployment();
  console.log("HOG deployed to:", await hog.getAddress());

  // Deploy BHOG
  const bhog = await BHOG.deploy();
  await bhog.waitForDeployment();
  console.log("BHOG deployed to:", await bhog.getAddress());

  // Deploy GHOG
  // For GHOG we need startTime and devFund parameters
  const startTime = Math.floor(Date.now() / 1000); // Current timestamp
  const [deployer] = await ethers.getSigners();
  const devFund = deployer.address; // Using deployer as devFund for this example

  const ghog = await GHOG.deploy(startTime, devFund);
  await ghog.waitForDeployment();
  console.log("GHOG deployed to:", await ghog.getAddress());

  // Verify contracts on Etherscan (optional)
  console.log("Deployments completed. Verify contracts with:");
  console.log(`npx hardhat verify ${await hog.getAddress()}`);
  console.log(`npx hardhat verify ${await bhog.getAddress()}`);
  console.log(`npx hardhat verify ${await ghog.getAddress()} ${startTime} ${devFund}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 