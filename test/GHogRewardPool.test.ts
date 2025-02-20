import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HOG, GHOG, GHogRewardPool } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GHogRewardPool", function () {
  this.timeout(100000);
  let hog: HOG;
  let ghog: GHOG;
  let gHogRewardPool: GHogRewardPool;
  let owner: SignerWithAddress;
  let devFund: SignerWithAddress;
  let startTime: number;
  let hogS: string;
  let ghogS: string;

  const ROUTER_ADDRESS = "0xF5F7231073b3B41c04BA655e1a7438b1a7b29c27";
  const S_TOKEN_ADDRESS = "0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794";
  const S_WHALE = "0x8E02247D3eE0E6153495c971FFd45Aa131f4D7cB";
  
  const ROUTER_ABI = [
    "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
    "function pairFor(address tokenA, address tokenB, bool stable) external view returns (address pair)",
    "function factory() external view returns (address)",
    "function sortTokens(address tokenA, address tokenB) external pure returns (address token0, address token1)",
    "function quoteAddLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired) external view returns (uint256 amountA, uint256 amountB, uint256 liquidity)"
  ];

  const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function allowance(address owner, address spender) external view returns (uint256)"
  ];

  const PAIR_ABI = [
    "function balanceOf(address) external view returns (uint256)",
    "function approve(address spender, uint256 value) external returns (bool)",
    "function transfer(address to, uint256 value) external returns (bool)",
    "function metadata() external view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)",
    "function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)"
  ];

  const VOTER_ABI = [
    "function createGauge(address gauge, uint256 type) external returns (address gaugeAddress, address internalBribe, address externalBribe)",
    "function gauges(address gauge) external view returns (address)",
    "function isAlive(address gauge) external view returns (bool)"
  ];

  before(async function () {
    console.log("Starting test setup...");
    [owner, devFund] = await ethers.getSigners();
    
    // Get current timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    startTime = latestBlock!.timestamp + 3600; // Start in 1 hour
  });

  it("Should create HOG-OS stable pool", async function () {
    // Deploy HOG
    const HOG = await ethers.getContractFactory("HOG");
    hog = await HOG.deploy();
    console.log("HOG deployed to:", await hog.getAddress());

    // Mint initial HOG tokens
    await hog.mint(owner.address, ethers.parseEther("1000000")); // 1M HOG
    console.log("Minted 1M HOG to owner");

    // Get S tokens from whale
    console.log("\nGetting S tokens from whale...");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [S_WHALE],
    });
    
    const sWhale = await ethers.getSigner(S_WHALE);
    
    // Fund whale with ETH for gas
    await network.provider.send("hardhat_setBalance", [
      S_WHALE,
      "0x56BC75E2D63100000", // 100 ETH
    ]);

    const sToken = await ethers.getContractAt(ERC20_ABI, S_TOKEN_ADDRESS);
    const whaleBalance = await sToken.balanceOf(S_WHALE);
    console.log("Whale S balance:", ethers.formatUnits(whaleBalance, 18));

    // Transfer S tokens to owner
    const transferAmount = ethers.parseEther("200000"); // 200k S tokens
    await sToken.connect(sWhale).transfer(owner.address, transferAmount);
    const ownerSBalance = await sToken.balanceOf(owner.address);
    console.log("Owner S balance:", ethers.formatUnits(ownerSBalance, 18));

    // Get router contract
    const router = await ethers.getContractAt(ROUTER_ABI, ROUTER_ADDRESS);
    
    // Verify balances and approvals
    console.log("\nVerifying balances and approvals...");
    const hogBalance = await hog.balanceOf(owner.address);
    console.log("HOG balance:", ethers.formatUnits(hogBalance, 18));
    console.log("S balance:", ethers.formatUnits(ownerSBalance, 18));

    // Approve router to spend tokens
    console.log("\nApproving router to spend tokens...");
    const hogApprovalTx = await hog.approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await hogApprovalTx.wait();
    console.log("HOG approved");

    const sApprovalTx = await sToken.connect(owner).approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await sApprovalTx.wait();
    console.log("S approved");

    // Verify approvals
    const hogAllowance = await hog.allowance(owner.address, ROUTER_ADDRESS);
    const sAllowance = await sToken.allowance(owner.address, ROUTER_ADDRESS);
    console.log("Allowances:", {
        HOG: ethers.formatUnits(hogAllowance, 18),
        S: ethers.formatUnits(sAllowance, 18)
    });

    // Create HOG-S stable pool
    console.log("\nCreating HOG-S stable pool...");
    const hogAmount = ethers.parseEther("100000"); // 100k HOG
    const sAmount = ethers.parseEther("100000"); // 100k S
    
    try {
        // Sort tokens to ensure correct order
        const [token0, token1] = await router.sortTokens(await hog.getAddress(), S_TOKEN_ADDRESS);
        console.log("Sorted tokens:", {
            token0,
            token1,
            hogAddress: await hog.getAddress(),
            sAddress: S_TOKEN_ADDRESS
        });

        const deadline = Math.floor(Date.now() / 1000) + 3600;
        console.log("\nAdding liquidity with parameters:", {
            tokenA: await hog.getAddress(),
            tokenB: S_TOKEN_ADDRESS,
            stable: true,
            amountADesired: ethers.formatUnits(hogAmount, 18),
            amountBDesired: ethers.formatUnits(sAmount, 18),
            amountAMin: 0,
            amountBMin: 0,
            to: owner.address,
            deadline: deadline
        });

        const tx = await router.addLiquidity(
            await hog.getAddress(),
            S_TOKEN_ADDRESS,
            true,
            hogAmount,
            sAmount,
            0,
            0,
            owner.address,
            deadline,
            { gasLimit: 5000000 }
        );
        console.log("Add liquidity tx hash:", tx.hash);
        const receipt = await tx.wait();
        console.log("Add liquidity tx confirmed:", receipt.status);

        // Get pool address
        hogS = await router.pairFor(token0, token1, true);
        console.log("Pool address:", hogS);

        // Verify pool creation with proper pair ABI
        try {
            const pool = await ethers.getContractAt(PAIR_ABI, hogS);
            
            // Get pool metadata
            const metadata = await pool.metadata();
            console.log("Pool metadata:", {
                decimals0: Number(metadata.dec0),
                decimals1: Number(metadata.dec1),
                reserve0: metadata.r0.toString(),
                reserve1: metadata.r1.toString(),
                isStable: metadata.st,
                token0: metadata.t0,
                token1: metadata.t1
            });

            // Get reserves to verify pool has liquidity
            const [reserve0, reserve1, timestamp] = await pool.getReserves();
            console.log("Pool reserves:", {
                reserve0: reserve0.toString(),
                reserve1: reserve1.toString(),
                timestamp: timestamp.toString()
            });

            // Check LP balance
            const poolBalance = await pool.balanceOf(owner.address);
            console.log("LP balance:", poolBalance.toString());
            
            expect(hogS).to.not.equal(ethers.ZeroAddress, "Pool should be created");
            expect(poolBalance).to.be.gt(0, "Should receive LP tokens");
        } catch (error) {
            console.error("Pool verification error:", {
                message: error.message,
                code: error.code,
                data: error.data
            });
            throw error;
        }
    } catch (error) {
        console.error("Error details:", {
            message: error.message,
            code: error.code,
            data: error.data,
            transaction: error.transaction,
        });
        throw error;
    }
  });

  it("Should create GHOG-OS volatile pool", async function () {
    // Deploy GHOG
    const GHOG = await ethers.getContractFactory("GHOG");
    ghog = await GHOG.deploy(startTime, devFund.address);
    console.log("GHOG deployed to:", await ghog.getAddress());

    // Get S tokens from whale
    console.log("\nGetting S tokens from whale...");
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [S_WHALE],
    });
    
    const sWhale = await ethers.getSigner(S_WHALE);
    
    // Fund whale with ETH for gas
    await network.provider.send("hardhat_setBalance", [
      S_WHALE,
      "0x56BC75E2D63100000", // 100 ETH
    ]);

    const sToken = await ethers.getContractAt(ERC20_ABI, S_TOKEN_ADDRESS);
    const whaleBalance = await sToken.balanceOf(S_WHALE);
    console.log("Whale S balance:", ethers.formatUnits(whaleBalance, 18));

    // Transfer S tokens to owner
    const transferAmount = ethers.parseEther("50000"); // 200k S tokens
    await sToken.connect(sWhale).transfer(owner.address, transferAmount);
    const ownerSBalance = await sToken.balanceOf(owner.address);
    console.log("Owner S balance:", ethers.formatUnits(ownerSBalance, 18));

    // Get router contract
    const router = await ethers.getContractAt(ROUTER_ABI, ROUTER_ADDRESS);
    
    // Verify balances and approvals
    console.log("\nVerifying balances and approvals...");
    const ghogBalance = await ghog.balanceOf(owner.address);
    console.log("GHOG balance:", ethers.formatUnits(ghogBalance, 18));
    console.log("S balance:", ethers.formatUnits(ownerSBalance, 18));

    // Approve router to spend tokens
    console.log("\nApproving router to spend tokens...");
    const ghogApprovalTx = await ghog.approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await ghogApprovalTx.wait();
    console.log("GHOG approved");

    const sApprovalTx = await sToken.connect(owner).approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await sApprovalTx.wait();
    console.log("S approved");

    // Verify approvals
    const ghogAllowance = await ghog.allowance(owner.address, ROUTER_ADDRESS);
    const sAllowance = await sToken.allowance(owner.address, ROUTER_ADDRESS);
    console.log("Allowances:", {
        GHOG: ethers.formatUnits(ghogAllowance, 18),
        S: ethers.formatUnits(sAllowance, 18)
    });

    // Create GHOG-S volatile pool
    console.log("\nCreating GHOG-S volatile pool...");
    const ghogAmount = ethers.parseEther("10"); // 10 GHOG
    const sAmount = ethers.parseEther("50000"); // 50k OS
    
    try {
        // Sort tokens to ensure correct order
        const [token0, token1] = await router.sortTokens(await ghog.getAddress(), S_TOKEN_ADDRESS);
        console.log("Sorted tokens:", {
            token0,
            token1,
            ghogAddress: await ghog.getAddress(),
            sAddress: S_TOKEN_ADDRESS
        });

        const deadline = Math.floor(Date.now() / 1000) + 3600;
        console.log("\nAdding liquidity with parameters:", {
            tokenA: await ghog.getAddress(),
            tokenB: S_TOKEN_ADDRESS,
            stable: false, // volatile pool
            amountADesired: ethers.formatUnits(ghogAmount, 18),
            amountBDesired: ethers.formatUnits(sAmount, 18),
            amountAMin: 0,
            amountBMin: 0,
            to: owner.address,
            deadline: deadline
        });

        const tx = await router.addLiquidity(
            await ghog.getAddress(),
            S_TOKEN_ADDRESS,
            false, // volatile pool
            ghogAmount,
            sAmount,
            0,
            0,
            owner.address,
            deadline,
            { gasLimit: 5000000 }
        );
        console.log("Add liquidity tx hash:", tx.hash);
        const receipt = await tx.wait();
        console.log("Add liquidity tx confirmed:", receipt.status);

        // Get pool address
        ghogS = await router.pairFor(token0, token1, false); // volatile pool
        console.log("Pool address:", ghogS);

        // Verify pool creation with proper pair ABI
        try {
            const pool = await ethers.getContractAt(PAIR_ABI, ghogS);
            
            // Get pool metadata
            const metadata = await pool.metadata();
            console.log("Pool metadata:", {
                decimals0: Number(metadata.dec0),
                decimals1: Number(metadata.dec1),
                reserve0: metadata.r0.toString(),
                reserve1: metadata.r1.toString(),
                isStable: metadata.st,
                token0: metadata.t0,
                token1: metadata.t1
            });

            // Get reserves to verify pool has liquidity
            const [reserve0, reserve1, timestamp] = await pool.getReserves();
            console.log("Pool reserves:", {
                reserve0: reserve0.toString(),
                reserve1: reserve1.toString(),
                timestamp: timestamp.toString()
            });

            // Check LP balance
            const poolBalance = await pool.balanceOf(owner.address);
            console.log("LP balance:", poolBalance.toString());
            
            expect(ghogS).to.not.equal(ethers.ZeroAddress, "Pool should be created");
            expect(poolBalance).to.be.gt(0, "Should receive LP tokens");
        } catch (error) {
            console.error("Pool verification error:", {
                message: error.message,
                code: error.code,
                data: error.data
            });
            throw error;
        }
    } catch (error) {
        console.error("Error details:", {
            message: error.message,
            code: error.code,
            data: error.data,
            transaction: error.transaction,
        });
        throw error;
    }
  });

  it("Should create gauges for HOG-OS and GHOG-OS pools", async function () {
    // First set up permissions
    const PERMISSIONS_REGISTRY = "0x8751ea0634f85474c94e8462e93751D2104Ed487";
    const SWPX_MULTISIG = "0xD79fd4399Ea1B9107fC04143f7a5DC2c71dE5b39";
    
    const PERMISSIONS_REGISTRY_ABI = [
      "function setRoleFor(address c, string role) external",
      "function hasRole(bytes role, address user) external view returns (bool)"
    ];

    const permissionsRegistry = await ethers.getContractAt(PERMISSIONS_REGISTRY_ABI, PERMISSIONS_REGISTRY);

    // Impersonate swpxMultisig
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [SWPX_MULTISIG],
    });

    await network.provider.send("hardhat_setBalance", [
      SWPX_MULTISIG,
      "0x56BC75E2D63100000", // 100 ETH
    ]);

    const multisigSigner = await ethers.getSigner(SWPX_MULTISIG);
    const registryAsMultisig = permissionsRegistry.connect(multisigSigner);

    console.log("\nSetting GOVERNANCE role...");
    const setRoleTx = await registryAsMultisig.setRoleFor(owner.address, "GOVERNANCE");
    await setRoleTx.wait();
    console.log("GOVERNANCE role set");

    // Stop impersonating swpxMultisig
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [SWPX_MULTISIG],
    });

    // Now proceed with voter contract
    const VOTER_ADDRESS = "0xc1ae2779903cfb84cb9dee5c03eceac32dc407f2";
    const voter = await ethers.getContractAt(VOTER_ABI, VOTER_ADDRESS);

    console.log("\nCreating gauges for pools...");
    
    try {
        // Create gauges for both pools
        console.log("Creating gauge for HOG-OS pool...");
        const hogGaugeTx = await voter.createGauge(
            hogS, // HOG-OS pool address
            0 // gauge type (0 for regular)
        );
        const hogGaugeReceipt = await hogGaugeTx.wait();
        
        // Get gauge addresses from event
        const hogGaugeEvent = hogGaugeReceipt.logs.find(
            log => log.topics[0] === ethers.id("GaugeCreated(address,address,address,address,address)")
        );

        // Properly decode the event data
        const [gauge, creator, internalBribe, externalBribe, pool] = ethers.AbiCoder.defaultAbiCoder().decode(
            ['address', 'address', 'address', 'address', 'address'],
            hogGaugeEvent.data
        );

        console.log("HOG-OS gauge created:", {
            gauge,
            creator,
            internalBribe,
            externalBribe,
            pool
        });

        console.log("\nCreating gauge for GHOG-OS pool...");
        const ghogGaugeTx = await voter.createGauge(
            ghogS, // GHOG-OS pool address
            0 // gauge type (0 for regular)
        );
        const ghogGaugeReceipt = await ghogGaugeTx.wait();

        // Get gauge addresses from event
        const ghogGaugeEvent = ghogGaugeReceipt.logs.find(
            log => log.topics[0] === ethers.id("GaugeCreated(address,address,address,address,address)")
        );

        // Properly decode the event data
        const [ghogGauge, ghogCreator, ghogInternalBribe, ghogExternalBribe, ghogPool] = ethers.AbiCoder.defaultAbiCoder().decode(
            ['address', 'address', 'address', 'address', 'address'],
            ghogGaugeEvent.data
        );

        console.log("GHOG-OS gauge created:", {
            gauge: ghogGauge,
            creator: ghogCreator,
            internalBribe: ghogInternalBribe,
            externalBribe: ghogExternalBribe,
            pool: ghogPool
        });

        // Verify gauges were created
        const hogGaugeAddress = await voter.gauges(hogS);
        const ghogGaugeAddress = await voter.gauges(ghogS);

        console.log("\nVerifying gauge creation...");
        console.log("HOG-OS gauge address:", hogGaugeAddress);
        console.log("GHOG-OS gauge address:", ghogGaugeAddress);

        expect(hogGaugeAddress).to.equal(gauge, "HOG-OS gauge not created correctly");
        expect(ghogGaugeAddress).to.equal(ghogGauge, "GHOG-OS gauge not created correctly");

        // Verify gauges are alive
        const hogGaugeAlive = await voter.isAlive(hogGaugeAddress);
        const ghogGaugeAlive = await voter.isAlive(ghogGaugeAddress);

        console.log("\nVerifying gauge status...");
        console.log("HOG-OS gauge alive:", hogGaugeAlive);
        console.log("GHOG-OS gauge alive:", ghogGaugeAlive);

        expect(hogGaugeAlive).to.be.true;
        expect(ghogGaugeAlive).to.be.true;

        // Store gauge addresses for later use
        POOLS[0].gauge = hogGaugeAddress;
        POOLS[1].gauge = ghogGaugeAddress;

    } catch (error) {
        console.error("Error creating gauges:", {
            message: error.message,
            code: error.code,
            data: error.data,
            transaction: error.transaction
        });
        throw error;
    }
  });
});
