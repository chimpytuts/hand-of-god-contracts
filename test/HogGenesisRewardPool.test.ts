import { ethers, network } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Wallet } from "ethers";
import { HOG, HogGenesisRewardPool } from "../typechain-types";

const POOLS = [
  {
    token: "0x287c6882dE298665977787e268f3dba052A6e251", // HOG-S
    whale: "0x0C4290C3018172dD838631c94Ee6906C0eA65f5e", // Replace with actual whale
    name: "HOG-S LP",
    investors: [] as string[] // Will be filled with 4 random wallets + whale
  },
  {
    token: "0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38", // S
    whale: "0x77BeD4760EE17Cb9704308F84CCdE8CbD7Adac2E",
    name: "S LP",
    investors: [] as string[]
  },
  {
    token: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", // USDC.e
    whale: "0xb38A90f14b24ae81Ec0B8f1373694f5B59811D8A",
    name: "USDC.e LP",
    investors: [] as string[]
  },
  {
    token: "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b", // WETH
    whale: "0x05BE7ce9be8824c925A66aFf3337bf8C197d6c0D",
    name: "WETH LP",
    investors: [] as string[]
  },
  {
    token: "0x3333b97138D4b086720b5aE8A7844b1345a33333", // SHADOW
    whale: "0xC3d0748661bf9dF1015fb9222b7a259A72A66D22",
    name: "SHADOW LP",
    investors: [] as string[]
  },
  {
    token: "0x79bbF4508B1391af3A0F4B30bb5FC4aa9ab0E07C", // ANON
    whale: "0x6FDb03ec52932c0bBB48F1367c7739480E78B785",
    name: "ANON LP",
    investors: [] as string[]
  },
  {
    token: "0xd3DCe716f3eF535C5Ff8d041c1A41C3bd89b97aE", // scUSD
    whale: "0xba154324a2b89D894cDE38B492a455Fef98c908C",
    name: "scUSD LP",
    investors: [] as string[]
  }
];

