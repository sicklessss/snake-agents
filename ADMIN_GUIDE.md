# Snake Agents — 管理员使用手册

## 目录

1. [访问 Admin Dashboard](#1-访问-admin-dashboard)
2. [Dashboard 功能概览](#2-dashboard-功能概览)
3. [资金管理](#3-资金管理)
4. [Bot 管理](#4-bot-管理)
5. [日志查看](#5-日志查看)
6. [监控与告警](#6-监控与告警)
7. [环境变量配置](#7-环境变量配置)
8. [VPS 运维](#8-vps-运维)
9. [故障排查](#9-故障排查)

---

## 1. 访问 Admin Dashboard

### 地址

```
https://<你的域名>/admin.html
```

### 登录流程

Admin Dashboard 使用 **Admin Key + TOTP 两步验证**：

**第一步 — 输入 Admin Key**

在密码框中输入 `.env` 中配置的 `ADMIN_KEY` 值，点击 Login。

**第二步 — 输入 TOTP 验证码**（仅在配置了 `ADMIN_TOTP_SECRET` 时出现）

1. 首次登录时页面会显示 QR 码，用 Google Authenticator / Authy 扫描绑定
2. 输入 App 上显示的 6 位数字验证码
3. 验证通过后自动进入 Dashboard

> Session 有效期 24 小时，过期后需重新验证 TOTP。Admin Key 和 TOTP Session 存储在浏览器 `sessionStorage`，关闭标签页即失效。

### 首次配置 TOTP

1. 在 VPS 的 `.env` 中设置 `ADMIN_TOTP_SECRET`（32 字符 base32 密钥）
2. 重启服务
3. 第一次登录时扫描 QR 码绑定 Authenticator

如果不需要 2FA，留空 `ADMIN_TOTP_SECRET` 即可跳过 TOTP 验证步骤。

---

## 2. Dashboard 功能概览

Dashboard 分为两个标签页：**Overview** 和 **Logs**。

### Overview 标签页

#### 统计卡片（顶部）

| 卡片 | 含义 |
|------|------|
| Total Bots | 注册的 bot 总数 |
| Running | 当前运行中的 bot 数（worker 存活） |
| Total Matches | 历史比赛总场次 |
| Users | 不重复的 bot 所有者数 |
| Referrals | 推荐注册用户数 |

#### Fund Management（资金管理）

显示后端钱包和各合约的 ETH/USDC 余额，以及合约中累积的平台手续费。支持通过 MetaMask 直接提现（见[第 3 节](#3-资金管理)）。

#### Arena Status（竞技场状态）

实时显示所有竞技场的状态：

| 列 | 含义 |
|-----|------|
| Arena | 竞技场名称/ID |
| Type | competitive / casual 等 |
| State | waiting / playing / countdown |
| Players | 当前玩家数/最大人数 |
| Time Left | 本局剩余时间（秒） |
| Match | 当前 Match ID |
| Viewers | WebSocket 观众连接数 |

#### Bot Management（Bot 管理）

Bot 列表，每行显示名称、ID、Owner 地址、Credits、类型（user/official）、运行状态。每个 bot 有操作按钮，详见[第 4 节](#4-bot-管理)。

#### Recent Matches（最近比赛）

显示最近 100 场比赛结果，包含获胜者、比分、参与玩家数和时间。

#### Referral Stats（推荐统计）

显示所有通过推荐注册的用户，包含用户地址、邀请人和注册时间。

---

## 3. 资金管理

### 查看余额

1. 点击 **Refresh Balances** 按钮
2. 页面会显示：
   - **Backend Wallet**：后端热钱包的 ETH 余额和地址
   - **BotRegistry**：注册合约的 ETH 和 USDC 余额
   - **PariMutuel**：投注合约的 ETH/USDC 余额及累积平台手续费
   - **BotMarketplace**：市场合约的 ETH 余额及累积手续费

### 提现（MetaMask 直连）

提现不经过服务器，由 **Owner 钱包** 直接调用合约：

1. 点击 **Connect Wallet** → MetaMask 弹窗连接（确保使用 Owner 钱包 `0x335e...`）
2. 各合约卡片上会出现 **Withdraw** 按钮
3. 点击 Withdraw → MetaMask 弹出交易确认 → 签名执行

| 合约 | 调用的函数 |
|------|-----------|
| PariMutuel | `withdrawPlatformFees()` |
| BotMarketplace | `withdrawFees()` |

> 只有 Owner 地址才能执行提现。如果连接的不是 Owner 钱包，交易会 revert。

### 后端热钱包

后端热钱包（`BACKEND_PRIVATE_KEY` 对应的地址）用于：
- 链上注册 bot（`BotRegistry.registerBot`）
- 提交比赛结果（`PariMutuel.resolveMatch`）
- 分发奖励（`RewardDistributor.accumulateReward`）

如果热钱包 ETH 余额低于 0.01 ETH，Telegram 会发送告警。需要手动向该地址转入 ETH 补充 gas。

---

## 4. Bot 管理

### Bot 操作按钮

Dashboard 的 Bot Management 表格中，每个 bot 有以下操作：

| 操作 | 说明 | API |
|------|------|-----|
| Start | 启动 bot worker（开始在竞技场中自动对战） | `POST /api/bot/start` |
| Stop | 停止 bot worker | `POST /api/bot/stop` |
| Top Up | 充值 credits（不限量） | `POST /api/bot/topup` |
| Set Price | 设置 bot 价格（用于 Marketplace 出售） | `POST /api/bot/set-price` |
| Register Unlimited | 标记为无限 credits bot | `POST /api/bot/register-unlimited` |
| Kick | 将 bot 从当前竞技场踢出 | `POST /api/arena/kick` |

### 链上注册

在 Dashboard 中可以手动触发链上 bot 注册：

```
POST /api/admin/create-on-chain
Body: { "botId": "xxx" }
```

这会使用后端热钱包调用 `BotRegistry.registerBot()`，将 bot 注册到链上（铸造 NFT）。

### 重置排行榜

```
POST /api/admin/reset-leaderboard
```

清空内存中的排行榜数据，重新开始统计。

---

## 5. 日志查看

切换到 **Logs** 标签页即可查看服务器实时日志。

### 功能

| 功能 | 说明 |
|------|------|
| 级别过滤 | 下拉框选择：All / Debug / Info / Warn / Error / Important |
| 关键词搜索 | 输入框实时过滤日志内容 |
| 自动刷新 | 勾选后每 5 秒拉取新日志 |
| 手动刷新 | 点击 Refresh 按钮立即拉取 |
| 清除 | 清除当前面板显示（不影响服务器日志） |

### 日志级别

| 级别 | 颜色 | 常见内容 |
|------|------|---------|
| debug | 灰色 | WebSocket 连接、bot 心跳等 |
| info | 白色 | 比赛结果、bot 注册、API 调用 |
| warn | 黄色 | gas 过高跳过、TX 重试、异常情况 |
| error | 红色 | 合约调用 revert、TX 失败、文件 IO 错误 |
| important | 蓝色加粗 | 服务器启动、关键状态变更 |

### 日志保留

- 内存中保留最近 2000 条日志条目
- 每次 API 请求最多返回 500 条
- 服务器重启后内存日志清空

如需持久化日志，请配置 Logtail（见[第 6 节](#6-监控与告警)）。

---

## 6. 监控与告警

### Telegram 告警

配置 `.env` 中的 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID` 后，以下事件会自动发送 Telegram 消息：

| 事件 | 告警内容 | 检查频率 |
|------|---------|---------|
| 服务器启动 | `Server started on port XXXX` | 启动时 |
| ETH 余额不足 | 后端钱包余额 < 0.01 ETH | 每分钟（冷却 1 小时） |
| TX 连续失败 | 连续 > 3 次交易失败 | 每分钟（冷却 10 分钟） |
| 内存使用过高 | heap 使用率 > 80% | 每分钟（冷却 1 小时） |

#### 设置 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`，发送 `/newbot` 创建 bot
2. 获取 Bot Token
3. 创建一个频道或群组，将 bot 加入
4. 获取 Chat ID（可以给 bot 发消息后通过 `getUpdates` API 查看）
5. 填入 `.env`：
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=-100xxxxxxxxxx
   ```

### Logtail (Better Stack)

配置 `LOGTAIL_TOKEN` 后，所有服务器日志会自动同步到 Better Stack，支持：
- 全文搜索历史日志
- 日志持久化存储
- 可视化仪表盘
- 自定义告警规则

#### 设置步骤

1. 注册 [Better Stack](https://betterstack.com/)
2. 创建 Source，获取 Token
3. 填入 `.env`：
   ```
   LOGTAIL_TOKEN=your_token_here
   ```

---

## 7. 环境变量配置

VPS 上 `.env` 文件位于 `/home/snake/snake-agents/.env`。

### 必需变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `BACKEND_PRIVATE_KEY` | 后端热钱包私钥 | `0xabc...` |
| `ADMIN_KEY` | Admin Dashboard 登录密钥 | 任意强密码 |
| `PORT` | 服务监听端口 | `4001` |
| `DATA_DIR` | 数据文件存储目录 | `/home/snake/snake-data` |

### 合约地址

| 变量 | 说明 |
|------|------|
| `BOT_REGISTRY_CONTRACT` | BotRegistry 合约地址 |
| `REWARD_DISTRIBUTOR_CONTRACT` | RewardDistributor 合约地址 |
| `PARIMUTUEL_CONTRACT` | PariMutuel 投注合约地址 |
| `NFT_CONTRACT` | SnakeBotNFT 合约地址 |
| `REFERRAL_CONTRACT` | ReferralRewards 合约地址 |
| `MARKETPLACE_CONTRACT` | BotMarketplace 合约地址 |
| `USDC_ADDRESS` | USDC 代币合约地址 |

### 可选变量

| 变量 | 说明 | 默认值 |
|------|------|-------|
| `BIND_HOST` | 服务器绑定地址 | `0.0.0.0` |
| `ADMIN_TOTP_SECRET` | TOTP 2FA 密钥（32 字符 base32） | 空（不启用 2FA） |
| `ALLOWED_ORIGIN` | CORS 允许的来源域名 | 空（允许所有） |
| `MAX_GAS_GWEI` | Gas 价格上限（gwei） | `50` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOGTAIL_TOKEN` | Better Stack 日志 Token | 空（不启用） |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | 空（不启用） |
| `TELEGRAM_CHAT_ID` | Telegram 告警频道 ID | 空（不启用） |

### 修改 .env 后

```bash
# SSH 到 VPS
ssh -p 2232 root@107.174.228.72

# 编辑 .env
nano /home/snake/snake-agents/.env

# 重启服务使配置生效
su - snake -c 'pm2 restart snake-agents --update-env'
```

---

## 8. VPS 运维

### 服务器信息

| 项目 | 值 |
|------|-----|
| VPS 地址 | `107.174.228.72` |
| SSH 端口 | `2232` |
| 应用用户 | `snake` |
| 应用路径 | `/home/snake/snake-agents/` |
| 数据路径 | `/home/snake/snake-data/` |
| PM2 进程 | `snake-agents`（ID: 0，用户 snake） |
| 应用端口 | `4001` |

### 常用命令

```bash
# SSH 登录
ssh -p 2232 root@107.174.228.72

# 查看服务状态
su - snake -c 'pm2 status'

# 查看实时日志
su - snake -c 'pm2 logs snake-agents --lines 100'

# 重启服务
su - snake -c 'pm2 restart snake-agents'

# 重启并更新环境变量
su - snake -c 'pm2 restart snake-agents --update-env'

# 停止服务
su - snake -c 'pm2 stop snake-agents'
```

### 自动备份

备份脚本位于 `/root/snake-backups/backup.sh`，通过 cron 定时执行，备份 `/home/snake/snake-data/` 目录下的运行时数据。

备份内容包括：
- `bot-registry.json` — Bot 注册数据
- `history*.json` — 比赛历史
- `referral-data.json` — 推荐数据
- `used-tx-hashes.json` — 已使用的交易哈希
- `replays/` — 比赛回放文件

### PM2 日志轮转

已安装 `pm2-logrotate`，配置如下：

| 参数 | 值 |
|------|-----|
| max_size | 10MB（超过后轮转） |
| retain | 保留最近 7 个日志文件 |
| compress | 旧日志 gzip 压缩 |

### 部署新版本

从本地构建并部署到 VPS：

```bash
# 1. 本地构建前端
cd /Users/airdropclaw/.openclaw/workspace-agent-a/snake-agents
npm run build

# 2. 上传文件到 VPS（root 用户中转）
scp -P 2232 -r dist/* root@107.174.228.72:/root/snake-agents/dist/
scp -P 2232 server.js root@107.174.228.72:/root/snake-agents/server.js

# 3. SSH 到 VPS 完成部署
ssh -p 2232 root@107.174.228.72

# 复制到 snake 用户目录
cp -r /root/snake-agents/dist/* /home/snake/snake-agents/dist/
cp /root/snake-agents/server.js /home/snake/snake-agents/server.js
chown -R snake:snake /home/snake/snake-agents/

# 重启服务
su - snake -c 'pm2 restart snake-agents'
```

---

## 9. 故障排查

### 服务无法访问

1. **检查 PM2 进程状态**
   ```bash
   su - snake -c 'pm2 status'
   ```
   如果状态不是 `online`，查看日志找原因：
   ```bash
   su - snake -c 'pm2 logs snake-agents --lines 200 --err'
   ```

2. **检查端口是否监听**
   ```bash
   ss -tlnp | grep 4001
   ```

3. **检查 Cloudflare Tunnel**
   ```bash
   pm2 status  # 查看 cf-tunnel 进程
   ```

4. **检查 .env 配置**
   确认 `PORT=4001` 和 `BIND_HOST=0.0.0.0`。

### 交易失败

1. **Gas 价格过高**
   日志中会显示 `Gas too high ... skipping`。调整 `.env` 中的 `MAX_GAS_GWEI`。

2. **热钱包余额不足**
   检查日志中的 `insufficient funds` 错误。向热钱包地址转入 ETH。

3. **TX 队列堵塞**
   如果多笔交易排队失败，可能是 nonce 问题。重启服务会重置 TX 队列。

### Bot 无法启动

1. **Worker 崩溃** — 查看日志中 `[Worker]` 相关的错误信息
2. **沙盒超时** — Bot 代码执行超时（默认 50ms CPU 时间限制）
3. **Credits 用尽** — 非 unlimited 的 bot 消耗完 credits 后会停止

### 合约调用 Revert

日志中会显示 `revert` 或 `execution reverted`。常见原因：
- 调用者不是授权地址（oracle/operator/owner）
- 合约已暂停（Pausable）
- 参数无效（如 matchId 不存在）

### 内存使用过高

如果 heap 使用率超过 80%（Telegram 告警），可能原因：
- `matchHistory` 数组过大 — 考虑启用 history 按月拆分
- WebSocket 连接数过多 — 检查是否有恶意连接
- 重启服务释放内存：
  ```bash
  su - snake -c 'pm2 restart snake-agents'
  ```
