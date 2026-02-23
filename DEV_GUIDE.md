# Snake Agents 开发者指南

> 最后更新: 2026-02-23

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈](#2-技术栈)
3. [项目结构](#3-项目结构)
4. [服务端架构 (server.js)](#4-服务端架构)
5. [前端架构 (App.tsx)](#5-前端架构)
6. [游戏引擎](#6-游戏引擎)
7. [智能合约](#7-智能合约)
8. [API 接口文档](#8-api-接口文档)
9. [WebSocket 协议](#9-websocket-协议)
10. [数据存储](#10-数据存储)
11. [积分系统](#11-积分系统)
12. [推荐系统](#12-推荐系统)
13. [回放系统](#13-回放系统)
14. [Bot 沙盒](#14-bot-沙盒)
15. [部署与运维](#15-部署与运维)

---

## 1. 项目概览

Snake Agents 是一个基于区块链的 AI Bot 对战平台。玩家编写 JavaScript AI 脚本驱动蛇形 Bot 在 30×30 的竞技场中对战。平台集成了 Base Sepolia 链上的 NFT 所有权、USDC 互注投注池、推荐奖励和积分系统。

### 核心功能
- **AI Bot 对战**: 玩家编写 JS 脚本控制蛇，在多人竞技场中自动对战
- **NFT 所有权**: 每个注册的 Bot 对应一个 ERC-721 NFT
- **USDC 投注**: 链上 pari-mutuel 投注系统，用 USDC 预测比赛赢家
- **Bot 交易市场**: NFT 托管式交易市场，支持买卖 Bot
- **积分系统**: 注册、签到、参赛、投注等行为积累积分
- **回放系统**: 比赛录制与回放

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 |
| 钱包连接 | wagmi 2 + viem 2 |
| 后端 | Node.js + Express 4 + ws (WebSocket) |
| 区块链 | Base Sepolia (ethers.js 6) |
| Bot 隔离 | Node.js Worker Threads + isolated-vm |
| 进程管理 | PM2 |
| 构建 | Vite (前端), 无构建 (后端) |

### 关键依赖
```
express         HTTP 服务 + 静态文件
ws              WebSocket 游戏通信
ethers          后端区块链交互
wagmi/viem      前端区块链交互
isolated-vm     Bot 脚本沙盒执行
compression     gzip 响应压缩
```

---

## 3. 项目结构

```
snake-agents/
├── server.js               # 后端入口 (Express + WebSocket + 游戏引擎, ~4500 行)
├── src/
│   ├── App.tsx             # 前端入口 (所有页面组件, ~2550 行)
│   └── contracts.ts        # 合约地址 + ABI 定义
├── dist/                   # Vite 构建输出 (生产静态文件, express.static 指向此目录)
├── public/                 # Vite 源静态资源 (构建时复制到 dist/)
│   ├── SNAKE_GUIDE.md      # 用户可见的游戏指南
│   └── vite.svg            # favicon
├── bots/                   # 用户上传的 Bot 脚本 ({botId}.js)
├── ecosystem.config.js     # PM2 配置
├── package.json
└── vite.config.ts
```

### VPS 数据目录 (与代码分离)
```
/root/snake-data/           # DATA_DIR 环境变量, 独立于代码目录
├── bots.json               # Bot 注册表
├── history.json            # 比赛历史 (最近 500 场)
├── match_counters.json     # 每日比赛计数器 (P/A 编号)
├── score.json              # 积分数据
├── referrals.json          # 推荐关系
├── entry-fee.json          # 动态入场费
├── replay-index.json       # 回放索引
└── replays/                # 比赛回放 (gzip 压缩)
    └── match-{id}.json.gz
```

> **重要**: 数据目录和代码目录分离，避免部署时误删数据。

---

## 4. 服务端架构

`server.js` 是单文件后端，约 4500 行，按以下顺序组织:

| 行范围 | 模块 | 说明 |
|--------|------|------|
| 1-30 | 初始化 | requires, DATA_DIR, 目录创建 |
| 30-70 | 合约 ABI | BotRegistry, SnakeBotNFT, PariMutuel, Marketplace, ReferralRewards |
| 70-100 | 区块链初始化 | ethers provider, signer, 合约实例 |
| 100-160 | 事件轮询 | 每 30s 查询 BotRegistered 事件 |
| 160-390 | Bot 注册表 | botRegistry 对象, 加载/保存, Worker 管理 |
| 390-530 | 服务器设置 | Express, compression, 静态文件, WebSocket |
| 530-690 | 数据管理 | 比赛历史, 计数器, displayId 映射 |
| 690-1480 | **Room 类** | 游戏房间核心逻辑 (详见游戏引擎章节) |
| 1480-1700 | 竞技房管理 | Competitive room, paid entries, auto-fill |
| 1700-2100 | Performance 房 | 多 performance 房间, Normal bot 填充 |
| 2100-2450 | 入场费系统 | 动态定价, 容量管理 |
| 2450-2970 | Bot API | 注册, 上传代码, 编辑 token 等 |
| 2970-3020 | Leaderboard API | 全局/按房间排行 |
| 3020-3340 | Bot 代码管理 | 上传, 读取, 启停 Worker |
| 3340-3530 | 投注 API | 链上投注查询, Portfolio |
| 3530-3760 | 积分 API | 签到, 查询, 排行榜 |
| 3760-3960 | NFT/链上 API | Bot NFT 查询, Marketplace listings |
| 3960-4190 | 推荐系统 | 推荐记录, 统计, claim |
| 4190-4500 | 服务器启动 | HTTP listen, 进程管理, cleanup |

### 核心内存数据结构

```javascript
// Bot 注册表 (持久化到 bots.json)
botRegistry = {
  "bot_abc123": {
    id: "bot_abc123",
    name: "MyAgent",
    owner: "0xaddress",
    botType: "agent",
    credits: 20,         // 试用次数 (注册后 unlimited=true)
    unlimited: false,
    running: false,
    scriptPath: "/root/snake-agents/bots/bot_abc123.js",
    preferredArenaId: "performance-1",
    regCode: "ABC12345", // 注册码
    createdAt: 1708776000000,
  }
}

// 游戏房间
rooms = {
  "performance-1": Room,  // 3 个 performance 房
  "performance-2": Room,
  "performance-3": Room,
  "competitive-1": Room,  // 1 个 competitive 房
}

// 积分 (持久化到 score.json)
userScores = {
  "0xaddress": {
    total: 350,
    checkin: { lastDate: "2026-02-23", streak: 3 },
    history: [
      { type: "checkin", points: 10, ts: 1708776000000, details: {} }
    ]
  }
}

// 比赛历史 (持久化到 history.json, 最近 500 场)
matchHistory = [
  {
    matchId: 418,               // 全局递增 (用于链上结算)
    arenaId: "competitive-1",
    timestamp: "2026-02-23T...",
    winner: "OptimusPrime",
    score: 41,
    participants: ["OptimusPrime", "Tactician", "ApexBot", ...]  // 注册 Bot 名单
  }
]
```

### 链上交易队列

服务端使用顺序交易队列避免 nonce 冲突:

```javascript
txQueue = [{ fn, args, label, retries }]  // FIFO 队列

// 处理流程:
// 1. 获取 pending nonce
// 2. 获取当前 gas price (×2 安全系数)
// 3. 执行交易
// 4. 失败最多重试 3 次
// 5. 逐个处理, 不并发
```

触发场景:
- `startCountdown()` → `pariMutuelContract.createMatch(matchId, startTime)`
- `startGameOver()` → `pariMutuelContract.settleMatch(matchId, [winners])`
- `registerBot()` → `botRegistryContract.createBot(botId, name, creator)`

---

## 5. 前端架构

`src/App.tsx` 是单文件前端，约 2550 行。所有组件在同一文件中定义。

### 组件列表

| 组件 | 行范围 | 功能 |
|------|--------|------|
| `WalletButton` | 104-336 | 钱包连接/断开, USDC winnings claim |
| `BotManagement` | 341-859 | Bot 注册、代码编辑、NFT 出售 |
| `Prediction` | 863-1033 | USDC 投注下注 |
| `CompetitiveEnter` | 1035-1109 | 付费进入竞技场 (0.001 ETH) |
| `GameCanvas` | 1112-1383 | 实时游戏画布 (30×30 canvas) |
| `PointsPage` | 1398-1558 | 积分页: 签到、积分明细、排行榜 |
| `PortfolioPage` | 1582-1834 | 投注仓位、历史、我的 Bot |
| `MarketplacePage` | 1837-1994 | Bot NFT 交易市场 |
| `ReplayPage` | 1996-2328 | 比赛回放播放器 |
| `App` (根组件) | 2342-2548 | 路由、Tab 切换、整体布局 |

### 页面 Tabs

```
Performance | Competitive | Leaderboard | Portfolio | Points | Marketplace | Replays
```

### 布局结构

```
┌──────────────────────────────────────────────────────┐
│ Header: Logo + Tab 按钮 + WalletButton               │
├────────────┬──────────────────────┬──────────────────┤
│ Left Panel │   Center (Canvas)    │  Right Panel     │
│            │                      │                  │
│ BotMgmt    │   GameCanvas         │  Rules /         │
│ Prediction │   (30x30 实时)       │  Leaderboard /   │
│ CompEnter  │                      │  Fighter List    │
│            │                      │                  │
├────────────┴──────────────────────┴──────────────────┤
│ (部分 Tab 使用全宽: Points, Portfolio, Marketplace,   │
│  Replay 等)                                          │
└──────────────────────────────────────────────────────┘
```

### 前端 ↔ 链上交互

前端通过 wagmi/viem 直接与智能合约交互:

| 操作 | 合约 | 方法 |
|------|------|------|
| 注册 Bot | BotRegistry | `registerBot(botId, inviter)` — 0.01 ETH |
| 查询 Bot | BotRegistry | `getBotById(botId)` |
| 查询 NFT | SnakeBotNFT | `botToTokenId(botId)`, `ownerOf(tokenId)` |
| 下注 | PariMutuel | `placeBet(matchId, botId, amount)` — USDC |
| 领奖 | PariMutuel | `claimWinnings(matchId)` |
| 查赔率 | PariMutuel | `getCurrentOdds(matchId, botId)` |
| USDC 授权 | ERC20 (USDC) | `approve(pariMutuel, max)` |
| 出售 Bot | BotMarketplace | `list(tokenId, price)` |
| 购买 Bot | BotMarketplace | `buy(tokenId)` — ETH |
| 取消出售 | BotMarketplace | `cancel(tokenId)` |

---

## 6. 游戏引擎

### Room 类 (server.js ~行 690-1480)

每个房间是一个独立的游戏实例:

```
Room
├── id: "performance-1" | "competitive-1"
├── type: "performance" | "competitive"
├── maxPlayers: 10
├── gameState: "WAITING" → "COUNTDOWN" → "PLAYING" → "GAMEOVER" → "WAITING"
├── players: { [id]: Player }
├── waitingRoom: { [id]: WaitingPlayer }
├── food: [{ x, y }]          // 最多 5 个
├── obstacles: [{ x, y, solid, blinkTimer }]  // 仅 competitive
├── replayFrames: [...]        // 每 tick 记录一帧
└── timerSeconds / turn / epoch
```

### 比赛生命周期

```
WAITING (5s)
  ├─ 等待玩家进入 waitingRoom
  └─ 自动填充 Normal Bot 到 maxPlayers

COUNTDOWN (5s)
  ├─ waitingRoom → players (分配出生点)
  ├─ 创建链上比赛: pariMutuelContract.createMatch()
  └─ 前端显示 "GET READY!"

PLAYING (180s = 3分钟)
  ├─ 每 125ms 一个 tick (8 FPS)
  │   ├─ 移动所有蛇
  │   ├─ 碰撞检测 (墙壁、自身、其他蛇、障碍物)
  │   ├─ 食物拾取 (+1 分, 蛇变长)
  │   ├─ 死亡处理 (24 tick 后移除)
  │   ├─ 记录回放帧
  │   └─ 广播状态给所有 WebSocket 客户端
  ├─ 障碍物生成 (仅 competitive, 每 30 tick)
  └─ 最后一条蛇存活 → 提前结束

GAMEOVER (5s)
  ├─ 保存比赛历史 (含参赛者名单)
  ├─ 保存回放 (gzip 压缩)
  ├─ 链上结算: pariMutuelContract.settleMatch()
  ├─ 发放积分 (参赛、名次奖励)
  └─ 5 秒后 → WAITING
```

### 碰撞规则

| 场景 | 结果 |
|------|------|
| 撞墙 | 死亡 |
| 撞自己 | 死亡 |
| 头撞头 (等长) | 双方死亡 |
| 头撞头 (不等长) | 短蛇死亡, 长蛇存活 |
| 头撞身体 (长蛇吃短蛇) | 短蛇被截断, 长蛇吞噬部分身体变长 |
| 撞障碍物 (solid) | 死亡 |
| 撞障碍物 (blinking) | 可通过 |

### 蛇的 AI 决策

```javascript
// 两类 Bot:
// 1. WebSocket Bot (用户上传脚本): 通过 Worker 线程执行用户代码, 返回 direction
// 2. Normal Bot (系统填充): 使用 flood-fill 算法
//    - 计算每个方向的可达空间
//    - 评分: 空间 × 2 + 食物距离 × 8-3 + 墙壁距离 × -0.3
//    - 选择最高分方向
```

### Canvas 渲染 (前端)

GameCanvas 使用 `<canvas>` 绘制 30×30 网格:
- 网格线: 半透明灰色
- 蛇身: 纯色方块, 头部带字母标识
- 蛇头: 三角形箭头指示方向
- 食物: 自定义 SVG 图标
- 障碍物: 红色 (solid) / 黄色闪烁 (passable)
- Overlay: 倒计时 "GET READY!", 结束 "WINNER"

---

## 7. 智能合约

链: **Base Sepolia** (chainId: 84532)

| 合约 | 地址 | 功能 |
|------|------|------|
| BotRegistry | `0x98B230509E2e825Ff94Ce69aA21662101E564FA2` | Bot 注册, 所有权追踪 |
| SnakeBotNFT | `0x7aC014594957c47cD822ddEA6910655C1987B84C` | ERC-721 Bot NFT |
| PariMutuel | `0x4bcf26A28919bBD30833a022244a3d2819317649` | USDC 投注池, 赔率, 结算 |
| BotMarketplace | `0x690c4c95317cE4C3e4848440c4ADC751781138f8` | NFT 托管交易 (2.5% 手续费) |
| RewardDistributor | `0x6c8d215606E23BBd353ABC5f531fbB0EaEeDe037` | 比赛奖励分发 |
| ReferralRewards | `0xA89FBd57Dd34d89F7D54a1980e6875fee5F2B819` | 推荐奖励领取 (签名验证) |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Base Sepolia 测试 USDC |

### 合约交互流程

```
用户注册 Bot:
  前端 → BotRegistry.registerBot(botId, inviter) {value: 0.01 ETH}
  后端 → BotRegistry.createBot(botId, name, creator) (异步 TX 队列)
  后端 → SnakeBotNFT.mintBotNFT(owner, botId, name) (通过 Registry 内部调用)

用户下注:
  前端 → USDC.approve(PariMutuel, maxUint256)
  前端 → PariMutuel.placeBet(matchId, botIdBytes32, amount)
  前端 → 后端 POST /api/score/bet (获得等额积分)

比赛结算:
  后端 → PariMutuel.createMatch(matchId, startTime) — 倒计时阶段
  后端 → PariMutuel.settleMatch(matchId, [winner1, winner2, winner3]) — 比赛结束

领奖:
  前端 → PariMutuel.claimWinnings(matchId) — 逐场领取 USDC
```

---

## 8. API 接口文档

### Bot 管理

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/bot/register` | 注册新 Bot | 无 (限频 10/min) |
| POST | `/api/bot/upload` | 上传 Bot 代码 | x-edit-token |
| POST | `/api/bot/edit-token` | 获取编辑 token (1h 有效) | 钱包签名 |
| GET | `/api/bot/:botId` | 查询 Bot 元数据 | 无 |
| GET | `/api/bot/:botId/code` | 获取 Bot 代码 | x-edit-token |
| GET | `/api/bot/:botId/credits` | 查询剩余试用次数 | 无 |
| GET | `/api/bot/my-bots` | 按钱包查询 Bot 列表 | x-wallet header |
| GET | `/api/bot/lookup?name=X` | 按名字查找 Bot | 无 |
| GET | `/api/bot/by-name/:name` | 按名字查找 (含 botId) | 无 |
| POST | `/api/bot/start` | 启动 Bot Worker | Admin key |
| POST | `/api/bot/stop` | 停止 Bot Worker | Admin key |
| POST | `/api/bot/topup` | 增加试用次数 | Admin key |
| POST | `/api/bot/register-unlimited` | 标记为无限次 | Admin key |

### 竞技场

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/arena/status` | 所有房间状态 |
| POST | `/api/competitive/enter` | 付费进入竞技场 (0.001 ETH) |
| GET | `/api/competitive/status` | 竞技房状态 |
| GET | `/api/competitive/registered` | 可参赛的注册 Bot 列表 |

### 排行榜

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/leaderboard/global` | 全局 Top 30 |
| GET | `/api/leaderboard/performance` | Performance 房 Top 30 |
| GET | `/api/leaderboard/competitive` | Competitive 房 Top 30 |
| GET | `/api/leaderboard/arena/:arenaId` | 指定房间排行 |

### 投注与资产

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bet/pool` | 当前比赛投注池 |
| GET | `/api/bet/winnings?address=X` | 用户可领奖金 |
| GET | `/api/pari-mutuel/claimable?address=X` | 所有可 claim 的赢利 |
| GET | `/api/portfolio?address=X` | 完整 Portfolio (仓位、历史、Bot) |

### 积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/score/my?address=X` | 我的积分详情 |
| GET | `/api/score/leaderboard` | 积分 Top 50 |
| POST | `/api/score/checkin` | 每日签到 (+10, 第 7 天 +30) |
| POST | `/api/score/bet` | 下注积分奖励 (等额) |
| POST | `/api/score/claim-register` | 领取注册奖励 |

### NFT & 交易

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/onchain-bots?wallet=X` | 钱包拥有的 NFT Bot |
| GET | `/api/bot/onchain/:botId` | 链上 Bot 数据 |
| GET | `/api/bot/nft/:botId` | NFT 元数据 |
| GET | `/api/bot/rewards/:botId` | Bot 待领奖励 |
| GET | `/api/marketplace/listings` | 市场在售列表 |
| POST | `/api/bot/claim` | 链上领取 Bot 所有权 |
| POST | `/api/bot/claim-nft` | 购买后更新所有权 |

### 推荐

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/referral/record` | 记录推荐关系 |
| POST | `/api/referral/my-stats` | 我的推荐统计 (签名认证) |
| POST | `/api/referral/claim-proof` | 获取 claim 签名证明 |
| GET | `/api/referral/info/:address` | 公开推荐信息 |

### 回放

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/replays` | 回放列表 |
| GET | `/api/replay/:matchId` | 获取指定比赛回放 (支持 P/A displayId) |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/history` | 原始比赛历史 |
| POST | `/api/admin/reset-leaderboard` | 清空排行榜 (Admin) |
| GET | `/api/admin/referral-stats` | 推荐系统全局统计 (Admin) |

---

## 9. WebSocket 协议

### 连接

```
ws://host:4001?arenaId=performance-1
```

### 客户端 → 服务端

**加入房间:**
```json
{
  "type": "join",
  "name": "MyBot",
  "botId": "bot_123",
  "botType": "agent",
  "botPrice": 0.01
}
```

**移动指令:**
```json
{
  "type": "move",
  "direction": { "x": 1, "y": 0 }
}
```
方向: `{x:1,y:0}` 右, `{x:-1,y:0}` 左, `{x:0,y:1}` 下, `{x:0,y:-1}` 上

### 服务端 → 客户端

**初始化 (加入成功):**
```json
{
  "type": "init",
  "id": "ws_abc123",
  "botId": "bot_123",
  "gridSize": 30
}
```

**游戏状态更新 (每 125ms):**
```json
{
  "type": "update",
  "state": {
    "matchId": 42,
    "displayMatchId": "P5",
    "arenaId": "performance-1",
    "gameState": "PLAYING",
    "turn": 156,
    "matchTimeLeft": 45,
    "timeLeft": 5,
    "players": [
      {
        "id": "ws_abc",
        "name": "Bot",
        "color": "#FF0000",
        "body": [{ "x": 15, "y": 10 }, { "x": 14, "y": 10 }],
        "direction": { "x": 1, "y": 0 },
        "alive": true,
        "score": 5,
        "length": 8,
        "botType": "agent",
        "botId": "bot_123"
      }
    ],
    "food": [{ "x": 15, "y": 20 }],
    "obstacles": [{ "x": 5, "y": 5, "solid": true }],
    "epoch": 5
  }
}
```

**比赛事件:**
```json
{ "type": "match_start", "matchId": 42, "arenaId": "performance-1" }
{ "type": "match_end", "matchId": 42, "winnerName": "OptimusPrime", "placements": ["bot_1st", "bot_2nd", "bot_3rd"] }
{ "type": "credits", "remaining": 19 }
{ "type": "kicked", "reason": "outbid" }
```

---

## 10. 数据存储

所有持久化数据存储在 `DATA_DIR` (`/root/snake-data/`), 与代码目录 (`/root/snake-agents/`) 分离。

### 文件格式

| 文件 | 格式 | 大小量级 | 说明 |
|------|------|----------|------|
| `bots.json` | JSON object | ~50KB | `{ botId: metadata }` |
| `history.json` | JSON array | ~300KB | 最近 500 场, 新的在前 |
| `score.json` | JSON object | ~100KB | `{ address: { total, history } }` |
| `referrals.json` | JSON object | ~10KB | `{ users, rewards }` |
| `match_counters.json` | JSON object | <1KB | `{ perfCounter, compCounter, date }` |
| `entry-fee.json` | JSON object | <1KB | `{ currentEntryFee }` |
| `replay-index.json` | JSON array | ~50KB | 回放列表索引 |
| `replays/*.json.gz` | gzip JSON | ~27KB/场 | 比赛回放帧数据 |

### 回放帧格式

```json
{
  "matchId": 42,
  "displayMatchId": "P5",
  "arenaId": "performance-1",
  "arenaType": "performance",
  "startTime": "2026-02-23T05:00:00Z",
  "endTime": "2026-02-23T05:03:00Z",
  "winner": "OptimusPrime",
  "winnerScore": 41,
  "frames": [
    {
      "turn": 0,
      "players": [
        {
          "id": "bot_123",
          "name": "OptimusPrime",
          "color": "#FF0000",
          "body": [{ "x": 15, "y": 3 }, { "x": 15, "y": 2 }, { "x": 15, "y": 1 }],
          "alive": true,
          "score": 0
        }
      ],
      "food": [{ "x": 10, "y": 15 }],
      "obstacles": []
    }
  ]
}
```

> **注意**: 回放帧中没有 `direction` 字段。前端通过 `body[0]` 和 `body[1]` 的位置差计算蛇头朝向。

### 每日备份

```bash
# /root/snake-backups/backup.sh (cron 每日 3:00 AM UTC)
tar -czf snake-data-{date}.tar.gz -C /root snake-data \
  --exclude='snake-data/replays/*.json' \
  --exclude='snake-data/replays/*.json.gz'
# 保留 7 天, 自动清理旧备份
```

### 回放清理

```bash
# /root/clean-replays.sh (cron 每日 4:00 AM UTC)
# 删除超过 36 小时的回放文件
```

---

## 11. 积分系统

积分只累加不扣减, 独立于 USDC 投注系统。

### 获取积分的方式

| 行为 | 积分 | 每日上限 |
|------|------|----------|
| 注册 Bot | +200 | 一次性 |
| 每日签到 (第 1-6 天) | +10 | 1 次/天 |
| 第 7 天连续签到 | +30 | 周期性 |
| Bot 参赛 | +5 | 20 次/天 |
| 比赛第 1 名 | +50 | 无 |
| 比赛第 2 名 | +30 | 无 |
| 比赛第 3 名 | +20 | 无 |
| 下注预测 | +等额积分 | 50 次/天 |
| 邀请 L1 (直接推荐) | +100 | 无 |
| 邀请 L2 (间接推荐) | +50 | 无 |

### 积分类型标识

```javascript
SCORE_TYPE_LABELS = {
  register: '注册奖励',
  checkin: '每日签到',
  match_participate: '参赛奖励',
  match_place: '名次奖励',
  bet_activity: '下注奖励',
  referral_l1: '邀请奖励 L1',
  referral_l2: '邀请奖励 L2',
}
```

---

## 12. 推荐系统

两级推荐结构:

```
A 邀请 B → A 获得 L1 奖励 (+100 积分)
B 邀请 C → A 获得 L2 奖励 (+50 积分), B 获得 L1 奖励 (+100 积分)
```

数据结构:
```json
{
  "users": {
    "0xB": { "inviter": "0xA", "registeredAt": 1708776000 },
    "0xC": { "inviter": "0xB", "registeredAt": 1708776000 }
  }
}
```

链上 claim 流程:
1. 后端生成签名证明 (`/api/referral/claim-proof`)
2. 前端提交到 ReferralRewards 合约

---

## 13. 回放系统

### 录制
- 在 `PLAYING` 状态期间, 每个 tick 记录一帧
- 帧数据包含: 所有玩家位置/状态、食物位置、障碍物
- **关键**: body/food/obstacles 使用深拷贝 (`.map()`), 避免引用共享
- 比赛结束后 gzip 压缩存储

### 播放 (前端 ReplayPage)
- 获取回放 JSON, 解析帧数组
- `setInterval` 以 125ms (1x) 或 62ms (2x) 推进帧
- 每帧重绘 canvas, 使用与 GameCanvas 相同的渲染逻辑
- 控制: 播放、暂停、停止(回到第 0 帧)、下一帧、2x 速度

### 保留策略
- `REPLAY_RETENTION_MS`: 36 小时
- 超时回放由 cron 任务清理

---

## 14. Bot 沙盒

用户上传的 Bot 脚本在隔离的 Worker 线程中执行。

### 安全限制

**禁止的代码模式** (静态分析扫描):
- `require()`, `import` — 无模块加载
- `process`, `__dirname`, `__filename` — 无环境访问
- `eval()`, `Function()`, `constructor.constructor` — 无代码生成
- `Proxy`, `Reflect`, `Symbol` — 无元编程

### Bot 脚本接口

```javascript
// Bot 脚本接收游戏状态, 返回移动方向
function move(state) {
  // state.myHead: { x, y }
  // state.myBody: [{ x, y }, ...]
  // state.food: [{ x, y }, ...]
  // state.enemies: [{ body: [{ x, y }], ... }, ...]
  // state.obstacles: [{ x, y, solid }, ...]
  // state.gridSize: 30

  return { x: 1, y: 0 }; // 返回方向向量
}
```

---

## 15. 部署与运维

### 环境变量

```bash
PORT=4001                    # HTTP 端口
DATA_DIR=/root/snake-data    # 数据目录
RPC_URL=https://sepolia.base.org
BACKEND_PRIVATE_KEY=0x...    # 后端钱包 (链上交易签名)
ADMIN_KEY=...                # Admin API 密钥
```

### VPS 信息

```
IP: 107.174.228.72
SSH 端口: 2232
HTTP 端口: 4001
代码目录: /root/snake-agents/
数据目录: /root/snake-data/
备份目录: /root/snake-backups/
```

### PM2 进程

```bash
# 查看状态
pm2 status

# 主进程
snake-agents    # server.js (port 4001)

# 辅助进程
hero-ai         # HERO-AI bot
ws-agent ×8     # WebSocket bot workers (cluster mode)
```

### 部署流程

```bash
# 本地
npm run build                    # Vite 构建前端 → dist/
scp -P 2232 dist/ server.js root@107.174.228.72:/root/snake-agents/

# VPS
pm2 restart snake-agents

# 验证
curl http://localhost:4001       # 检查 HTML
curl http://localhost:4001/api/score/leaderboard  # 检查 API
pm2 logs snake-agents --lines 10  # 检查日志
```

> **注意**: `express.static` 指向 `dist/` 目录。部署时只需更新 `dist/` 和 `server.js`, 然后重启 `snake-agents` 进程。`public/` 仅是 Vite 的源静态资源目录, 不要往里面放构建产物。

### 磁盘使用

```
/root/snake-agents/   ~24GB (含 node_modules, bots/)
/root/snake-data/     ~50MB (数据文件 + 回放)
/root/snake-backups/  ~20MB (7天备份)
```

回放存储估算: ~27KB/场 × ~2100 场/天 = ~55MB/天, 36 小时保留 ≈ ~80MB。
