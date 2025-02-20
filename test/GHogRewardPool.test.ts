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
  let voter: any;
  let hogWallets: any[];  // Add HOG-OS LP holders
  let ghogWallets: any[]; // Add GHOG-OS LP holders

  const ROUTER_ADDRESS = "0xF5F7231073b3B41c04BA655e1a7438b1a7b29c27";
  const S_TOKEN_ADDRESS = "0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794";
  const S_WHALE = "0x8E02247D3eE0E6153495c971FFd45Aa131f4D7cB";
  const VOTER_ADDRESS = "0xc1ae2779903cfb84cb9dee5c03eceac32dc407f2";
  const SWAPX_TOKEN = "0xA04BC7140c26fc9BB1F36B1A604C7A5a88fb0E70";

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
    "function isAlive(address gauge) external view returns (bool)",
    "function vote(uint256 tokenId, address[] pools, uint256[] weights) external",
    "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
    "function distributeAll() external",  // Updated with correct modifier
  ];

  before(async function () {
    console.log("Starting test setup...");
    [owner, devFund] = await ethers.getSigners();
    
    // Get current timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    startTime = latestBlock!.timestamp + 3600; // Start in 1 hour

    // Get voter contract instance
    voter = await ethers.getContractAt(VOTER_ABI, VOTER_ADDRESS);

    const wallets = await ethers.getSigners();
    hogWallets = wallets.slice(1, 6);     // Save HOG-OS LP holders
    ghogWallets = wallets.slice(6, 11);   // Save GHOG-OS LP holders
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

        if (!hogGaugeEvent) {
            throw new Error("GaugeCreated event not found");
        }

        // Log the raw event data for debugging
        console.log("Raw event data:", {
            topics: hogGaugeEvent.topics,
            data: hogGaugeEvent.data
        });

        // Create interface for event parsing
        const iface = new ethers.Interface([
            "event GaugeCreated(address indexed gauge, address creator, address internal_bribe, address indexed external_bribe, address indexed pool)"
        ]);

        // Parse the event
        const parsedHogEvent = iface.parseLog({
            topics: hogGaugeEvent.topics,
            data: hogGaugeEvent.data
        });

        const hogGauge = parsedHogEvent.args[0];
        const hogInternalBribe = parsedHogEvent.args[2];
        const hogExternalBribe = parsedHogEvent.args[3];

        console.log("HOG-OS gauge created:", {
            gauge: hogGauge,
            internalBribe: hogInternalBribe,
            externalBribe: hogExternalBribe
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

        if (!ghogGaugeEvent) {
            throw new Error("GaugeCreated event not found");
        }

        // Parse the event
        const parsedGhogEvent = iface.parseLog({
            topics: ghogGaugeEvent.topics,
            data: ghogGaugeEvent.data
        });

        const ghogGauge = parsedGhogEvent.args[0];
        const ghogInternalBribe = parsedGhogEvent.args[2];
        const ghogExternalBribe = parsedGhogEvent.args[3];

        console.log("GHOG-OS gauge created:", {
            gauge: ghogGauge,
            internalBribe: ghogInternalBribe,
            externalBribe: ghogExternalBribe
        });

        // Verify gauges were created
        const hogGaugeAddress = await voter.gauges(hogS);
        const ghogGaugeAddress = await voter.gauges(ghogS);

        console.log("\nVerifying gauge creation...");
        console.log("HOG-OS gauge address:", hogGaugeAddress);
        console.log("GHOG-OS gauge address:", ghogGaugeAddress);

        expect(hogGaugeAddress).to.equal(hogGauge, "HOG-OS gauge not created correctly");
        expect(ghogGaugeAddress).to.equal(ghogGauge, "GHOG-OS gauge not created correctly");

        // Verify gauges are alive
        const hogGaugeAlive = await voter.isAlive(hogGaugeAddress);
        const ghogGaugeAlive = await voter.isAlive(ghogGaugeAddress);

        console.log("\nVerifying gauge status...");
        console.log("HOG-OS gauge alive:", hogGaugeAlive);
        console.log("GHOG-OS gauge alive:", ghogGaugeAlive);

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

  it("Should vote and distribute SWAPX rewards to gauges", async function () {
    console.log("\nSetting up voting power...");
    
    // Constants
    const VESWAPX_ADDRESS = "0xAA30F0977620D4d46B3Bb3Cf0794Fe645d576CA3";
    const SWAPX_WHALE = "0x83943a422B5EC0be815Ca5c9ADc4A39A00097920";
    
    const swapxToken = await ethers.getContractAt(ERC20_ABI, SWAPX_TOKEN);
    const voter = await ethers.getContractAt(VOTER_ABI, VOTER_ADDRESS);

    // Get gauge addresses
    const hogGaugeAddress = await voter.gauges(hogS);
    const ghogGaugeAddress = await voter.gauges(ghogS);

    console.log("Existing gauge addresses:", {
        "HOG-OS gauge": hogGaugeAddress,
        "GHOG-OS gauge": ghogGaugeAddress
    });

    // Impersonate SWAPX whale
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [SWAPX_WHALE],
    });

    await network.provider.send("hardhat_setBalance", [
        SWAPX_WHALE,
        "0x56BC75E2D63100000", // 100 ETH
    ]);

    const swapxWhale = await ethers.getSigner(SWAPX_WHALE);

    // Transfer SWAPX to owner
    const swapxAmount = ethers.parseEther("50000"); // 1000 SWAPX
    console.log("Transferring SWAPX from whale to owner...");
    await swapxToken.connect(swapxWhale).transfer(owner.address, swapxAmount);
    console.log("Transferred", ethers.formatEther(swapxAmount), "SWAPX to owner");

    // Stop impersonating
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [SWAPX_WHALE],
    });

    // Setup veSwapx contract
    const VESWAPX_ABI = [
        "function create_lock(uint256 _value, uint256 _lock_duration) external returns (uint256 newTokenId, uint256 votingPower)",
        "function balanceOf(address) external view returns (uint256)"
    ];
    const veSwapx = await ethers.getContractAt(VESWAPX_ABI, VESWAPX_ADDRESS);

    // Approve veSwapx to spend SWAPX
    console.log("Approving SWAPX spending...");
    await swapxToken.approve(VESWAPX_ADDRESS, swapxAmount);

    // Lock SWAPX for 4 weeks (in seconds)
    const lockDuration = 4 * 7 * 24 * 3600; // 4 weeks in seconds
    console.log("Locking SWAPX tokens...");
    await veSwapx.create_lock(swapxAmount, lockDuration);
    
    // Get the tokenId using tokenOfOwnerByIndex
    const VESWAPX_EXTENDED_ABI = [
        ...VESWAPX_ABI,
        "function tokenOfOwnerByIndex(address _owner, uint256 _tokenIndex) external view returns (uint256)"
    ];
    const veSwapxExtended = await ethers.getContractAt(VESWAPX_EXTENDED_ABI, VESWAPX_ADDRESS);
    
    // Get the first token (index 0) for the owner
    const tokenId = await veSwapxExtended.tokenOfOwnerByIndex(owner.address, 0);
    console.log("Found NFT tokenId:", tokenId.toString());

    // Vote for both pools with equal weight using the tokenId
    console.log("\nVoting for pools...");
    const poolVotes = [hogS, ghogS];
    const weights = [5000, 5000];  // Using basis points: 5000 = 50%, total = 10000 (100%)
    
    console.log("Voting with params:", {
        tokenId: tokenId.toString(),
        pools: poolVotes,
        weights: weights
    });

    try {
        await voter.vote(
            tokenId,      // NFT token ID
            poolVotes,    // pool addresses array
            weights       // weights array (in basis points, 10000 = 100%)
        );
        console.log("Vote transaction completed");
    } catch (error) {
        console.error("Vote failed with error:", {
            message: error.message,
            data: error.data
        });
        throw error;
    }

    // Advance time to allow for reward accrual
    // console.log("\nAdvancing time by 7 days...");
    // await network.provider.send("evm_increaseTime", [3600 * 24 * 7]);
    // await network.provider.send("evm_mine");

    // Distribute rewards
    // const DISTRIBUTOR = "0xA65AFAb928eec174c93018f7DB73a27414ee088c";
    
    // try {
       //  console.log("\nDistributing SWAPX rewards...");
        
        // Impersonate distributor account
       //  await network.provider.request({
       //      method: "hardhat_impersonateAccount",
       //      params: [DISTRIBUTOR],
       //  });

        // Fund the distributor with some ETH for gas
        // await network.provider.send("hardhat_setBalance", [
        //     DISTRIBUTOR,
        //     "0x56BC75E2D63100000", // 100 ETH
        // ]);

        // const distributor = await ethers.getSigner(DISTRIBUTOR);
        
        // Check distributor balance
        // const distributorBalance = await ethers.provider.getBalance(DISTRIBUTOR);
        // console.log("Distributor ETH balance:", ethers.formatEther(distributorBalance));

        // Call distributeAll as the distributor
        // const tx = await voter.connect(distributor).distributeAll();
       //  const receipt = await tx.wait();
        // console.log("distributeAll completed with status:", receipt.status);

        // Stop impersonating
     //    await network.provider.request({
     //        method: "hardhat_stopImpersonatingAccount",
     //        params: [DISTRIBUTOR],
     //    });
    // } catch (error) {
    //     console.error("Error distributing rewards:", {
    //         message: error.message,
    //         code: error.code,
    //         data: error.data
    //     });
    //     throw error;
    // }

    // Check SWAPX balances of gauges
    console.log("\nChecking SWAPX balances of gauges...");
    const hogGaugeSwapx = await swapxToken.balanceOf(hogGaugeAddress);
    const ghogGaugeSwapx = await swapxToken.balanceOf(ghogGaugeAddress);

    console.log("HOG-OS gauge SWAPX balance:", ethers.formatEther(hogGaugeSwapx));
    console.log("GHOG-OS gauge SWAPX balance:", ethers.formatEther(ghogGaugeSwapx));

    // Verify that gauges received SWAPX
    expect(hogGaugeSwapx).to.be.gt(0, "HOG-OS gauge should have SWAPX balance");
    expect(ghogGaugeSwapx).to.be.gt(0, "GHOG-OS gauge should have SWAPX balance");
  });

  it("Should deploy GHogRewardPool and distribute initial rewards", async function () {
    // Get current block timestamp for pool start time
    const latestBlock = await ethers.provider.getBlock('latest');
    const poolStartTime = latestBlock.timestamp + 60; // Start 1 minute from now

    console.log("\nDeploying GHogRewardPool with parameters:", {
        ghogToken: await ghog.getAddress(),
        hogLPToken: hogS,
        ghogLPToken: ghogS,
        owner: owner.address,
        poolStartTime: new Date(poolStartTime * 1000).toISOString()
    });

    try {
        // Deploy GHogRewardPool
        const GHogRewardPool = await ethers.getContractFactory("GHogRewardPool");
        gHogRewardPool = await GHogRewardPool.deploy(
            await ghog.getAddress(),  // GHOG token address
            hogS,                     // HOG-OS LP token address
            ghogS,                    // GHOG-OS LP token address
            owner.address,            // Owner address
            poolStartTime             // Pool start time
        );

        await gHogRewardPool.waitForDeployment();
        console.log("GHogRewardPool deployed to:", await gHogRewardPool.getAddress());

        // Distribute rewards to the GHogRewardPool
        console.log("\nDistributing initial GHOG rewards to GHogRewardPool...");
        const rewardPoolAddress = await gHogRewardPool.getAddress();
        const distributeTx = await ghog.distributeReward(rewardPoolAddress);
        await distributeTx.wait();

        // Verify GHOG balance of reward pool
        const rewardPoolBalance = await ghog.balanceOf(rewardPoolAddress);
        console.log("GHogRewardPool GHOG balance:", ethers.formatEther(rewardPoolBalance));
        
        expect(rewardPoolBalance).to.be.gt(0, "GHogRewardPool should have GHOG balance after distribution");

        console.log("\nGHogRewardPool deployment and initial reward distribution verified successfully");

    } catch (error) {
        console.error("Error in deployment and distribution:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should distribute LP tokens to different wallets", async function () {
    // Get LP token contracts
    const hogLPToken = await ethers.getContractAt(ERC20_ABI, hogS);
    const ghogLPToken = await ethers.getContractAt(ERC20_ABI, ghogS);

    // Get owner's LP balances
    const ownerHogLP = await hogLPToken.balanceOf(owner.address);
    const ownerGhogLP = await ghogLPToken.balanceOf(owner.address);

    console.log("\nInitial owner LP balances:", {
        "HOG-OS LP": ownerHogLP.toString(),
        "GHOG-OS LP": ownerGhogLP.toString()
    });

    // Amount to send to each wallet (10% of owner's balance)
    const hogLPAmount = ownerHogLP * 10n / 100n;  // 10% each
    const ghogLPAmount = ownerGhogLP * 10n / 100n; // 10% each

    console.log("\nDistributing LP tokens to wallets...");
    console.log("Amount per wallet:", {
        "HOG-OS LP": hogLPAmount.toString(),
        "GHOG-OS LP": ghogLPAmount.toString()
    });

    try {
        // Transfer HOG-OS LP tokens to first set of wallets
        console.log("\nDistributing HOG-OS LP tokens...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            console.log(`Transferring HOG-OS LP to wallet ${i + 1}: ${wallet.address}`);

            const hogTransferTx = await hogLPToken.connect(owner).transfer(
                wallet.address,
                hogLPAmount
            );
            await hogTransferTx.wait();

            const walletHogLP = await hogLPToken.balanceOf(wallet.address);
            console.log(`Wallet ${i + 1} HOG-OS LP balance: ${walletHogLP.toString()}`);
            expect(walletHogLP).to.equal(hogLPAmount, `HOG-OS LP transfer failed for wallet ${i + 1}`);
        }

        // Transfer GHOG-OS LP tokens to second set of wallets
        console.log("\nDistributing GHOG-OS LP tokens...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            console.log(`Transferring GHOG-OS LP to wallet ${i + 1}: ${wallet.address}`);

            const ghogTransferTx = await ghogLPToken.connect(owner).transfer(
                wallet.address,
                ghogLPAmount
            );
            await ghogTransferTx.wait();

            const walletGhogLP = await ghogLPToken.balanceOf(wallet.address);
            console.log(`Wallet ${i + 1} GHOG-OS LP balance: ${walletGhogLP.toString()}`);
            expect(walletGhogLP).to.equal(ghogLPAmount, `GHOG-OS LP transfer failed for wallet ${i + 1}`);
        }

        // Verify owner's remaining balance (should be 50% of initial balance)
        const finalOwnerHogLP = await hogLPToken.balanceOf(owner.address);
        const finalOwnerGhogLP = await ghogLPToken.balanceOf(owner.address);

        console.log("\nFinal owner LP balances:", {
            "HOG-OS LP": finalOwnerHogLP.toString(),
            "GHOG-OS LP": finalOwnerGhogLP.toString()
        });
        
        console.log("\nLP token distribution completed successfully");

    } catch (error) {
        console.error("Error distributing LP tokens:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should set allocation points and multiple wallets deposit LP tokens", async function () {
    console.log("\nSetting allocation points for pools...");
    
    try {
        // Set HOG-OS pool parameters (40%)
        console.log("Setting parameters for HOG-OS pool...");
        const hogSetTx = await gHogRewardPool.set(
            0,              // Pool ID for HOG-OS (first pool)
            400,           // Allocation points (400)
            50,            // With fee (50)
            ethers.ZeroAddress // Null address for gauge
        );
        await hogSetTx.wait();
        console.log("HOG-OS pool parameters set successfully");

        // Set GHOG-OS pool parameters (60%)
        console.log("Setting parameters for GHOG-OS pool...");
        const ghogSetTx = await gHogRewardPool.set(
            1,               // Pool ID for GHOG-OS (second pool)
            600,            // Allocation points (600)
            50,             // With fee (50)
            ethers.ZeroAddress // Null address for gauge
        );
        await ghogSetTx.wait();
        console.log("GHOG-OS pool parameters set successfully");

        // Get LP token contracts
        const ERC20_ABI = [
            "function balanceOf(address owner) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ];
        const hogLPToken = await ethers.getContractAt(ERC20_ABI, hogS);
        const ghogLPToken = await ethers.getContractAt(ERC20_ABI, ghogS);

        // Deposit HOG-OS LP tokens for first 5 wallets
        console.log("\nDepositing HOG-OS LP tokens...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            const walletBalance = await hogLPToken.balanceOf(wallet.address);
            
            // Generate random percentage between 20% and 80%
            const percentage = Math.floor(Math.random() * 61) + 20; // 20 to 80
            const depositAmount = (walletBalance * BigInt(percentage)) / 100n;
            
            console.log(`Wallet ${i + 1} approving HOG-OS LP...`);
            const approveTx = await hogLPToken.connect(wallet).approve(
                gHogRewardPool.getAddress(),
                depositAmount
            );
            await approveTx.wait();

            console.log(`Wallet ${i + 1} depositing ${percentage}% of HOG-OS LP...`);
            const depositTx = await gHogRewardPool.connect(wallet).deposit(0, depositAmount);
            await depositTx.wait();

            const userInfo = await gHogRewardPool.userInfo(0, wallet.address);
            console.log(`Wallet ${i + 1} deposited amount:`, userInfo.amount.toString());
        }

        // Deposit GHOG-OS LP tokens for second 5 wallets
        console.log("\nDepositing GHOG-OS LP tokens...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            const walletBalance = await ghogLPToken.balanceOf(wallet.address);
            
            // Generate random percentage between 20% and 80%
            const percentage = Math.floor(Math.random() * 61) + 20; // 20 to 80
            const depositAmount = (walletBalance * BigInt(percentage)) / 100n;
            
            console.log(`Wallet ${i + 1} approving GHOG-OS LP...`);
            const approveTx = await ghogLPToken.connect(wallet).approve(
                gHogRewardPool.getAddress(),
                depositAmount
            );
            await approveTx.wait();

            console.log(`Wallet ${i + 1} depositing ${percentage}% of GHOG-OS LP...`);
            const depositTx = await gHogRewardPool.connect(wallet).deposit(1, depositAmount);
            await depositTx.wait();

            const userInfo = await gHogRewardPool.userInfo(1, wallet.address);
            console.log(`Wallet ${i + 1} deposited amount:`, userInfo.amount.toString());
        }

        // Verify pool parameters
        const [hogPoolInfo, ghogPoolInfo] = await Promise.all([
            gHogRewardPool.poolInfo(0),
            gHogRewardPool.poolInfo(1)
        ]);
     
        console.log("\nAllocation points set and deposits completed successfully");

    } catch (error) {
        console.error("Error in allocation and deposit process:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should show pending rewards and harvest after 1 day", async function () {
    console.log("\nAdvancing time by 1 day...");
    
    try {
        // Advance time by 1 day (86400 seconds)
        await network.provider.send("evm_increaseTime", [86400]);
        await network.provider.send("evm_mine");

        // Check and harvest HOG-OS LP holders rewards
        console.log("\nChecking HOG-OS LP holders rewards...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            
            // Check pending rewards
            const pendingRewards = await gHogRewardPool.pendingShare(0, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));

            // Get balance before harvest
            const balanceBefore = await ghog.balanceOf(wallet.address);
            
            // Harvest rewards
            console.log(`Wallet ${i + 1} harvesting...`);
            const harvestTx = await gHogRewardPool.connect(wallet).deposit(0, 0);
            await harvestTx.wait();

            // Get balance after harvest
            const balanceAfter = await ghog.balanceOf(wallet.address);
            const harvested = balanceAfter - balanceBefore;

            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
            expect(harvested).to.be.gt(0, `Wallet ${i + 1} didn't receive rewards`);
        }

        // Check and harvest GHOG-OS LP holders rewards
        console.log("\nChecking GHOG-OS LP holders rewards...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            
            // Check pending rewards
            const pendingRewards = await gHogRewardPool.pendingShare(1, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));

            // Get balance before harvest
            const balanceBefore = await ghog.balanceOf(wallet.address);
            
            // Harvest rewards
            console.log(`Wallet ${i + 1} harvesting...`);
            const harvestTx = await gHogRewardPool.connect(wallet).deposit(1, 0);
            await harvestTx.wait();

            // Get balance after harvest
            const balanceAfter = await ghog.balanceOf(wallet.address);
            const harvested = balanceAfter - balanceBefore;

            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
            expect(harvested).to.be.gt(0, `Wallet ${i + 1} didn't receive rewards`);
        }

        // Verify that rewards were distributed according to allocation points
        const totalHogRewards = await Promise.all(
            hogWallets.map(wallet => ghog.balanceOf(wallet.address))
        );
        const totalGhogRewards = await Promise.all(
            ghogWallets.map(wallet => ghog.balanceOf(wallet.address))
        );

        const hogPoolTotal = totalHogRewards.reduce((a, b) => a + b, 0n);
        const ghogPoolTotal = totalGhogRewards.reduce((a, b) => a + b, 0n);

        console.log("\nTotal rewards distributed:");
        console.log("HOG-OS pool total:", ethers.formatEther(hogPoolTotal));
        console.log("GHOG-OS pool total:", ethers.formatEther(ghogPoolTotal));

        // Verify approximate 40/60 split (allowing for some rounding)
        const totalRewards = hogPoolTotal + ghogPoolTotal;
        const hogShare = (hogPoolTotal * 1000n) / totalRewards;  // Multiply by 1000 for precision
        const ghogShare = (ghogPoolTotal * 1000n) / totalRewards;

        console.log("\nReward distribution ratio:");
        console.log("HOG-OS pool share:", Number(hogShare) / 10, "%");
        console.log("GHOG-OS pool share:", Number(ghogShare) / 10, "%");

        // Allow for 1% deviation from target ratio
        expect(hogShare).to.be.closeTo(400n, 10n, "HOG-OS pool rewards not close to 40%");
        expect(ghogShare).to.be.closeTo(600n, 10n, "GHOG-OS pool rewards not close to 60%");

    } catch (error) {
        console.error("Error checking rewards:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should show pending rewards and harvest after 1 day", async function () {
    console.log("\nAdvancing time by 1 day...");
    
    try {
        // Advance time by 1 day (86400 seconds)
        await network.provider.send("evm_increaseTime", [86400]);
        await network.provider.send("evm_mine");

        // Check and harvest HOG-OS LP holders rewards
        console.log("\nChecking HOG-OS LP holders rewards...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            
            // Check pending rewards
            const pendingRewards = await gHogRewardPool.pendingShare(0, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));

            // Get balance before harvest
            const balanceBefore = await ghog.balanceOf(wallet.address);
            
            // Harvest rewards
            console.log(`Wallet ${i + 1} harvesting...`);
            const harvestTx = await gHogRewardPool.connect(wallet).deposit(0, 0);
            await harvestTx.wait();

            // Get balance after harvest
            const balanceAfter = await ghog.balanceOf(wallet.address);
            const harvested = balanceAfter - balanceBefore;

            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
            expect(harvested).to.be.gt(0, `Wallet ${i + 1} didn't receive rewards`);
        }

        // Check and harvest GHOG-OS LP holders rewards
        console.log("\nChecking GHOG-OS LP holders rewards...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            
            // Check pending rewards
            const pendingRewards = await gHogRewardPool.pendingShare(1, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));

            // Get balance before harvest
            const balanceBefore = await ghog.balanceOf(wallet.address);
            
            // Harvest rewards
            console.log(`Wallet ${i + 1} harvesting...`);
            const harvestTx = await gHogRewardPool.connect(wallet).deposit(1, 0);
            await harvestTx.wait();

            // Get balance after harvest
            const balanceAfter = await ghog.balanceOf(wallet.address);
            const harvested = balanceAfter - balanceBefore;

            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
            expect(harvested).to.be.gt(0, `Wallet ${i + 1} didn't receive rewards`);
        }

        // Verify that rewards were distributed according to allocation points
        const totalHogRewards = await Promise.all(
            hogWallets.map(wallet => ghog.balanceOf(wallet.address))
        );
        const totalGhogRewards = await Promise.all(
            ghogWallets.map(wallet => ghog.balanceOf(wallet.address))
        );

        const hogPoolTotal = totalHogRewards.reduce((a, b) => a + b, 0n);
        const ghogPoolTotal = totalGhogRewards.reduce((a, b) => a + b, 0n);

        console.log("\nTotal rewards distributed:");
        console.log("HOG-OS pool total:", ethers.formatEther(hogPoolTotal));
        console.log("GHOG-OS pool total:", ethers.formatEther(ghogPoolTotal));

        // Verify approximate 40/60 split (allowing for some rounding)
        const totalRewards = hogPoolTotal + ghogPoolTotal;
        const hogShare = (hogPoolTotal * 1000n) / totalRewards;  // Multiply by 1000 for precision
        const ghogShare = (ghogPoolTotal * 1000n) / totalRewards;

        console.log("\nReward distribution ratio:");
        console.log("HOG-OS pool share:", Number(hogShare) / 10, "%");
        console.log("GHOG-OS pool share:", Number(ghogShare) / 10, "%");

        // Allow for 1% deviation from target ratio
        expect(hogShare).to.be.closeTo(400n, 10n, "HOG-OS pool rewards not close to 40%");
        expect(ghogShare).to.be.closeTo(600n, 10n, "GHOG-OS pool rewards not close to 60%");

    } catch (error) {
        console.error("Error checking rewards:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should set gauges and allocation points for HOG-OS and GHOG-OS pools", async function () {
    console.log("\nSetting gauges and allocation points for pools in GHogRewardPool...");
    
    // Get the actual gauge addresses from voter contract
    const hogGaugeAddress = await voter.gauges(hogS);
    const ghogGaugeAddress = await voter.gauges(ghogS);

    console.log("Actual gauge addresses:", {
        "HOG-OS gauge": hogGaugeAddress,
        "GHOG-OS gauge": ghogGaugeAddress
    });
    
    try {
        // Set HOG-OS pool parameters
        console.log("Setting parameters for HOG-OS pool...");
        const hogSetTx = await gHogRewardPool.set(
            0,              // Pool ID for HOG-OS (first pool)
            500,           // Allocation points (500)
            50,            // With fee (50)
            hogGaugeAddress // Actual gauge address for HOG-OS pool
        );
        await hogSetTx.wait();
        console.log("HOG-OS pool parameters set successfully");

        // Set GHOG-OS pool parameters
        console.log("Setting parameters for GHOG-OS pool...");
        const ghogSetTx = await gHogRewardPool.set(
            1,               // Pool ID for GHOG-OS (second pool)
            500,            // Allocation points (500)
            50,             // With fee (50)
            ghogGaugeAddress // Actual gauge address for GHOG-OS pool
        );
        await ghogSetTx.wait();
        console.log("GHOG-OS pool parameters set successfully");

        // Verify the parameters were set correctly
        const [hogPoolInfo, ghogPoolInfo] = await Promise.all([
            gHogRewardPool.poolInfo(0),
            gHogRewardPool.poolInfo(1)
        ]);

        console.log("\nVerifying pool parameters:");
        console.log({
            "HOG-OS pool": {
                gauge: hogPoolInfo.gauge,
                allocPoint: hogPoolInfo.allocPoint.toString(),
                withFee: hogPoolInfo.withFee.toString(),
                lastRewardTime: hogPoolInfo.lastRewardTime.toString(),
                accGhogPerShare: hogPoolInfo.accGhogPerShare.toString()
            },
            "GHOG-OS pool": {
                gauge: ghogPoolInfo.gauge,
                allocPoint: ghogPoolInfo.allocPoint.toString(),
                withFee: ghogPoolInfo.withFee.toString(),
                lastRewardTime: ghogPoolInfo.lastRewardTime.toString(),
                accGhogPerShare: ghogPoolInfo.accGhogPerShare.toString()
            }
        });

        // Verify HOG-OS pool
        expect(hogPoolInfo.gauge).to.equal(hogGaugeAddress, "HOG-OS gauge not set correctly");
        expect(hogPoolInfo.allocPoint).to.equal(500, "HOG-OS allocation points not set correctly");
        expect(hogPoolInfo.withFee).to.equal(50, "HOG-OS fee not set correctly");

        // Verify GHOG-OS pool
        expect(ghogPoolInfo.gauge).to.equal(ghogGaugeAddress, "GHOG-OS gauge not set correctly");
        expect(ghogPoolInfo.allocPoint).to.equal(500, "GHOG-OS allocation points not set correctly");
        expect(ghogPoolInfo.withFee).to.equal(50, "GHOG-OS fee not set correctly");
        
        console.log("\nPool parameters verified successfully");

    } catch (error) {
        console.error("Error setting pool parameters:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

  it("Should check pending rewards at different stages and harvest", async function () {
    console.log("\nChecking rewards flow over time...");
    
    try {
        // Advance time by 1 day
        console.log("Advancing time by 1 day...");
        await network.provider.send("evm_increaseTime", [86400]);
        await network.provider.send("evm_mine");

        // Check pending rewards for HOG-OS LP holders
        console.log("\nChecking HOG-OS LP holders initial pending rewards...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            const pendingRewards = await gHogRewardPool.pendingShare(0, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));
        }

        // Check pending rewards for GHOG-OS LP holders
        console.log("\nChecking GHOG-OS LP holders initial pending rewards...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            const pendingRewards = await gHogRewardPool.pendingShare(1, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));
        }

        // Deposit remaining LP tokens
        console.log("\nDepositing remaining HOG-OS LP tokens...");
        const ERC20_ABI = [
            "function balanceOf(address owner) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ];
        const hogLPToken = await ethers.getContractAt(ERC20_ABI, hogS);
        const ghogLPToken = await ethers.getContractAt(ERC20_ABI, ghogS);

        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            const remainingBalance = await hogLPToken.balanceOf(wallet.address);
            if (remainingBalance > 0n) {
                await hogLPToken.connect(wallet).approve(gHogRewardPool.getAddress(), remainingBalance);
                await gHogRewardPool.connect(wallet).deposit(0, remainingBalance);
                console.log(`Wallet ${i + 1} deposited remaining:`, remainingBalance.toString());
            }
        }

        console.log("\nDepositing remaining GHOG-OS LP tokens...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            const remainingBalance = await ghogLPToken.balanceOf(wallet.address);
            if (remainingBalance > 0n) {
                await ghogLPToken.connect(wallet).approve(gHogRewardPool.getAddress(), remainingBalance);
                await gHogRewardPool.connect(wallet).deposit(1, remainingBalance);
                console.log(`Wallet ${i + 1} deposited remaining:`, remainingBalance.toString());
            }
        }

        // Advance time by 10 minutes
        console.log("\nAdvancing time by 10 minutes...");
        await network.provider.send("evm_increaseTime", [600]);
        await network.provider.send("evm_mine");

        // Check updated pending rewards
        console.log("\nChecking HOG-OS LP holders updated pending rewards...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            const pendingRewards = await gHogRewardPool.pendingShare(0, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));
        }

        console.log("\nChecking GHOG-OS LP holders updated pending rewards...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            const pendingRewards = await gHogRewardPool.pendingShare(1, wallet.address);
            console.log(`Wallet ${i + 1} pending rewards:`, ethers.formatEther(pendingRewards));
        }

        // Harvest rewards
        console.log("\nHarvesting rewards for HOG-OS LP holders...");
        for (let i = 0; i < hogWallets.length; i++) {
            const wallet = hogWallets[i];
            const balanceBefore = await ghog.balanceOf(wallet.address);
            await gHogRewardPool.connect(wallet).deposit(0, 0);
            const balanceAfter = await ghog.balanceOf(wallet.address);
            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(balanceAfter - balanceBefore));
        }

        console.log("\nHarvesting rewards for GHOG-OS LP holders...");
        for (let i = 0; i < ghogWallets.length; i++) {
            const wallet = ghogWallets[i];
            const balanceBefore = await ghog.balanceOf(wallet.address);
            await gHogRewardPool.connect(wallet).deposit(1, 0);
            const balanceAfter = await ghog.balanceOf(wallet.address);
            console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(balanceAfter - balanceBefore));
        }

        console.log("\nAll rewards checks completed successfully");

    } catch (error) {
        console.error("Error in rewards check process:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });

    /* it("Should claim SwapX rewards after 2 days", async function () {
    const swapxToken = await ethers.getContractAt(ERC20_ABI, SWAPX_TOKEN);
    
    console.log("\nAdvancing time by 2 days...");
    await network.provider.send("evm_increaseTime", [2 * 86400]); // 2 days
    await network.provider.send("evm_mine");

    // Get initial balances
    const initialDevFundBalance = await swapxToken.balanceOf(devFund.address);
    console.log("Initial devFund SwapX balance:", ethers.formatEther(initialDevFundBalance));

    try {
        // Claim rewards for HOG-OS pool
        console.log("\nClaiming SwapX rewards for HOG-OS pool...");
        await gHogRewardPool.claimSwapxRewards(0, SWAPX_TOKEN);

        // Claim rewards for GHOG-OS pool
        console.log("Claiming SwapX rewards for GHOG-OS pool...");
        await gHogRewardPool.claimSwapxRewards(1, SWAPX_TOKEN);

        // Get final balances
        const finalDevFundBalance = await swapxToken.balanceOf(devFund.address);
        console.log("\nFinal devFund SwapX balance:", ethers.formatEther(finalDevFundBalance));

        // Verify rewards were claimed and transferred to devFund
        const rewardsClaimed = finalDevFundBalance - initialDevFundBalance;
        console.log("Total SwapX rewards claimed:", ethers.formatEther(rewardsClaimed));

        expect(rewardsClaimed).to.be.gt(0, "Should have claimed some SwapX rewards");

    } catch (error) {
        console.error("Error claiming SwapX rewards:", {
            message: error.message,
            code: error.code,
            data: error.data
        });
        throw error;
    }
  });*/

  it("Should handle withdrawals and verify owner received fees", async function () {
    // Get contracts
    const hogToken = await ethers.getContractAt(PAIR_ABI, hogS);
    const ghogToken = await ethers.getContractAt(PAIR_ABI, ghogS);
    
    // Check initial owner balances
    const initialHogBalance = await hogToken.balanceOf(owner.address);
    const initialGhogBalance = await ghogToken.balanceOf(owner.address);
    
    console.log("\nInitial owner balances:", {
        HOG: ethers.formatEther(initialHogBalance),
        GHOG: ethers.formatEther(initialGhogBalance)
    });

    // Check HOG wallets' staked amounts
    console.log("\nChecking HOG wallets staked amounts:");
    for (let i = 0; i < hogWallets.length; i++) {
        const wallet = hogWallets[i];
        const [amount, rewardDebt] = await gHogRewardPool.userInfo(0, wallet.address);
        console.log(`HOG Wallet ${i + 1}:`, {
            address: wallet.address,
            staked: ethers.formatEther(amount),
            rewardDebt: ethers.formatEther(rewardDebt)
        });
    }

    // Check GHOG wallets' staked amounts
    console.log("\nChecking GHOG wallets staked amounts:");
    for (let i = 0; i < ghogWallets.length; i++) {
        const wallet = ghogWallets[i];
        const [amount, rewardDebt] = await gHogRewardPool.userInfo(1, wallet.address);
        console.log(`GHOG Wallet ${i + 1}:`, {
            address: wallet.address,
            staked: ethers.formatEther(amount),
            rewardDebt: ethers.formatEther(rewardDebt)
        });
    }

    // First HOG wallet withdraws everything, second withdraws half
    console.log("\nHOG wallets withdrawing...");
    // Full withdrawal for first HOG wallet
    const [hogAmount1] = await gHogRewardPool.userInfo(0, hogWallets[0].address);
    if (hogAmount1 > 0n) {
        console.log(`\nHOG Wallet 1 withdrawing full amount:`, {
            address: hogWallets[0].address,
            amount: ethers.formatEther(hogAmount1)
        });
        await gHogRewardPool.connect(hogWallets[0]).withdraw(0, hogAmount1);
    }

    // Half withdrawal for second HOG wallet
    const [hogAmount2] = await gHogRewardPool.userInfo(0, hogWallets[1].address);
    if (hogAmount2 > 0n) {
        const halfAmount = hogAmount2 / 2n;
        console.log(`\nHOG Wallet 2 withdrawing half:`, {
            address: hogWallets[1].address,
            amount: ethers.formatEther(halfAmount)
        });
        await gHogRewardPool.connect(hogWallets[1]).withdraw(0, halfAmount);
    }

    // First GHOG wallet withdraws everything, second withdraws half
    console.log("\nGHOG wallets withdrawing...");
    // Full withdrawal for first GHOG wallet
    const [ghogAmount1] = await gHogRewardPool.userInfo(1, ghogWallets[0].address);
    if (ghogAmount1 > 0n) {
        console.log(`\nGHOG Wallet 1 withdrawing full amount:`, {
            address: ghogWallets[0].address,
            amount: ethers.formatEther(ghogAmount1)
        });
        await gHogRewardPool.connect(ghogWallets[0]).withdraw(1, ghogAmount1);
    }

    // Half withdrawal for second GHOG wallet
    const [ghogAmount2] = await gHogRewardPool.userInfo(1, ghogWallets[1].address);
    if (ghogAmount2 > 0n) {
        const halfAmount = ghogAmount2 / 2n;
        console.log(`\nGHOG Wallet 2 withdrawing half:`, {
            address: ghogWallets[1].address,
            amount: ethers.formatEther(halfAmount)
        });
        await gHogRewardPool.connect(ghogWallets[1]).withdraw(1, halfAmount);
    }

    // Check owner's final balances and fee earnings
    const finalHogBalance = await hogToken.balanceOf(owner.address);
    const finalGhogBalance = await ghogToken.balanceOf(owner.address);
    
    const hogFees = finalHogBalance - initialHogBalance;
    const ghogFees = finalGhogBalance - initialGhogBalance;
    
    console.log("\nOwner balance changes:", {
        HOG: {
            initial: ethers.formatEther(initialHogBalance),
            final: ethers.formatEther(finalHogBalance),
            fees: ethers.formatEther(hogFees)
        },
        GHOG: {
            initial: ethers.formatEther(initialGhogBalance),
            final: ethers.formatEther(finalGhogBalance),
            fees: ethers.formatEther(ghogFees)
        }
    });

    // Verify owner received fees
    expect(hogFees).to.be.gt(0, "Owner should have received HOG fees");
    expect(ghogFees).to.be.gt(0, "Owner should have received GHOG fees");

    // Verify remaining balances for wallets that withdrew half
    const [remainingHog] = await gHogRewardPool.userInfo(0, hogWallets[1].address);
    const [remainingGhog] = await gHogRewardPool.userInfo(1, ghogWallets[1].address);
    
    console.log("\nRemaining balances for half-withdrawal wallets:", {
        "HOG Wallet 2": ethers.formatEther(remainingHog),
        "GHOG Wallet 2": ethers.formatEther(remainingGhog)
    });

    expect(remainingHog).to.be.gt(0, "Second HOG wallet should still have staked amount");
    expect(remainingGhog).to.be.gt(0, "Second GHOG wallet should still have staked amount");
  });

  it("Should handle rate changes and distribute rewards correctly", async function () {
    // Get initial state
    const initialSharePerSecond = await gHogRewardPool.sharePerSecond();
    console.log("\nInitial sharePerSecond:", ethers.formatEther(initialSharePerSecond));

    // Check initial rewards after 1 day
    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    console.log("\n=== First Day Rewards (Initial Rate) ===");
    // Check HOG-OS LP holders
    for (let i = 0; i < hogWallets.length; i++) {
        const pending = await gHogRewardPool.pendingShare(0, hogWallets[i].address);
        console.log(`HOG Wallet ${i + 1} pending:`, ethers.formatEther(pending));
    }
    // Check GHOG-OS LP holders
    for (let i = 0; i < ghogWallets.length; i++) {
        const pending = await gHogRewardPool.pendingShare(1, ghogWallets[i].address);
        console.log(`GHOG Wallet ${i + 1} pending:`, ethers.formatEther(pending));
    }

    // Advance 3 more days and update rate to 0.1
    await network.provider.send("evm_increaseTime", [86400 * 4]);
    await network.provider.send("evm_mine");
    
    const newSharePerSecond = ethers.parseEther("0.1");
    await gHogRewardPool.setSharePerSecond(newSharePerSecond);
    console.log("\nUpdated sharePerSecond to:", ethers.formatEther(newSharePerSecond));

    // Check rewards after rate change
    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    console.log("\n=== Rewards After Rate Change ===");
    // Check and harvest HOG-OS LP holders
    console.log("\nHOG-OS LP holders:");
    for (let i = 0; i < hogWallets.length; i++) {
        const wallet = hogWallets[i];
        const pending = await gHogRewardPool.pendingShare(0, wallet.address);
        console.log(`Wallet ${i + 1} pending:`, ethers.formatEther(pending));

        const balanceBefore = await ghog.balanceOf(wallet.address);
        await gHogRewardPool.connect(wallet).deposit(0, 0);
        const balanceAfter = await ghog.balanceOf(wallet.address);
        const harvested = balanceAfter - balanceBefore;
        console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
    }

    // Check and harvest GHOG-OS LP holders
    console.log("\nGHOG-OS LP holders:");
    for (let i = 0; i < ghogWallets.length; i++) {
        const wallet = ghogWallets[i];
        const pending = await gHogRewardPool.pendingShare(1, wallet.address);
        console.log(`Wallet ${i + 1} pending:`, ethers.formatEther(pending));

        const balanceBefore = await ghog.balanceOf(wallet.address);
        await gHogRewardPool.connect(wallet).deposit(1, 0);
        const balanceAfter = await ghog.balanceOf(wallet.address);
        const harvested = balanceAfter - balanceBefore;
        console.log(`Wallet ${i + 1} harvested:`, ethers.formatEther(harvested));
    }

    // Update rate again to 0.12 after 7 days
    await network.provider.send("evm_increaseTime", [86400 * 7]);
    await network.provider.send("evm_mine");
    
    const finalSharePerSecond = ethers.parseEther("0.12");
    await gHogRewardPool.setSharePerSecond(finalSharePerSecond);
    console.log("\nUpdated sharePerSecond to:", ethers.formatEther(finalSharePerSecond));

    // Check final rewards after another day
    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    console.log("\n=== Final Rewards (After Second Rate Change) ===");
    // Verify pool allocations are maintained
    const hogPoolTotal = await Promise.all(
        hogWallets.map(async wallet => {
            const pending = await gHogRewardPool.pendingShare(0, wallet.address);
            console.log(`HOG Wallet pending:`, ethers.formatEther(pending));
            return pending;
        })
    ).then(amounts => amounts.reduce((a, b) => a + b, 0n));

    const ghogPoolTotal = await Promise.all(
        ghogWallets.map(async wallet => {
            const pending = await gHogRewardPool.pendingShare(1, wallet.address);
            console.log(`GHOG Wallet pending:`, ethers.formatEther(pending));
            return pending;
        })
    ).then(amounts => amounts.reduce((a, b) => a + b, 0n));

    console.log("\nPool Totals:", {
        "HOG-OS": ethers.formatEther(hogPoolTotal),
        "GHOG-OS": ethers.formatEther(ghogPoolTotal)
    });

    // Verify 40/60 split is maintained
    const totalPending = hogPoolTotal + ghogPoolTotal;
    const hogShare = (hogPoolTotal * 1000n) / totalPending;
    const ghogShare = (ghogPoolTotal * 1000n) / totalPending;

    console.log("\nPool Shares:", {
        "HOG-OS": `${Number(hogShare) / 10}%`,
        "GHOG-OS": `${Number(ghogShare) / 10}%`
    });

    expect(hogShare).to.be.closeTo(400n, 10n, "HOG-OS pool share should be ~40%");
    expect(ghogShare).to.be.closeTo(600n, 10n, "GHOG-OS pool share should be ~60%");
  });
});