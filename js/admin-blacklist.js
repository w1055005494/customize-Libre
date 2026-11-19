/**
 * LibreTV 黑名单管理页
 * - 口令仅保存在 sessionStorage，禁止写入 localStorage
 * - 所有用户数据均通过 textContent 渲染，避免注入
 */
(function () {
    'use strict';

    var API_URL = '/api/blacklist';
    var PASSWORD_KEY = 'blacklistAdminPassword';

    var els = {
        versionText: document.getElementById('versionText'),
        updatedAtText: document.getElementById('updatedAtText'),
        unlockSection: document.getElementById('unlockSection'),
        unlockForm: document.getElementById('unlockForm'),
        passwordInput: document.getElementById('passwordInput'),
        unlockBtn: document.getElementById('unlockBtn'),
        unlockError: document.getElementById('unlockError'),
        mainSection: document.getElementById('mainSection'),
        addForm: document.getElementById('addForm'),
        titleInput: document.getElementById('titleInput'),
        modeSelect: document.getElementById('modeSelect'),
        noteInput: document.getElementById('noteInput'),
        addBtn: document.getElementById('addBtn'),
        filterInput: document.getElementById('filterInput'),
        entriesBody: document.getElementById('entriesBody'),
        emptyHint: document.getElementById('emptyHint'),
        statusBar: document.getElementById('statusBar')
    };

    var state = {
        password: '',
        version: 0,
        updatedAt: 0,
        entries: [],
        filter: '',
        busy: false
    };

    // ---------- 通用工具 ----------

    // 与搜索一致的归一化规则：NFKC + 小写 + 去空白
    function normalize(text) {
        return String(text == null ? '' : text).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    }

    // 渲染为本地时间字符串
    function formatTime(timestamp) {
        var time = Number(timestamp);
        if (!isFinite(time) || time <= 0) {
            return '—';
        }
        var date = new Date(time);
        if (isNaN(date.getTime())) {
            return '—';
        }
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    function setStatus(message) {
        els.statusBar.textContent = message;
    }

    function showUnlockError(message) {
        els.unlockError.textContent = message;
        els.unlockError.hidden = false;
    }

    function clearUnlockError() {
        els.unlockError.textContent = '';
        els.unlockError.hidden = true;
    }

    // ---------- sessionStorage 口令 ----------

    function readStoredPassword() {
        try {
            return sessionStorage.getItem(PASSWORD_KEY) || '';
        } catch (error) {
            return '';
        }
    }

    function storePassword(password) {
        try {
            sessionStorage.setItem(PASSWORD_KEY, password);
        } catch (error) {
            // 隐私模式下写入失败时仅保留内存状态
        }
    }

    function clearStoredPassword() {
        try {
            sessionStorage.removeItem(PASSWORD_KEY);
        } catch (error) {
            // 忽略存储不可用
        }
    }

    // ---------- 请求辅助 ----------

    async function readError(response, fallback) {
        try {
            var data = await response.json();
            if (data && data.error) {
                return String(data.error);
            }
        } catch (error) {
            // 响应不是 JSON 时使用兜底文案
        }
        return fallback;
    }

    // ---------- 渲染 ----------

    function renderMeta() {
        els.versionText.textContent = state.version > 0 ? ('v' + state.version) : '—';
        els.updatedAtText.textContent = formatTime(state.updatedAt);
    }

    function applyDocument(doc) {
        state.version = Number(doc && doc.version) || 0;
        state.updatedAt = Number(doc && doc.updatedAt) || 0;
        state.entries = Array.isArray(doc && doc.entries) ? doc.entries : [];
        renderMeta();
    }

    function buildRow(entry) {
        var row = document.createElement('tr');

        var titleCell = document.createElement('td');
        titleCell.className = 'title-cell';
        titleCell.textContent = entry.title || '';

        var modeCell = document.createElement('td');
        modeCell.className = 'mode-cell';
        modeCell.textContent = entry.mode === 'contains' ? '包含' : '精确';

        var noteCell = document.createElement('td');
        noteCell.className = 'note-cell';
        noteCell.textContent = entry.note ? entry.note : '—';

        var timeCell = document.createElement('td');
        timeCell.className = 'time-cell';
        timeCell.textContent = formatTime(entry.createdAt);

        var actionCell = document.createElement('td');
        actionCell.className = 'actions';

        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-sm';
        toggleBtn.textContent = '切换模式';
        toggleBtn.disabled = state.busy;
        toggleBtn.addEventListener('click', function () {
            toggleMode(entry.id);
        });

        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.textContent = '删除';
        deleteBtn.disabled = state.busy;
        deleteBtn.addEventListener('click', function () {
            removeEntry(entry.id);
        });

        actionCell.appendChild(toggleBtn);
        actionCell.appendChild(deleteBtn);

        row.appendChild(titleCell);
        row.appendChild(modeCell);
        row.appendChild(noteCell);
        row.appendChild(timeCell);
        row.appendChild(actionCell);
        return row;
    }

    function renderList() {
        var keyword = state.filter.trim().toLowerCase();
        var visibleEntries = state.entries.filter(function (entry) {
            if (!keyword) {
                return true;
            }
            var title = String(entry.title || '').toLowerCase();
            var note = String(entry.note || '').toLowerCase();
            return title.indexOf(keyword) !== -1 || note.indexOf(keyword) !== -1;
        });

        els.entriesBody.textContent = '';
        visibleEntries.forEach(function (entry) {
            els.entriesBody.appendChild(buildRow(entry));
        });

        if (visibleEntries.length > 0) {
            els.emptyHint.hidden = true;
        } else {
            els.emptyHint.textContent = state.entries.length === 0
                ? '暂无黑名单条目，请在上方新增。'
                : '没有匹配的条目。';
            els.emptyHint.hidden = false;
        }
    }

    // 保存/解锁期间禁用可提交按钮，避免重复请求
    function setBusy(busy) {
        state.busy = busy;
        els.addBtn.disabled = busy;
        els.unlockBtn.disabled = busy;
        var buttons = els.entriesBody.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].disabled = busy;
        }
    }

    // ---------- 解锁 ----------

    async function unlock() {
        if (state.busy) {
            return;
        }

        var password = els.passwordInput.value;
        if (!password) {
            showUnlockError('请输入管理员口令');
            els.passwordInput.focus();
            return;
        }

        clearUnlockError();
        setBusy(true);
        els.unlockBtn.textContent = '正在解锁…';

        try {
            var response = await fetch(API_URL + '?admin=1', {
                method: 'GET',
                headers: { 'X-Admin-Password': password },
                cache: 'no-store'
            });

            if (response.ok) {
                var doc = await response.json();
                state.password = password;
                storePassword(password);
                applyDocument(doc);

                els.unlockSection.hidden = true;
                els.mainSection.hidden = false;
                state.filter = '';
                els.filterInput.value = '';
                renderList();
                setStatus('已解锁，共 ' + state.entries.length + ' 条');
                return;
            }

            // 任何解锁失败都清除已保存的口令
            clearStoredPassword();
            state.password = '';

            if (response.status === 401) {
                els.passwordInput.value = '';
                showUnlockError('口令错误');
            } else if (response.status === 503) {
                var serviceMessage = await readError(response, '服务未就绪');
                showUnlockError('服务未就绪：' + serviceMessage);
            } else if (response.status === 404 || response.status === 405) {
                showUnlockError('当前部署不支持黑名单功能，需要部署在 Cloudflare Pages 并绑定 KV');
            } else {
                var message = await readError(response, '请稍后重试');
                showUnlockError('解锁失败（HTTP ' + response.status + '）：' + message);
            }

            els.mainSection.hidden = true;
            els.unlockSection.hidden = false;
        } catch (error) {
            clearStoredPassword();
            state.password = '';
            showUnlockError('无法连接服务，请检查网络或部署环境');
            els.mainSection.hidden = true;
            els.unlockSection.hidden = false;
        } finally {
            els.unlockBtn.textContent = '解锁';
            setBusy(false);
        }
    }

    // ---------- 保存 ----------

    async function save(entries) {
        if (state.busy || !state.password) {
            return false;
        }

        setBusy(true);
        setStatus('正在保存…');

        try {
            var response = await fetch(API_URL, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': state.password
                },
                body: JSON.stringify({ entries: entries })
            });

            if (response.ok) {
                var doc = await response.json();
                applyDocument(doc);
                setStatus('保存成功，当前版本 v' + state.version + '，共 ' + state.entries.length + ' 条');
                return true;
            }

            if (response.status === 401) {
                clearStoredPassword();
                state.password = '';
                els.passwordInput.value = '';
                els.mainSection.hidden = true;
                els.unlockSection.hidden = false;
                showUnlockError('口令错误，请重新解锁');
                setStatus('未保存：口令已失效');
                return false;
            }

            if (response.status === 400) {
                var invalidMessage = await readError(response, '参数不合法');
                setStatus('未保存：' + invalidMessage);
            } else if (response.status === 503) {
                var serviceMessage = await readError(response, '服务未就绪');
                setStatus('未保存：' + serviceMessage);
            } else if (response.status === 404 || response.status === 405) {
                setStatus('未保存：当前部署不支持黑名单功能（需要 Cloudflare Pages + KV）');
            } else {
                var message = await readError(response, '请稍后重试');
                setStatus('未保存（HTTP ' + response.status + '）：' + message);
            }
            return false;
        } catch (error) {
            setStatus('无法连接服务，保存失败，请稍后重试');
            return false;
        } finally {
            setBusy(false);
            // 重新渲染以恢复行内按钮状态（失败时也保持原有数据）
            if (!els.mainSection.hidden) {
                renderList();
            }
        }
    }

    // ---------- 增删改 ----------

    function createId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 'entry-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    async function addEntry() {
        if (state.busy) {
            return;
        }

        var title = els.titleInput.value.trim();
        var mode = els.modeSelect.value === 'contains' ? 'contains' : 'exact';
        var note = els.noteInput.value.trim();

        if (!title) {
            setStatus('请输入片名');
            els.titleInput.focus();
            return;
        }
        if (title.length > 100) {
            setStatus('片名不能超过 100 个字符');
            return;
        }
        if (note.length > 200) {
            setStatus('备注不能超过 200 个字符');
            return;
        }

        var duplicated = state.entries.some(function (entry) {
            return normalize(entry.title) === normalize(title) && entry.mode === mode;
        });
        if (duplicated) {
            setStatus('已存在相同片名和匹配模式的条目，请勿重复添加');
            return;
        }

        var entry = {
            id: createId(),
            title: title,
            mode: mode,
            note: note,
            createdAt: Date.now()
        };

        var saved = await save(state.entries.concat(entry));
        if (saved) {
            els.titleInput.value = '';
            els.noteInput.value = '';
            els.modeSelect.value = 'exact';
            els.titleInput.focus();
        }
    }

    function toggleMode(id) {
        if (state.busy) {
            return;
        }
        var entries = state.entries.map(function (entry) {
            if (entry.id !== id) {
                return entry;
            }
            return Object.assign({}, entry, {
                mode: entry.mode === 'contains' ? 'exact' : 'contains'
            });
        });
        save(entries);
    }

    function removeEntry(id) {
        if (state.busy) {
            return;
        }
        var target = state.entries.filter(function (entry) {
            return entry.id === id;
        })[0];
        if (!target) {
            return;
        }
        if (!window.confirm('确定删除黑名单条目「' + target.title + '」吗？')) {
            return;
        }
        var entries = state.entries.filter(function (entry) {
            return entry.id !== id;
        });
        save(entries);
    }

    // ---------- 初始化 ----------

    function init() {
        els.unlockForm.addEventListener('submit', function (event) {
            event.preventDefault();
            unlock();
        });

        els.addForm.addEventListener('submit', function (event) {
            event.preventDefault();
            addEntry();
        });

        els.filterInput.addEventListener('input', function () {
            state.filter = els.filterInput.value;
            renderList();
        });

        renderMeta();

        // 当前会话已保存口令时自动尝试解锁，失败会在 unlock() 中清除
        var stored = readStoredPassword();
        if (stored) {
            els.passwordInput.value = stored;
            unlock();
        }
    }

    init();
})();
