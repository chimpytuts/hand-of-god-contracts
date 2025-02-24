// SPDX-License-Identifier: MIT

/*
@@@@@@@@@@@@@@#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@JG@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@# &@#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@& ^@5J@@@@@@@@&5G@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@J  #G J&@@&B?^7&@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@&BGPPY^   5@       7#@&@@@@@@@@@@@&P5&@@@@@P5&@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@P^~@@@@@@@@@@@@@@@@@@@P~::Y@@@@@@@@B5JJYG&@@@@@@@@@@@@@@@@@@@@&^^#@
@&#GY??JPG5?~...~&@G. .~5GJ7B@@@@@@@@@@@@G  5@@@@B  Y@@@&###&@@@@&&&@&##@@@@@@@&##@?  &@@@@@@@@&###@@@@@J  JP&@@@@@&!  :~!~. Y@@@@&###&@@@@@@&##&G  G@
@@@@@@#J.  :7#@@@@@@@@@P: .@@@@@@@@@@@@@@B  7BGGBJ  5@@!.^^: .G@@~  ...  ^@@@7  .:.   &@@@@@@P: .:. :G@~   ::#@@@@@. .&@@@@@&@@@P: .:. :P@@Y. .:..  G@
@@@@@@@@@Y   .@@@@@@@@G   .&@@@@@@@@@@@@@B  .::::.  5@@#5YYY.  @@~  #@@B  J@!  #@@@~  &@@@@@G  5@@@5  G@?  &@@@@@@&  7@@@@@5.~@G  5@@@5  BG  P@@@Y  G@
@@@@@@@@@P  !&@@@@@@@@@P~.  ^P&@@@@@@@@@@B  5@@@@B  Y@5  YBG.  @@~ .@@@&  ?@J  P@@&:  &@@@@@B  ?@@@7  #@?  &@@@@@@@7  ?#@@@^  @B  ?@@@7  #B  ?@@&7  G@
@@@@@@@&57PG?:  ~@@P...:!YPG5J?J5B&@@@@@@B  P@@@@#  P@&^.:~!^ .@@! :@@@&. Y@@P: ..:: .&@@@@@@#!.....!#@@Y .&@@@@@@@@#!. ....^Y@@#!.....!#@@B^ ...^. B@
@@@@@@&&&P:      !@.   75PGG#@@@@@@@@@@@@@@@@@@@@@@@@@@@@&&@@@@@@@@@@@@@@@@@@@@@&@@@@@@@@@@@@@@@@&@@@@@@@@@@@@@@@@@@@@@@&&@@@@@@@@@@&@@@@@@@@@@&@@@@@@
@@@@@@@G^~P&@@@#: @~  &@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@&PG@@@@@@@@@^@# ^@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@#@@J.@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@7&@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@

$HOG is the primary token of the Hand of God protocol, designed to function as a medium of exchange while maintaining a soft peg to $OS.
*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./lib/SafeMath8.sol";
import "./owner/Operator.sol";
import "./interfaces/IOracle.sol";

contract HOG is ERC20Burnable, Operator {
    using SafeMath8 for uint8;
    using SafeMath for uint256;

    uint256 public constant INITIAL_DAOFUND_DISTRIBUTION = 1000 ether; // 1000 HOG
    uint256 public constant GENESIS_DISTRIBUTION = 714000 ether; // 714k HOG for genesis pool

    bool public rewardsDistributed = false;

    // Address of the Oracle
    address public hogOracle;

    /**
     * @notice Constructs the HOG ERC-20 contract.
     */
    constructor() ERC20("HOG", "HOG") {
        // Mints 200 HOG to contract creator for initial pool setup

        _mint(msg.sender, 200 ether);
    }

    function _getHogPrice() internal view returns (uint256 _hogPrice) {
        try IOracle(hogOracle).consult(address(this), 1e18) returns (uint256 _price) {
            return uint256(_price);
        } catch {
            revert("Hog: failed to fetch HOG price from Oracle");
        }
    }

    function setHogOracle(address _hogOracle) public onlyOperator {
        require(_hogOracle != address(0), "oracle address cannot be 0 address");
        hogOracle = _hogOracle;
    }

    /**
     * @notice Operator mints HOG to a recipient
     * @param recipient_ The address of recipient
     * @param amount_ The amount of HOG to mint to
     * @return whether the process has been done
     */
    function mint(address recipient_, uint256 amount_) public onlyOperator returns (bool) {
        uint256 balanceBefore = balanceOf(recipient_);
        _mint(recipient_, amount_);
        uint256 balanceAfter = balanceOf(recipient_);

        return balanceAfter > balanceBefore;
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
    }

    function burnFrom(address account, uint256 amount) public override onlyOperator {
        super.burnFrom(account, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(sender, _msgSender(), allowance(sender, _msgSender()).sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    /**
     * @notice distribute to reward pool (only once)
     */
    function distributeReward(
        address _daoFund,
        address _genesis
    ) external onlyOperator {
        require(_daoFund != address(0), "!_treasury");
        require(_genesis != address(0), "!_genesis");
        require(!rewardsDistributed, "only can distribute once");
        rewardsDistributed = true;
        _mint(_daoFund, INITIAL_DAOFUND_DISTRIBUTION);
        _mint(_genesis, GENESIS_DISTRIBUTION);
    }

    function governanceRecoverUnsupported(
        IERC20 _token,
        uint256 _amount,
        address _to
    ) external onlyOperator {
        _token.transfer(_to, _amount);
    }
}