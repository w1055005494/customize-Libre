// 搜索黑名单：从 /api/blacklist 读取条目（title + mode），先读本地缓存立即可用，
// 再后台刷新；对外提供 ready / filter / isBlocked / refresh / getEntries。
// 接口不可用（未绑定 KV、非 Pages 部署、网络失败）时按空列表处理，不影响搜索。
(function() {
    const CACHE_KEY = 'searchBlacklistCacheV1';
    const API_URL = '/api/blacklist';
    const READY_TIMEOUT = 1500;
    const TITLE_FIELDS = ['vod_name', 'vod_sub', 'vod_en', 'title', 'name'];

    let entries = [];
    let exactTitles = new Set();
    let containsTitles = [];

    // 与搜索一致的归一化：NFKC + 小写 + 去空白
    function normalize(value) {
        return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    }

    // 整理接口/缓存数据为 [{title, mode}]，丢弃非法条目
    function sanitizeEntries(list) {
        if (!Array.isArray(list)) return [];
        const result = [];
        list.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const title = typeof item.title === 'string' ? item.title.trim() : '';
            if (!title) return;
            result.push({
                title: title,
                mode: item.mode === 'contains' ? 'contains' : 'exact'
            });
        });
        return result;
    }

    // 更新内存条目，同时重建匹配索引
    function setEntries(list) {
        entries = list;
        exactTitles = new Set();
        containsTitles = [];
        list.forEach(item => {
            const title = normalize(item.title);
            if (!title) return;
            if (item.mode === 'contains') {
                if (containsTitles.indexOf(title) === -1) containsTitles.push(title);
            } else {
                exactTitles.add(title);
            }
        });
    }

    // 同步读取本地缓存，保证首屏过滤立即可用
    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return sanitizeEntries(parsed.entries);
        } catch (error) {
            return null;
        }
    }

    // 刷新成功后写回缓存，存储不可用时静默忽略
    function writeCache(list) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                fetchedAt: Date.now(),
                entries: list.map(item => ({ title: item.title, mode: item.mode }))
            }));
        } catch (error) {
            // 忽略写入失败（隐私模式、配额不足等）
        }
    }

    // 任一标题字段命中即视为命中：contains 为包含，其余按完全相等
    function isBlocked(item) {
        if (!exactTitles.size && !containsTitles.length) return false;
        if (!item || typeof item !== 'object') return false;
        const texts = TITLE_FIELDS
            .map(field => normalize(item[field]))
            .filter(Boolean);
        if (!texts.length) return false;
        return texts.some(text => {
            if (exactTitles.has(text)) return true;
            return containsTitles.some(keyword => text.indexOf(keyword) !== -1);
        });
    }

    // 过滤结果列表：黑名单为空时原样返回新数组
    function filter(results) {
        const list = Array.isArray(results) ? results : [];
        if (!entries.length) return list.slice();
        return list.filter(item => !isBlocked(item));
    }

    // 后台拉取黑名单，永不 reject；失败时保留当前（缓存）值
    function refresh() {
        return fetch(API_URL, { cache: 'no-store' })
            .then(response => {
                if (!response || !response.ok) return null;
                return response.json();
            })
            .then(data => {
                if (!data || typeof data !== 'object') return entries;
                // 接口可用但未配置 KV：按空列表处理
                const next = data.configured === false ? [] : sanitizeEntries(data.entries);
                setEntries(next);
                writeCache(next);
                return entries;
            })
            .catch(() => entries);
    }

    const cachedEntries = readCache();
    if (cachedEntries) setEntries(cachedEntries);

    // 最多等待 1.5 秒，超时按当前缓存值继续搜索
    const ready = Promise.race([
        refresh(),
        new Promise(resolve => setTimeout(resolve, READY_TIMEOUT))
    ]).catch(() => entries);

    window.SearchBlacklist = {
        ready: ready,
        filter: filter,
        isBlocked: isBlocked,
        refresh: refresh,
        getEntries: function() {
            return entries.map(item => ({ title: item.title, mode: item.mode }));
        }
    };
})();
