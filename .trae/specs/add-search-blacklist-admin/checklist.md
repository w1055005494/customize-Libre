# Checklist

## 后端接口与存储
- [x] 未绑定 `BLACKLIST_KV` 时 `GET /api/blacklist` 返回 200 与 `{configured:false, version:0, entries:[]}`
- [x] 已绑定 KV 时 `GET /api/blacklist` 返回 `id/title/mode`，不包含 `note`
- [x] `GET /api/blacklist?admin=1` 携带正确口令返回含 `note` 的条目，错误口令返回 401
- [x] `PUT /api/blacklist` 在口令错误时返回 401，未配置 `ADMIN_PASSWORD` 时返回 503
- [x] `PUT` 对空片名、超长片名、非法 `mode`、超过 1000 条返回 400，且 KV 未被修改
- [x] 重复条目按归一化片名 + 模式去重，不产生重复项
- [x] 每次成功写入后 `version` 递增、`updatedAt` 更新
- [x] 服务端日志中不出现口令明文或哈希

## 前端过滤
- [x] `js/blacklist.js` 在 `index.html` 中先于 `app.js` 加载
- [x] 黑名单数据优先使用 5 分钟缓存，随后在后台刷新，刷新失败不影响搜索
- [x] 精确模式：片名归一化后完全相等才屏蔽，大小写/空格/全半角差异不影响匹配
- [x] 包含模式：片名包含关键词即屏蔽
- [x] 未命中任何条目时，结果数量、排序、筛选统计与过滤前一致
- [x] 多来源合并卡片：部分来源命中只隐藏对应来源，全部命中则卡片整体消失
- [x] 首次搜索会等待黑名单就绪，最多 1.5 秒，超时按已有缓存继续
- [x] 成人内容过滤仍然生效，且黑名单过滤发生在其之后
- [x] `/api/blacklist` 请求不再被 `js/api.js` 的 fetch 包装劫持；`/api/search`、`/api/detail` 逻辑不变

## 管理页面
- [x] 未输入正确口令时页面不展示任何条目
- [x] 解锁后可看到片名、模式、备注、创建时间、版本号与更新时间
- [x] 新增精确条目与包含条目后立即保存并在列表中出现
- [x] 切换匹配模式后保存成功，列表同步更新
- [x] 删除条目后保存成功，列表中消失
- [x] 口令只保存在 `sessionStorage`，刷新页面需要重新输入，localStorage 中无口令
- [x] 保存失败时给出明确提示，且不会把界面状态误报为成功

## 部署与降级
- [x] README 包含 KV 命名空间创建、`BLACKLIST_KV` 绑定、`ADMIN_PASSWORD` 设置与管理页路径
- [x] 非 Pages 部署下搜索正常，黑名单按空列表处理，管理页提示当前部署不支持
- [x] KV 变更后最多 60 秒内（接口缓存）全站访客生效
