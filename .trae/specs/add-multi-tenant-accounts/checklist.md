# Checklist

## 数据与部署
- [ ] `scripts/d1-schema.sql` 在 `wrangler d1 execute` 下可重复执行（`IF NOT EXISTS`），`users.username` 唯一约束生效
- [ ] `scripts/hash-password.mjs` 生成的哈希能被 Workers 端 `verifyPassword` 校验通过
- [ ] README 的多租户部署步骤覆盖 D1 绑定、`SESSION_SECRET`、建表、管理员播种与旧部署迁移
- [ ] 生产代码中无明文密码、无哈希写入日志

## 认证
- [ ] 未登录访问 `/`、`/index.html`、`/player.html` 均 302 到 `/login.html?next=<原路径>`
- [ ] 登录成功后返回 HttpOnly + Secure + SameSite=Lax 的 `ltv_session` Cookie，且 JS 无法读取
- [ ] 错误密码返回 401；15 分钟内连续 5 次失败返回 429；成功登录后计数清零
- [ ] 登出后 Cookie 失效，再访问页面回到登录页
- [ ] 修改密码后旧会话失效，需要用新密码重新登录
- [ ] 被禁用用户的既有会话在下一次请求即失效

## 数据隔离与同步
- [ ] 用户 A 与用户 B 在同一浏览器登录后，自定义源、选中源、观看记录、稍后看互不可见
- [ ] 添加/删除自定义源后 2 秒内发出 `PUT /api/me/state`，刷新后数据仍在
- [ ] 播放进度保存后（30 秒周期）能同步到服务端，换浏览器登录仍可「继续观看」
- [ ] 无会话调用 `/api/me/state` 返回 401 且不返回任何用户数据
- [ ] 首次登录且服务端状态为空时，本机白名单数据被一次性导入并提示
- [ ] 服务端对非白名单键、超过 256KB 的值返回 400

## 页面与前端
- [ ] 中间件注入的 `window.__ACCOUNT__` 包含用户信息与除 `viewingHistory` 外的白名单状态
- [ ] `app.js` 解析阶段能读到注入的 `selectedAPIs`/`customAPIs`，首页源列表显示正确
- [ ] `viewingHistory` 异步就绪后 `libretv:state-ready` 被派发，继续观看区域自动重渲染
- [ ] `js/api.js` 只拦截 `/api/search` 与 `/api/detail`，登录/管理/状态接口正常到达后端
- [ ] 页面不再出现密码弹窗，也不再注入 `PASSWORD` 哈希
- [ ] 页面顶部可见当前用户名、退出登录与修改密码入口

## 管理后台
- [ ] `/admin.html` 仅管理员可访问，普通用户访问被拒绝且不泄露用户列表
- [ ] 管理员可新增用户并立即用新账号登录
- [ ] 新增重复用户名返回 409
- [ ] 管理员可禁用/启用、重置密码、删除用户；删除后 `user_state` 同步清理
- [ ] `/api/admin/*` 在无会话或非管理员时返回 401/403

## 代理与播放
- [ ] 已登录时 `/proxy/<编码URL>` 返回 200，URL 中不含 `auth`、`t` 参数
- [ ] 无会话请求 `/proxy/...` 返回 401，且未向上游发起请求
- [ ] HLS 分片、图片代理、下载功能在多租户模式下正常工作

## 兼容与回归
- [ ] `node server.mjs` + `PASSWORD` 部署下仍显示原密码弹窗，代理鉴权逻辑不变
- [ ] `/api/search`、`/api/detail` 的搜索与详情流程无回归
- [ ] `service-worker.js` 版本号已递增，`/api/auth/`、`login.html`、`admin.html` 不被离线缓存
- [ ] 退出登录或会话过期后，浏览器回退不会看到其他账号的缓存页面内容
