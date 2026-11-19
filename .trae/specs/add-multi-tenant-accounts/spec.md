# 多租户账号体系（用户名/密码 + 独立源与观看记录）Spec

## Why

LibreTV 目前只有一个全站共享访问密码：部署到 Cloudflare Pages 后，任何拿到密码的人都看到同一份数据，系统无法识别「是谁」，也无法为不同人保存不同的自定义源与观看记录。需要改为**用户名 + 密码登录**，每个账号拥有自己独立的源配置与观看记录，账号由管理员在后台录入。

## 可行性分析

### 现状（源码结论）

| 环节 | 现状 | 结论 |
| --- | --- | --- |
| 页面鉴权 | [functions/_middleware.js](file:///E:/AI/code/LibreTV-main/functions/_middleware.js) 把 `PASSWORD`/`PASSWORD_HASH` 的 SHA-256 注入 `window.__ENV__.PASSWORD` | 全站单一密码 |
| 前端校验 | [js/password.js](file:///E:/AI/code/LibreTV-main/js/password.js) 在浏览器比对哈希，结果写 `localStorage.passwordVerified` | 哈希在页面源码可见，可绕过，无法区分用户 |
| 代理鉴权 | [functions/proxy/[[path]].js](file:///E:/AI/code/LibreTV-main/functions/proxy/[[path]].js) 用 URL 参数 `?auth=<sha256(password)>&t=<ts>` 校验 | 哈希出现在 URL 与日志中，共享同一密码 |
| 用户数据 | `customAPIs`、`selectedAPIs`、`viewingHistory`、`watchLaterV1` 等全部在 localStorage | 换设备/清缓存即丢失，多用户在同一浏览器会互相覆盖 |
| 读取时机 | [js/app.js](file:///E:/AI/code/LibreTV-main/js/app.js#L11-L12) 在脚本解析阶段读取 `selectedAPIs`/`customAPIs`；[js/ui.js](file:///E:/AI/code/LibreTV-main/js/ui.js#L446-L480) 在 `DOMContentLoaded` 渲染观看记录 | 服务端数据必须在业务脚本执行前完成水合 |
| 后端能力 | `functions/` 下只有 HTML 注入中间件与静态代理，无 D1/KV 绑定 | 需要新增数据库与接口 |
| fetch 拦截 | [js/api.js](file:///E:/AI/code/LibreTV-main/js/api.js#L396-L432) 把同源**所有** `/api/*` 改写为内置搜索/详情 | 新增 `/api/auth/*` 会被劫持，必须先收窄 |
| Service Worker | [service-worker.js](file:///E:/AI/code/LibreTV-main/service-worker.js) 对 `/api/`、`/proxy/` 仅走网络，页面 network-first | 重定向不会被缓存，基本兼容 |

### 可行性结论

**可行**。Cloudflare Pages 原生支持 Pages Functions 与 D1（SQLite）绑定，可在同一个项目里用：

- D1 存账号、会话版本、每用户键值状态；
- HttpOnly 签名 Cookie 做服务端会话；
- 根级 `_middleware.js` 做 HTML 导航网关 + 首屏数据注入；
- Pages Functions 提供登录、登出、状态同步、管理后台接口。

播放、搜索、代理主体逻辑不需要重写，改动集中在「认证」与「数据同步」两条链路。

### 关键设计决策

1. **存储选 D1**：需要唯一索引、事务、按用户查询；KV 最终一致且无法查询，不采用。
2. **密码哈希**：WebCrypto `PBKDF2-SHA256`（随机盐，迭代次数可配置），存储为 `pbkdf2$<iter>$<salt>$<hash>`。Workers 无原生 bcrypt，不使用 bcrypt。
3. **会话**：无状态 HMAC-SHA256 签名 Cookie `ltv_session`（`HttpOnly; Secure; SameSite=Lax; Path=/`，30 天），载荷含 `uid/role/sessionVersion/exp`。改密、禁用时递增 `session_version`，旧会话立即失效。
4. **代理鉴权改 Cookie**：同源的 `<video>`、HLS 分片、图片请求都会自动带 Cookie，因此代理函数只需校验会话，不再接收 `?auth=哈希`。**（BREAKING）**
5. **数据隔离**：`user_state(user_id, key, value)` 按「用户 + 键」存储，键白名单复用 [js/config-manager.js](file:///E:/AI/code/LibreTV-main/js/config-manager.js#L3-L29) 的 `CONFIG_STORAGE_KEYS`；自定义源与观看记录为必存项，其余偏好顺带同步。
6. **首屏水合**：中间件在 HTML 中注入 `window.__ACCOUNT__`（用户信息 + 除 `viewingHistory` 外的白名单状态），新增 `js/account.js` 置于所有业务脚本之前，同步写入 localStorage，保证 `app.js` 解析时读到正确数据。`viewingHistory` 体积最大（含分集 URL 数组），由 `account.js` 异步拉取后合并，并触发首页「继续观看」重渲染。
7. **写回**：包装 `localStorage.setItem/removeItem`，对白名单键做 2 秒防抖 `PUT /api/me/state`（按单键提交，不整包重写）；`pagehide` 用 `sendBeacon` 兜底；失败保留待同步标记，下次进入页面重试（最后写入胜出）。
8. **兼容范围**：本次只改 Cloudflare Pages。`server.mjs`（Node/Docker）与 Vercel/Netlify 仍走原单密码逻辑——`password.js`、`proxy-auth.js` 检测到 `window.__ACCOUNT__` 时整体让位，其余环境行为不变。

### 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Workers 免费计划 CPU 10ms | PBKDF2 10 万次迭代可能超限 | 迭代次数做成可配置，默认 2 万并在文档写明实测方法；必要时升级 Workers Paid |
| D1 免费额度 10 万行写/天 | 播放器每 30s 保存进度，写量大 | 同步做 2s 防抖 + 单键 upsert；文档给出每活跃用户约 120 次/小时的估算，可调为 60s 节流 |
| 离线 / PWA | 离线期间的修改无法即时上传 | 本地保留待同步标记，恢复在线后补传 |
| 多标签页并发 | 后写覆盖先写 | 保持最后写入胜出，沿用现有 `storage` 事件刷新 UI |
| 首屏注入体积 | 页面变大 | `viewingHistory` 不进 HTML，仅注入小键 |
| 既有本地数据 | 老用户升级后记录仍在本地 | 首次登录且服务端该用户状态为空时，一次性把本机白名单键上传 |

### 非目标

- 不做 OAuth/第三方登录、找回密码邮件、MFA。
- 不做管理员代编辑某用户的源/记录（只做账号管理）。
- 不做多端实时同步（仅进入页面时拉取 + 修改后回写）。
- 不为 Netlify/Vercel/Docker 提供多租户。

## What Changes

- 新增 D1 数据表：`users`、`user_state`、`login_attempts`，并提供建表 SQL 与管理员播种脚本。
- 新增 Pages Functions：`/api/auth/{login,logout,me,password}`、`/api/me/state`、`/api/admin/users`、`/api/admin/users/:id`。
- 重写 [functions/_middleware.js](file:///E:/AI/code/LibreTV-main/functions/_middleware.js)：HTML 导航鉴权、`/admin.html` 角色校验、注入 `window.__ACCOUNT__`、停止注入 `PASSWORD` 哈希。
- 改造 [functions/proxy/[[path]].js](file:///E:/AI/code/LibreTV-main/functions/proxy/[[path]].js)：鉴权从查询参数哈希改为会话 Cookie。**（BREAKING）**
- 新增 `login.html`（登录页）、`admin.html` + `js/admin.js`（用户管理后台）。
- 新增 `js/account.js`：首屏水合、修改回写、退出登录/改密入口、一次性导入本机旧数据。
- 收窄 [js/api.js](file:///E:/AI/code/LibreTV-main/js/api.js) 的 fetch 拦截到 `/api/search`、`/api/detail`。
- 调整 [js/password.js](file:///E:/AI/code/LibreTV-main/js/password.js)、[js/proxy-auth.js](file:///E:/AI/code/LibreTV-main/js/proxy-auth.js)：存在 `window.__ACCOUNT__` 时不再启用单密码门禁、不再拼 `auth` 参数。
- 更新 `service-worker.js` 缓存版本与排除规则、`README.md` 部署与迁移说明。
- 移除 Pages 上的页面级密码注入（`{{PASSWORD}}`）。

## Impact

- Affected specs：认证与会话、用户数据持久化、代理鉴权、管理后台、部署配置。
- Affected code：`functions/**`、`js/api.js`、`js/password.js`、`js/proxy-auth.js`、`js/ui.js`（记录重渲染钩子）、`index.html`、`player.html`、`service-worker.js`、`scripts/*`、`README.md`。
- 部署侧：需在 Cloudflare Pages 创建 D1 数据库并绑定为 `DB`，新增环境变量 `SESSION_SECRET`；D1 建表与播种管理员需执行一次 `wrangler d1 execute`。

## ADDED Requirements

### Requirement: 用户名密码登录与会话

系统 SHALL 提供 `/login.html` 登录页与 `POST /api/auth/login`，校验 D1 中的账号并下发 HttpOnly 会话 Cookie；未登录的 HTML 导航 MUST 被重定向到登录页。

#### Scenario: 未登录访问首页
- **WHEN** 浏览器无有效会话访问 `/`
- **THEN** 返回 302 到 `/login.html?next=%2F`，登录成功后回到原路径

#### Scenario: 登录成功
- **WHEN** 提交正确的用户名与密码
- **THEN** 返回 200 与用户信息，并在响应中 `Set-Cookie: ltv_session=...; HttpOnly; Secure; SameSite=Lax; Path=/`

#### Scenario: 登录失败与限流
- **WHEN** 同一用户名 15 分钟内连续 5 次密码错误
- **THEN** 返回 429 并提示稍后再试；成功登录后清空失败计数

#### Scenario: 退出登录
- **WHEN** 已登录用户调用 `POST /api/auth/logout`
- **THEN** Cookie 被清除，再次访问页面回到登录页

#### Scenario: 会话失效
- **WHEN** 用户被管理员禁用或修改了密码
- **THEN** 其已签发的会话在下一次请求时被判定无效并跳转登录页

### Requirement: 用户数据隔离与同步

系统 SHALL 以 `user_state` 按用户隔离保存自定义源（`customAPIs`）、选中源（`selectedAPIs`）、观看记录（`viewingHistory`）、稍后看（`watchLaterV1`）及白名单内的偏好键，并在页面加载时完成水合、在修改后回写。

#### Scenario: 两个用户互不影响
- **WHEN** 用户 A 与用户 B 在同一浏览器先后登录并各自添加自定义源
- **THEN** A 只看到自己的源列表，B 登录后看到自己的源列表，且各自首页继续观看互不出现对方记录

#### Scenario: 修改后服务端持久化
- **WHEN** 已登录用户添加/删除自定义源或产生播放进度
- **THEN** 2 秒内发出 `PUT /api/me/state`，刷新页面或换设备登录后数据仍存在

#### Scenario: 首次登录导入本机旧数据
- **WHEN** 用户首次登录且服务端该用户状态为空，而本机 localStorage 已有白名单数据
- **THEN** 系统把本机数据上传为该账号的初始状态，并提示已导入

#### Scenario: 未授权访问数据接口
- **WHEN** 无有效会话请求 `/api/me/state`
- **THEN** 返回 401，不泄露任何用户数据

### Requirement: 管理后台录入用户

系统 SHALL 提供 `/admin.html` 管理页与管理员接口，支持用户列表、新增、禁用/启用、重置密码、删除；仅 `role=admin` 可访问。

#### Scenario: 管理员新增用户
- **WHEN** 管理员填写用户名与密码提交
- **THEN** 新用户创建成功（默认 `role=user`、`status=active`），可立即在登录页登录

#### Scenario: 普通用户访问后台
- **WHEN** `role=user` 的用户访问 `/admin.html` 或调用 `/api/admin/*`
- **THEN** 返回 403（页面回首页并提示无权限），不返回用户列表

#### Scenario: 禁用与删除
- **WHEN** 管理员禁用某用户
- **THEN** 该用户旧会话立即失效、登录被拒绝；删除用户时其 `user_state` 一并清理

#### Scenario: 用户名冲突
- **WHEN** 新增或重命名时用户名已存在
- **THEN** 返回 409 并提示用户名已被占用

### Requirement: 代理请求使用会话鉴权

`/proxy/*` MUST 用会话 Cookie 校验，未认证返回 401；请求 URL 中不再出现密码哈希。

#### Scenario: 已登录播放
- **WHEN** 已登录用户播放视频，播放器通过 `/proxy/<编码URL>` 拉取 m3u8 与分片
- **THEN** 请求不携带 `auth` 参数，代理返回 200 并按原逻辑转发/过滤

#### Scenario: 未登录直接调用代理
- **WHEN** 无会话请求 `/proxy/...`
- **THEN** 返回 401 JSON，不发起任何上游请求

### Requirement: 兼容非 Pages 部署

非 Cloudflare Pages 部署（`server.mjs`、Netlify、Vercel）SHALL 继续使用原有单密码逻辑。

#### Scenario: Docker 部署升级后仍可访问
- **WHEN** 使用 `server.mjs` 部署并设置 `PASSWORD`
- **THEN** 页面仍显示原密码弹窗，代理仍校验 `auth` 哈希，行为与升级前一致

## MODIFIED Requirements

### Requirement: 页面鉴权

由「页面内比对全站密码哈希」改为「服务端会话网关」：Cloudflare Pages 的 HTML 导航先经 `_middleware.js` 校验会话，通过后再注入当前用户信息与状态；未通过直接 302 到登录页，不再向前端暴露任何密码哈希。

### Requirement: 首页与播放页初始化

`index.html`、`player.html` MUST 在业务脚本之前加载 `js/account.js`；`app.js` 读取 `selectedAPIs`/`customAPIs` 的时机不变，由水合保证数据已就绪；`viewingHistory` 异步就绪后 MUST 触发 `libretv:state-ready` 事件，由 `ui.js` 重渲染继续观看与稍后看。

## REMOVED Requirements

### Requirement: Pages 上的全站密码注入

**Reason**：共享密码无法区分用户，且哈希暴露在页面源码中可被绕过。
**Migration**：部署后执行 D1 建表SQL，播种一个管理员账号；管理员在 `/admin.html` 为每个使用者创建账号。`PASSWORD`/`PASSWORD_HASH` 在 Pages 上不再参与登录；其他部署平台保留原逻辑。
