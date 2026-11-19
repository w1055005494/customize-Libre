// functions/api/blacklist.js
//
// 搜索结果黑名单接口（仅在 Cloudflare Pages 上启用）。
// 依赖两个绑定（在 Pages 项目「设置 → 函数」中配置）：
// - BLACKLIST_KV：KV 命名空间，存放全站共享的黑名单文档
// - ADMIN_PASSWORD：管理页写入口令，与站点访问密码 PASSWORD 相互独立
//
// 接口行为：
// - GET /api/blacklist           公开读取，仅返回 id/title/mode
// - GET /api/blacklist?admin=1   校验 X-Admin-Password，返回含 note 的完整文档
// - PUT /api/blacklist           校验 X-Admin-Password，校验后整体写入 KV

const KV_KEY = 'search-blacklist:v1';
const MAX_ENTRIES = 1000;
const MAX_TITLE_LENGTH = 100;
const MAX_NOTE_LENGTH = 200;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_MODES = ['exact', 'contains'];

export async function onRequest(context) {
    const { request, env } = context;
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (method === 'GET') {
        if (url.searchParams.get('admin') === '1') {
            return handleAdminGet(request, env);
        }
        return handlePublicGet(env);
    }

    if (method === 'PUT') {
        return handlePut(request, env);
    }

    return jsonResponse({ error: '不支持的请求方法' }, 405, { 'Allow': 'GET, PUT' });
}

// 归一化：与前端搜索/匹配规则保持一致
function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// 统一的 JSON 响应
function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...headers
        }
    });
}

// 管理员接口统一不缓存（含错误响应）
function adminResponse(body, status = 200) {
    return jsonResponse(body, status, { 'Cache-Control': 'no-store' });
}

// 计算 SHA-256 十六进制字符串
async function sha256Hex(value) {
    const data = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 常量时间比较两个十六进制摘要，避免根据比较耗时推测口令
async function passwordMatches(provided, expected) {
    const [providedHash, expectedHash] = await Promise.all([
        sha256Hex(provided),
        sha256Hex(expected)
    ]);
    if (providedHash.length !== expectedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < providedHash.length; i++) {
        diff |= providedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }
    return diff === 0;
}

// 管理员鉴权：先确认绑定与环境变量，再常量时间比较口令
async function checkAdmin(request, env) {
    if (!env.BLACKLIST_KV) {
        return { ok: false, status: 503, error: '未绑定 BLACKLIST_KV' };
    }
    if (!env.ADMIN_PASSWORD) {
        return { ok: false, status: 503, error: '未配置 ADMIN_PASSWORD' };
    }
    const provided = request.headers.get('X-Admin-Password') || '';
    const matched = await passwordMatches(provided, env.ADMIN_PASSWORD);
    if (!matched) {
        return { ok: false, status: 401, error: '口令错误' };
    }
    return { ok: true };
}

// 空文档（未绑定 KV、KV 无数据或数据损坏时使用）
function emptyDocument() {
    return { version: 0, updatedAt: 0, entries: [] };
}

// 从 KV 读取文档；数据缺失或 JSON 损坏时返回空文档，KV 读取异常向上抛出
async function readDocument(env) {
    const raw = await env.BLACKLIST_KV.get(KV_KEY);
    if (!raw) return emptyDocument();
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyDocument();
        return {
            version: Number.isFinite(parsed.version) ? parsed.version : 0,
            updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
            entries: Array.isArray(parsed.entries) ? parsed.entries : []
        };
    } catch (error) {
        console.error('解析黑名单数据失败:', error.message);
        return emptyDocument();
    }
}

// 公开响应：去掉 note，只保留安全字段
function toPublicEntry(entry) {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
        id: typeof item.id === 'string' ? item.id : '',
        title: typeof item.title === 'string' ? item.title : '',
        mode: item.mode === 'contains' ? 'contains' : 'exact'
    };
}

