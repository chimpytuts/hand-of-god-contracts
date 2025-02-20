import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@hardhat/impersonator";
import { HOG, GHOG, GHogRewardPool } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GHogRewardPool", function () {
  let hog: HOG;
  let owner: SignerWithAddress;
  let devFund: SignerWithAddress;
  let startTime: number;
  let hogS: string;

  const SwAPX_ROUTER_ADDRESS = "0xF5F7231073b3B41c04BA655e1a7438b1a7b29c27";
  const OS_TOKEN_ADDRESS = "0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794";
  
  const ROUTER_ABI = [
    "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
    "function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)"
  ];

  before(async function () {
    [owner, devFund] = await ethers.getSigners();
    
    // Get current timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    startTime = latestBlock!.timestamp + 3600; // Start in 1 hour

    // Deploy HOG and GHOG
    const HOG = await ethers.getContractFactory("HOG");
    hog = await HOG.deploy();

    await hog.transferOperator(owner.address);

    // Mint initial tokens
    await hog.mint(owner.address, ethers.parseEther("1000000")); // 1M HOG

    // Get router contract
    const router = await ethers.getContractAt(ROUTER_ABI, SwAPX_ROUTER_ADDRESS);
    
    // Approve router to spend tokens
    await hog.approve(SwAPX_ROUTER_ADDRESS, ethers.MaxUint256);

    // Create HOG-S stable pool
    console.log("Creating HOG-S stable pool...");
    const hogAmount = ethers.parseEther("100000"); // 100k HOG
    const sAmount = ethers.parseEther("100000"); // 100k S (assuming same decimals)
    
    try {
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
        await router.addLiquidity(
            await hog.getAddress(),
            OS_TOKEN_ADDRESS,
            true, // stable pool
            hogAmount,
            sAmount,
            0, // amountAMin
            0, // amountBMin
            owner.address,
            deadline
        );
        
        // Get pool address
        hogS = await router.getPool(await hog.getAddress(), OS_TOKEN_ADDRESS, true);
        console.log("HOG-S pool created at:", hogS);
    } catch (error) {
        console.error("Error creating HOG-S pool:", error);
        throw error;
    }
  });
});
