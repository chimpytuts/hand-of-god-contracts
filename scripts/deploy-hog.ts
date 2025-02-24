import { ethers, network, run } from "hardhat";

async function main() {
  // Get the deployer's signer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy HOG token
  console.log("Deploying HOG token...");
  const HOG = await ethers.getContractFactory("HOG");
  const hog = await HOG.deploy();
  await hog.waitForDeployment();
  
  const hogAddress = await hog.getAddress();
  console.log("HOG token deployed to:", hogAddress);

  // Wait for a few block confirmations before verification
  console.log("Waiting for block confirmations...");
  await hog.deploymentTransaction()?.wait(5);

  // Verify the contract on the explorer
  if (network.name !== "hardhat") {
    console.log("Verifying contract on explorer...");
    try {
      await run("verify:verify", {
        address: hogAddress,
        constructorArguments: [],
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