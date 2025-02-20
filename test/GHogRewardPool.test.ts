import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@hardhat/impersonator";
import { HOG, GHOG, GHogRewardPool } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GHogRewardPool", function () {
  let hog: HOG;
  let ghog: GHOG;
  let gHogRewardPool: GHogRewardPool;
  let owner: SignerWithAddress;
  let devFund: SignerWithAddress;
  let startTime: number;
  let hogS: string;
  let ghogS: string;

  const FACTORY_ADDRESS = "0xDDD9845Ba0D8f38d3045f804f67A1a8B9A528FcC";
  const FACTORY_ABI = [
    "function createPair(address tokenA, address tokenB) external returns (address pair)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
  ];

  before(async function () {
    [owner, devFund] = await ethers.getSigners();
    
    // Get current timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    startTime = latestBlock!.timestamp + 3600; // Start in 1 hour

    // Deploy HOG and GHOG
    const HOG = await ethers.getContractFactory("HOG");
    hog = await HOG.deploy();
    
    const GHOG = await ethers.getContractFactory("GHOG");
    ghog = await GHOG.deploy();

    // Mint initial tokens
    await hog.mint(owner.address, ethers.parseEther("1000000")); // 1M HOG
    await ghog.mint(owner.address, ethers.parseEther("1000000")); // 1M GHOG

    // Create HOG-S and GHOG-S pairs
    const factory = await ethers.getContractAt(FACTORY_ABI, FACTORY_ADDRESS);
    
    // Create HOG-S pair
    console.log("Creating HOG-S pair...");
    await factory.createPair(await hog.getAddress(), ethers.ZeroAddress); // Use appropriate S token address
    hogS = await factory.getPair(await hog.getAddress(), ethers.ZeroAddress);
    console.log("HOG-S pair created at:", hogS);

    // Create GHOG-S pair
    console.log("Creating GHOG-S pair...");
    await factory.createPair(await ghog.getAddress(), ethers.ZeroAddress); // Use appropriate S token address
    ghogS = await factory.getPair(await ghog.getAddress(), ethers.ZeroAddress);
    console.log("GHOG-S pair created at:", ghogS);

    // Add liquidity to pairs
    console.log("Adding liquidity to pairs...");
    // Add liquidity code here (will need router contract)

    // Deploy GHogRewardPool
    const GHogRewardPool = await ethers.getContractFactory("GHogRewardPool");
    gHogRewardPool = await GHogRewardPool.deploy(
      await ghog.getAddress(),
      hogS,
      ghogS,
      devFund.address,
      startTime
    );

    // Fund reward pool with GHOG
    const rewardAmount = ethers.parseEther("100000"); // 100k GHOG
    await ghog.mint(await gHogRewardPool.getAddress(), rewardAmount);
  });

  it("Should initialize with correct values", async function () {
    expect(await gHogRewardPool.ghog()).to.equal(await ghog.getAddress());
    expect(await gHogRewardPool.devFund()).to.equal(devFund.address);
    expect(await gHogRewardPool.poolStartTime()).to.equal(startTime);
    expect(await gHogRewardPool.operator()).to.equal(owner.address);
    
    // Check pool info
    const pool0 = await gHogRewardPool.poolInfo(0);
    const pool1 = await gHogRewardPool.poolInfo(1);
    
    expect(pool0.token).to.equal(hogS);
    expect(pool1.token).to.equal(ghogS);
  });

  // Add more tests...
});
