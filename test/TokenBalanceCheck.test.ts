import { ethers, network } from "hardhat";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("Token Balance Check", function () {
  const TOKEN_ADDRESS = "0x287c6882dE298665977787e268f3dba052A6e251";
  const WALLET_ADDRESS = "0x0C4290C3018172dD838631c94Ee6906C0eA65f5e";

  before(async function () {
    // Fork mainnet at latest block
    await network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: "https://rpc.ankr.com/sonic_mainnet"
        },
      }],
    });
    
    // Mine a block to fix the hardfork issue
    await helpers.mine();
  });

  it("should check wallet token balance", async function() {
    // Simple ERC20 ABI with just the functions we need
    const abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)"
    ];

    // Get contract instance
    const token = await ethers.getContractAt(abi, TOKEN_ADDRESS);
    
    // Get token info and balance
    const balance = await token.balanceOf(WALLET_ADDRESS);
    const decimals = await token.decimals();
    const symbol = await token.symbol();

    console.log(`Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
    expect(balance).to.be.gt(0, "Wallet should have tokens");
  });
}); 