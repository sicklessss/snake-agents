# Snake Agents — 游戏架构文档

> 最后更新：2026-02-21

---

## 目录

1. [项目概述](#项目概述)
2. [系统架构总览](#系统架构总览)
3. [技术栈](#技术栈)
4. [目录结构](#目录结构)
5. [后端服务器 (server.js)](#后端服务器)
6. [游戏引擎](#游戏引擎)
7. [Bot 沙盒执行系统](#bot-沙盒执行系统)
8. [智能合约体系](#智能合约体系)
9. [前端 (React/Vite)](#前端)
10. [经济系统](#经济系统)
11. [数据持久化](#数据持久化)
12. [部署与运维](#部署与运维)
13. [安全机制](#安全机制)
14. [关键业务流程](#关键业务流程)

---

## 项目概述

**Snake Agents** 是一个基于区块链的 AI Bot 对战平台。玩家编写 JavaScript AI 脚本驱动自己的蛇形 Bot 在 30×30 的竞技场中与其他 Bot 竞争。平台集成了 Base Sepolia 链上的 NFT 所有权、USDC 互注投注池、推荐奖励以及空投积分系统，构建了一个完整的"代码即资产"生态。

**核心玩法：** 编写 AI → 上传脚本 → Bot 自动参赛 → 赚取奖励

---

## 系统架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                         用户 / Bot 开发者                              │
│                                                                       │
│   ┌───────────────────────────────────────────────┐                  │
│   │          浏览器 (React 前端)                     │    Bot 脚本     │
│   │   Wagmi + RainbowKit + Viem                    │    (JS 文件)    │
│   │   Canvas 实时渲染 + 投注面板 + 排行榜           │                  │
│   └──────────────────────┬────────────────────────┘       │         │
│                           │ HTTP / WebSocket               │         │
└───────────────────────────┼───────────────────────────────┼──────────┘
                            ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     VPS (107.174.228.72:3000)                         │
│                                                                       │
│   ┌────────────────────────────────────────────────────────────┐     │
│   │                 server.js (Express + WebSocket)              │     │
│   │                      ~4200 行 · 50+ API 端点                 │     │
│   │                                                              │     │
│   │   ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │     │
│   │   │ GameRoom ×N  │  │ GameRoom ×1  │  │   HTTP API     │  │     │
│   │   │ performance  │  │ competitive  │  │   50+ 端点     │  │     │
│   │   └──────┬───────┘  └──────┬───────┘  └────────┬───────┘  │     │
│   │          │                  │                    │          │     │
│   │   ┌──────▼──────────────────▼────────────────────▼──────┐  │     │
│   │   │          Worker 线程池 (isolated-vm 沙盒)             │  │     │
│   │   │       每个 Bot 独立 Worker · 16MB 内存限制            │  │     │
│   │   │       最多 300 个并发 Worker                          │  │     │
│   │   └─────────────────────────────────────────────────────┘  │     │
│   └────────────────────────────────────────────────────────────┘     │
│                                                                       │
│   持久化: history.json │ replays/ │ bots/ │ data/                    │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ ethers.js v6 (JSON-RPC)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Base Sepolia 区块链 (ChainID: 84532)               │
│                                                                       │
│   BotRegistry │ SnakeBotNFT │ RewardDistributor │ USDC Token         │
│   SnakeAgentsPariMutuel │ ReferralRewards │ BotMarketplace             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 技术栈

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | - | 运行时 |
| Express.js | - | HTTP 服务器 |
| ws | - | WebSocket 实时通信 |
| ethers.js | 6.11 | 区块链交互 |
| isolated-vm | - | Bot 脚本沙盒隔离执行 |
| dotenv | - | 环境变量管理 |
| PM2 | - | 进程管理（ecosystem.config.js 配置 5 个 Arena 实例） |

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| Vite | 7 | 构建工具 |
| TypeScript | - | 类型安全 |
| Wagmi | 2.19 | 钱包连接 |
| RainbowKit | 2.2 | 钱包 UI（自定义，无 WalletConnect 依赖） |
| Viem | 2.46 | 以太坊交互库 |
| @tanstack/react-query | - | 服务端状态管理 |

### 区块链

| 技术 | 版本 | 用途 |
|------|------|------|
| Solidity | ^0.8.19 / 0.8.20 | 智能合约语言（合约声明 ^0.8.19，Hardhat 编译 0.8.20） |
| OpenZeppelin | 5.4 | 标准合约库（ERC-721, Ownable, ReentrancyGuard, Pausable） |
| Hardhat | 2.19 | 合约编译 & 部署 |
| Base Sepolia | ChainID 84532 | 测试网络 |

---

## 目录结构

```
snake-agents/
│
├── server.js                         主服务器（~4200行，游戏引擎 + API + 链上交互）
├── sandbox-worker.js                 Bot 沙盒执行 Worker 线程 (isolated-vm)
├── hero-agent.js                     示例英雄级 AI Bot
├── agent.js                          HTTP Bot 示例
├── bot.js                            WebSocket Bot 示例
├── ws-agent.js                       WebSocket Agent 模板
│
├── contracts/                        Solidity 合约源码（6 个合约）
│   ├── BotRegistry.sol               Bot 注册 · 所有权 · 市场
│   ├── SnakeBotNFT.sol               Bot ERC-721 NFT
│   ├── SnakeAgentsPariMutuel.sol      USDC 互注投注池
│   ├── RewardDistributor.sol         Bot 奖励分配
│   ├── ReferralRewards.sol           EIP-712 推荐奖励
│   └── BotMarketplace.sol            NFT 托管交易市场
│
├── src/                              前端 React 源码
│   ├── App.tsx                       主组件（~92KB，所有 UI 逻辑）
│   ├── contracts.ts                  合约地址 + ABI 定义
│   ├── main.tsx                      入口文件
│   └── index.css                     样式
│
├── artifacts/                        Hardhat 编译产物
├── abis/                             合约 ABI JSON
├── bots/                             已上传的 Bot JS 脚本（gitignored）
├── replays/                          比赛回放 JSON（gitignored，约 20GB）
├── data/                             本地持久化数据（gitignored）
│   ├── bots.json                     Bot 注册表
│   ├── referrals.json                推荐关系
│   ├── points.json                   用户积分
│   ├── airdrop-points.json           空投积分追踪
│   └── entry-fee.json                竞技场当前入场费
├── history.json                      比赛历史记录（gitignored）
├── public/                           前端构建产物（rsync 部署）
│
├── deploy*.js / deploy*.mjs          30+ 部署脚本
├── package.json                      依赖配置
├── hardhat.config.js                 Hardhat 编译配置
├── ecosystem.config.js               PM2 进程配置
├── .env                              环境变量（gitignored）
│
├── ARCHITECTURE.md                   旧版架构文档
├── BOT_GUIDE.md                      Bot 开发指南
├── README.md                         快速开始
├── CODE_REVIEW.md                    代码审查笔记
├── PROJECT_STATUS.md                 项目状态
└── DEVLOG.md                         开发日志
```

---

## 后端服务器

`server.js` 是整个平台的核心，约 4200 行代码，集成了游戏引擎、HTTP API、WebSocket 服务和区块链交互。

### 全局配置常量

| 常量 | 值 | 说明 |
|------|----|------|
| `gridSize` | 30 | 地图 30×30 格 |
| `MATCH_DURATION` | 180s | 每局 3 分钟 |
| `MAX_FOOD` | 5 | 场上最多 5 个食物 |
| `DEATH_BLINK_TURNS` | 24 | 死亡闪烁帧数 |
| 游戏帧间隔 | 125ms | 硬编码于 `setInterval(() => {...}, 125)`（~8fps） |
| `MAX_WORKERS` | 300 | 最大 Worker 线程数 |

### HTTP API 端点（50+）

#### Bot 管理

| 方法 | 路径 | 说明 | 鉴权方式 |
|------|------|------|----------|
| `POST` | `/api/bot/register` | 注册新 Bot | 限流 10次/min |
| `POST` | `/api/bot/register-unlimited` | 无限制注册（内部调用） | Admin Key |
| `POST` | `/api/bot/upload` | 上传/更新 Bot 脚本 | 限流 10次/min |
| `POST` | `/api/bot/claim` | 链上领取 Bot 所有权 | 钱包签名 |
| `POST` | `/api/bot/claim-nft` | 领取 Bot NFT | 钱包签名 |
| `POST` | `/api/bot/edit-token` | 获取编辑令牌 | 限流 20次/min |
| `POST` | `/api/bot/set-price` | 设置 Bot 价格 | Admin Key |
| `GET` | `/api/bot/registration-fee` | 查询链上注册费 | 无 |
| `GET` | `/api/bot/lookup?name=` | 按名称查 Bot | 无 |
| `GET` | `/api/bot/by-name/:name` | 按名称精确查 Bot | 无 |
| `GET` | `/api/bot/my-bots` | 获取用户 Bot 列表 | 无 |
| `GET` | `/api/bot/:botId` | 查询 Bot 信息 | 无 |
| `GET` | `/api/bot/:botId/credits` | 查余额 | 无 |
| `GET` | `/api/bot/:botId/code` | 获取 Bot 代码 | 无 |
| `GET` | `/api/bot/onchain/:botId` | 查询链上 Bot 信息 | 无 |
| `GET` | `/api/bot/nft/:botId` | 查询 Bot NFT 信息 | 无 |
| `GET` | `/api/bot/rewards/:botId` | 查询 Bot 奖励 | 无 |
| `POST` | `/api/bot/topup` | 充值 credits | Admin Key |
| `POST` | `/api/bot/start` | 启动 Bot Worker | Admin Key |
| `POST` | `/api/bot/stop` | 停止 Bot Worker | Admin Key |

#### 竞技场管理

| 方法 | 路径 | 说明 | 鉴权方式 |
|------|------|------|----------|
| `GET` | `/api/arena/status` | 所有房间状态 | 无 |
| `POST` | `/api/arena/join` | 加入指定房间 | 无 |
| `POST` | `/api/arena/kick` | 踢出玩家 | Admin Key |
| `GET` | `/api/competitive/status` | 竞技场状态 | 无 |
| `GET` | `/api/competitive/registered` | 竞技场已注册玩家 | 无 |
| `POST` | `/api/competitive/enter` | 付费进入竞技场 | 无 |

#### 用户 & 市场

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/user/bots` | 获取用户 Bot 列表 |
| `GET` | `/api/user/onchain-bots?wallet=` | 获取链上用户 Bot 列表 |
| `GET` | `/api/marketplace/listings` | 市场上架 Bot 列表 |
| `GET` | `/api/leaderboard/global` | 全局排行榜 |
| `GET` | `/api/leaderboard/performance` | 表演场排行榜 |
| `GET` | `/api/leaderboard/competitive` | 竞技场排行榜 |
| `GET` | `/api/leaderboard/arena/:arenaId` | 特定竞技场排行 |
| `GET` | `/api/replays` | 回放列表 |
| `GET` | `/api/replay/:matchId` | 获取回放数据 |
| `GET` | `/api/match/by-display-id` | 按显示 ID 查比赛 |
| `GET` | `/api/portfolio` | 用户投注组合 |

#### 投注 / 预测系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/bet/place` | 下注（别名：`/api/prediction/place`） |
| `GET` | `/api/bet/status` | 投注状态（别名：`/api/prediction/status`） |
| `POST` | `/api/bet/claim` | 领取奖金 |
| `GET` | `/api/bet/pool` | 当前奖池 |
| `GET` | `/api/bet/winnings` | 查看中奖金额 |
| `GET` | `/api/pari-mutuel/claimable?address=` | 查看所有待领取奖金 |

#### 积分 & 空投

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/points/my` | 我的积分 |
| `GET` | `/api/points/leaderboard` | 积分排行榜 |
| `POST` | `/api/airdrop/checkin` | 每日签到 |
| `GET` | `/api/airdrop/my` | 我的空投积分 |
| `GET` | `/api/airdrop/leaderboard` | 空投排行榜 |
| `POST` | `/api/airdrop/claim-register` | 领取注册奖励 |

#### 推荐系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/referral/record` | 记录推荐关系 |
| `POST` | `/api/referral/claim-proof` | 获取链下签名领取证明（需签名认证） |
| `POST` | `/api/referral/my-stats` | 我的推荐统计（需签名认证） |
| `GET` | `/api/referral/info/:address` | 推荐统计 |
| `GET` | `/api/admin/referral-stats` | 全局推荐统计（Admin Key） |

#### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/admin/reset-leaderboard` | 重置排行榜（Admin Key） |
| `POST` | `/api/admin/create-on-chain` | 链上创建 Bot（Admin Key） |

### WebSocket 消息协议

#### 客户端 → 服务器

```json
// 加入游戏
{
  "type": "join",
  "name": "BotName",
  "botId": "bot_xyz123",
  "botType": "agent",
  "arenaType": "performance"
}

// 发送移动方向（每帧）
{
  "type": "move",
  "direction": { "x": 1, "y": 0 }
}
```

#### 服务器 → 客户端

```json
// 初始化
{ "type": "init", "id": "player_id", "gridSize": 30 }

// 进入等待队列
{ "type": "queued", "id": "player_id", "entryPrice": 0.01 }

// 每帧状态更新（125ms 一次）
{
  "type": "update",
  "state": {
    "matchId": 100,
    "arenaId": "performance-1",
    "turn": 42,
    "gameState": "PLAYING",
    "timeLeft": 120,
    "players": [
      {
        "id": "player_abc",
        "name": "MyBot",
        "botId": "bot_xyz",
        "body": [{"x":15,"y":15}, {"x":15,"y":16}, {"x":15,"y":17}],
        "head": {"x": 15, "y": 15},
        "alive": true,
        "score": 5
      }
    ],
    "food": [{"x": 10, "y": 20}],
    "obstacles": [{"x": 5, "y": 8, "blinking": false}]
  }
}

// 被踢出
{ "type": "kicked", "reason": "full" }

// 比赛结束
{ "type": "game_over", "winners": [...] }
```

---

## 游戏引擎

### 房间类型

| 类型 | 数量上限 | 每房间最大玩家 | 特性 |
|------|----------|---------------|------|
| `performance-1` ~ `performance-N` | 最多 10 个 | 10 | 表演场，按 Bot 数量动态创建 |
| `competitive-1` | 1 个（上限 2） | 10 | 竞技场，带随机障碍物，付费入场 |

> 表演场房间数量根据已注册 Agent Bot 数量动态计算：`Math.min(10, Math.ceil(agentCount / 8))`，最少 1 个。

### 比赛生命周期

```
COUNTDOWN (5s)
    │  等待最少 2 名玩家
    ▼
PLAYING (180s)
    │  每 125ms 一帧循环：
    │  ① 读取玩家输入方向
    │  ② 移动蛇头（禁止 180° 掉头）
    │  ③ 边界碰撞检测
    │  ④ 蛇间碰撞检测
    │  ⑤ 食物消耗（蛇身延长 +1）
    │  ⑥ 动态食物生成
    │  ⑦ 广播完整状态给所有客户端
    │  ⑧ 检测游戏结束条件
    ▼
GAME_OVER
    │  保存比赛历史 → 保存回放数据
    │  链上结算（settleMatch）
    ▼
COUNTDOWN（新一局）
```

### 死亡类型

| 类型 | 原因 | 说明 |
|------|------|------|
| `wall` | 撞到边界 | 越过 30×30 地图边缘 |
| `self` | 撞到自身 | 蛇头碰到自己身体 |
| `eaten` | 被更长的蛇吃掉 | 短蛇头碰到长蛇，被吞噬 |
| `collision` | 撞到其他蛇身体 | 蛇头碰到他蛇身体段 |
| `headon` | 两蛇头对撞 | 等长同归于尽，长蛇存活 |
| `corpse` | 撞到死蛇尸体 | 尸体在场上残留 |
| `obstacle` | 撞到障碍物 | 仅竞技场模式 |
| `disconnect` | 断线 | WebSocket 连接丢失 |

### 竞技场特殊机制

- 每 **80 帧**（约 10 秒）随机生成 1~12 格障碍物（BFS 随机扩展形成不规则形状）
- 新障碍物闪烁警告后固化（`blinkTimer` 倒计时结束 → `solid = true`）
- 死蛇尸体自动转化为障碍物
- 场地越来越危险，迫使 Bot 更积极行动

### 竞技场入场费机制

- 初始入场费 **0.01 ETH**（存储于 `data/entry-fee.json`）
- 当所有 60 个表演场席位满员时，入场费自动 +0.01 ETH
- 出价低于当前入场费的 Agent Bot 会被踢出，腾出位置
- 仅 `agent` 和 `hero` 类型 Bot 需付费进入竞技场

### 比赛结算

- **胜者判定：** 最后存活的蛇 或 时间到时最长的蛇
- 支持 **前三名排名** 用于奖励分配（1st / 2nd / 3rd）

---

## Bot 沙盒执行系统

`sandbox-worker.js` 使用 `isolated-vm` 在独立 Worker 线程中安全执行用户上传的 Bot 脚本。

### 沙盒架构

```
server.js (主线程)
    │
    ├── Worker Thread #1 ─── isolated-vm Isolate ─── Bot A 脚本
    ├── Worker Thread #2 ─── isolated-vm Isolate ─── Bot B 脚本
    ├── Worker Thread #3 ─── isolated-vm Isolate ─── Bot C 脚本
    │   ...
    └── Worker Thread #N ─── isolated-vm Isolate ─── Bot N 脚本
```

### Bot 脚本可用 API

```javascript
// 配置信息
CONFIG.serverUrl      // WebSocket 连接地址 (ws://127.0.0.1:3000?...)
CONFIG.botId          // Bot 唯一标识

// 网络
WebSocket()           // 仅允许连接 localhost

// 输出
console.log()         // 日志（重定向到父线程）
console.info()        // 同 console.log
console.error()       // 错误日志
console.warn()        // 同 console.error

// 定时器
setTimeout()          // 延时执行
setInterval()         // 定时执行
clearTimeout()
clearInterval()
```

### 被封禁的危险 API

```
require / import          ← 禁止加载模块
module / exports          ← 禁止模块系统
fs / net / http / https   ← 禁止 I/O
child_process             ← 禁止系统调用
eval / Function           ← 禁止动态执行
process / Buffer          ← 禁止进程访问
__dirname / __filename    ← 禁止路径访问
__proto__                 ← 禁止原型链攻击
```

### 资源限制

| 限制项 | 值 |
|--------|----|
| 单 Isolate 内存 | 16 MB |
| 最大 WebSocket 连接 | 3 个 / Bot |
| 最大定时器数量 | 100 个 / Bot |
| 回调超时 | 5 秒 |
| 初始化超时 | 30 秒（脚本首次执行的总时间限制） |
| 单条消息最大长度 | 4096 字节（WebSocket send） |
| 定时器延迟范围 | setTimeout: 0~60000ms, setInterval: 50~60000ms |
| 最大并发 Worker | 300 个 |

### Bot 脚本示例

```javascript
// 最简 Bot：追踪最近食物
const ws = new WebSocket(CONFIG.serverUrl);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'SimpleBot',
    botId: CONFIG.botId
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'update') return;

  const state = msg.state;
  const me = state.players.find(p => p.id === myId);
  if (!me || !me.alive) return;

  const head = me.body[0];
  const food = state.food[0];

  // 朝食物方向移动
  let dx = food.x - head.x;
  let dy = food.y - head.y;

  let direction;
  if (Math.abs(dx) > Math.abs(dy)) {
    direction = { x: dx > 0 ? 1 : -1, y: 0 };
  } else {
    direction = { x: 0, y: dy > 0 ? 1 : -1 };
  }

  ws.send(JSON.stringify({ type: 'move', direction }));
};
```

---

## 智能合约体系

**网络：** Base Sepolia (ChainID: 84532)

### 合约总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      智能合约关系图                                │
│                                                                   │
│   用户钱包                                                        │
│     │                                                             │
│     ├─── BotRegistry ──────── SnakeBotNFT (ERC-721)             │
│     │    注册 Bot、管理所有权      每个 Bot 对应一个 NFT            │
│     │                                                             │
│     ├─── SnakeAgentsPariMutuel ──── RewardDistributor             │
│     │    USDC 互注投注              积累并分配 Bot 设计者奖励       │
│     │                                                             │
│     ├─── ReferralRewards                                         │
│     │    EIP-712 推荐奖励                                         │
│     │                                                             │
│     └─── BotMarketplace                                          │
│          NFT 托管交易市场                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 合约地址

| 合约 | 地址 | 来源 |
|------|------|------|
| BotRegistry | `0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800` | contracts.ts + server.js |
| SnakeBotNFT | `0xF269b84543041EA350921E3e3A2Da0B14B85453C` | contracts.ts + server.js |
| RewardDistributor | `0xB354e3062b493466da0c1898Ede5aabF56279046` | contracts.ts + server.js |
| SnakeAgentsPariMutuel | `0x35c8660C448Ccc5eef716E5c4aa2455c82B843C7` | contracts.ts + server.js |
| ReferralRewards | `0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F` | contracts.ts + server.js |
| BotMarketplace | `0x3088D308148B1FE6BE61770E2Bb78B41852Db4fC` | contracts.ts + server.js |
| USDC (测试) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | contracts.ts |

### BotRegistry.sol — Bot 注册与所有权

管理 Bot 的注册、所有权转移和基础市场功能。

**核心函数：**
- `registerBot(bytes32 _botId, address _inviter)` — 链上注册（需支付注册费）
- `createBot(bytes32 _botId, string _botName, address _creator)` — 后端创建（仅 owner）
- `getBotById(bytes32 _botId)` — 查询 Bot 信息
- `getOwnerBots(address _owner)` — 获取用户所有 Bot

**限制：** 每用户最多 5 个 Bot，注册费 0.01 ETH（链上可调）

### SnakeBotNFT.sol — ERC-721 NFT

每个注册的 Bot 对应一个唯一 NFT 代币，支持转让和交易。

**核心函数：**
- `mintBotNFT(address _to, bytes32 _botId, string _botName)` — 铸造（由 BotRegistry 调用）
- `getBotsByOwner(address _owner)` — 枚举用户的 Bot
- `tokenURI(uint256 tokenId)` — 返回 Base64 编码 JSON 元数据

### SnakeAgentsPariMutuel.sol — USDC 互注投注池

用户使用 USDC 对比赛中的 Bot 下注，奖池按比例分配。

**核心函数：**
- `placeBet(uint256 _matchId, bytes32 _botId, uint256 _amount)` — 下注 USDC
- `createMatch(uint256 _matchId, uint256 _startTime)` — 创建比赛（仅 oracle）
- `settleMatch(uint256 _matchId, bytes32[] _winners)` — 结算比赛（仅 oracle）
- `claimWinnings(uint256 _matchId)` — 领取奖金
- `withdrawPlatformFees()` — 提取平台费（仅提取追踪的累积费用）

**奖池分配（合约常量）：**

```
总投注池 100%
├── 10%  平台抽水 (PLATFORM_RAKE = 1000 / 10000)
│        → accumulatedPlatformFees（安全独立追踪）
│        → 包含平台费 + Bot 设计者奖励（链下分配）
│
└── 90%  投注者奖金池 (PERCENTAGE_BASE - TOTAL_RAKE)
    ├── 50%  押中第1名的投注者按份额分 (FIRST_PLACE_SHARE = 5000)
    ├── 30%  押中第2名的投注者按份额分 (SECOND_PLACE_SHARE = 3000)
    └── 20%  押中第3名的投注者按份额分 (THIRD_PLACE_SHARE = 2000)
```

> 投注者奖金按其在对应 Bot 的投注占比按比例分配（pari-mutuel 互注模式）。

### RewardDistributor.sol — 奖励分配

积累并分配 Bot 设计者从比赛中赚取的奖励。

**核心函数：**
- `accumulateReward(bytes32 _botId, uint256 _amount, uint256 _matchId, uint8 _placement)` — 仅 PariMutuel 合约可调用
- `claimRewards(bytes32 _botId)` — Bot 所有者领取奖励
- `claimRewardsBatch(bytes32[])` — 批量领取

**最低领取门槛：** 0.001 ETH

### ReferralRewards.sol — EIP-712 推荐奖励

链下签名 + 链上验证的推荐奖励系统。

**核心函数：**
- `claim(uint256 amount, uint256 nonce, bytes signature)` — 用户凭后端签名领取
- `getNonce(address user)` — 获取当前 nonce（防重放）

**EIP-712 签名结构：**
```solidity
struct ClaimMessage {
  address user;
  uint256 amount;
  uint256 nonce;
}
```

### BotMarketplace.sol — NFT 托管市场

基于 NFT 托管的 Bot 交易市场。

**核心函数：**
- `list(uint256 tokenId, uint256 price)` — 上架（NFT 托管到合约）
- `buy(uint256 tokenId)` — 购买（ETH 支付）
- `cancel(uint256 tokenId)` — 取消上架（NFT 退回）
- `getActiveListings()` — 获取所有在售列表

**平台手续费：** 2.5%（basis points: 250）

---

## 前端

**技术栈：** React 19 + Vite 7 + TypeScript + Wagmi + RainbowKit

### 主要组件（App.tsx，~92KB）

| 组件 | 功能 |
|------|------|
| `WalletButton` | 多钱包选择器（MetaMask / Coinbase / 注入式），显示余额与领取入口 |
| `BotPanel` | 用户 Bot 列表（最多 5 个），管理注册/上传/编辑 |
| `BotSlot` | 单个 Bot 卡片，显示状态、收益、操作按钮 |
| `BotUploadModal` | Bot JS 代码编辑器，支持初次上传和后续编辑 |
| `BotClaimByName` | 通过名称 + 钱包签名领取已有 Bot |
| `GameDisplay` | Canvas 实时渲染游戏画面（30×30 格、蛇身、食物、障碍物） |
| `Leaderboard` | 全局 / 分竞技场排行榜 |
| `BettingPanel` | USDC 对局投注面板（选 Bot、输金额、下注） |
| `MatchInfo` | 当前比赛信息（玩家列表、赔率） |

### 钱包集成

支持多种钱包，无 WalletConnect 依赖：
- **MetaMask** — 浏览器插件
- **Coinbase Wallet** — Coinbase 官方钱包
- **Injected** — 其他浏览器钱包

### 状态管理

| Hook | 来源 | 用途 |
|------|------|------|
| `useAccount` | Wagmi | 当前连接钱包 |
| `useWriteContract` | Wagmi | 发送链上交易 |
| `useSignMessage` | Wagmi | 消息签名（认证/领取） |
| `useQuery` | @tanstack/react-query | API 数据获取与缓存 |

### 构建与部署

```bash
# 本地构建
cd snake-agents-next && npm run build

# 同步到 VPS
rsync -az --delete -e "ssh -p 2232" dist/ root@107.174.228.72:/root/snake-agents/public/
```

---

## 经济系统

### USDC 互注投注

用户使用 USDC（6 位小数）对比赛中的 Bot 下注：
1. 比赛开始后 5 分钟内可下注
2. 下注不可撤销
3. 比赛结束后链上结算
4. 中奖者调用 `claimWinnings()` 领取

### 空投积分系统

| 积分类型 | 数量 | 说明 |
|----------|------|------|
| `checkin_base` | 10 分/天 | 每日签到基础分 |
| `checkin_streak` | 30 分 | 连续签到第 7 天奖励 |
| `match_participate` | 5 分/场 | 参与比赛 |
| `match_placement` | 50/30/20 分 | 获得 1st/2nd/3rd |
| `bet_activity` | 5 分/次 | 参与投注 |
| `bet_win` | 0.5× 赢得金额 | 投注中奖 |
| `register_bonus` | 200 分 | 新用户注册 |
| `referral_l1` | 100 分 | 直接推荐 |
| `referral_l2` | 50 分 | 二级推荐 |

**每日上限：** 比赛积分 20 分/天，投注积分 50 分/天

### 推荐系统

- **两级推荐：** L1（直接邀请）+ L2（邀请人的邀请人）
- **链下记录 + 链上领取：** 后端签名 EIP-712 消息，用户凭签名链上领取
- **Nonce 递增防重放**

---

## 数据持久化

| 文件/目录 | 内容 | 格式 | 重启保留 |
|-----------|------|------|----------|
| `history.json` | 所有比赛记录 | JSON | ✅ |
| `replays/match-N.json` | 完整比赛帧回放（~20GB） | JSON | ✅ |
| `bots/bot_xxx.js` | 已上传的 Bot 脚本 | JS | ✅ |
| `data/bots.json` | Bot 注册表（名称、类型、owner、credits） | JSON | ✅ |
| `data/referrals.json` | 推荐关系和奖励记录 | JSON | ✅ |
| `data/points.json` | 用户积分 | JSON | ✅ |
| `data/airdrop-points.json` | 空投积分追踪 | JSON | ✅ |
| `data/entry-fee.json` | 竞技场当前入场费 | JSON | ✅ |
| `.env` | 环境变量 | dotenv | ✅ |

以上文件均在 `.gitignore` 中，PM2 重启仅重启进程，不影响数据。

---

## 部署与运维

### 服务器信息

```
IP:    107.174.228.72
SSH:   ssh -p 2232 root@107.174.228.72
Port:  3000
```

### PM2 进程（ecosystem.config.js）

```
Arena-1   — server.js, PORT=3000
Arena-2   — server.js, PORT=3001
Arena-3   — server.js, PORT=3002
Arena-4   — server.js, PORT=3003
Arena-5   — server.js, PORT=3004
```

> 每个 Arena 实例运行独立的 server.js 进程，监听不同端口。

### Git 分支

| 分支 | 目录 | 内容 |
|------|------|------|
| `master` | `/workspace-agent-a/snake-agents` | 后端服务器 + 智能合约 |
| `snake-agents-next` | `/snake-agents-next` | 前端 React 应用 |

### 密钥管理

| 密钥 | 存储方式 |
|------|----------|
| Owner 私钥 | 用户本地 1Password，**从不上传** |
| Backend 私钥 | VPS 上 `backend-private-key-v2.age`（age 加密），启动时解密 |
| Admin Key | VPS `.env` 文件 |
| Hardhat 部署密钥 | 通过 `PRIVATE_KEY` 环境变量传入 |

---

## 安全机制

| 层级 | 机制 | 实现方式 |
|------|------|----------|
| Bot 脚本 | 沙盒隔离 | isolated-vm + 禁用关键词 + Worker 线程 + 16MB 内存限制 |
| API 鉴权 | 分级权限 | Admin Key（管理操作）+ 钱包签名（用户操作） |
| 防重放 | 多重保护 | `/claim` 5 分钟窗口 + ReferralRewards nonce 递增 |
| 智能合约 | 安全模式 | ReentrancyGuard + Pausable + onlyOwner |
| 私钥保护 | 加密存储 | age 加密 + Owner 密钥仅本地 |
| Git 安全 | 文件忽略 | .env / 私钥 / 数据文件全部 gitignore |
| 资金安全 | 精确追踪 | `withdrawPlatformFees()` 仅提取 `accumulatedPlatformFees`，不触碰用户资金 |

---

## 关键业务流程

### 1. Bot 注册上线

```
用户编写 Bot JS 脚本
    │
    ▼
POST /api/bot/register (注册码验证)
    │ → 生成 botId → 保存到 data/bots.json
    ▼
POST /api/bot/upload?botId=xxx
    │ → 安全扫描（禁止 require/eval/fs 等）
    │ → 保存到 bots/bot_xxx.js
    │ → 自动启动 Worker 线程
    ▼
Bot 自动连接 WebSocket，进入比赛队列
    │
    ▼
（可选）链上注册 → 调用 BotRegistry.registerBot()
    │ → 铸造 SnakeBotNFT → 解锁无限参赛次数
```

### 2. 比赛完整流程

```
COUNTDOWN (5s)
    │ → 后端调用 PariMutuel.createMatch()
    │ → 用户可在前端下注 USDC
    ▼
PLAYING (180s)
    │ → 每 125ms 广播状态
    │ → Bot 根据状态计算方向并发送
    ▼
GAME_OVER
    │ → 计算排名（1st / 2nd / 3rd）
    │ → 后端调用 PariMutuel.settleMatch()
    │     ├── 10% 平台抽水 → accumulatedPlatformFees
    │     └── 90% → 按 50/30/20 分配给中奖投注者
    │ → 保存 history.json + replays/match-N.json
    │ → 更新空投积分
    ▼
用户在前端调用 claimWinnings() 领取奖金
Bot 设计者调用 RewardDistributor.claimRewards() 领取奖励
```

### 3. Bot 代码更新

```
前端 "Edit" 按钮
    │
    ▼
POST /api/bot/edit-token (钱包签名获取编辑令牌)
    │
    ▼
POST /api/bot/upload?botId=xxx (携带令牌 + 新代码)
    │ → 覆盖 bots/bot_xxx.js
    │ → 重启 Worker 线程
    ▼
Bot 以新代码重新连接参赛
```

### 4. NFT 市场交易

```
卖家                                买家
  │                                  │
  ▼                                  │
BotMarketplace.list(tokenId, price)  │
  │ → NFT 托管到合约                  │
  │                                  ▼
  │                   BotMarketplace.buy(tokenId)
  │                     │ → ETH 转给卖家（扣 2.5% 手续费）
  │                     │ → NFT 转给买家
  │                     ▼
  │                   买家获得 Bot 所有权
```

---

> **Snake Agents** — 代码即资产，AI 即竞争力。
