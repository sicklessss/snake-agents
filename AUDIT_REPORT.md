# Snake Agents 安全审计报告

> 审计日期: 2026-02-24
> 审计范围: server.js (~4500 行), src/App.tsx (~2550 行)

## 概要

| 严重程度 | 数量 |
|----------|------|
| CRITICAL | 3 |
| HIGH | 8 |
| MEDIUM | 8 |
| LOW | 5 |

---

## CRITICAL — 必须立即修复

### C1. 前端 `botId` 未定义变量 — 下注积分记录失败

- **文件**: `src/App.tsx:977`
- **类别**: 代码 Bug
- **状态**: 当前正在影响线上功能

下注成功后调用 `/api/score/bet` 时，传入了未定义的 `botId` 变量：

```javascript
// 当前代码 (bug)
body: JSON.stringify({ address, amount: parseFloat(amount), matchId: mid, botId }),

// 应改为
body: JSON.stringify({ address, amount: parseFloat(amount), matchId: mid, botId: botName }),
```

`botId` 在该作用域内不存在（只有 `botName` 和 `botIdBytes32`），导致传入 `undefined`。后端虽然不会报错，但积分记录中的 botId 字段为空，无法追溯是哪个 bot 的下注。

**修复方案**: 将 `botId` 改为 `botName`。

---

### C2. 积分注册奖励并发竞态 — 可重复领取

- **文件**: `server.js` `awardScore` / 注册流程
- **类别**: 竞态条件 / 经济漏洞

注册奖励的检查和发放不是原子操作：

```javascript
const alreadyClaimed = adUser && adUser.history.some(h => h.type === 'register');
if (!alreadyClaimed) {
    awardScore(ownerAddr, 'register', REGISTER_BONUS, {});  // +200
}
```

两个并发的 `/api/bot/register` 请求可以同时通过 `alreadyClaimed` 检查（两个请求都读到 history 里还没有 `register` 记录），然后各自发放 200 积分。

**利用方式**: 用脚本同时发送 2-5 个注册请求 → 每个都拿到 200 积分 → 一次注册获得 400-1000 积分。

**修复方案**: 在 `awardScore` 内部用同步锁或在写入前再次检查。简单方案：在 `ensureScoreUser` 后立即设置一个 `claiming` 标记。

---

### C3. Bot credit 扣减竞态 — 绕过试用次数限制

- **文件**: `server.js:1886-1893`
- **类别**: 竞态条件

```javascript
if (botMeta.credits <= 0) return { ok: false, reason: 'trial_exhausted' };
botMeta.credits -= 1;  // 非原子: 检查和扣减之间有窗口
```

**利用方式**: 一个只剩 1 次 credit 的 bot，同时发送 20 个 WebSocket join 请求 → 全部通过检查 → credit 被扣到 -19 → 获得 20 次免费游戏。

**修复方案**: 在检查时直接扣减并检查结果：
```javascript
botMeta.credits -= 1;
if (botMeta.credits < 0) { botMeta.credits += 1; return { ok: false }; }
```

---

## HIGH — 尽快修复

### H1. Bot 脚本验证仅靠正则 — 可能被绕过

- **文件**: `server.js:749-774`
- **类别**: 沙盒安全

禁止的模式（`require`, `eval`, `import` 等）只通过正则匹配检测：

```javascript
/\brequire\s*\(/,
/\beval\s*\(/,
/\bFunction\s*\(/,
```

可通过以下方式绕过：
- 字符串拼接: `global['req' + 'uire']('fs')`
- 方括号访问: `this.constructor.constructor('return process')()`
- Unicode 转义: `\u0065val()`

**修复方案**: 使用 AST 解析验证（如 `acorn`）代替正则，或依赖 `isolated-vm` 的沙盒隔离能力而非静态扫描。

---

### H2. Edit token 使用后不销毁 — 1 小时内可反复使用

- **文件**: `server.js` edit-token 逻辑
- **类别**: 认证漏洞

Edit token 创建后存在 `editTokens` Map 中，有效期 1 小时。但上传代码后 token 不被删除，在整个有效期内可以反复修改 bot 代码。

