// SPDX-License-Identifier: BUSL-1.1

// Made by CodeStag Labs

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/IBasisAsset.sol";

contract HogGenesisRewardPool is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // governance
    address public operator;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 token; // Address of LP token contract.
        uint256 depFee; // deposit fee that is applied to created pool.
        uint256 allocPoint; // How many allocation points assigned to this pool. HOGs to distribute per block.
        uint256 lastRewardTime; // Last time that HOGs distribution occurs.
        uint256 accHogPerShare; // Accumulated HOGs per share, times 1e18. See below.
        bool isStarted; // if lastRewardTime has passed
        uint256 poolHogPerSec; // rewards per second for pool (acts as allocPoint)
    }
    
    IERC20 public hog;
    address public devFund;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // The time when HOG mining starts.
    uint256 public poolStartTime;

    // The time when HOG mining ends.
    uint256 public poolEndTime;
    uint256 public hogPerSecond = 0 ether;
    uint256 public runningTime = 7 days;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);

    constructor(
        address _hog,
        address _devFund,
        uint256 _poolStartTime
    ) {
        require(block.timestamp < _poolStartTime, "pool cant be started in the past");
        if (_hog != address(0)) hog = IERC20(_hog);
        if(_devFund != address(0)) devFund = _devFund;

        poolStartTime = _poolStartTime;
        poolEndTime = _poolStartTime + runningTime;
        operator = msg.sender;
        devFund = _devFund;

        // create all the pools
        add(0.316956019 ether, 0, IERC20(0x287c6882dE298665977787e268f3dba052A6e251), false, 0);    // Hog-OS 27% 
        add(0.223041088 ether, 100, IERC20(0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794), false, 0);  // OS 19% 
        add(0.117384259 ether, 100, IERC20(0x79bbF4508B1391af3A0F4B30bb5FC4aa9ab0E07C), false, 0);  // Anon 10% 
        add(0.105648148 ether, 100, IERC20(0x44E23B1F3f4511b3a7e81077Fd9F2858dF1B7579), false, 0);  // Mclb 9%
        add(0.129132870 ether, 100, IERC20(0xA04BC7140c26fc9BB1F36B1A604C7A5a88fb0E70), false, 0);  // SWPx 11%
        add(0.082175926 ether, 100, IERC20(0xE5DA20F15420aD15DE0fa650600aFc998bbE3955), false, 0);  // stS 7% 
        add(0.082175926 ether, 100, IERC20(0xd3DCe716f3eF535C5Ff8d041c1A41C3bd89b97aE), false, 0);  // scUSD 7% 
        add(0.046944444 ether, 100, IERC20(0x4EEC869d847A6d13b0F6D1733C5DEC0d1E741B4f), false, 0);  // Indi 4% 
        add(0.046944444 ether, 100, IERC20(0x9fDbC3f8Abc05Fa8f3Ad3C17D2F806c1230c4564), false, 0);  // Goglz 4%
        add(0.023472222 ether, 100, IERC20(0x2D0E0814E62D80056181F5cd932274405966e4f0), false, 0);  // Beets 2% 
    }

    modifier onlyOperator() {
        require(operator == msg.sender, "HogGenesisRewardPool: caller is not the operator");
        _;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function checkPoolDuplicate(IERC20 _token) internal view {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            require(poolInfo[pid].token != _token, "HogGenesisRewardPool: existing pool?");
        }
    }

    // bulk add pools
    function addBulk(uint256[] calldata _allocPoints, uint256[] calldata _depFees, IERC20[] calldata _tokens, bool _withUpdate, uint256 _lastRewardTime) external onlyOperator {
        require(_allocPoints.length == _depFees.length && _allocPoints.length == _tokens.length, "HogGenesisRewardPool: invalid length");
        for (uint256 i = 0; i < _allocPoints.length; i++) {
            add(_allocPoints[i], _depFees[i], _tokens[i], _withUpdate, _lastRewardTime);
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
            poolHogPerSec: _allocPoint,
            lastRewardTime: _lastRewardTime,
            accHogPerShare: 0,
            isStarted: _isStarted
        }));       
        
        if (_isStarted) {
            totalAllocPoint = totalAllocPoint.add(_allocPoint);
            hogPerSecond = hogPerSecond.add(_allocPoint);
        }
    }

    // Update the given pool's HOG allocation point. Can only be called by the operator.
    function set(uint256 _pid, uint256 _allocPoint, uint256 _depFee) public onlyOperator {
        massUpdatePools();

        PoolInfo storage pool = poolInfo[_pid];
        require(_depFee < 200);  // deposit fee cant be more than 2%;
        pool.depFee = _depFee;

        if (pool.isStarted) {
            totalAllocPoint = totalAllocPoint.sub(pool.allocPoint).add(_allocPoint);
            hogPerSecond = hogPerSecond.sub(pool.poolHogPerSec).add(_allocPoint);
        }
        pool.allocPoint = _allocPoint;
        pool.poolHogPerSec = _allocPoint;
    }

    function bulkSet(uint256[] calldata _pids, uint256[] calldata _allocPoints, uint256[] calldata _depFees) external onlyOperator {
        require(_pids.length == _allocPoints.length && _pids.length == _depFees.length, "HogGenesisRewardPool: invalid length");
        for (uint256 i = 0; i < _pids.length; i++) {
            set(_pids[i], _allocPoints[i], _depFees[i]);
        }
    }

    // Return accumulate rewards over the given _from to _to block.
    function getGeneratedReward(uint256 _fromTime, uint256 _toTime) public view returns (uint256) {
        if (_fromTime >= _toTime) return 0;
        if (_toTime >= poolEndTime) {
            if (_fromTime >= poolEndTime) return 0;
            if (_fromTime <= poolStartTime) return poolEndTime.sub(poolStartTime).mul(hogPerSecond);
            return poolEndTime.sub(_fromTime).mul(hogPerSecond);
        } else {
            if (_toTime <= poolStartTime) return 0;
            if (_fromTime <= poolStartTime) return _toTime.sub(poolStartTime).mul(hogPerSecond);
            return _toTime.sub(_fromTime).mul(hogPerSecond);
        }
    }

    // View function to see pending HOGs on frontend.
    function pendingHOG(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accHogPerShare = pool.accHogPerShare;
        uint256 tokenSupply = pool.token.balanceOf(address(this));
        if (block.timestamp > pool.lastRewardTime && tokenSupply != 0) {
            uint256 _generatedReward = getGeneratedReward(pool.lastRewardTime, block.timestamp);
            uint256 _hogReward = _generatedReward.mul(pool.allocPoint).div(totalAllocPoint);
            accHogPerShare = accHogPerShare.add(_hogReward.mul(1e18).div(tokenSupply));
        }
        return user.amount.mul(accHogPerShare).div(1e18).sub(user.rewardDebt);
    }

    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // massUpdatePoolsInRange
    function massUpdatePoolsInRange(uint256 _fromPid, uint256 _toPid) public {
        require(_fromPid <= _toPid, "HogGenesisRewardPool: invalid range");
        for (uint256 pid = _fromPid; pid <= _toPid; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) private {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTime) {
            return;
        }
        uint256 tokenSupply = pool.token.balanceOf(address(this));
        if (tokenSupply == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }
        if (!pool.isStarted) {
            pool.isStarted = true;
            totalAllocPoint = totalAllocPoint.add(pool.allocPoint);
            hogPerSecond = hogPerSecond.add(pool.poolHogPerSec);
        }
        if (totalAllocPoint > 0) {
            uint256 _generatedReward = getGeneratedReward(pool.lastRewardTime, block.timestamp);
            uint256 _hogReward = _generatedReward.mul(pool.allocPoint).div(totalAllocPoint);
            pool.accHogPerShare = pool.accHogPerShare.add(_hogReward.mul(1e18).div(tokenSupply));
        }
        pool.lastRewardTime = block.timestamp;
    }

    function setDevFund(address _devFund) public onlyOperator {
        devFund = _devFund;
    }

    // Deposit LP tokens.
    function deposit(uint256 _pid, uint256 _amount) public nonReentrant {
        address _sender = msg.sender;
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 _pending = user.amount.mul(pool.accHogPerShare).div(1e18).sub(user.rewardDebt);
            if (_pending > 0) {
                safeHogTransfer(_sender, _pending);
                emit RewardPaid(_sender, _pending);
            }
        }
        if (_amount > 0 ) {
            pool.token.safeTransferFrom(_sender, address(this), _amount);
            uint256 depositDebt = _amount.mul(pool.depFee).div(10000);
            user.amount = user.amount.add(_amount.sub(depositDebt));
            pool.token.safeTransfer(devFund, depositDebt);
        }
        user.rewardDebt = user.amount.mul(pool.accHogPerShare).div(1e18);
        emit Deposit(_sender, _pid, _amount);
    }

    // Withdraw LP tokens.
    function withdraw(uint256 _pid, uint256 _amount) public nonReentrant {
        address _sender = msg.sender;
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 _pending = user.amount.mul(pool.accHogPerShare).div(1e18).sub(user.rewardDebt);
        if (_pending > 0) {
            safeHogTransfer(_sender, _pending);
            emit RewardPaid(_sender, _pending);
        }
        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.token.safeTransfer(_sender, _amount);
        }
        user.rewardDebt = user.amount.mul(pool.accHogPerShare).div(1e18);
        emit Withdraw(_sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 _amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.token.safeTransfer(msg.sender, _amount);
        emit EmergencyWithdraw(msg.sender, _pid, _amount);
    }

    // Safe hog transfer function, just in case if rounding error causes pool to not have enough HOGs.
    function safeHogTransfer(address _to, uint256 _amount) internal {
        uint256 _hogBal = hog.balanceOf(address(this));
        if (_hogBal > 0) {
            if (_amount > _hogBal) {
                hog.safeTransfer(_to, _hogBal);
            } else {
                hog.safeTransfer(_to, _amount);
            }
        }
    }

    function setOperator(address _operator) external onlyOperator {
        operator = _operator;
    }

    function governanceRecoverUnsupported(
        IERC20 _token,
        uint256 amount,
        address to
    ) external onlyOperator {
        if (block.timestamp < poolEndTime + 7 days) {
            // do not allow to drain tokens if less than 7 days after pool ends
            uint256 length = poolInfo.length;
            for (uint256 pid = 0; pid < length; ++pid) {
                PoolInfo storage pool = poolInfo[pid];
                require(_token != pool.token, "token cannot be pool token");
            }
        }
        
        _token.safeTransfer(to, amount);
    }
}
