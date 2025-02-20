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
    whale: "0xcD650EB6f55D6d00f14FD95AE434FeF9B95aDbd2",
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

      // Fund all investors with ETH for gas
      for (const pool of POOLS) {
        for (const investorAddress of pool.investors) {
          await network.provider.send("hardhat_setBalance", [
            investorAddress,
            "0x56BC75E2D63100000" // 100 ETH
          ]);
        }
      }
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
          
          if (balance > 0n) {
            // Approve before deposit
            console.log(`Approving ${ethers.formatUnits(balance, decimals)} tokens for ${investorAddress}`);
            await token.connect(investor).approve(await genesisPool.getAddress(), balance);
            
            // Calculate stake amount (20%, 40%, 60%, 80%, 100%)
            const stakeAmount = (balance * BigInt(20 + index * 20)) / 100n;
            
            console.log(`Depositing ${ethers.formatUnits(stakeAmount, decimals)} tokens for ${investorAddress}`);
            await genesisPool.connect(investor).deposit(pid, stakeAmount);
            
            // Verify deposit
            const userInfo = await genesisPool.userInfo(pid, investorAddress);
            console.log(`Verified deposit amount: ${ethers.formatUnits(userInfo.amount, decimals)}`);
          }
        }
      }
    });

    it("Should accumulate different rewards based on stake size", async function () {
      await time.increase(time.duration.days(1));

      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const decimals = await token.decimals();
        const symbol = await token.symbol();
        
        console.log(`\nChecking rewards for pool ${symbol} (pid: ${pid})`);
        
        for (const investorAddress of pool.investors) {
          const userInfo = await genesisPool.userInfo(pid, investorAddress);
          console.log(`User ${investorAddress}`);
          console.log(`- Staked: ${ethers.formatUnits(userInfo.amount, decimals)} ${symbol}`);
          
          const pending = await genesisPool.pendingHOG(pid, investorAddress);
          console.log(`- Pending rewards: ${ethers.formatUnits(pending, 18)} HOG`);
          
          // Only check for rewards if there was a stake
          if (userInfo.amount > 0n) {
            expect(pending).to.be.gt(0);
          }
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

    it("Should not allow deposits before pool starts", async function () {
      // Try to deposit before start time
      await time.setNextBlockTimestamp(startTime - 3600); // 1 hour before start
      
      const pool = POOLS[0];
      const token = await ethers.getContractAt(minimalABI, pool.token);
      const investor = await ethers.getImpersonatedSigner(pool.investors[0]);
      const balance = await token.balanceOf(pool.investors[0]);
      const symbol = await token.symbol();
      
      console.log(`Attempting early deposit of ${ethers.formatUnits(balance, await token.decimals())} ${symbol}`);
      
      // Should revert or have no rewards
      await genesisPool.connect(investor).deposit(0, balance);
      const pending = await genesisPool.pendingHOG(0, pool.investors[0]);
      expect(pending).to.equal(0);
    });

    it("Should track deposit fees correctly", async function () {
      // Move to start time
      await time.setNextBlockTimestamp(startTime);

      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const decimals = await token.decimals();
        const symbol = await token.symbol();
        
        console.log(`\nChecking deposit fees for pool ${symbol} (pid: ${pid})`);
        
        for (const [index, investorAddress] of pool.investors.entries()) {
          const investor = await ethers.getImpersonatedSigner(investorAddress);
          const balance = await token.balanceOf(investorAddress);
          
          if (balance > 0n) {
            const stakeAmount = (balance * BigInt(20 + index * 20)) / 100n;
            const expectedFee = (stakeAmount * 50n) / 10000n; // 0.5% fee
            
            const devFundBefore = await token.balanceOf(devFund.address);
            
            console.log(`Depositing ${ethers.formatUnits(stakeAmount, decimals)} ${symbol}`);
            await genesisPool.connect(investor).deposit(pid, stakeAmount);
            
            const devFundAfter = await token.balanceOf(devFund.address);
            const actualFee = devFundAfter - devFundBefore;
            
            console.log(`Dev fund received ${ethers.formatUnits(actualFee, decimals)} ${symbol} as fee`);
            expect(actualFee).to.equal(expectedFee);
          }
        }
      }
    });

    it("Should allow multiple harvests during genesis period", async function () {
      // Simulate multiple harvests over the 7-day period
      const harvestIntervals = [1, 2, 4, 6]; // Days to harvest
      
      for (const day of harvestIntervals) {
        console.log(`\nDay ${day} harvests:`);
        await time.increaseTo(startTime + (day * 24 * 3600));
        
        for (let pid = 0; pid < POOLS.length; pid++) {
          const pool = POOLS[pid];
          const token = await ethers.getContractAt(minimalABI, pool.token);
          const symbol = await token.symbol();
          
          console.log(`\nHarvesting from pool ${symbol} (pid: ${pid})`);
          
          for (const investorAddress of pool.investors) {
            const investor = await ethers.getImpersonatedSigner(investorAddress);
            const pending = await genesisPool.pendingHOG(pid, investorAddress);
            
            if (pending > 0n) {
              const hogBefore = await hog.balanceOf(investorAddress);
              // Harvest by depositing 0
              await genesisPool.connect(investor).deposit(pid, 0);
              const hogAfter = await hog.balanceOf(investorAddress);
              const harvested = hogAfter - hogBefore;
              
              console.log(`User ${investorAddress} harvested ${ethers.formatUnits(harvested, 18)} HOG`);
            }
          }
        }
      }
    });

    it("Should track daily rewards until genesis ends", async function () {
      const dayDuration = 24 * 3600;
      let totalRewardsDistributed = 0n;
      
      // First, set up initial deposits for all pools
      console.log("\n=== Setting up initial deposits ===");
      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const symbol = await token.symbol();
        const decimals = await token.decimals();
        
        console.log(`\nSetting up ${symbol} pool (pid: ${pid})`);
        
        for (const [index, investorAddress] of pool.investors.entries()) {
          const investor = await ethers.getImpersonatedSigner(investorAddress);
          const balance = await token.balanceOf(investorAddress);
          
          if (balance > 0n) {
            // Approve tokens first
            await token.connect(investor).approve(await genesisPool.getAddress(), balance);
            
            // Stake different amounts for each investor (20%, 40%, 60%, 80%, 100%)
            const stakeAmount = (balance * BigInt(20 + index * 20)) / 100n;
            
            console.log(`Investor ${investorAddress} staking ${ethers.formatUnits(stakeAmount, decimals)} ${symbol}`);
            await genesisPool.connect(investor).deposit(pid, stakeAmount);
          }
        }
      }

      // Now track daily rewards
      for (let day = 1; day <= 7; day++) {
        console.log(`\n=== Day ${day} of Genesis Period ===`);
        
        // Increase time by one day
        await network.provider.send("evm_increaseTime", [dayDuration]);
        await network.provider.send("evm_mine");

        let dailyRewards = 0n;

        for (let pid = 0; pid < POOLS.length; pid++) {
          const pool = POOLS[pid];
          const token = await ethers.getContractAt(minimalABI, pool.token);
          const symbol = await token.symbol();
          const decimals = await token.decimals();
          
          console.log(`\nPool ${symbol} (pid: ${pid})`);
          let poolDailyRewards = 0n;
          
          for (const investorAddress of pool.investors) {
            const userInfo = await genesisPool.userInfo(pid, investorAddress);
            const pending = await genesisPool.pendingHOG(pid, investorAddress);
            
            if (userInfo.amount > 0n) {
              console.log(`\nUser ${investorAddress}`);
              console.log(`- Staked: ${ethers.formatUnits(userInfo.amount, decimals)} ${symbol}`);
              console.log(`- Pending rewards: ${ethers.formatUnits(pending, 18)} HOG`);
              
              // Harvest rewards if available
              if (pending > 0n) {
                const investor = await ethers.getImpersonatedSigner(investorAddress);
                const hogBefore = await hog.balanceOf(investorAddress);
                await genesisPool.connect(investor).deposit(pid, 0);
                const hogAfter = await hog.balanceOf(investorAddress);
                const harvested = hogAfter - hogBefore;
                
                poolDailyRewards += harvested;
                console.log(`- Harvested: ${ethers.formatUnits(harvested, 18)} HOG`);
              }
            }
          }
          
          dailyRewards += poolDailyRewards;
          console.log(`\nPool ${symbol} daily rewards: ${ethers.formatUnits(poolDailyRewards, 18)} HOG`);
        }

        totalRewardsDistributed += dailyRewards;
        const remainingHog = await hog.balanceOf(await genesisPool.getAddress());
        
        console.log(`\nDay ${day} Summary:`);
        console.log(`- Daily rewards distributed: ${ethers.formatUnits(dailyRewards, 18)} HOG`);
        console.log(`- Total rewards distributed: ${ethers.formatUnits(totalRewardsDistributed, 18)} HOG`);
        console.log(`- Remaining in pool: ${ethers.formatUnits(remainingHog, 18)} HOG`);

        // Optional: verify rewards are being distributed
        expect(dailyRewards).to.be.gt(0, "Should distribute rewards each day");
      }
    });
  });

  describe("Post-Farming Period", function () {
    it("Should not generate more rewards after end time", async function () {
      await time.increase(time.duration.days(1));
      
      for (let pid = 0; pid < POOLS.length; pid++) {
        const pool = POOLS[pid];
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const symbol = await token.symbol();
        
        console.log(`\nChecking post-farming rewards for ${symbol} pool`);
        for (const investorAddress of pool.investors) {
          const pending = await genesisPool.pendingHOG(pid, investorAddress);
          console.log(`User ${investorAddress} pending rewards: ${ethers.formatUnits(pending, 18)} HOG`);
          expect(pending).to.equal(0);
        }
      }
    });

    it("Should allow operator to recover unsupported tokens after 7 days", async function () {
      // Wait for 7 days after pool end
      await time.increase(time.duration.days(7));

      const hogBalance = await hog.balanceOf(await genesisPool.getAddress());
      console.log(`Remaining HOG balance in pool: ${ethers.formatUnits(hogBalance, 18)} HOG`);

      // Try to recover HOG tokens
      await expect(
        genesisPool.connect(owner).governanceRecoverUnsupported(
          hog,
          hogBalance,
          owner.address
        )
      ).to.not.be.reverted;

      // Verify the recovery
      const finalHogBalance = await hog.balanceOf(await genesisPool.getAddress());
      const ownerBalance = await hog.balanceOf(owner.address);
      
      console.log(`Final HOG balance in pool: ${ethers.formatUnits(finalHogBalance, 18)} HOG`);
      console.log(`Recovered HOG in owner wallet: ${ethers.formatUnits(ownerBalance, 18)} HOG`);
      
      expect(finalHogBalance).to.equal(0);
      expect(ownerBalance).to.be.gt(0);
    });
  });

  describe("Post-Genesis Analysis", function () {
    it("Should show final dev fund holdings", async function () {
      console.log("\nDev Fund Final Holdings:");
      
      for (const pool of POOLS) {
        const token = await ethers.getContractAt(minimalABI, pool.token);
        const symbol = await token.symbol();
        const decimals = await token.decimals();
        const balance = await token.balanceOf(devFund.address);
        
        console.log(`${symbol}: ${ethers.formatUnits(balance, decimals)}`);
        expect(balance).to.be.gt(0, `Dev fund should have collected ${symbol} fees`);
      }
    });

    it("Should allow operator to recover HOG after timelock", async function () {
      // Wait for 7 days after pool end
      await time.increaseTo(startTime + 7 * 24 * 3600);

      const hogBalance = await hog.balanceOf(await genesisPool.getAddress());
      console.log(`\nRemaining HOG balance in pool: ${ethers.formatUnits(hogBalance, 18)} HOG`);

      await expect(
        genesisPool.connect(owner).governanceRecoverUnsupported(
          hog,
          hogBalance,
          owner.address
        )
      ).to.not.be.reverted;

      const finalHogBalance = await hog.balanceOf(await genesisPool.getAddress());
      const ownerBalance = await hog.balanceOf(owner.address);
      
      console.log(`Final HOG balance in pool: ${ethers.formatUnits(finalHogBalance, 18)} HOG`);
      console.log(`Recovered HOG in owner wallet: ${ethers.formatUnits(ownerBalance, 18)} HOG`);
      
      expect(finalHogBalance).to.equal(0);
      expect(ownerBalance).to.be.gt(0);
    });
  });
}); 