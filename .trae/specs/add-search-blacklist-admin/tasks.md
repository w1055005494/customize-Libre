# Tasks

- [x] Task 1: 实现黑名单存储与接口
  - [x] SubTask 1.1: 新建 `functions/api/blacklist.js`：`GET` 读取 KV `search-blacklist:v1`，未绑定 `BLACKLIST_KV` 时返回 `{configured:false, version:0, entries:[]}`；公开响应只返回 `id/title/mode`
  - [x] SubTask 1.2: 同文件实现 `PUT`：校验 `X-Admin-Password`（与 `ADMIN_PASSWORD` 各自 SHA-256 后常量时间比较），校验条目结构与数量（≤1000、title 1–100、mode 合法、note ≤200、归一化去重），整体写回 KV 并递增 `version`
  - [x] SubTask 1.3: `GET ?admin=1` 校验口令后返回含 `note` 的完整条目；口令错误 401，未配置 503，参数错误 400

- [x] Task 2: 前端黑名单模块与搜索接入
  - [x] SubTask 2.1: 新建 `js/blacklist.js`：加载 `/api/blacklist`（localStorage 缓存 5 分钟、先缓存后刷新），暴露 `window.SearchBlacklist.ready` 与 `filter(results)`；匹配复用 NFKC + 小写 + 去空白，字段取 `vod_name/vod_sub/vod_en/title/name`
  - [x] SubTask 2.2: 在 `index.html` 的业务脚本之前引入 `js/blacklist.js`
  - [x] SubTask 2.3: 修改 `js/app.js`：`search()` 开始前 `await` 黑名单就绪（最多 1.5 秒），`update()` 中在 `filterYellowContentResults` 之后、排序分组之前调用 `SearchBlacklist.filter`
  - [x] SubTask 2.4: 修改 `js/api.js` 的 `window.fetch` 拦截范围，仅处理 `/api/search` 与 `/api/detail`，其余同源 `/api/*` 走原生请求

- [x] Task 3: 黑名单管理页面
  - [x] SubTask 3.1: 新建 `admin.html`：口令解锁表单 + 条目表格（片名/模式/备注/创建时间）+ 新增表单 + 删除与修改模式操作 + 版本号与更新时间展示
  - [x] SubTask 3.2: 新建 `js/admin-blacklist.js`：口令仅存 `sessionStorage`，带 `X-Admin-Password` 调用 `GET ?admin=1` 解锁与 `PUT` 保存；错误口令、未配置、参数非法、网络失败分别给出提示
  - [x] SubTask 3.3: 新增/删除/切换模式后立即保存并刷新列表，重复条目给出提示，保存中禁用重复提交

- [x] Task 4: 部署配置与文档
  - [x] SubTask 4.1: 在 `README.md` 增加「搜索结果黑名单」章节：创建 KV 命名空间并以 `BLACKLIST_KV` 绑定、设置 `ADMIN_PASSWORD`、管理页路径、生效时间与排障说明
  - [x] SubTask 4.2: 说明非 Cloudflare Pages 部署（Node/Vercel/Netlify）不支持该功能，前端会按空列表降级

- [x] Task 5: 验证
  - [x] SubTask 5.1: 用 `wrangler pages dev --kv BLACKLIST_KV` 本地验证 `GET`/`PUT`/`?admin=1` 的全部状态码
  - [x] SubTask 5.2: 在管理页完成解锁、新增精确条目、新增包含条目、切换模式、删除，确认 KV 文档与列表同步
  - [x] SubTask 5.3: 搜索验证：精确命中、包含命中、未命中、多来源合并卡片只隐藏命中来源、版本缓存 60 秒后更新
  - [x] SubTask 5.4: 回归验证：成人内容过滤、筛选栏统计、排序、`/api/search` 与 `/api/detail` 均不受影响；KV 未绑定时搜索仍正常

# Task Dependencies

- Task 2.3、Task 3 依赖 Task 1（接口）
- Task 2.1 依赖 Task 1.1（响应格式）
- Task 2.4 与 Task 1、Task 2.1–2.3 相互独立
- Task 4 依赖 Task 1 与 Task 3 完成后补充实际路径与提示文案
- Task 5 依赖 Task 1–4 全部完成
- Task 2.2 与 Task 2.3 可在 Task 2.1 完成后并行；Task 3.1 与 Task 3.2 可并行
