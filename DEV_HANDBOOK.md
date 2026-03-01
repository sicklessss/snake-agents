# Snake Agents — 开发手册

> 面向接手开发者的完整架构文档。涵盖后端、前端、合约、Bot 系统、部署流程。

---

## 目录

1. [项目概览](#1-项目概览)
2. [文件结构](#2-文件结构)
3. [技术栈](#3-技术栈)
4. [后端架构 (server.js)](#4-后端架构)
5. [GameRoom 游戏引擎](#5-gameroom-游戏引擎)
6. [Bot 沙箱系统](#6-bot-沙箱系统)
7. [区块链集成](#7-区块链集成)
8. [HTTP API 完整列表](#8-http-api-完整列表)
9. [WebSocket 协议](#9-websocket-协议)
10. [前端架构 (App.tsx)](#10-前端架构)
11. [合约体系](#11-合约体系)
12. [数据持久化](#12-数据持久化)
13. [积分与排行榜](#13-积分与排行榜)
14. [部署与运维](#14-部署与运维)
15. [环境变量](#15-环境变量)
16. [关键架构模式](#16-关键架构模式)

---

## 1. 项目概览

Snake Agents 是一个多人贪吃蛇 AI 对战平台，玩家上传 JavaScript 编写的 Bot 脚本，在服务端沙箱中自动对战。平台结合了 Base Sepolia 链上的 NFT 铸造、PariMutuel USDC 下注、积分系统、推荐奖励等 GameFi 元素。

**核心玩法流程：**
1. 用户注册 Bot → 获得 `regCode`
2. 链上 `registerBot()` 付 0.01 ETH → 解锁无限对局
3. 上传 Bot JS 脚本 → 在 `isolated-vm` 沙箱中运行
4. Bot 通过 WebSocket 连接游戏房间，接收状态、发送移动指令
5. 每局 3 分钟，存活最长/最长蛇获胜
6. 观众可用 USDC 对比赛结果下注

---

## 2. 文件结构

```
snake-agents/
├── server.js                 # 主服务器 (~5200 行): 游戏引擎 + API + WS + 区块链
├── sandbox-worker.js         # Bot 沙箱 Worker 线程 (isolated-vm)
├── src/
│   ├── App.tsx               # 整个前端 React 应用 (~2800 行)
│   ├── contracts.ts          # 前端用的合约地址 + ABI
│   ├── index.css             # 全局 CSS (赛博朋克风格)
│   ├── main.tsx              # React 入口
│   └── assets/food.svg       # 食物图标
├── bots/                     # 参考 Bot 实现
│   ├── bot_hero.js           # 完整 HERO-AI (3 阶段策略)
│   ├── bot_apex_v2.js        # Apex v2
│   ├── bot_apex_v3.js        # Apex v3 (极简洪填充)
│   └── bot_apex4k.js         # Apex 4k 变体
├── contracts/                # Solidity 合约源码
│   ├── BotRegistry.sol
│   ├── SnakeAgentsPariMutuel.sol
│   ├── SnakeBotNFT.sol
│   ├── RewardDistributor.sol
│   ├── BotMarketplace.sol
│   └── ReferralRewards.sol
├── artifacts/                # Hardhat 编译产物
├── public/
│   ├── SNAKE_GUIDE.md        # 公开的 Bot 编写指南
│   └── fonts/                # 自托管 Orbitron 字体
├── dist/                     # Vite 构建产物 (部署用)
├── package.json
├── vite.config.ts
├── hardhat.config.js
├── ecosystem.config.js       # PM2 配置
├── deploy-all.js             # 合约部署脚本
├── .env                      # 环境变量 (不入 git)
└── .env.example              # 环境变量模板
```

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| 钱包连接 | wagmi v2 + viem |
| 后端运行时 | Node.js + Express |
| 实时通信 | ws (WebSocket) |
| Bot 沙箱 | worker_threads + isolated-vm |
| 区块链 | Base Sepolia (ethers.js v6) |
| 合约框架 | Hardhat |
| 进程管理 | PM2 |
| 压缩 | compression (gzip) |

---

## 4. 后端架构

`server.js` 是一个约 5200 行的单文件后端，承担所有职责。以下是各区块概览：

### 4.1 启动流程

```
require('dotenv').config()
↓
初始化 logging、atomicWriteFile、DATA_DIR
↓
加载区块链配置 (合约地址、ABI、provider、wallet)
↓
加载持久化数据 (bots.json, history.json, leaderboard-stats.json, ...)
↓
创建 Express app + HTTP server
↓
注册中间件 (compression, static files, CORS, rate-limit)
↓
注册所有 API 路由
↓
创建 WebSocket server (wss)
↓
初始化游戏房间 (performance × N + competitive × 1)
↓
server.listen(PORT)
  → initContracts()
  → resumeRunningBots() (3 秒延迟)
  → 清理旧 replay 文件
```

### 4.2 房间管理

**房间类型：**
- `performance` — 表演赛，最多 6 个房间 (A-F)，每房间 10 人，自动填充 Normal bot
- `competitive` — 竞技赛，1 个房间，10 人，支持付费入场

**自动缩放：** 根据活跃 Agent 数量自动创建/销毁 performance 房间：
```
房间数 = min(6, ceil(agentCount / 8))
```

**竞技场自动填充：** 倒计时阶段 (timerSeconds > 3) 每 2 秒触发一次 `autoFillCompetitiveRoom()`：
1. 优先加入当前比赛已付费的 Bot
2. 用注册 Agent 替换 Normal bot (随机打乱顺序)

### 4.3 Match ID 双轨制

每场比赛有两个 ID：
- **matchId** — 全局自增数字 (用于链上 `createMatch` / `settleMatch`)
- **displayMatchId** — 人类可读 (如 `A5`、`P12`)
  - Performance 房间: `{letter}{counter}` (A1, A2, B1, ...)
  - Competitive 房间: `P{counter}` (P1, P2, ...)

```js
// 双向映射 (保留最近 500 条)
displayIdToMatchId: Map<string, number>
matchIdToDisplayId(matchId): string | null
```

### 4.4 Epoch 系统

```js
const EPOCH_ORIGIN = new Date('2026-02-20T00:00:00Z'); // 上线日期
function getCurrentEpoch() {
    const now = Date.now();
    const diffMs = now - EPOCH_ORIGIN.getTime();
    return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1);
}
```

Epoch 1 = 2026-02-20，每 UTC 日 +1。排行榜按 Epoch 分隔。

### 4.5 顺序交易队列

所有链上写操作通过单一队列顺序执行，防止 nonce 冲突：

```js
enqueueTx(label, fn)          // 推到队尾
enqueueTxPriority(label, fn)  // 推到队首 (用于 createMatch)
enqueueTxAsync(label, fn)     // 返回 Promise
```

**`_drainTxQueue()` 行为：**
- 每次 TX 前读取 `pending` nonce
- gas 设为当前值的 2 倍
- `createMatch`/`settleMatch` 失败自动重试 3 次
- `"already exists"` 视为成功
- `"does not exist"` 视为不可恢复错误

### 4.6 入场费动态调价

```js
let currentEntryFee = 0.01; // ETH
```

当所有 60 个槽位 (6 房间 × 10) 都被当前价格的 Agent 填满时，入场费增加 0.01 ETH。新高价 Agent 可踢走低价 Agent。

---

## 5. GameRoom 游戏引擎

### 5.1 GameRoom 类字段

```js
class GameRoom {
    id           // "performance-A" | "competitive-1"
    type         // "performance" | "competitive"
    letter       // "A"-"F" | null
    maxPlayers   // 10
    clients      // Set<WebSocket> — 所有观众/Bot 连接

    // 游戏状态
    players      // { [id]: PlayerObject }
    food         // [{ x, y }]
    turn         // tick 计数器
    matchTimeLeft// 倒计时 (秒)，初始 180
    waitingRoom  // { [id]: WaitingPlayer } — 下局参与者
    gameState    // "COUNTDOWN" | "PLAYING" | "GAMEOVER"
    winner       // 获胜者名字
    timerSeconds // 当前阶段倒计时
    currentMatchId
    displayMatchId
    nextMatch    // { matchId, displayMatchId, chainCreated }

    // 竞技场专用
    obstacles    // [{ x, y, solid, blinkTimer, fromCorpse }]
    obstacleTick // 障碍物生成计时
    paidEntries  // { displayMatchId: [botId, ...] }
}
```

### 5.2 游戏循环

**两个定时器：**

**Tick 循环 (125ms)：**
```
PLAYING 状态 → tick()
其他状态 → broadcastState()
```

**Timer 循环 (默认 1000ms)：**
```
PLAYING → matchTimeLeft-- (到 0 时调用 endMatchByTime)
GAMEOVER → timerSeconds-- (到 0 时 → startCountdown)
COUNTDOWN → timerSeconds-- (到 0 时 → startGame)
```

### 5.3 状态机

```
COUNTDOWN (5s)
    ↓ startGame()
PLAYING (180s)
    ↓ endMatchByTime() 或 仅剩 1 人时 victoryPause (24 ticks)
GAMEOVER (5s)
    ↓ startCountdown()
COUNTDOWN → ...循环
```

### 5.4 tick() 详解

每个 tick (125ms) 按顺序执行：

1. **Victory Pause** — 如果 `victoryPauseTimer > 0`，递减并返回
2. **障碍物更新** (仅竞技场)
   - 闪烁计时器递减，归 0 后变实体
   - 每 80 tick (10 秒) 生成新障碍物 (BFS 扩展，1-16 格)
3. **Bot 自动 AI** — 无 WebSocket 连接的 bot 使用内置洪填充 AI
4. **食物补给** — 保持场上 `MAX_FOOD` (5) 个食物
   - 竞技场食物上限随时间递减: `ceil(matchTimeLeft / 30) - 1`
5. **蛇移动** — 按方向移动头部、吃食物/长大/加分、HP 消耗
6. **碰撞检测**
   - 撞墙 → 死亡 (`wall`)
   - 撞自己 → 死亡 (`self`)
   - 撞障碍物 → 死亡 (`obstacle`)
   - HP 归零 → 饥饿死亡 (`starvation`)
   - 头对头: 长蛇吃短蛇 (`eaten`)，等长双亡 (`headon`)
   - 头撞身体: 长蛇咬断对方尾巴 (`eaten`)，短蛇撞死 (`collision`)
7. **死亡动画** — 闪烁 24 tick
8. **胜负判定** — 仅剩 1 人 → 胜利暂停；0 人 → 直接结束
9. **广播状态**

### 5.5 HP 系统

- 初始 100 HP
- 每 tick 消耗 1 HP (约 12.5 秒耗尽)
- 吃食物恢复至 100 HP
- HP ≤ 0 → 饥饿死亡

### 5.6 竞技场特有机制

- **障碍物**：每 10 秒生成，出现时先闪烁 2 秒再变实体
- **尸体变障碍**：死蛇身体变成永久障碍物 (除 `eaten` 类型)
- **食物递减**：比赛越接近结束，场上食物越少
- **付费入场**：需要发送 ETH 交易 + 提交 txHash 验证

### 5.7 关键方法一览

| 方法 | 说明 |
|------|------|
| `startLoops()` | 启动两个定时器 |
| `tick()` | 主逻辑循环 |
| `broadcastState()` | 序列化完整状态并推送 |
| `startGame()` | 将 waitingRoom 中的玩家放上棋盘 |
| `startCountdown()` | 重置状态，保留 waitingRoom |
| `startGameOver(survivor)` | 记录历史、保存回放、链上结算、发积分 |
| `endMatchByTime()` | 时间到，最长蛇获胜 |
| `handleJoin(data, ws)` | 验证加入、扣积分、放入 waitingRoom |
| `handleMove(playerId, data)` | 验证方向改变 (不能 180° 掉头) |
| `killPlayer(p, deathType)` | 标记死亡，竞技场尸体变障碍 |
| `saveReplay(survivor)` | gzip 压缩帧数据写入文件 |

---

## 6. Bot 沙箱系统

### 6.1 架构

```
server.js (主线程)
  ├── startBotWorker(botId)
  │     ├── 读取 bots/{botId}.js
  │     ├── scanBotScript() — AST 静态安全扫描
  │     └── new Worker('sandbox-worker.js', { workerData })
  │
  └── sandbox-worker.js (Worker 线程)
        └── isolated-vm Isolate (16MB 内存限制)
              └── Bot JS 脚本在隔离环境中运行
```

### 6.2 安全扫描 (`scanBotScript`)

使用 `acorn` 解析 JS AST，拦截以下内容：
- **禁止调用**: `require`, `import`, `eval`, `Function`, `Proxy`, `Reflect`, `WeakRef`, `FinalizationRegistry`
- **禁止引用**: `process`, `global`, `globalThis`, `__dirname`, `__filename`, `child_process`
- **禁止属性访问**: `.env`, `.exit`, `.kill`, `.mainModule`, `.binding`, `.constructor`, `.__proto__`, `.getPrototypeOf`

### 6.3 沙箱注入的 API

Bot 脚本中可用的全局对象：

| API | 说明 |
|-----|------|
| `WebSocket` | 受限的 WS 类 (仅能连 localhost) |
| `console.log/error/info/warn` | 日志 (转发到主线程) |
| `setTimeout(fn, ms)` | 0-60000ms |
| `setInterval(fn, ms)` | 最短 50ms |
| `clearTimeout/clearInterval` | 清除定时器 |
| `CONFIG.serverUrl` | 本机 WS 地址 (`ws://127.0.0.1:{PORT}?arenaId={id}`) |
| `CONFIG.botId` | Bot 标识符 |

**资源限制：**
- 内存：16MB (isolated-vm 硬限)
- WebSocket 连接数：3
- 定时器上限：100 个
- 回调超时：5 秒
- 初始化超时：30 秒

### 6.4 Bot 通信协议

```javascript
const ws = new WebSocket(CONFIG.serverUrl);

ws.on('open', () => {
    ws.send(JSON.stringify({
        type: 'join',
        name: 'MyBot',
        botType: 'hero',    // 'agent' 或 'hero'
        botId: CONFIG.botId
    }));
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'update') {
        const state = msg.state;
        const me = state.players.find(p => p.botId === CONFIG.botId);
        if (me && me.alive) {
            // 计算下一步方向...
            ws.send(JSON.stringify({
                type: 'move',
                direction: { x: 1, y: 0 } // 右: {1,0} 左: {-1,0} 上: {0,-1} 下: {0,1}
            }));
        }
    }
});
```

### 6.5 Bot 注册表

```js
// DATA_DIR/bots.json
botRegistry = {
    "abc12": {
        id: "abc12",
        name: "MyBot",
        owner: "0x1234...abcd",     // 钱包地址 (小写)
        price: 0,
        botType: "agent",           // "agent" | "hero"
        credits: 20,               // 剩余对局次数 (unlimited 后为 999999)
        unlimited: false,          // 链上注册后为 true
        running: true,             // 是否正在运行
        createdAt: 1708000000000,
        regCode: "A1B2C3",        // 链上注册验证码
        scriptHash: "sha256...",   // 脚本哈希
        lastStarted: 1708000000000,
        roomId: "performance-A"    // 当前分配的房间
    }
}
```

### 6.6 Worker 生命周期

```
startBotWorker(botId)
  → 停止已有同 botId 的 Worker
  → 读取并扫描脚本
  → 创建新 Worker 线程
  → 标记 bot.running = true
  → Worker 发送 status: 'running'
  → 每 10 秒心跳检测
  → 内存超 90% 时警告

stopBotWorker(botId)
  → worker.terminate()
  → 从 activeWorkers 移除
  → 标记 bot.running = false
```

**全局限制：** `MAX_WORKERS = 300`，超出后 performance 房间暂停新 Bot。

---

## 7. 区块链集成

### 7.1 合约地址

| 合约 | 地址 | 用途 |
|------|------|------|
| BotRegistry | `0x98B2...FA2` | Bot 创建/注册 |
| SnakeBotNFT | `0x7aC0...B84C` | ERC721 NFT |
| PariMutuel | `0xeEd4...078d` | USDC 对赌 + Runner Rewards |
| RewardDistributor | `0x6c8d...e037` | 奖励分发 |
| BotMarketplace | `0x690c...38f8` | NFT 市场 |
| ReferralRewards | `0xA89F...B819` | 推荐奖励 |

### 7.2 后端钱包 (Oracle)

通过 `BACKEND_PRIVATE_KEY` 加载，负责：
- `createBot()` — 链上创建 Bot 记录
- `createMatch()` — 创建比赛 (提前创建，以便用户下注)
- `settleMatch()` — 结算比赛 (提交 top-3 排名)

### 7.3 链上事件监听

每 30 秒轮询 `BotRegistered` 事件：
```
BotRegistered(bytes32 botId, address owner)
→ 在本地 botRegistry 中设置 unlimited = true, credits = 999999
```

### 7.4 比赛链上生命周期

```
startGame() → 预创建下下场 createMatch(nextMatchId, startTime)
   ↓
比赛开始后前 10 秒 → 投注窗口开放，用户可 placeBet()
   ↓
10 秒后 → lockBetting()，投注关闭
   ↓
startGameOver() → settleMatch(matchId, winnerBytes32Array)
   ↓
用户调用 claimWinnings() 领取奖金
```

**投注窗口：** 投注仅在比赛开始后的前 10 秒内开放（`matchTimeLeft > MATCH_DURATION - 10`），之后自动锁定。

### 7.5 Runner Rewards（参赛奖励）

PariMutuel 合约将每局赌池的 10% 平台抽成拆分为：
- **5% 平台手续费** — `accumulatedPlatformFees`，owner 可提取
- **5% Runner Rewards** — 分配给参赛 Bot，按名次加权

Bot owner 可通过以下方式领取：
- `claimRunnerRewards(bytes32 botId)` — 领取单个 Bot
- `claimRunnerRewardsBatch(bytes32[] botIds)` — 批量领取

相关 API：
- `GET /api/runner-rewards/stats` — 全局累积 Runner Rewards 总额
- `GET /api/runner-rewards/pending?address=0x...` — 指定钱包下所有 Bot 的待领取奖励

---

## 8. HTTP API 完整列表

### Bot 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/bot/register` | 注册新 Bot 或通过 regCode 认领 |
| `GET` | `/api/bot/my-bots?owner=0x...` | 查询某地址的所有 Bot |
| `GET` | `/api/bot/lookup?name=xxx` | 按名称查找 Bot |
| `GET` | `/api/bot/:botId` | 获取 Bot 元数据 |
| `GET` | `/api/bot/:botId/credits` | 查询剩余次数 |
| `POST` | `/api/bot/upload?botId=xxx` | 上传 Bot 脚本 (需 edit-token) |
| `POST` | `/api/bot/edit-token` | 获取 24h 编辑令牌 (需钱包签名) |
| `GET` | `/api/bot/:botId/code` | 获取 Bot 源码 (需 x-edit-token) |
| `POST` | `/api/bot/start` | 启动 Bot Worker (需 ADMIN_KEY) |
| `POST` | `/api/bot/stop` | 停止 Bot Worker (需 ADMIN_KEY) |
| `POST` | `/api/bot/topup` | 充值次数 (需 ADMIN_KEY) |
| `POST` | `/api/bot/set-price` | 设置 Bot 价格 (需 ADMIN_KEY) |
| `POST` | `/api/bot/register-unlimited` | 授予无限次数 (需 ADMIN_KEY) |
| `POST` | `/api/bot/claim` | 认领未被认领的 Bot (需签名) |
| `POST` | `/api/bot/claim-nft` | NFT 购买后更新本地所有者 |
| `GET` | `/api/bot/by-name/:name` | 按名称查找 (URL 编码) |

### 竞技场

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/arena/status` | 所有房间状态 + Worker 数 |
| `POST` | `/api/arena/join` | 获取 Bot 的 WS 连接地址 |
| `POST` | `/api/arena/kick` | 踢人 (需 ADMIN_KEY) |
| `GET` | `/api/competitive/status` | 竞技场状态 + 入场费 |
| `GET` | `/api/competitive/registered` | 所有已注册 Agent Bot |
| `POST` | `/api/competitive/enter` | 付费入场 (提交 txHash) |

### 排行榜与历史

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/init` | 批量获取: epoch + 表演/竞技排行榜 |
| `GET` | `/api/leaderboard/global` | 总排行 Top 30 |
| `GET` | `/api/leaderboard/performance` | 表演赛总排行 |
| `GET` | `/api/leaderboard/competitive` | 竞技赛总排行 |
| `GET` | `/api/leaderboard/arena/:arenaId` | 单房间排行 |
| `GET` | `/history` | 原始比赛历史数组 |
| `GET` | `/api/match/by-display-id?id=P3` | displayMatchId → 数字 matchId |

### 对赌/投注

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/bet/pool?matchId=123` | 赌池信息 |
| `GET` | `/api/bet/winnings?matchId=123&address=0x...` | 潜在奖金 |
| `GET` | `/api/pari-mutuel/claimable?address=0x...` | 可领取的奖金列表 |
| `GET` | `/api/matches/active` | 所有房间中可下注的比赛列表 |
| `GET` | `/api/portfolio?address=0x...` | 完整投资组合 |
| `POST` | `/api/score/bet` | 下注后领取积分 |

### Runner Rewards（参赛奖励）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/runner-rewards/stats` | Runner Rewards 全局累积总额 |
| `GET` | `/api/runner-rewards/pending?address=0x...` | 指定钱包的待领取奖励 |

### 积分与签到

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/score/my?address=0x...` | 我的积分、排名、签到 |
| `GET` | `/api/score/leaderboard` | 积分 Top 50 |
| `POST` | `/api/score/checkin` | 每日签到 (需签名) |
| `POST` | `/api/score/claim-register` | 领取注册奖励 200 分 (需签名) |

### 推荐

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/referral/my-stats` | 我的推荐统计 (需签名) |
| `POST` | `/api/referral/record` | 记录推荐关系 (TX 证明) |
| `GET` | `/api/referral/info/:address` | 公开推荐信息 |
| `GET` | `/api/referral/claim-proof?address=0x...` | 获取推荐奖励链上领取签名 |

### Admin API（需 ADMIN_KEY + TOTP）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/dashboard-data` | 全量 Dashboard 数据 |
| `GET` | `/api/admin/balances` | 链上合约余额查询 |
| `GET` | `/api/admin/logs?since=ts&level=info` | 服务器日志 |
| `GET` | `/api/admin/referral-stats` | 推荐统计 |
| `GET` | `/api/admin/totp-setup` | TOTP 设置 URI (仅需 ADMIN_KEY) |
| `POST` | `/api/admin/verify-totp` | TOTP 验证码校验 (仅需 ADMIN_KEY) |
| `POST` | `/api/admin/create-on-chain` | 手动触发链上 Bot 创建 |
| `POST` | `/api/admin/reset-leaderboard` | 重置排行榜 |

### 回放

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/replays` | 最近 50 场回放元数据 |
| `GET` | `/api/replay/:matchId` | 完整回放数据 (支持 displayMatchId) |

### NFT / 链上

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/bot/onchain/:botId` | 链上 Bot 信息 |
| `GET` | `/api/user/onchain-bots?wallet=0x...` | NFT 持有的 Bot |
| `GET` | `/api/bot/nft/:botId` | NFT tokenId + tokenURI |
| `GET` | `/api/bot/rewards/:botId` | 待领取奖励 |
| `GET` | `/api/marketplace/listings` | NFT 市场在售列表 |

---

## 9. WebSocket 协议

### 9.1 连接

```
ws://{host}:{port}/ws?arenaId={roomId}
```

连接后自动成为该房间的观众，可接收所有状态广播。

### 9.2 客户端 → 服务器

| type | 字段 | 说明 |
|------|------|------|
| `join` | `name, botType, botId, [price]` | 加入比赛等候室 |
| `move` | `direction: {x, y}` | 移动指令 (不能 180° 掉头) |

### 9.3 服务器 → 客户端

| type | 说明 |
|------|------|
| `update` | 每 tick 完整游戏状态 (见下方结构) |
| `queued` | 加入成功: `{ id, botId, entryPrice }` |
| `init` | 比赛开始时: `{ id, botId, gridSize }` |
| `match_start` | `{ matchId, arenaId, arenaType }` |
| `match_end` | `{ matchId, winnerBotId, winnerName, placements }` |
| `credits` | `{ remaining }` — Agent 进入 performance 房间后 |
| `kicked` | `{ reason: 'outbid' }` — 被高价 Agent 踢出 |

### 9.4 `update` 状态结构

```javascript
{
    matchId: 123,
    arenaId: "performance-A",
    arenaType: "performance",
    gridSize: 30,
    turn: 456,
    gameState: "PLAYING",        // "COUNTDOWN" | "PLAYING" | "GAMEOVER"
    winner: null,
    timeLeft: 3,                 // 当前阶段剩余秒数
    matchTimeLeft: 120,          // 比赛剩余秒数
    players: [{
        id: "abc12",
        name: "MyBot",
        color: "#FF0000",
        body: [{x:5, y:5}, {x:4, y:5}, {x:3, y:5}],
        head: {x:5, y:5},
        direction: {x:1, y:0},
        score: 3,
        hp: 85,
        alive: true,
        blinking: false,
        deathTimer: 0,
        deathType: null,
        length: 3,
        botType: "hero",
        botId: "abc12"
    }],
    waitingPlayers: [...],       // 等候室中的玩家
    food: [{x:10, y:15}],
    obstacles: [{x:20, y:20, solid:true, blinkTimer:0}],  // 仅竞技场
    matchNumber: 5,
    displayMatchId: "A5",
    nextMatch: {
        matchId: 124,
        displayMatchId: "A6",
        chainCreated: true
    },
    epoch: 7,
    victoryPause: false,
    victoryPauseTime: 0
}
```

### 9.5 速率限制

- 每个 WS 连接最多 20 条消息/秒，超出部分丢弃
- 每个 IP 最多 `MAX_WS_PER_IP`（默认 10）个 WebSocket 连接，超限返回 1008 关闭

**IP 检测优先级：** `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` → `remoteAddress`（Cloudflare Tunnel 环境下使用 `cf-connecting-ip` 获取真实客户端 IP）

---

## 10. 前端架构

### 10.1 组件结构 (全在 App.tsx)

```
App
├── 顶部导航: 表演场 | 竞技场 | 排行榜 | 积分 | 市场 | 回放
├── WalletButton (钱包连接/断开/领奖)
│
├── [表演场/竞技场页面]
│   ├── 左栏
│   │   ├── BotManagement (注册/编辑/上传/出售)
│   │   ├── CompetitiveEnter (竞技场付费入场)
│   │   └── Prediction (USDC 下注面板)
│   ├── 中央: GameCanvas (WebSocket + Canvas 渲染)
│   └── 右栏
│       ├── Fighters (实时玩家列表)
│       └── Leaderboard (排行榜 Top 10)
│
├── [排行榜页面] — 表演赛/竞技赛分栏，当前 Epoch / 总榜切换
├── [积分页面] — 我的积分、签到、积分规则、排行榜
├── [市场页面] — NFT 在售列表
├── [投资组合页面] — 活跃仓位、历史、我的 Bot
└── [回放页面] — 回放列表 + Canvas 播放器
```

### 10.2 钱包集成

```typescript
// wagmi v2 配置
chains: [baseSepolia]
connectors: [injected(), metaMask(), coinbaseWallet()]
transport: http('https://sepolia.base.org')
```

**Gas 估算辅助：** 所有链上写操作前调用 `estimateGas()` 并加 30% buffer，解决 OKX 钱包确认按钮灰色问题。

### 10.3 Canvas 渲染

使用原生 `<canvas>` 2D 上下文，支持高 DPR 屏幕：

1. 黑色背景 + 网格线 (蓝色=表演赛, 紫色=竞技赛)
2. 障碍物: 实体=深红色 X 图案 + 红色阴影; 闪烁=黄色动画
3. 食物: SVG 图标或红色圆形
4. 蛇: 身体带名字字母，三角形头部指向移动方向，头上方显示 HP 条
5. 死蛇: 40% 透明度，500ms 闪烁动画

### 10.4 WebSocket 重连

指数退避重连: 1s → 2s → 4s → ... → 16s，断线时显示 "Disconnected — reconnecting..."。

---

## 11. 合约体系

### 11.1 BotRegistry.sol

- `createBot(bytes32 botId, string name, address creator)` — 后端调用
- `registerBot(bytes32 botId, address inviter)` — 用户付 0.01 ETH 注册
- 每个钱包最多注册 5 个 Bot
- 事件: `BotCreated`, `BotRegistered`

### 11.2 SnakeBotNFT.sol (ERC721)

- 注册时自动铸造 NFT
- `botToTokenId(bytes32)` / `tokenIdToBot(uint256)` 双向映射
- `getBotsByOwner(address)` — 枚举
- 支持 `safeTransferFrom` 交易

### 11.3 SnakeAgentsPariMutuel.sol

- `createMatch(uint256 matchId, uint256 startTime)` — Oracle 创建
- `placeBet(uint256 matchId, bytes32 botId, uint256 amount)` — USDC 下注
- `lockBetting(uint256 matchId)` — Oracle 锁定投注（比赛开始 10 秒后）
- `settleMatch(uint256 matchId, bytes32[] winners)` — Oracle 结算 top-3
- `claimWinnings(uint256 matchId)` — 用户领取
- `claimRefund(uint256 matchId)` — 未结算比赛退款
- `emergencyRefundMatch(uint256 matchId)` — Oracle 紧急退款
- `claimRunnerRewards(bytes32 botId)` — Bot owner 领取参赛奖励
- `claimRunnerRewardsBatch(bytes32[] botIds)` — 批量领取
- `withdrawPlatformFees()` — Owner 提取平台手续费 (USDC)
- 抽成分配: 10% 总抽成 = 5% 平台手续费 + 5% Runner Rewards

### 11.4 RewardDistributor.sol

- 累积 ETH 奖励给 Bot
- `pendingRewards(bytes32 botId)` — 待领取金额
- `claimRewards(botId)` / `claimRewardsBatch(botIds)` — 领取
- 最低领取门槛 `MIN_CLAIM_THRESHOLD`

### 11.5 BotMarketplace.sol

- `list(uint256 tokenId, uint256 price)` — NFT 托管到合约
- `buy(uint256 tokenId)` — 付 ETH 购买，NFT 转给买家
- `cancel(uint256 tokenId)` — 取消上架
- 2.5% 手续费

### 11.6 ReferralRewards.sol

- 链下签名 + 链上领取模式
- 后端签名 `(amount, nonce)`, 用户提交链上交易

---

## 12. 数据持久化

所有数据文件存储在 `DATA_DIR` 目录 (默认 `/root/snake-data`)：

| 文件 | 内容 | 写入时机 |
|------|------|----------|
| `bots.json` | Bot 注册表 | 注册/编辑/上传/状态变更时 |
| `history.json` | 最近 5000 场比赛记录 | 每场比赛结束 |
| `leaderboard-stats.json` | 按 Epoch 聚合的胜场统计 | 每 30 秒批量刷盘 |
| `match_counters.json` | 各房间 displayId 计数器 | matchId 递增时 |
| `paid-entries.json` | 竞技场付费入场记录 | 付费入场时 |
| `entry-fee.json` | 当前竞技场入场费 | 费用变化时 |
| `score.json` | 用户积分数据 | 积分变动时 |
| `referrals.json` | 推荐关系 | 新推荐记录时 |
| `replay-index.json` | 回放索引 (最近 200 场) | 保存回放时 |
| `replays/match-{id}.json.gz` | gzip 压缩的帧数据 | 比赛结束时 |
| `replay-purged.flag` | 一次性清理标记 | 首次启动时 |

**写入方式：** 统一使用 `atomicWriteFile()` — 先写 `.tmp` 文件再 `rename`，防止崩溃时数据损坏。

---

## 13. 积分与排行榜

### 13.1 积分来源

| 行为 | 积分 | 限制 |
|------|------|------|
| 首次注册 Bot | +200 | 一次性 |
| 每日签到 | +10 | 每天一次 |
| 连续签到 7 天 | +30 | 7 天后重置连续天数 |
| 比赛参与 (Bot 拥有者) | +5 | 每日上限 20 分 |
| 比赛第 1 名 | +50 | — |
| 比赛第 2 名 | +30 | — |
| 比赛第 3 名 | +20 | — |
| 下注 | +floor(USDC 金额) | 每日上限 50 分 |
| 直接推荐 (L1) | +100 | — |
| 间接推荐 (L2) | +50 | — |

积分只增不减。

### 13.2 排行榜

排行榜基于 `lbStats` 聚合数据，按 Epoch 或全部时间汇总胜场数：

```js
lbStats = {
    perf: { "1": { "BotA": 5, "BotB": 3 }, "2": { ... } },
    comp: { "1": { "BotX": 2 }, ... }
}
```

- 每场胜利通过 `recordWin()` 记录
- 每 30 秒通过 `saveLbStats()` 刷盘
- API 查询时实时聚合排序

---

## 14. 部署与运维

### 14.1 服务器信息

- **IP**: `107.174.228.72`
- **SSH 端口**: `2232`
- **应用路径**: `/home/snake/snake-agents/`（`snake` 用户）
- **数据路径**: `/home/snake/snake-data/`
- **PM2 进程**: `snake-agents` (id: 0, 用户 `snake`)
- **上传中转**: `/root/snake-agents/`（root 用户，scp 上传用）
- **Cloudflare Tunnel**: PM2 进程 `cf-tunnel`，转发到 `127.0.0.1:4001`

### 14.2 构建与部署

```bash
# 1. 本地构建前端
npm run build

# 2. 上传到 root 中转目录
scp -P 2232 -r dist/* root@107.174.228.72:/root/snake-agents/dist/
scp -P 2232 server.js root@107.174.228.72:/root/snake-agents/server.js

# 3. 复制到 snake 用户目录并重启
ssh -p 2232 root@107.174.228.72 "
  cp /root/snake-agents/server.js /home/snake/snake-agents/server.js
  cp -r /root/snake-agents/dist/* /home/snake/snake-agents/dist/
  chown -R snake:snake /home/snake/snake-agents/server.js /home/snake/snake-agents/dist/
  su - snake -c 'pm2 restart snake-agents'
"

# 4. 验证
ssh -p 2232 root@107.174.228.72 "su - snake -c 'pm2 show snake-agents' | grep -E 'status|uptime'"
```

### 14.3 静态资源缓存策略

- `/assets/` 目录 (Vite 哈希文件名): `Cache-Control: public, max-age=31536000, immutable`
- `/assets/*.gz` 预压缩文件: 直接以 `Content-Encoding: gzip` 提供
- `index.html`: `no-cache`

### 14.4 常用运维命令

```bash
# 查看日志
pm2 logs snake-agents --lines 100

# 查看状态
pm2 list

# 重启
pm2 restart snake-agents

# 停止
pm2 stop snake-agents

# 查看内存/CPU
pm2 monit
```

### 14.5 Cloudflare Tunnel

通过 PM2 进程 `cf-tunnel` 运行，提供 HTTPS 域名访问。

---

## 15. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP/WS 监听端口 |
| `BIND_HOST` | `0.0.0.0` | 绑定地址 |
| `ADMIN_KEY` | (无) | 管理 API 密钥 |
| `BACKEND_PRIVATE_KEY` | (无) | 后端钱包私钥 |
| `RPC_URL` | `https://sepolia.base.org` | 区块链 RPC |
| `DATA_DIR` | `/home/snake/snake-data` | 数据存储目录 |
| `LOG_LEVEL` | `info` | 日志级别: debug/info/warn/error |
| `ADMIN_TOTP_SECRET` | (无) | TOTP 2FA 密钥 (32 字符 base32) |
| `ALLOWED_ORIGIN` | `*` | CORS 允许的来源域名 |
| `MAX_GAS_GWEI` | `50` | Gas 价格上限 (gwei) |
| `MAX_WS_PER_IP` | `10` | 每 IP WebSocket 最大连接数 |
| `USDC_ADDRESS` | `0x036C...3dCF7e` | USDC 合约地址 |
| `LOGTAIL_TOKEN` | (无) | Better Stack 日志 Token |
| `TELEGRAM_BOT_TOKEN` | (无) | Telegram 告警 Bot Token |
| `TELEGRAM_CHAT_ID` | (无) | Telegram 告警频道 ID |
| `BOT_REGISTRY_CONTRACT` | (内置) | 覆盖合约地址 |
| `NFT_CONTRACT` | (内置) | 覆盖 NFT 合约 |
| `PARIMUTUEL_CONTRACT` | (内置) | 覆盖 PariMutuel 合约 |
| `REWARD_DISTRIBUTOR_CONTRACT` | (内置) | 覆盖奖励合约 |
| `REFERRAL_CONTRACT` | (内置) | 覆盖推荐合约 |
| `BOT_MARKETPLACE_CONTRACT` | (内置) | 覆盖市场合约 |

---

## 16. 关键架构模式

### 16.1 预创建下一场比赛

`startGame()` 时立即在链上 `createMatch` 下一场，这样用户可以在当前比赛进行时就对下一场下注。

### 16.2 原子文件写入

所有持久化数据使用 `atomicWriteFile()`：写入 `.tmp.{pid}.{counter}` 临时文件后 `rename`，防止进程崩溃导致数据文件损坏。

### 16.3 批量刷盘

排行榜数据通过 `_lbStatsDirty` 标记位 + 30 秒定时器批量写入，避免每场比赛都触发磁盘 I/O。

### 16.4 Bot 信用系统

- 未链上注册的 Bot：每次进入 performance 房间消耗 1 credit (初始 20)
- 链上注册后：`unlimited = true`, `credits = 999999`

### 16.5 Nonce 安全的 TX 队列

所有链上写操作串行执行，每次读取 `pending` nonce，避免因并发或失败重试导致 nonce 冲突。

### 16.6 洪填充 AI 回退

没有 WebSocket 连接的 Bot 使用内置洪填充 AI 自动移动，确保房间内始终有活跃的蛇。评分维度：可达空间、敌人头部危险、食物吸引力、中心偏好、墙壁惩罚。

### 16.7 编辑令牌认证

Bot 代码的读写需要通过钱包签名获取 24 小时有效的编辑令牌，令牌同时验证链上 NFT 所有权。

---

> 最后更新: 2026-02-28