**修复方案**: 在 `/api/bot/upload` 成功后调用 `editTokens.delete(token)`。

---

### H3. 付费参赛不验证 Bot 所有权

- **文件**: `server.js:2881-2962`
- **类别**: 经济漏洞

`/api/competitive/enter` 只检查 bot 是否存在于 `botRegistry`，不检查调用者是否拥有该 bot 的 NFT。

**利用方式**: 任何人可以为别人的 bot 付费报名，导致原主人的 bot 被强制加入比赛。

**修复方案**: 验证 TX 发送者 === bot NFT 的 `ownerOf`。

---

### H4. USDC 无限授权

- **文件**: `src/App.tsx:948`
- **类别**: 资产安全

```javascript
const maxApproval = BigInt('0xfff...fff');
args: [CONTRACTS.pariMutuel, maxApproval],
```

授权了无限 USDC 额度给 PariMutuel 合约。如果合约存在漏洞或被攻击，用户钱包中的**全部 USDC** 都有风险。

**修复方案**: 改为只授权当前下注金额：`args: [CONTRACTS.pariMutuel, usdcAmount]`。

---

### H5. displayMatchId 每日重置碰撞

- **文件**: `server.js:587-590`
- **类别**: 逻辑 Bug

P1/A1 编号每天从 1 重置。`displayIdToMatchId` 映射只保留最近 200 条。当用户查询 "P5" 时，可能返回今天的 P5 也可能返回昨天的 P5（如果缓存中恰好还在）。

影响回放查询、投注匹配。

**修复方案**: displayId 加入日期元素，如 `P0224-5`（2月24日第5场 performance），或使用全局唯一 ID。

---

### H6. 付费参赛记录未持久化

- **文件**: `server.js:2946`
- **类别**: 数据完整性

`room.paidEntries` 只存在内存中。服务器重启 → 所有付费参赛记录丢失 → 用户付了 ETH 但 bot 未入场。

**修复方案**: 将 `paidEntries` 持久化到 `DATA_DIR/paid-entries.json`，启动时恢复。

---

### H7. JSON 数据文件加载无容错

- **文件**: `server.js:229, 267, 540, 560`
- **类别**: 可用性

```javascript
referralData = JSON.parse(fs.readFileSync(REFERRAL_DATA_FILE, 'utf8'));
```

如果文件损坏（磁盘满写入截断、意外中断等），`JSON.parse` 抛异常 → 服务器无法启动 → 完全宕机。

当前受影响的文件：`referrals.json`, `score.json`, `history.json`, `match_counters.json`。

**修复方案**: 每个文件加载都用 try-catch 包裹，失败时回退到空数据并记录告警。

---

### H8. WebSocket 消息无 schema 验证

- **文件**: `src/App.tsx:1182`
- **类别**: 前端健壮性

```javascript
const msg = JSON.parse(e.data);
if (msg.type === 'update') render(msg.state);  // 不验证 state 结构
```

如果服务端发来格式异常的 state（缺少 players 数组、坐标为负数等），canvas 渲染会崩溃，但错误被静默吞掉，用户只看到画面冻结。

**修复方案**: 在渲染前做基本的 schema 检查（`state.players` 是数组、`state.food` 是数组等），异常时显示错误提示。

---

## MEDIUM — 应该修复

### M1. 无 CORS 配置

- **文件**: `server.js` Express 初始化
- **类别**: Web 安全

Express 没有配置 CORS 中间件。默认允许任何域名的 JavaScript 向 API 发请求。恶意网站可以在用户不知情的情况下调用 API（如签到、查询积分等）。

**修复方案**: 添加 `cors` 中间件，白名单只允许自己的域名。

---

### M2. 签名验证时间窗口 5 分钟

- **文件**: `server.js` 多处签名验证
- **类别**: 重放攻击

签到、编辑 token、claim 等功能的签名验证时间窗口为 5 分钟。如果签名被截获，攻击者有 5 分钟可以重放。

影响端点：`/api/bot/edit-token`, `/api/bot/claim`, `/api/score/checkin`, `/api/score/claim-register`。

**修复方案**: 缩短窗口到 60 秒，并记录已使用的签名防止重放。

---

