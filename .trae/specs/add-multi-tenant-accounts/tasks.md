# Tasks

- [ ] Task 1: 搭建 D1 数据层与部署配置
  - [ ] SubTask 1.1: 新建 `scripts/d1-schema.sql`，创建 `users`（含 `username` 唯一索引、`role`、`status`、`session_version`）、`user_state`（`PRIMARY KEY(user_id,key)`）、`login_attempts`（按用户名+时间窗）三张表
  - [ ] SubTask 1.2: 新建 `scripts/hash-password.mjs`，用 Node `crypto.pbkdf2Sync` 生成与 Workers 端一致的 `pbkdf2$iter$salt$hash` 字符串，并输出可直接执行的播种 SQL
  - [ ] SubTask 1.3: 在 `README.md` 增加「多租户部署」章节：创建 D1、绑定变量名 `DB`、设置 `SESSION_SECRET`、执行 schema、播种管理员、旧单密码部署的迁移步骤

- [ ] Task 2: 实现 Pages Functions 公共认证库
  - [ ] SubTask 2.1: 新建 `functions/_lib/auth.js`：PBKDF2 哈希/校验、HMAC 会话签发与校验、Cookie 读写、`getSessionUser(env, request)`（校验签名、过期、`status`、`session_version`）、`requireUser`/`requireAdmin`、同源校验、统一 JSON 响应
  - [ ] SubTask 2.2: 新建 `functions/_lib/state.js`：状态键白名单（对齐 `CONFIG_STORAGE_KEYS` + `hasSeenDisclaimer`）、`loadState`/`saveState`（单键 upsert）、单值体积上限（256KB）
  - [ ] SubTask 2.3: 新建 `functions/_lib/limiter.js`：基于 `login_attempts` 的登录失败限流（15 分钟 5 次），成功登录清零

- [ ] Task 3: 实现认证接口
  - [ ] SubTask 3.1: `functions/api/auth/login.js`：校验入参 → 限流 → 校验密码 → 签发 Cookie → 返回 `{user}`
  - [ ] SubTask 3.2: `functions/api/auth/logout.js` 与 `functions/api/auth/me.js`
  - [ ] SubTask 3.3: `functions/api/auth/password.js`：校验旧密码 → 更新哈希 → `session_version+1` → 清除 Cookie（强制重新登录）

- [ ] Task 4: 改造页面网关与新增登录/管理页面
  - [ ] SubTask 4.1: 重写 `functions/_middleware.js`：放行 `/api/*`、`/proxy/*` 与静态资源；对 HTML 导航校验会话，未登录 302 到 `login.html?next=`；`/admin.html` 校验 `role=admin`；注入 `window.__ACCOUNT__`（用户 + 除 `viewingHistory` 外的白名单状态）；停止注入 `{{PASSWORD}}` 哈希
  - [ ] SubTask 4.2: 新建 `login.html`：用户名/密码表单，调用 `POST /api/auth/login`，成功后按 `next` 跳转，失败显示错误与限流提示
  - [ ] SubTask 4.3: 新建 `admin.html` 与 `js/admin.js`：用户列表、新增、禁用/启用、重置密码、删除，全部走 `/api/admin/*`，仅管理员可见

- [ ] Task 5: 实现用户状态与管理接口
  - [ ] SubTask 5.1: `functions/api/me/state.js`：`GET` 返回当前用户全部白名单状态，`PUT` 接收 `{updates:{key:value}}` 按单键 upsert；越权/超限返回 400/401
  - [ ] SubTask 5.2: `functions/api/admin/users.js`（列表、新增、用户名冲突 409）
  - [ ] SubTask 5.3: `functions/api/admin/users/[id].js`（改角色/状态、重置密码、删除并清理 `user_state`）

- [ ] Task 6: 前端接入账号与水合同步
  - [ ] SubTask 6.1: 新建 `js/account.js`：解析 `window.__ACCOUNT__` 同步写入 localStorage（先于 `config.js` 加载）、包装 `setItem/removeItem` 做 2 秒防抖回写、`pagehide` 用 `sendBeacon` 兜底、异步拉取 `viewingHistory` 并派发 `libretv:state-ready`、退出登录/修改密码入口、首次登录一次性导入本机旧数据
  - [ ] SubTask 6.2: 在 `index.html`、`player.html` 的业务脚本之前引入 `js/account.js`
  - [ ] SubTask 6.3: `js/password.js`、`js/proxy-auth.js` 增加「存在 `window.__ACCOUNT__` 即让位」分支（不再弹密码框、`addAuthToProxyUrl` 原样返回）；`js/player.js` 的直接密码校验改为会话判断
  - [ ] SubTask 6.4: 收窄 `js/api.js` 的 `window.fetch` 拦截范围为 `/api/search`、`/api/detail`，避免劫持认证/管理接口
  - [ ] SubTask 6.5: `js/ui.js` 监听 `libretv:state-ready` 重渲染继续观看与稍后看；`js/diagnostics.js` 用 `/api/auth/me` 与会话状态替换密码哈希诊断
  - [ ] SubTask 6.6: 改造 `functions/proxy/[[path]].js` 鉴权为会话 Cookie，未认证返回 401；移除 `auth`/`t` 参数校验
  - [ ] SubTask 6.7: 更新 `service-worker.js`（版本号递增、`/api/auth/` 与 `login.html`/`admin.html` 不入缓存），首页顶部加入用户名/退出登录/修改密码入口

- [ ] Task 7: 验证与回归
  - [ ] SubTask 7.1: 用 `wrangler pages dev` + 本地 D1 跑通登录、登出、改密、会话过期
  - [ ] SubTask 7.2: 验证双用户隔离（自定义源、选中源、观看记录、稍后看互不影响）
  - [ ] SubTask 7.3: 验证代理：已登录播放正常、未登录 401、URL 中无 `auth` 参数
  - [ ] SubTask 7.4: 验证管理员权限边界（普通用户访问 `/admin.html` 与 `/api/admin/*` 被拒绝）
  - [ ] SubTask 7.5: 回归非 Pages 部署：`node server.mjs` + `PASSWORD` 下原密码门禁与代理鉴权仍可用；`/api/search`、`/api/detail` 拦截逻辑不变

# Task Dependencies

- Task 2 依赖 Task 1（表结构）
- Task 3、Task 5 依赖 Task 2（认证与状态库）
- Task 4 依赖 Task 2 与 Task 3（网关需要会话能力）
- Task 6 依赖 Task 4 与 Task 5（页面注入的 `__ACCOUNT__` 与状态接口）
- Task 7 依赖 Task 1–6 全部完成
- Task 1 与 Task 2.1/2.2 可并行；Task 4.2（登录页）与 Task 4.3（管理页）可并行；Task 6.4、6.5、6.7 互相独立
