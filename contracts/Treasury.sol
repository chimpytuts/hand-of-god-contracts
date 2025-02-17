// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./lib/Babylonian.sol";
import "./owner/Operator.sol";
import "./utils/ContractGuard.sol";
import "./interfaces/IBasisAsset.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IMasonry.sol";
import "./owner/Operator.sol";

contract Treasury is ContractGuard, Operator {
    using SafeERC20 for IERC20;
    using Address for address;
    using SafeMath for uint256;

    /* ========= CONSTANT VARIABLES ======== */

    uint256 public constant PERIOD = 6 hours;
    uint256 public constant BASIS_DIVISOR = 100000; // 100%

    /* ========== STATE VARIABLES ========== */

    // flags
    bool public initialized = false;

    // epoch
    uint256 public startTime;
    uint256 public epoch = 0;
    uint256 public epochSupplyContractionLeft = 0;

    //=================================================================// exclusions from total supply
    address[] public excludedFromTotalSupply = [
        address(0x29D0762f7bE8409d0aC34A3595AF62E8c0120950) // HogGenesisRewardPool
    ];

    // core components
    address public hog;
    address public bhog;
    address public ghog;

    address public masonry;
    address public hogOracle;

    // price
    uint256 public hogPriceOne;
    uint256 public hogPriceCeiling;

    uint256 public seigniorageSaved;

    uint256 public maxSupplyExpansionPercent;
    uint256 public bondDepletionFloorPercent;
    uint256 public seigniorageExpansionFloorPercent;
    uint256 public maxSupplyContractionPercent;
    uint256 public maxDebtRatioPercent;

    /* =================== Added variables =================== */
    uint256 public previousEpochHogPrice;
    uint256 public maxDiscountRate; // when purchasing bond
    uint256 public maxPremiumRate;  // when redeeming bond
    uint256 public discountPercent;
    uint256 public premiumThreshold;
    uint256 public premiumPercent;
    uint256 public mintingFactorForPayingDebt; // print extra HOG during debt phase

    address public daoFund;
    uint256 public daoFundSharedPercent;

    //=================================================//

    address public devFund;
    uint256 public devFundSharedPercent;
    address public teamFund;
    uint256 public teamFundSharedPercent;

    /* =================== Events =================== */

    event Initialized(address indexed executor, uint256 at);
    event BurnedBonds(address indexed from, uint256 bondAmount);
    event RedeemedBonds(address indexed from, uint256 hogAmount, uint256 bondAmount);
    event BoughtBonds(address indexed from, uint256 hogAmount, uint256 bondAmount);
    event TreasuryFunded(uint256 timestamp, uint256 seigniorage);
    event MasonryFunded(uint256 timestamp, uint256 seigniorage);
    event DaoFundFunded(uint256 timestamp, uint256 seigniorage);
    event DevFundFunded(uint256 timestamp, uint256 seigniorage);
    event TeamFundFunded(uint256 timestamp, uint256 seigniorage);

    /* =================== Modifier =================== */

    modifier checkCondition {
        require(block.timestamp >= startTime, "Treasury: not started yet");

        _;
    }

    modifier checkEpoch {
        require(block.timestamp >= nextEpochPoint(), "Treasury: not opened yet");

        _;

        epoch = epoch.add(1);
        epochSupplyContractionLeft = (getHogPrice() > hogPriceCeiling) ? 0 : getHogCirculatingSupply().mul(maxSupplyContractionPercent).div(BASIS_DIVISOR);
    }

    modifier checkOperator {
        require(
                IBasisAsset(hog).operator() == address(this) &&
                IBasisAsset(bhog).operator() == address(this) &&
                IBasisAsset(ghog).operator() == address(this) &&
                Operator(masonry).operator() == address(this),
            "Treasury: need more permission"
        );

        _;
    }

    modifier notInitialized {
        require(!initialized, "Treasury: already initialized");

        _;
    }

    /* ========== VIEW FUNCTIONS ========== */

    function isInitialized() public view returns (bool) {
        return initialized;
    }

    // epoch
    function nextEpochPoint() public view returns (uint256) {
        return startTime.add(epoch.mul(PERIOD));
    }

    // oracle
    function getHogPrice() public view returns (uint256 hogPrice) {
        try IOracle(hogOracle).consult(hog, 1e18) returns (uint256 price) {
            return uint256(price);
        } catch {
            revert("Treasury: failed to consult HOG price from the oracle");
        }
    }

    function getHogUpdatedPrice() public view returns (uint256 _hogPrice) {
        try IOracle(hogOracle).twap(hog, 1e18) returns (uint256 price) {
            return uint256(price);
        } catch {
            revert("Treasury: failed to consult HOG price from the oracle");
        }
    }

    // budget
    function getReserve() public view returns (uint256) {
        return seigniorageSaved;
    }

    function getBurnableHogLeft() public view returns (uint256 _burnableHogLeft) {
        uint256 _hogPrice = getHogPrice();
        if (_hogPrice <= hogPriceOne) {
            uint256 _hogSupply = getHogCirculatingSupply();
            uint256 _bondMaxSupply = _hogSupply.mul(maxDebtRatioPercent).div(BASIS_DIVISOR);
            uint256 _bondSupply = IERC20(bhog).totalSupply();
            if (_bondMaxSupply > _bondSupply) {
                uint256 _maxMintableBond = _bondMaxSupply.sub(_bondSupply);
                uint256 _maxBurnableHog = _maxMintableBond.mul(_hogPrice).div(1e18);
                _burnableHogLeft = Math.min(epochSupplyContractionLeft, _maxBurnableHog);
            }
        }
    }

    function getRedeemableBonds() public view returns (uint256 _redeemableBonds) {
        uint256 _hogPrice = getHogPrice();
        if (_hogPrice > hogPriceCeiling) {
            uint256 _totalHog = IERC20(hog).balanceOf(address(this));
            uint256 _rate = getBondPremiumRate();
            if (_rate > 0) {
                _redeemableBonds = _totalHog.mul(1e18).div(_rate);
            }
        }
    }

    function getBondDiscountRate() public view returns (uint256 _rate) {
        uint256 _hogPrice = getHogPrice();
        if (_hogPrice <= hogPriceOne) {
            if (discountPercent == 0) {
                // no discount
                _rate = hogPriceOne;
            } else {
                uint256 _bondAmount = hogPriceOne.mul(1e18).div(_hogPrice); // to burn 1 HOG
                uint256 _discountAmount = _bondAmount.sub(hogPriceOne).mul(discountPercent).div(BASIS_DIVISOR);
                _rate = hogPriceOne.add(_discountAmount);
                if (maxDiscountRate > 0 && _rate > maxDiscountRate) {
                    _rate = maxDiscountRate;
                }
            }
        }
    }

    function getBondPremiumRate() public view returns (uint256 _rate) {
        uint256 _hogPrice = getHogPrice();
        if (_hogPrice > hogPriceCeiling) {
            uint256 _hogPricePremiumThreshold = hogPriceOne.mul(premiumThreshold).div(100);
            if (_hogPrice >= _hogPricePremiumThreshold) {
                //Price > 1.10
                uint256 _premiumAmount = _hogPrice.sub(hogPriceOne).mul(premiumPercent).div(BASIS_DIVISOR);
                _rate = hogPriceOne.add(_premiumAmount);
                if (maxPremiumRate > 0 && _rate > maxPremiumRate) {
                    _rate = maxPremiumRate;
                }
            } else {
                // no premium bonus
                _rate = hogPriceOne;
            }
        }
    }

    /* ========== GOVERNANCE ========== */

    function initialize(
        address _hog,
        address _bhog,
        address _ghog,
        address _hogOracle,
        address _masonry,
        uint256 _startTime
    ) public notInitialized onlyOperator {
        hog = _hog;
        bhog = _bhog;
        ghog = _ghog;
        hogOracle = _hogOracle;
        masonry = _masonry;
        startTime = _startTime;

        hogPriceOne = 10 ** 18;
        // hogPriceCeiling = 1000300000000000000; // 1.003 as its stable pool
        hogPriceCeiling = hogPriceOne.mul(101).div(100); // even if its stable we aim to get 1.01

        maxSupplyExpansionPercent = 150; // 0.15%

        bondDepletionFloorPercent = 100000; // 100% of Bond supply for depletion floor
        seigniorageExpansionFloorPercent = 35000; // At least 35% of expansion reserved for masonry
        maxSupplyContractionPercent = 10000; // Upto 10.0% supply for contraction (to burn HOG and mint bhog)
        maxDebtRatioPercent = 35000; // Upto 35% supply of bhog to purchase

        premiumThreshold = 1100;
        premiumPercent = 70000;

        // set seigniorageSaved to it's balance
        seigniorageSaved = IERC20(hog).balanceOf(address(this));

        initialized = true;
        emit Initialized(msg.sender, block.number);
    }

    function setOperator(address _operator) external onlyOperator {
        transferOperator(_operator);
    }

    function renounceOperator() external onlyOperator {
        _renounceOperator();
    }

    function setMasonry(address _masonry) external onlyOperator {
        masonry = _masonry;
    }

    function setHogOracle(address _hogOracle) external onlyOperator {
        hogOracle = _hogOracle;
    }

    function setHogPriceCeiling(uint256 _hogPriceCeiling) external onlyOperator {
        require(_hogPriceCeiling >= hogPriceOne && _hogPriceCeiling <= hogPriceOne.mul(120).div(100), "out of range"); // [$1.0, $1.2]
        hogPriceCeiling = _hogPriceCeiling;
    }

    function setMaxSupplyExpansionPercents(uint256 _maxSupplyExpansionPercent) external onlyOperator {
        require(_maxSupplyExpansionPercent >= 10 && _maxSupplyExpansionPercent <= 10000, "_maxSupplyExpansionPercent: out of range"); // [0.01%, 10%]
        maxSupplyExpansionPercent = _maxSupplyExpansionPercent;
    }

    function setBondDepletionFloorPercent(uint256 _bondDepletionFloorPercent) external onlyOperator {
        require(_bondDepletionFloorPercent >= 500 && _bondDepletionFloorPercent <= BASIS_DIVISOR, "out of range"); // [0.5%, 100%]
        bondDepletionFloorPercent = _bondDepletionFloorPercent;
    }

    function setMaxSupplyContractionPercent(uint256 _maxSupplyContractionPercent) external onlyOperator {
        require(_maxSupplyContractionPercent >= 100 && _maxSupplyContractionPercent <= 15000, "out of range"); // [0.1%, 15%]
        maxSupplyContractionPercent = _maxSupplyContractionPercent;
    }

    function setMaxDebtRatioPercent(uint256 _maxDebtRatioPercent) external onlyOperator {
        require(_maxDebtRatioPercent >= 1000 && _maxDebtRatioPercent <= BASIS_DIVISOR, "out of range"); // [1%, 100%]
        maxDebtRatioPercent = _maxDebtRatioPercent;
    }

    function setExtraFunds(
        address _daoFund,
        uint256 _daoFundSharedPercent,
        address _devFund,
        uint256 _devFundSharedPercent,
        address _teamFund,
        uint256 _teamFundSharedPercent
    ) external onlyOperator {
        require(_daoFund != address(0), "zero");
        require(_daoFundSharedPercent <= 15000, "out of range");
        require(_devFund != address(0), "zero");
        require(_devFundSharedPercent <= 3500, "out of range");
        require(_teamFund != address(0), "zero");
        require(_teamFundSharedPercent <= 5500, "out of range");

        daoFund = _daoFund;
        daoFundSharedPercent = _daoFundSharedPercent;
        devFund = _devFund;
        devFundSharedPercent = _devFundSharedPercent;
        teamFund = _teamFund;
        teamFundSharedPercent = _teamFundSharedPercent;
    }

    function setMaxDiscountRate(uint256 _maxDiscountRate) external onlyOperator {
        require(_maxDiscountRate <= 200000, "_maxDiscountRate is over 200%");
        maxDiscountRate = _maxDiscountRate;
    }

    function setMaxPremiumRate(uint256 _maxPremiumRate) external onlyOperator {
        require(_maxPremiumRate <= 200000, "_maxPremiumRate is over 200%");
        maxPremiumRate = _maxPremiumRate;
    }

    function setDiscountPercent(uint256 _discountPercent) external onlyOperator {
        require(_discountPercent <= 200000, "_discountPercent is over 200%");
        discountPercent = _discountPercent;
    }

    function setPremiumThreshold(uint256 _premiumThreshold) external onlyOperator {
        require(_premiumThreshold >= hogPriceCeiling, "_premiumThreshold exceeds hogPriceCeiling");
        require(_premiumThreshold <= 1500, "_premiumThreshold is higher than 1.5");
        premiumThreshold = _premiumThreshold;
    }

    function setPremiumPercent(uint256 _premiumPercent) external onlyOperator {
        require(_premiumPercent <= 200000, "_premiumPercent is over 200%");
        premiumPercent = _premiumPercent;
    }

    function setMintingFactorForPayingDebt(uint256 _mintingFactorForPayingDebt) external onlyOperator {
        require(_mintingFactorForPayingDebt >= BASIS_DIVISOR && _mintingFactorForPayingDebt <= 200000, "_mintingFactorForPayingDebt: out of range"); // [100%, 200%]
        mintingFactorForPayingDebt = _mintingFactorForPayingDebt;
    }

    function setExpansionRate(uint256 _newRate) external onlyOperator {
        require(_newRate >= 10 && _newRate <= 10000, "_newRate: out of range"); // [0.01%, 10%]
        
        // Optional: Add a max change per epoch to prevent dramatic shifts
        require(
            _newRate <= maxSupplyExpansionPercent.mul(2) && 
            _newRate >= maxSupplyExpansionPercent.div(2),
            "Rate change too dramatic"
        );
        
        maxSupplyExpansionPercent = _newRate;
    }

    /* ========== MUTABLE FUNCTIONS ========== */

    function _updateHogPrice() internal {
        try IOracle(hogOracle).update() {} catch {}
    }

    function getHogCirculatingSupply() public view returns (uint256) {
        IERC20 hogErc20 = IERC20(hog);
        uint256 totalSupply = hogErc20.totalSupply();
        uint256 balanceExcluded = 0;
        for (uint8 entryId = 0; entryId < excludedFromTotalSupply.length; ++entryId) {
            balanceExcluded = balanceExcluded.add(hogErc20.balanceOf(excludedFromTotalSupply[entryId]));
        }
        return totalSupply.sub(balanceExcluded);
    }

    function buyBonds(uint256 _hogAmount, uint256 targetPrice) external onlyOneBlock checkCondition checkOperator {
        require(_hogAmount > 0, "Treasury: cannot purchase bonds with zero amount");

        uint256 hogPrice = getHogPrice();
        require(hogPrice == targetPrice, "Treasury: HOG price moved");
        require(
            hogPrice < hogPriceOne, // price < $1
            "Treasury: hogPrice not eligible for bond purchase"
        );

        require(_hogAmount <= epochSupplyContractionLeft, "Treasury: not enough bond left to purchase");

        uint256 _rate = getBondDiscountRate();
        require(_rate > 0, "Treasury: invalid bond rate");

        uint256 _bondAmount = _hogAmount.mul(_rate).div(1e18);
        uint256 hogSupply = getHogCirculatingSupply();
        uint256 newBondSupply = IERC20(bhog).totalSupply().add(_bondAmount);
        require(newBondSupply <= hogSupply.mul(maxDebtRatioPercent).div(BASIS_DIVISOR), "over max debt ratio");

        IBasisAsset(hog).burnFrom(msg.sender, _hogAmount);
        IBasisAsset(bhog).mint(msg.sender, _bondAmount);

        epochSupplyContractionLeft = epochSupplyContractionLeft.sub(_hogAmount);
        _updateHogPrice();

        emit BoughtBonds(msg.sender, _hogAmount, _bondAmount);
    }

    function redeemBonds(uint256 _bondAmount, uint256 targetPrice) external onlyOneBlock checkCondition checkOperator {
        require(_bondAmount > 0, "Treasury: cannot redeem bonds with zero amount");

        uint256 hogPrice = getHogPrice();
        require(hogPrice == targetPrice, "Treasury: HOG price moved");
        require(
            hogPrice > hogPriceCeiling, // price > $1.01
            "Treasury: hogPrice not eligible for bond purchase"
        );

        uint256 _rate = getBondPremiumRate();
        require(_rate > 0, "Treasury: invalid bond rate");

        uint256 _hogAmount = _bondAmount.mul(_rate).div(1e18);
        require(IERC20(hog).balanceOf(address(this)) >= _hogAmount, "Treasury: treasury has no more budget");

        seigniorageSaved = seigniorageSaved.sub(Math.min(seigniorageSaved, _hogAmount));

        IBasisAsset(bhog).burnFrom(msg.sender, _bondAmount);
        IERC20(hog).safeTransfer(msg.sender, _hogAmount);

        _updateHogPrice();

        emit RedeemedBonds(msg.sender, _hogAmount, _bondAmount);
    }

    function _sendToMasonry(uint256 _amount) internal {
        IBasisAsset(hog).mint(address(this), _amount);

        uint256 _daoFundSharedAmount = 0;
        if (daoFundSharedPercent > 0) {
            _daoFundSharedAmount = _amount.mul(daoFundSharedPercent).div(BASIS_DIVISOR);
            IERC20(hog).transfer(daoFund, _daoFundSharedAmount);
            emit DaoFundFunded(block.timestamp, _daoFundSharedAmount);
        }

        uint256 _devFundSharedAmount = 0;
        if (devFundSharedPercent > 0) {
            _devFundSharedAmount = _amount.mul(devFundSharedPercent).div(BASIS_DIVISOR);
            IERC20(hog).transfer(devFund, _devFundSharedAmount);
            emit DevFundFunded(block.timestamp, _devFundSharedAmount);
        }

        uint256 _teamFundSharedAmount = 0;
        if (teamFundSharedPercent > 0) {
            _teamFundSharedAmount = _amount.mul(teamFundSharedPercent).div(BASIS_DIVISOR);
            IERC20(hog).transfer(teamFund, _teamFundSharedAmount);
            emit TeamFundFunded(block.timestamp, _teamFundSharedAmount);
        }

        _amount = _amount.sub(_daoFundSharedAmount).sub(_devFundSharedAmount).sub(_teamFundSharedAmount);

        IERC20(hog).safeApprove(masonry, 0);
        IERC20(hog).safeApprove(masonry, _amount);
        IMasonry(masonry).allocateSeigniorage(_amount);
        emit MasonryFunded(block.timestamp, _amount);
    }

    function allocateSeigniorage() external onlyOneBlock checkCondition checkEpoch checkOperator {
        _updateHogPrice();
        previousEpochHogPrice = getHogPrice();
        uint256 hogSupply = getHogCirculatingSupply().sub(seigniorageSaved);
        
        if (previousEpochHogPrice > hogPriceCeiling) {
            uint256 bondSupply = IERC20(bhog).totalSupply();
            uint256 _percentage = previousEpochHogPrice.sub(hogPriceOne);
            uint256 _savedForBond;
            uint256 _savedForMasonry;
            
            uint256 _mse = maxSupplyExpansionPercent.mul(1e13);
            
            if (_percentage > _mse) {
                _percentage = _mse;
            }
            if (seigniorageSaved >= bondSupply.mul(bondDepletionFloorPercent).div(BASIS_DIVISOR)) {
                // saved enough to pay debt, mint as usual rate
                _savedForMasonry = hogSupply.mul(_percentage).div(1e18);
            } else {
                // have not saved enough to pay debt, mint more
                uint256 _seigniorage = hogSupply.mul(_percentage).div(1e18);
                _savedForMasonry = _seigniorage.mul(seigniorageExpansionFloorPercent).div(BASIS_DIVISOR);
                _savedForBond = _seigniorage.sub(_savedForMasonry);
                if (mintingFactorForPayingDebt > 0) {
                    _savedForBond = _savedForBond.mul(mintingFactorForPayingDebt).div(BASIS_DIVISOR);
                }
            }
            if (_savedForMasonry > 0) {
                _sendToMasonry(_savedForMasonry);
            }
            if (_savedForBond > 0) {
                seigniorageSaved = seigniorageSaved.add(_savedForBond);
                IBasisAsset(hog).mint(address(this), _savedForBond);
                emit TreasuryFunded(block.timestamp, _savedForBond);
            }
        }
    }

    function governanceRecoverUnsupported(
        IERC20 _token,
        uint256 _amount,
        address _to
    ) external onlyOperator {
        // do not allow to drain core tokens
        require(address(_token) != address(hog), "hog");
        require(address(_token) != address(bhog), "bond");
        require(address(_token) != address(ghog), "share");
        _token.safeTransfer(_to, _amount);
    }

    function tombSetOperator(address _operator) external onlyOperator {
        IBasisAsset(tomb).transferOperator(_operator);
    }

    function tshareSetOperator(address _operator) external onlyOperator {
        IBasisAsset(tshare).transferOperator(_operator);
    }

    function tbondSetOperator(address _operator) external onlyOperator {
        IBasisAsset(tbond).transferOperator(_operator);
    }

    function masonrySetOperator(address _operator) external onlyOperator {
        IMasonry(masonry).setOperator(_operator);
    }

    function masonrySetLockUp(uint256 _withdrawLockupEpochs, uint256 _rewardLockupEpochs) external onlyOperator {
        IMasonry(masonry).setLockUp(_withdrawLockupEpochs, _rewardLockupEpochs);
    }

    function masonryAllocateSeigniorage(uint256 amount) external onlyOperator {
        IMasonry(masonry).allocateSeigniorage(amount);
    }

    function masonryGovernanceRecoverUnsupported(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyOperator {
        IMasonry(masonry).governanceRecoverUnsupported(_token, _amount, _to);
    }
}