// GET /api/blacklist：公开读取
async function handlePublicGet(env) {
    if (!env.BLACKLIST_KV) {
        return jsonResponse({
            configured: false,
            version: 0,
            updatedAt: 0,
            entries: []
        }, 200, { 'Cache-Control': 'public, max-age=60' });
    }

    try {
        const doc = await readDocument(env);
        return jsonResponse({
            configured: true,
            version: doc.version,
            updatedAt: doc.updatedAt,
            entries: doc.entries.map(toPublicEntry)
        }, 200, { 'Cache-Control': 'public, max-age=60' });
    } catch (error) {
        console.error('读取黑名单失败:', error.message);
        return jsonResponse({ error: '读取黑名单失败' }, 500);
    }
}

// GET /api/blacklist?admin=1：管理员读取完整文档
async function handleAdminGet(request, env) {
    const auth = await checkAdmin(request, env);
    if (!auth.ok) {
        return adminResponse({ error: auth.error }, auth.status);
    }

    try {
        const doc = await readDocument(env);
        return adminResponse({
            configured: true,
            version: doc.version,
            updatedAt: doc.updatedAt,
            entries: doc.entries
        });
    } catch (error) {
        console.error('读取黑名单失败:', error.message);
        return adminResponse({ error: '读取黑名单失败' }, 500);
    }
}

// 校验并整理写入的条目；失败时返回 { error }
function validateEntries(input) {
    if (!input || typeof input !== 'object') {
        return { error: '请求体必须是 JSON 对象' };
    }
    if (!Array.isArray(input.entries)) {
        return { error: 'entries 必须是数组' };
    }
    if (input.entries.length > MAX_ENTRIES) {
        return { error: `entries 不能超过 ${MAX_ENTRIES} 条` };
    }

    const entries = [];
    const seen = new Set();

    for (let i = 0; i < input.entries.length; i++) {
        const raw = input.entries[i];
        const label = `第 ${i + 1} 条`;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { error: `${label}格式不正确` };
        }

        if (typeof raw.title !== 'string') {
            return { error: `${label}的 title 必须是字符串` };
        }
        const title = raw.title.trim();
        if (title.length < 1) {
            return { error: `${label}的 title 不能为空` };
        }
        if (title.length > MAX_TITLE_LENGTH) {
            return { error: `${label}的 title 不能超过 ${MAX_TITLE_LENGTH} 个字符` };
        }
        if (CONTROL_CHARS.test(title)) {
            return { error: `${label}的 title 不能包含控制字符` };
        }

        let mode = 'exact';
        if (raw.mode !== undefined && raw.mode !== null) {
            if (!ALLOWED_MODES.includes(raw.mode)) {
                return { error: `${label}的 mode 只能是 exact 或 contains` };
            }
            mode = raw.mode;
        }

        let note = '';
        if (raw.note !== undefined && raw.note !== null) {
            if (typeof raw.note !== 'string') {
                return { error: `${label}的 note 必须是字符串` };
            }
            note = raw.note.trim();
            if (note.length > MAX_NOTE_LENGTH) {
                return { error: `${label}的 note 不能超过 ${MAX_NOTE_LENGTH} 个字符` };
            }
        }

        const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id)
            ? raw.id
            : crypto.randomUUID();
        const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();

        // 按「归一化 title + mode」去重，保留第一条
        const dedupeKey = `${normalize(title)}\u0000${mode}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const entry = { id, title, mode, createdAt };
        if (note) entry.note = note;
        entries.push(entry);
    }

    return { entries };
}

// PUT /api/blacklist：管理员整体写入
async function handlePut(request, env) {
    const auth = await checkAdmin(request, env);
    if (!auth.ok) {
        return adminResponse({ error: auth.error }, auth.status);
    }

    let body;
    try {
        body = await request.json();
    } catch (error) {
        return adminResponse({ error: '请求体不是合法的 JSON' }, 400);
    }

    const result = validateEntries(body);
    if (result.error) {
        return adminResponse({ error: result.error }, 400);
    }

    try {
        const current = await readDocument(env);
        const doc = {
            version: current.version + 1,
            updatedAt: Date.now(),
            entries: result.entries
        };
        await env.BLACKLIST_KV.put(KV_KEY, JSON.stringify(doc));
        return adminResponse(doc);
    } catch (error) {
        console.error('写入黑名单失败:', error.message);
        return adminResponse({ error: '写入黑名单失败' }, 500);
    }
}
