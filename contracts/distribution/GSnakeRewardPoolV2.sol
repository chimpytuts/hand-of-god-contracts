// SPDX-License-Identifier: BUSL-1.1

// GSnakeRewardPool --> visit https://snake.finance/ for full experience
// Made by Kell

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/IBasisAsset.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/farming/IERC4626.sol";
import "../interfaces/farming/IShadowGauge.sol";
import "../interfaces/farming/ISwapxGauge.sol";
import "../interfaces/farming/IShadowVoter.sol";
import "../interfaces/farming/ISwapxVoter.sol";
import "../interfaces/farming/IX33.sol";

contract GSnakeRewardPoolV2 is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    enum GaugeDex {
        NONE,
        SHADOW,
        SWAPX
    }

    // governance
    address public operator;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
    }

    struct GaugeInfo {
        bool isGauge;   // If this is a gauge
        address gauge;  // The gauge
        GaugeDex gaugeDex; // Dex of the gauge
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 token; // Address of LP token contract.
        uint256 depFee; // deposit fee that is applied to created pool.
        uint256 allocPoint; // How many allocation points assigned to this pool. GSNAKEs to distribute per block.
        uint256 lastRewardTime; // Last time that GSNAKEs distribution occurs.
        uint256 accGsnakePerShare; // Accumulated GSNAKEs per share, times 1e18. See below.
        bool isStarted; // if lastRewardTime has passed
        GaugeInfo gaugeInfo; // Gauge info (does this pool have a gauge and where is it)
        uint256 poolGsnakePerSec; // rewards per second for pool (acts as allocPoint)
    }

    IERC20 public gsnake;
    IOracle public gsnakeOracle;
    bool public claimGaugeRewardsOnUpdatePool = true;
    bool public pegStabilityModuleFeeEnabled = true;
    uint256 public pegStabilityModuleFee = 150; // 15%
    uint256 public minClaimThreshold = 1e12; // 0.000001 GSNAKE
    IShadowVoter public shadowVoter;
    ISwapxVoter public swapxVoter;
    address public constant XSHADOW_TOKEN = 0x5050bc082FF4A74Fb6B0B04385dEfdDB114b2424;
    address public constant X33_TOKEN = 0x3333111A391cC08fa51353E9195526A70b333333;
    address public constant SWAPX_TOKEN = 0xA04BC7140c26fc9BB1F36B1A604C7A5a88fb0E70;
    address public bribesSafe;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Pending rewards for each user in each pool (pending rewards accrued since last deposit/withdrawal)
    mapping(uint256 => mapping(address => uint256)) public pendingRewards;

    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // The time when GSNAKE mining starts.
    uint256 public poolStartTime;

    // The time when GSNAKE mining ends.
    uint256 public poolEndTime;
    uint256 public sharePerSecond = 0 ether;
    uint256 public runningTime = 730 days;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);

    constructor(
        address _gsnake,
        address _bribesSafe,
        uint256 _poolStartTime,
        address _shadowVoter,
        address _swapxVoter
    ) {
        require(block.timestamp < _poolStartTime, "pool cant be started in the past");
        if (_gsnake != address(0)) gsnake = IERC20(_gsnake);
        if(_bribesSafe != address(0)) bribesSafe = _bribesSafe;

        poolStartTime = _poolStartTime;
        poolEndTime = _poolStartTime + runningTime;
        operator = msg.sender;
        shadowVoter = IShadowVoter(_shadowVoter);
        swapxVoter = ISwapxVoter(_swapxVoter);
        bribesSafe = _bribesSafe;

        // create all the pools
        add(0, 0, IERC20(0x287c6882dE298665977787e268f3dba052A6e251), false, 0); // Snake-S
        add(0, 0, IERC20(0xb901D7316447C84f4417b8a8268E2822095051E6), false, 0); // GSnake-S
    }

    modifier onlyOperator() {
        require(operator == msg.sender, "GSnakeRewardPool: caller is not the operator");
        _;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function checkPoolDuplicate(IERC20 _token) internal view {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            require(poolInfo[pid].token != _token, "GSnakeRewardPool: existing pool?");
        }
    }

    // Add new lp to the pool. Can only be called by operator.
    function add(
        uint256 _allocPoint,
        uint256 _depFee,
        IERC20 _token,
        bool _withUpdate,
        uint256 _lastRewardTime
    ) public onlyOperator {
        checkPoolDuplicate(_token);
        if (_withUpdate) {
            massUpdatePools();
        }
        if (block.timestamp < poolStartTime) {
            // chef is sleeping
            if (_lastRewardTime == 0) {
                _lastRewardTime = poolStartTime;
            } else {
                if (_lastRewardTime < poolStartTime) {
                    _lastRewardTime = poolStartTime;
                }
            }
        } else {
            // chef is cooking
            if (_lastRewardTime == 0 || _lastRewardTime < block.timestamp) {
                _lastRewardTime = block.timestamp;
            }
        }
        bool _isStarted = (_lastRewardTime <= poolStartTime) || (_lastRewardTime <= block.timestamp);
        poolInfo.push(PoolInfo({
            token: _token,
            depFee: _depFee,
            allocPoint: _allocPoint,
            poolGsnakePerSec: _allocPoint,
            lastRewardTime: _lastRewardTime,
            accGsnakePerShare: 0,
            isStarted: _isStarted,
            gaugeInfo: GaugeInfo(false, address(0), GaugeDex.NONE)
        }));
        // enableGauge(poolInfo.length - 1);
        
        
        if (_isStarted) {
            totalAllocPoint = totalAllocPoint.add(_allocPoint);
            sharePerSecond = sharePerSecond.add(_allocPoint);
        }
    }

    // Update the given pool's GSNAKE allocation point. Can only be called by the operator.
    function set(uint256 _pid, uint256 _allocPoint, uint256 _depFee) public onlyOperator {
        massUpdatePools();

        PoolInfo storage pool = poolInfo[_pid];
        require(_depFee < 200);  // deposit fee cant be more than 2%;
        pool.depFee = _depFee;

        if (pool.isStarted) {
            totalAllocPoint = totalAllocPoint.sub(pool.allocPoint).add(_allocPoint);
            sharePerSecond = sharePerSecond.sub(pool.poolGsnakePerSec).add(_allocPoint);
        }
        pool.allocPoint = _allocPoint;
        pool.poolGsnakePerSec = _allocPoint;
    }

    function bulkSet(uint256[] calldata _pids, uint256[] calldata _allocPoints, uint256[] calldata _depFees) external onlyOperator {
        require(_pids.length == _allocPoints.length && _pids.length == _depFees.length, "GSnakeRewardPool: invalid length");
        for (uint256 i = 0; i < _pids.length; i++) {
            set(_pids[i], _allocPoints[i], _depFees[i]);
        }
    }

    // Return accumulate rewards over the given _from to _to block.
    function getGeneratedReward(uint256 _fromTime, uint256 _toTime) public view returns (uint256) {
        if (_fromTime >= _toTime) return 0;
        if (_toTime >= poolEndTime) {
            if (_fromTime >= poolEndTime) return 0;
            if (_fromTime <= poolStartTime) return poolEndTime.sub(poolStartTime).mul(sharePerSecond);
            return poolEndTime.sub(_fromTime).mul(sharePerSecond);
        } else {
            if (_toTime <= poolStartTime) return 0;
            if (_fromTime <= poolStartTime) return _toTime.sub(poolStartTime).mul(sharePerSecond);
            return _toTime.sub(_fromTime).mul(sharePerSecond);
        }
    }

    // View function to see pending GSNAKEs on frontend.
    function pendingShare(uint256 _pid, address _user) public view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accGsnakePerShare = pool.accGsnakePerShare;
        uint256 tokenSupply = pool.gaugeInfo.isGauge ? IShadowGauge(pool.gaugeInfo.gauge).balanceOf(address(this)) : pool.token.balanceOf(address(this));
        if (block.timestamp > pool.lastRewardTime && tokenSupply != 0) {
            uint256 _generatedReward = getGeneratedReward(pool.lastRewardTime, block.timestamp);
            uint256 _gsnakeReward = _generatedReward.mul(pool.allocPoint).div(totalAllocPoint);
            accGsnakePerShare = accGsnakePerShare.add(_gsnakeReward.mul(1e18).div(tokenSupply));
        }
        return user.amount.mul(accGsnakePerShare).div(1e18).sub(user.rewardDebt);
    }

    // View function to see pending GSNAKEs on frontend and any other pending rewards accumulated.
    function pendingShareAndPendingRewards(uint256 _pid, address _user) external view returns (uint256) {
        uint256 _pendingShare = pendingShare(_pid, _user);
        return _pendingShare.add(pendingRewards[_pid][_user]);
    }

    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
            updatePoolWithGaugeDeposit(pid);
        }
    }

    // massUpdatePoolsInRange
    function massUpdatePoolsInRange(uint256 _fromPid, uint256 _toPid) public {
        require(_fromPid <= _toPid, "GSnakeRewardPool: invalid range");
        for (uint256 pid = _fromPid; pid <= _toPid; ++pid) {
            updatePool(pid);
            updatePoolWithGaugeDeposit(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) private {
        updatePoolWithGaugeDeposit(_pid);
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTime) {
            return;
        }
        uint256 tokenSupply = pool.gaugeInfo.isGauge ? IShadowGauge(pool.gaugeInfo.gauge).balanceOf(address(this)) : pool.token.balanceOf(address(this));
        if (tokenSupply == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }
        if (!pool.isStarted) {
            pool.isStarted = true;
            totalAllocPoint = totalAllocPoint.add(pool.allocPoint);
            sharePerSecond = sharePerSecond.add(pool.poolGsnakePerSec);
        }
        if (totalAllocPoint > 0) {
            uint256 _generatedReward = getGeneratedReward(pool.lastRewardTime, block.timestamp);
            uint256 _gsnakeReward = _generatedReward.mul(pool.allocPoint).div(totalAllocPoint);
            pool.accGsnakePerShare = pool.accGsnakePerShare.add(_gsnakeReward.mul(1e18).div(tokenSupply));
        }
        pool.lastRewardTime = block.timestamp;
        if (claimGaugeRewardsOnUpdatePool) {claimAllRewards(_pid);}
    }
    
    // Deposit LP tokens to earn rewards
    function updatePoolWithGaugeDeposit(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        address gauge = pool.gaugeInfo.gauge;
        uint256 balance = pool.token.balanceOf(address(this));
        // Do nothing if this pool doesn't have a gauge
        if (pool.gaugeInfo.isGauge) {
            // Do nothing if the LP token in the MC is empty
            if (balance > 0) {
                // Approve to the gauge
                if (pool.token.allowance(address(this), gauge) < balance ){
                    pool.token.approve(gauge, type(uint256).max);
                }
                // Deposit the LP in the gauge
                IShadowGauge(pool.gaugeInfo.gauge).deposit(balance); // NOTE: no need to check if gauge is shadow or swapx, because both have the same function
            }
        }
    }

    // Claim rewards to treasury
    function claimAllRewards(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (pool.gaugeInfo.isGauge) {
            if (pool.gaugeInfo.gaugeDex == GaugeDex.SHADOW) {
                _claimShadowRewards(_pid);
            }
            if (pool.gaugeInfo.gaugeDex == GaugeDex.SWAPX) { 
                _claimSwapxRewards(_pid);
            }
        }
    }

    function _claimShadowRewards(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        address[] memory gaugeRewardTokens = IShadowGauge(pool.gaugeInfo.gauge).rewardsList();
        IShadowGauge(pool.gaugeInfo.gauge).getReward(address(this), gaugeRewardTokens);

        for (uint256 i = 0; i < gaugeRewardTokens.length; i++) {
            IERC20 rewardToken = IERC20(gaugeRewardTokens[i]);
            uint256 rewardAmount = rewardToken.balanceOf(address(this));

            if (rewardAmount > 0) {
                if (address(rewardToken) == XSHADOW_TOKEN) {
                    _convertXShadow(rewardAmount);
                } else {
                    rewardToken.safeTransfer(bribesSafe, rewardAmount);
                }
            }
        }
    }

    function convertXShadow(uint256 _amount) public onlyOperator {
        _convertXShadow(_amount);
    }

    function _convertXShadow(uint256 _amount) internal {
        IERC20(XSHADOW_TOKEN).approve(address(X33_TOKEN), _amount); // approve xshadow to x33
        bool canMint = IX33(X33_TOKEN).isUnlocked();
        if (canMint) {
            IERC4626(X33_TOKEN).deposit(_amount, address(this)); // mint x33
            IERC20(X33_TOKEN).safeTransfer(bribesSafe, _amount); // send x33 to bribesSafe
        }
    }

    function _claimSwapxRewards(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        ISwapxGauge(pool.gaugeInfo.gauge).getReward(); // claim the swapx rewards

        IERC20 rewardToken = IERC20(SWAPX_TOKEN);
        uint256 rewardAmount = rewardToken.balanceOf(address(this));
        if (rewardAmount > 0) {
            rewardToken.safeTransfer(bribesSafe, rewardAmount);
        }
    }

    // Add a gauge to a pool
    function enableGauge(uint256 _pid, GaugeDex _gaugeDex) public onlyOperator {
        if (_gaugeDex == GaugeDex.SHADOW) {
            _enableGaugeShadow(_pid);
        }
        if (_gaugeDex == GaugeDex.SWAPX) {
            _enableGaugeSwapX(_pid);
        }
    }

    function _enableGaugeShadow(uint256 _pid) internal {
        address gauge = shadowVoter.gaugeForPool(address(poolInfo[_pid].token));
        if (gauge != address(0)) {
            poolInfo[_pid].gaugeInfo = GaugeInfo(true, gauge, GaugeDex.SHADOW);
        }
    }

    function _enableGaugeSwapX(uint256 _pid) internal {
        // Add the logic for swapx
        address gauge = swapxVoter.gauges(address(poolInfo[_pid].token));
        if (gauge != address(0)) {
            poolInfo[_pid].gaugeInfo = GaugeInfo(true, gauge, GaugeDex.SWAPX);
        }
    }

    // Withdraw LP from the gauge
    function withdrawFromGauge(uint256 _pid, uint256 _amount) internal {
        PoolInfo storage pool = poolInfo[_pid];
        // Do nothing if this pool doesn't have a gauge
        if (pool.gaugeInfo.isGauge) {
            // Withdraw from the gauge
            IShadowGauge(pool.gaugeInfo.gauge).withdraw(_amount); // NOTE: no need to check if gauge is shadow or swapx, because both have the same function
        }
    }

    // Deposit LP tokens.
    function deposit(uint256 _pid, uint256 _amount) public nonReentrant {
        address _sender = msg.sender;
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 _pending = user.amount.mul(pool.accGsnakePerShare).div(1e18).sub(user.rewardDebt);
            if (_pending > 0) {
                // safeGsnakeTransfer(_sender, _pending);
                // emit RewardPaid(_sender, _pending);

                // accrue pending rewards to be claimed later
                pendingRewards[_pid][_sender] = pendingRewards[_pid][_sender].add(_pending);
            }
        }
        if (_amount > 0 ) {
            pool.token.safeTransferFrom(_sender, address(this), _amount);
            uint256 depositDebt = _amount.mul(pool.depFee).div(10000);
            user.amount = user.amount.add(_amount.sub(depositDebt));
            pool.token.safeTransfer(bribesSafe, depositDebt);
        }
        updatePoolWithGaugeDeposit(_pid);
        user.rewardDebt = user.amount.mul(pool.accGsnakePerShare).div(1e18);
        emit Deposit(_sender, _pid, _amount);
    }

    // Withdraw LP tokens.
    function withdraw(uint256 _pid, uint256 _amount) public payable nonReentrant {
        address _sender = msg.sender;
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        updatePoolWithGaugeDeposit(_pid);
        uint256 _pending = user.amount.mul(pool.accGsnakePerShare).div(1e18).sub(user.rewardDebt);
        if (_pending > 0) {
            // safeGsnakeTransfer(_sender, _pending);
            // emit RewardPaid(_sender, _pending);

            // accrue pending rewards to be claimed later
            pendingRewards[_pid][_sender] = pendingRewards[_pid][_sender].add(_pending);
        }
        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            withdrawFromGauge(_pid, _amount);
            pool.token.safeTransfer(_sender, _amount);
        }
        user.rewardDebt = user.amount.mul(pool.accGsnakePerShare).div(1e18);
        emit Withdraw(_sender, _pid, _amount);
    }

    function harvest(uint256 _pid) public payable nonReentrant { 
        address _sender = msg.sender;
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_sender];

        // Ensure rewards are updated
        updatePool(_pid);
        updatePoolWithGaugeDeposit(_pid);

        // Calculate the latest pending rewards
        uint256 _pending = user.amount.mul(pool.accGsnakePerShare).div(1e18).sub(user.rewardDebt);
        uint256 _accumulatedPending = pendingRewards[_pid][_sender];
        uint256 _rewardsToClaim = _pending.add(_accumulatedPending);

        // Ensure that the user is claiming an amount above the minimum threshold
        require(_rewardsToClaim >= minClaimThreshold, "Claim amount below minimum threshold");

        if (_rewardsToClaim > 0) {
            pendingRewards[_pid][_sender] = 0;

            uint256 amountSonicToPay = 0;
            if (pegStabilityModuleFeeEnabled) {
                uint256 currentGSNAKEPriceInSonic = gsnakeOracle.twap(address(gsnake), 1e18);
                amountSonicToPay = (currentGSNAKEPriceInSonic.mul(_rewardsToClaim).div(1e18)).mul(pegStabilityModuleFee).div(1000);
                require(msg.value >= amountSonicToPay, "insufficient sonic for PSM cost");
            } else {
                require(msg.value == 0, "GSnakeRewardPool: invalid msg.value");
            }

            safeGsnakeTransfer(_sender, _rewardsToClaim);
            emit RewardPaid(_sender, _rewardsToClaim);

            // Refund any excess S if pegStabilityModuleFee is enabled
            if (pegStabilityModuleFeeEnabled && msg.value > amountSonicToPay) {
                uint256 refundAmount = msg.value - amountSonicToPay;
                (bool success, ) = _sender.call{value: refundAmount}("");
                require(success, "Refund failed");
            }
        }
        // Update the user’s reward debt
        user.rewardDebt = user.amount.mul(pool.accGsnakePerShare).div(1e18);
    }

    function harvestAll() public payable nonReentrant {
        address _sender = msg.sender;
        uint256 length = poolInfo.length;
        uint256 totalUserRewardsToClaim = 0;

        for (uint256 pid = 0; pid < length; ++pid) {
            PoolInfo storage pool = poolInfo[pid];
            UserInfo storage user = userInfo[pid][_sender];

            // Ensure rewards are updated
            updatePool(pid);
            updatePoolWithGaugeDeposit(pid);

            // Calculate the latest pending rewards
            uint256 _pending = user.amount.mul(pool.accGsnakePerShare).div(1e18).sub(user.rewardDebt);
            uint256 _accumulatedPending = pendingRewards[pid][_sender];
            uint256 _rewardsToClaim = _pending.add(_accumulatedPending);

            if (_rewardsToClaim > 0) {
                pendingRewards[pid][_sender] = 0;
                totalUserRewardsToClaim = totalUserRewardsToClaim.add(_rewardsToClaim);
            }
            // Update the user’s reward debt
            user.rewardDebt = user.amount.mul(pool.accGsnakePerShare).div(1e18);
        }

        // Ensure that the user is claiming an amount above the minimum threshold
        require(totalUserRewardsToClaim >= minClaimThreshold, "Claim amount below minimum threshold");

        if (totalUserRewardsToClaim > 0) {
            uint256 amountSonicToPay = 0;
            if (pegStabilityModuleFeeEnabled) {
                uint256 currentGSNAKEPriceInSonic = gsnakeOracle.twap(address(gsnake), 1e18);
                amountSonicToPay = (currentGSNAKEPriceInSonic.mul(totalUserRewardsToClaim).div(1e18)).mul(pegStabilityModuleFee).div(1000);
                require(msg.value >= amountSonicToPay, "insufficient sonic for PSM cost");
            } else {
                require(msg.value == 0, "GSnakeRewardPool: invalid msg.value");
            }

            safeGsnakeTransfer(_sender, totalUserRewardsToClaim);
            emit RewardPaid(_sender, totalUserRewardsToClaim);

            // Refund any excess S if pegStabilityModuleFee is enabled
            if (pegStabilityModuleFeeEnabled && msg.value > amountSonicToPay) {
                uint256 refundAmount = msg.value - amountSonicToPay;
                (bool success, ) = _sender.call{value: refundAmount}("");
                require(success, "Refund failed");
            }
        }
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 _amount = user.amount;
        withdrawFromGauge(_pid, _amount);
        pendingRewards[_pid][msg.sender] = 0;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.token.safeTransfer(msg.sender, _amount);
        emit EmergencyWithdraw(msg.sender, _pid, _amount);
    }

    // Safe gsnake transfer function, just in case if rounding error causes pool to not have enough GSNAKEs.
    function safeGsnakeTransfer(address _to, uint256 _amount) internal {
        uint256 _gsnakeBal = gsnake.balanceOf(address(this));
        if (_gsnakeBal > 0) {
            if (_amount > _gsnakeBal) {
                gsnake.safeTransfer(_to, _gsnakeBal);
            } else {
                gsnake.safeTransfer(_to, _amount);
            }
        }
    }

    function setOperator(address _operator) external onlyOperator {
        operator = _operator;
    }

    function setBribesSafe(address _bribesSafe) public onlyOperator {
        bribesSafe = _bribesSafe;
    }

    function setPegStabilityModuleFee(uint256 _pegStabilityModuleFee) external onlyOperator {
        require(_pegStabilityModuleFee <= 500, "GSnakeRewardPool: invalid peg stability module fee"); // max 50%
        pegStabilityModuleFee = _pegStabilityModuleFee;
    }

    function setGSnakeOracle(IOracle _gsnakeOracle) external onlyOperator {
        gsnakeOracle = _gsnakeOracle;
    }

    function setPegStabilityModuleFeeEnabled(bool _enabled) external onlyOperator {
        pegStabilityModuleFeeEnabled = _enabled;
    }

    function setMinClaimThreshold(uint256 _minClaimThreshold) external onlyOperator {
        require(_minClaimThreshold >= 0, "GSnakeRewardPool: invalid min claim threshold");
        require(_minClaimThreshold <= 1e18, "GSnakeRewardPool: invalid max claim threshold");
        minClaimThreshold = _minClaimThreshold;
    }

    function setClaimGaugeRewardsOnUpdatePool(bool _claimGaugeRewardsOnUpdatePool) external onlyOperator {
        claimGaugeRewardsOnUpdatePool = _claimGaugeRewardsOnUpdatePool;
    }

    function governanceRecoverUnsupported(IERC20 _token, uint256 amount, address to) external onlyOperator {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            PoolInfo storage pool = poolInfo[pid];
            require(_token != pool.token, "ShareRewardPool: Token cannot be pool token");
        }
        _token.safeTransfer(to, amount);
    }

    /**
     * @notice Collects the Sonic.
     * @param amount The amount of Sonic to collect
     */
    function collectSonic(uint256 amount) public onlyOperator {
        (bool sent,) = bribesSafe.call{value: amount}("");
        require(sent, "failed to send Sonic");
    }
}