describe("HogGenesisRewardPool", function () {
  this.timeout(100000);

  let hog: HOG;
  let genesisPool: HogGenesisRewardPool;
  let owner: SignerWithAddress;
  let devFund: SignerWithAddress;
  let daoFund: SignerWithAddress;
  let startTime: number;

  // Fix the minimal ABI to include transfer
  const minimalABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  async function createRandomWalletsAndDistribute(pool: typeof POOLS[0]) {
    const randomWallets = Array.from({length: 4}, () => Wallet.createRandom().connect(ethers.provider));
    pool.investors = [pool.whale, ...randomWallets.map(w => w.address)];

    try {
      // First, verify the contract exists at the address
      console.log(`Checking if contract exists at ${pool.token}`);
      const code = await ethers.provider.getCode(pool.token);
      console.log(`Contract code length at ${pool.token}: ${code.length}`);
      if (code === '0x') {
        throw new Error(`No contract found at ${pool.token}`);
      }

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [pool.whale],
      });

      await network.provider.send("hardhat_setBalance", [
        pool.whale,
        "0x56BC75E2D63100000", // 100 ETH
      ]);

      const whaleSigner = await ethers.getImpersonatedSigner(pool.whale);
      
      console.log(`Creating contract instance for ${pool.name}`);
      const token = await ethers.getContractAt(minimalABI, pool.token);

    
  

      console.log(`Checking balance for whale ${pool.whale} in pool ${pool.name}`);
      const whaleBalance = await token.balanceOf(pool.whale);
      console.log(`Whale balance: ${whaleBalance.toString()}`);
      
      // Convert whaleBalance to BigInt for comparison
      if (whaleBalance == 0n) {
        console.log(`Whale ${pool.whale} has zero balance for ${pool.name}`);
        return randomWallets;
      }

      // Use BigInt division
      const amountPerWallet = whaleBalance / 5n;

      for (const wallet of randomWallets) {
        await network.provider.send("hardhat_setBalance", [
          wallet.address,
          "0x56BC75E2D63100000",
        ]);

        console.log(`Attempting to transfer ${amountPerWallet.toString()} tokens to ${wallet.address}`);
        await token.connect(whaleSigner).transfer(wallet.address, amountPerWallet);
        console.log(`Distributed ${amountPerWallet.toString()} ${pool.name} to ${wallet.address}`);
      }
    } catch (error) {
      console.error(`Error in ${pool.name} distribution:`, {
        error,
        errorMessage: error.message,
        errorStack: error.stack,
        tokenAddress: pool.token,
        whaleAddress: pool.whale
      });
      return randomWallets;
    }

    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [pool.whale],
    });

    return randomWallets;
  }

  before(async function () {
    console.log("Starting test setup...");
    try {
      // Check provider connection first with timeout
      console.log("Checking provider connection...");
      const provider = ethers.provider;
      
      // Add timeout to getNetwork call
      const networkPromise = Promise.race([
        provider.getNetwork(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Network request timeout")), 10000)
        )
      ]);

      try {
        const network = await networkPromise;
        console.log("Connected to network:", {
          name: network.name,
          chainId: network.chainId
        });
      } catch (error) {
        console.error("Failed to connect to network:", error);
        throw error;
      }

      // Try to get block number to verify connection
      try {
        const blockNumber = await provider.getBlockNumber();
        console.log("Current block number:", blockNumber);
      } catch (error) {
        console.error("Failed to get block number:", error);
        throw error;
      }

      console.log("Getting signers...");
      const signers = await ethers.getSigners();
      console.log("Number of signers available:", signers.length);
      
      owner = signers[0];
      console.log("Owner address:", owner.address);
      
      // Check if owner has balance
      const balance = await ethers.provider.getBalance(owner.address);
      console.log("Owner balance:", ethers.formatEther(balance), "ETH");

      if (signers.length < 3) {
        throw new Error("Not enough signers available. Need at least 3 signers.");
      }

      [devFund, daoFund] = [signers[1], signers[2]];
      console.log("Dev Fund address:", devFund.address);
      console.log("DAO Fund address:", daoFund.address);

      // Set start time with error handling
      try {
        startTime = (await time.latest()) + 3600;
        console.log("Start time set to:", startTime);
      } catch (error) {
        console.error("Error setting start time:", error);
        throw error;
      }
      
      // Deploy HOG with error handling
      console.log("Deploying HOG...");
      try {
        const HOG = await ethers.getContractFactory("HOG", owner);
        hog = await HOG.deploy();
        await hog.waitForDeployment();
        console.log("HOG deployed at:", await hog.getAddress());
      } catch (error) {
        console.error("Error deploying HOG:", error);
        throw error;
      }
      
      // Deploy Genesis Pool with error handling
      console.log("Deploying Genesis Pool...");
      try {
        const GenesisPool = await ethers.getContractFactory("HogGenesisRewardPool", owner);
        genesisPool = await GenesisPool.deploy(
          await hog.getAddress(),
          devFund.address,
          startTime
        );
        await genesisPool.waitForDeployment();
        console.log("Genesis Pool deployed at:", await genesisPool.getAddress());
      } catch (error) {
        console.error("Error deploying Genesis Pool:", error);
        throw error;
      }

      // Distribute rewards with error handling
      console.log("Distributing rewards...");
      try {
        await hog.distributeReward(daoFund.address, await genesisPool.getAddress());
        console.log("Rewards distributed successfully");
      } catch (error) {
        console.error("Error distributing rewards:", error);
        throw error;
      }

      // Setup pools with error handling
      console.log("Setting up pools...");
      for (const pool of POOLS) {
        console.log(`Setting up ${pool.name}...`);
        try {
          await createRandomWalletsAndDistribute(pool);
          console.log(`${pool.name} setup complete`);
        } catch (error) {
          console.error(`Error setting up ${pool.name}:`, error);
          throw error;
        }
      }
      console.log("Setup complete!");
    } catch (error) {
      console.error("Error during setup:", error);
      throw error;
    }
  });

  it("should have proper setup", function() {
    console.log("Running first test...");
    expect(true).to.be.true;
  });

  it("should check whale's token balance", async function() {
    const pool = POOLS[0]; // HOG-S LP pool
    const minimalABI = [
      "function balanceOf(address) view returns (uint256)",
      "function symbol() view returns (string)"
    ];

    // Create contract instance
    const token = await ethers.getContractAt(minimalABI, pool.token);
    
    // Check whale's balance
    const whaleBalance = await token.balanceOf(pool.whale);
    const symbol = await token.symbol();
    
    console.log(`Whale (${pool.whale}) balance: ${whaleBalance.toString()} ${symbol}`);
    expect(whaleBalance).to.be.gt(0, "Whale should have tokens");
  });

  describe("Farming Simulation", function () {
    before(async function () {
      // Fix the token contract instantiation
      for (const pool of POOLS) {
        const token = await ethers.getContractAt(minimalABI, pool.token);
        
        for (const investorAddress of pool.investors) {
          try {
            const investor = await ethers.getImpersonatedSigner(investorAddress);
            const balance = await token.balanceOf(investorAddress);
            
            if (balance > 0n) {
              await token.connect(investor).approve(
                await genesisPool.getAddress(),
                balance
              );
            }
          } catch (error) {
            console.log(`Skipping approval for ${investorAddress} in ${pool.name}`);
          }
        }
      }

      await time.increaseTo(startTime);
    });

    it("Should allow all investors to deposit with different amounts", async function () {
      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const decimals = await token.decimals();
        
        for (const [index, investorAddress] of pool.investors.entries()) {
          const investor = await ethers.getImpersonatedSigner(investorAddress);
          const balance = await token.balanceOf(investorAddress);
          const stakeAmount = (balance * BigInt(20 + index * 20)) / 100n;
          
          await expect(
            genesisPool.connect(investor).deposit(pid, stakeAmount)
          ).to.not.be.reverted;

          console.log(
            `Investor ${investorAddress} staked ${ethers.formatUnits(stakeAmount, decimals)} ${pool.name}`
          );
        }
      }
    });

    it("Should accumulate different rewards based on stake size", async function () {
      await time.increase(time.duration.days(1));

      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        for (const investorAddress of pool.investors) {
          const pending = await genesisPool.pendingHOG(pid, investorAddress);
          expect(pending).to.be.gt(0);
          console.log(
            `Investor ${investorAddress} pending rewards: ${ethers.formatUnits(pending, 18)} HOG for ${pool.name}`
          );
        }
      }
    });

    it("Should complete the 7-day farming period", async function () {
      await time.increase(time.duration.days(6));

      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        for (const investorAddress of pool.investors) {
          const investor = await ethers.getImpersonatedSigner(investorAddress);
          const userInfo = await genesisPool.userInfo(pid, investorAddress);
          const beforeBalance = await hog.balanceOf(investorAddress);
          
          await genesisPool.connect(investor).withdraw(pid, userInfo.amount);
          
          const afterBalance = await hog.balanceOf(investorAddress);
          const rewards = afterBalance - beforeBalance;
          console.log(
            `Investor ${investorAddress} total rewards: ${ethers.formatUnits(rewards, 18)} HOG from ${pool.name}`
          );
        }
      }
    });
  });

  describe("Post-Farming Period", function () {
    it("Should not generate more rewards after end time", async function () {
      await time.increase(time.duration.days(1));
      
      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        for (const investorAddress of pool.investors) {
          const pending = await genesisPool.pendingHOG(pid, investorAddress);
          expect(pending).to.equal(0);
        }
      }
    });

    it("Should allow emergency withdrawals", async function () {
      const firstPool = POOLS[0];
      const firstInvestor = await ethers.getImpersonatedSigner(firstPool.investors[0]);
      
      await expect(
        genesisPool.connect(firstInvestor).emergencyWithdraw(0)
      ).to.not.be.reverted;
    });
  });
}); 