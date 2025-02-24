import { ethers, network, run } from "hardhat";

async function main() {
  // Get the deployer's signer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Contract arguments
  const HOG_TOKEN = "0xb3804bf38bd170ef65b4de8536d19a8e3600c0a9";
  const DEV_FUND = "0xeFb4DA71d2Fc85cECED7aD15F71E723CCD25F998";
  const POOL_START_TIME = 1740524400; // Feb 25, 2025, 23:00:00 GMT

  // Deploy Genesis Pool
  console.log("Deploying HogGenesisRewardPool...");
  const HogGenesisRewardPool = await ethers.getContractFactory("HogGenesisRewardPool");
  const genesisPool = await HogGenesisRewardPool.deploy(
    HOG_TOKEN,
    DEV_FUND,
    POOL_START_TIME
  );
  await genesisPool.waitForDeployment();
  
  const genesisPoolAddress = await genesisPool.getAddress();
  console.log("HogGenesisRewardPool deployed to:", genesisPoolAddress);

  // Wait for a few block confirmations before verification
  console.log("Waiting for block confirmations...");
  await genesisPool.deploymentTransaction()?.wait(5);

  // Verify the contract on the explorer
  if (network.name !== "hardhat") {
    console.log("Verifying contract on explorer...");
    try {
      await run("verify:verify", {
        address: genesisPoolAddress,
        constructorArguments: [HOG_TOKEN, DEV_FUND, POOL_START_TIME],
        contract: "contracts/HogGenesisRewardPool.sol:HogGenesisRewardPool"
      });
      console.log("Contract verified successfully");
    } catch (error) {
      console.log("Verification failed:", error);
    }
  }

  console.log("Deployment completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 