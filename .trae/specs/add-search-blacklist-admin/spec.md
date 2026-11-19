# 搜索结果黑名单管理后台 Spec

## Why

LibreTV 的搜索结果直接来自多个采集源，目前没有任何「内容屏蔽」能力。需要一个管理页面维护黑名单条目，当搜索结果命中黑名单中的剧集时，在展示层直接隐藏这些结果，且改动对全站所有访客生效。

## What Changes

- 新增 Cloudflare KV 存储（绑定名 `BLACKLIST_KV`）保存黑名单文档，全站共享。
- 新增 `GET/PUT /api/blacklist`：公开读取（仅 `title`/`mode`/`id`）、管理员写入。
- 新增 `admin.html` + `js/admin-blacklist.js` 管理页：口令解锁后增删改条目，支持「精确/包含」两种匹配模式。
- 新增 `js/blacklist.js`：加载并缓存黑名单，提供 `filter(results)` 同步过滤能力。
- 修改 [js/app.js](file:///E:/AI/code/LibreTV-main/js/app.js#L864-L873) 的搜索汇总流程：在成人内容过滤之后、分组之前应用黑名单。
- 修改 [js/api.js](file:///E:/AI/code/LibreTV-main/js/api.js#L396-L432)：把 `window.fetch` 拦截收窄到 `/api/search`、`/api/detail`，避免劫持 `/api/blacklist`。
- 新增环境变量 `ADMIN_PASSWORD`，写入接口用常量时间比较校验；未配置时写入返回 503。
- 更新 `README.md`：KV 绑定、`ADMIN_PASSWORD`、管理页入口与验证方法。
- 不改变搜索请求、分组、播放与代理逻辑；被屏蔽条目只是不进入展示分组。

## Impact

- Affected specs：内容审核/展示过滤、管理后台、Cloudflare 部署配置。
- Affected code：
  - 新增：`functions/api/blacklist.js`、`js/blacklist.js`、`js/admin-blacklist.js`、`admin.html`
  - 修改：`js/app.js`（过滤钩子 + 等待黑名单就绪）、`js/api.js`（收窄拦截）、`index.html`（引入 `js/blacklist.js`）、`README.md`
- 部署侧：Cloudflare Pages 需创建 KV 命名空间并以 `BLACKLIST_KV` 绑定；新增 `ADMIN_PASSWORD` 环境变量。
- 不影响：Node `server.mjs`、Vercel、Netlify 部署（无 KV，黑名单接口不可用，前端按空列表处理）。

## 实现要点

### 数据格式（KV key：`search-blacklist:v1`）

```json
{
  "version": 3,
  "updatedAt": 1763000000000,
  "entries": [
    { "id": "uuid", "title": "某剧名", "mode": "exact", "note": "内部备注", "createdAt": 1763 }
  ]
}
```

- `mode`：`exact`（归一化后完全相等，默认）或 `contains`（片名包含该关键词）。
- 归一化规则与现有搜索一致：`NFKC` + 小写 + 去空白。
- 匹配字段沿用 [js/search.js](file:///E:/AI/code/LibreTV-main/js/search.js#L1-L7) 的 `vod_name`/`vod_sub`/`vod_en`/`title`/`name`。

### 接口行为

| 方法与路径 | 鉴权 | 行为 |
| --- | --- | --- |
| `GET /api/blacklist` | 无 | 返回 `{configured, version, updatedAt, entries:[{id,title,mode}]}`，`Cache-Control: public, max-age=60` |
| `GET /api/blacklist?admin=1` | `X-Admin-Password` | 同上并包含 `note`；口令错误返回 401 |
| `PUT /api/blacklist` | `X-Admin-Password` | 校验后整体写入 KV，返回新文档；口令错误 401，未配置 503，格式错误 400 |

写入校验：`entries` 为数组且不超过 1000 条；`title` 去空白后 1–100 字符、禁止控制字符；`mode ∈ {exact, contains}`；`note` 不超过 200 字符；按「归一化 title + mode」去重；`id` 缺失时由服务端生成。

### 展示过滤

- `js/blacklist.js` 在页面加载时拉取一次（内存 + localStorage 缓存 5 分钟，先读缓存再后台刷新），暴露 `window.SearchBlacklist.ready`（Promise）与 `filter(results)`。
- [js/app.js](file:///E:/AI/code/LibreTV-main/js/app.js#L807) 的 `search()` 在开始请求前 `await` 黑名单就绪（最多等 1.5 秒，超时按缓存值继续），确保首屏结果已按黑名单过滤。
- 过滤发生在 `filterYellowContentResults` 之后、`LibreExperience.groupResults` 之前，因此多来源合并卡片若所有来源都命中黑名单即整体消失；同剧不同来源只要有一个来源未命中，仍按原逻辑展示。
- 黑名单接口不可用（未绑定 KV、非 Pages 部署、网络失败）时返回空列表，搜索行为与升级前一致。

### 安全

- `ADMIN_PASSWORD` 只存在服务端环境变量；管理页仅在 `sessionStorage` 保存口令用于当次会话，禁止写入 localStorage。
- 服务端对提供的口令与 `ADMIN_PASSWORD` 分别做 SHA-256 后逐字节常量时间比较；不记录任何口令内容到日志。
- 管理页本身不含敏感数据，未解锁时不展示条目；写入接口才是真正的权限边界。
- 可选加固（不强制）：用 Cloudflare Access 再保护 `/admin.html`。

## ADDED Requirements

### Requirement: 黑名单管理页

系统 SHALL 提供 `/admin.html`，管理员输入 `ADMIN_PASSWORD` 后可查看、新增、修改、删除黑名单条目，并看到当前版本与更新时间。

#### Scenario: 解锁成功
- **WHEN** 管理员输入与 `ADMIN_PASSWORD` 一致的口令
- **THEN** 页面展示全部条目（含备注）与版本号，后续增删改均可保存

#### Scenario: 口令错误
- **WHEN** 输入错误口令
- **THEN** 返回并提示「口令错误」，页面不展示任何条目、不发起写入

#### Scenario: 新增条目
- **WHEN** 管理员填写片名、选择「精确」或「包含」并提交
- **THEN** 条目立即写入 KV，列表出现该条目，`version` 递增

#### Scenario: 重复条目
- **WHEN** 新增与已有条目归一化片名和匹配模式都相同的条目
- **THEN** 接口返回 409 或直接去重，列表不出现重复项

#### Scenario: 参数非法
- **WHEN** 提交空片名、超过 100 字符的片名、非法 `mode` 或超过 1000 条
- **THEN** 返回 400，KV 内容不被修改

#### Scenario: 未配置管理员口令
- **WHEN** Pages 环境未设置 `ADMIN_PASSWORD` 而调用写入接口
- **THEN** 返回 503 并提示需配置环境变量

### Requirement: 搜索结果展示屏蔽

系统 SHALL 在搜索结果进入展示层前剔除命中黑名单的条目。

#### Scenario: 精确匹配
- **WHEN** 黑名单存在 `{title:"某剧名", mode:"exact"}`，搜索结果中出现片名归一化后完全相同的条目
- **THEN** 该条目不出现在搜索结果中，也不参与后续分组

#### Scenario: 包含匹配
- **WHEN** 黑名单存在 `{title:"系列名", mode:"contains"}`，搜索结果中片名包含该关键词
- **THEN** 这些条目全部被隐藏

#### Scenario: 未命中
- **WHEN** 搜索结果的片名与所有黑名单条目不匹配
- **THEN** 结果与过滤前完全一致，数量、排序、筛选都不变

#### Scenario: 多来源合并卡片
- **WHEN** 同一部剧来自 3 个源，其中 2 个源命中黑名单
- **THEN** 只隐藏命中的 2 个来源；如果 3 个源全部命中，则该卡片整体不展示

#### Scenario: 黑名单服务不可用
- **WHEN** KV 未绑定或 `/api/blacklist` 请求失败
- **THEN** 前端按空黑名单处理，搜索仍可正常使用，并在管理页提示未配置

### Requirement: 黑名单读取接口

系统 SHALL 提供公开只读接口供前端拉取黑名单，公开响应 MUST 不包含内部备注。

#### Scenario: 访客读取
- **WHEN** 未登录访客请求 `GET /api/blacklist`
- **THEN** 返回 `{configured:true, version, updatedAt, entries:[{id,title,mode}]}`，不包含 `note`

#### Scenario: 未绑定 KV
- **WHEN** Pages 未绑定 `BLACKLIST_KV`
- **THEN** 返回 `{configured:false, version:0, entries:[]}`，状态码 200

## MODIFIED Requirements

### Requirement: 搜索结果汇总流程

`search()` 的汇总顺序由「成人内容过滤 → 排序 → 分组 → 渲染」调整为「成人内容过滤 → 黑名单过滤 → 排序 → 分组 → 渲染」，并在首次搜索前等待黑名单数据就绪（最多 1.5 秒）。结果计数、筛选栏统计与排序均基于过滤后的结果。

### Requirement: 前端 `/api/*` 拦截

`js/api.js` 的 `window.fetch` 包装只处理 `/api/search` 与 `/api/detail`；其他同源 `/api/*` 请求（含 `/api/blacklist`）走原生 `fetch`。

## REMOVED Requirements

无。