### M3. 推荐记录 TX 验证不严格

- **文件**: `server.js:4072-4106`
- **类别**: 经济漏洞

推荐记录只检查 TX 目标地址是 BotRegistry，不检查是否真的是 `registerBot` 函数调用。任何发到 BotRegistry 合约的 TX（包括只读调用产生的 TX）都能通过验证。

**修复方案**: 解析 TX data 前 4 字节，验证是 `registerBot` 的 function selector。

---

### M4. Player name 潜在 XSS

- **文件**: `src/App.tsx:2497`
- **类别**: XSS（低风险）

```jsx
<span className="fighter-name">{p.name}</span>
```

React 默认会转义 HTML，所以实际风险低。但如果未来有人改用 `dangerouslySetInnerHTML` 或在其他上下文使用 player name，风险会升高。

**修复方案**: 服务端在广播 state 时对 name 做 sanitize。

---

### M5. userScores 内存无限增长

- **文件**: `server.js:300`
- **类别**: 内存泄漏

每个签到过的用户都永久保留在 `userScores` 对象中，无清理机制。每个用户对象包含 total、checkin、最多 100 条 history。

当用户量达到数万时，`score.json` 文件和内存占用会持续增长。

**修复方案**: 定期清理超过 30 天未活跃的用户数据，或改用数据库。

---

### M6. replayFrames 未及时释放

- **文件**: `server.js` Room 类
- **类别**: 内存

比赛结束后 `replayFrames` 数组写入文件，但数组引用在 Room 对象中保留到下一场比赛开始才清空。4 个房间同时保留上一场的帧数据 → 额外数十 MB 内存占用。

**修复方案**: `saveReplay()` 完成后立即 `this.replayFrames = []`。

---

### M7. NFT 购买者可下载 Bot 源码

- **文件**: `server.js:2806-2834`
- **类别**: 知识产权

edit-token 验证的是 NFT 持有者身份。如果用户 A 创建了 bot，用户 B 在市场上购买了 NFT，B 就可以获取 edit-token 并下载 A 写的全部源码。

这可能不是 bug 而是 feature（NFT = 完整所有权），但需要明确产品设计意图。

**如果不希望源码随 NFT 转让**: 记录原始创建者地址，只有创建者能获取 edit-token。

---

### M8. 部分 API 缺少限频

- **文件**: `server.js` 多个 GET 端点
- **类别**: DoS 防护

以下端点没有 rate limit：
- `GET /api/portfolio`（包含链上查询，较重）
- `GET /api/bot/:botId`
- `GET /api/user/bots`
- `GET /api/marketplace/listings`（包含链上查询）
- `GET /api/pari-mutuel/claimable`（包含链上查询）

**修复方案**: 对包含链上查询的端点加 rate limit（如 10 req/min/IP）。

---

## LOW — 有空时优化

### L1. `Math.random()` 生成 ID

- **文件**: `server.js` 多处
- `Math.random()` 不是密码学安全的随机源。对于游戏内 player ID 风险低，但如果用于任何安全敏感场景应改用 `crypto.randomBytes()`。

### L2. 前端 Leaderboard 30 秒刷新

- **文件**: `src/App.tsx:2392`
- 实时对战游戏中 30 秒刷新太慢，建议降到 10 秒。

### L3. NFT Approval 等待最多 20 秒

- **文件**: `src/App.tsx:596-607`
- 出售 Bot 时等待 NFT approval 确认最多轮询 10 次 × 2 秒 = 20 秒。网络拥堵时可能不够，导致后续 list 交易失败。建议增加到 30 次或用 receipt 等待。

### L4. 列表渲染用 array index 做 key

- **文件**: `src/App.tsx` 多处 `.map((item, i) => <li key={i}>)`
- 当列表顺序变化时导致不必要的 DOM 重建。建议用 `address` 或 `botId` 做 key。

### L5. WebSocket 重连可能产生多连接

- **文件**: `src/App.tsx:1162-1189`
- 快速切换 Performance/Competitive 页面时，旧的重连定时器可能在组件卸载后触发，创建重复连接。cleanup 函数设置了 `destroyed=true` 但 setTimeout 回调中的检查可能有竞态。
