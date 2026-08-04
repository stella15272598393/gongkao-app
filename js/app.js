/* ========================================
   莲莲工作台 - 主应用逻辑
   包含：模块切换、倒计时、搜索、数据管理、图表渲染
   ======================================== */

// ========== 全局状态 ==========
let currentModule = 'shizheng';
let currentShizhengFilter = 'all';
let currentShizhengSource = 'all';
let currentQiushiTag = 'all';
let currentRenwuCat = 'all';
let currentQuoteIndex = -1;
let currentQuote = null; // 当前显示的金句（供搜索原文用）
let currentMorningSource = 'all';

// 版本号：每次改动 JS 后 +1，用于确认手机端是否加载到最新代码
const APP_VERSION = '2026-08-04-v12';
const APP_AUTHOR = '莲莲';  // 作者昵称，借给别人用时显示你的署名
const APP_NAME = '🪷 莲莲工作台';
let currentRenwuDailyIndex = -1;
let practiceState = {
    questions: [],
    currentIndex: 0,
    correct: 0,
    wrong: 0,
    startTime: null,
    timerInterval: null,
    active: false
};
let currentChartType = 'line';
let editingMockId = null;

// ========== 通用弹窗（替代原生 alert/confirm/prompt，兼容 PWA 手机端） ==========
// 原生对话框在 iOS/Android 的「添加到主屏幕」独立运行模式下会被屏蔽，故自建弹窗。
function showAppModal({ title = '提示', body = '', fields = [], okText = '确定', cancelText = '取消', hideCancel = false, onOk, onCancel }) {
    const overlay = document.getElementById('appModalOverlay');
    if (!overlay) { // 兜底：极端情况下退回原生
        if (hideCancel) { alert(body); if (onOk) onOk({}); return; }
        if (confirm(body)) { if (onOk) onOk({}); } else { if (onCancel) onCancel(); }
        return;
    }
    document.getElementById('appModalTitle').textContent = title;
    document.getElementById('appModalBody').textContent = body;
    const fieldsWrap = document.getElementById('appModalFields');
    fieldsWrap.innerHTML = fields.map(f => {
        if (f.type === 'select') {
            return `<div style="margin-bottom:12px;"><label style="display:block;font-size:12px;color:#888;margin-bottom:5px;">${f.label}</label>` +
                `<select id="am_${f.id}" class="modal-input">${f.options.map(o => `<option value="${o}"${o === f.value ? ' selected' : ''}>${o}</option>`).join('')}</select></div>`;
        }
        return `<div style="margin-bottom:12px;"><label style="display:block;font-size:12px;color:#888;margin-bottom:5px;">${f.label}</label>` +
            `<input id="am_${f.id}" type="${f.type || 'text'}" class="modal-input" placeholder="${f.placeholder || ''}" value="${f.value || ''}"/></div>`;
    }).join('');
    const actions = document.getElementById('appModalActions');
    actions.innerHTML = '';
    if (!hideCancel) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-outline';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => { closeAppModal(); if (onCancel) onCancel(); };
        actions.appendChild(cancelBtn);
    }
    const okBtn = document.createElement('button');
    okBtn.className = 'btn-pink';
    okBtn.textContent = okText;
    okBtn.onclick = () => {
        const values = {};
        fields.forEach(f => { const el = document.getElementById('am_' + f.id); values[f.id] = el ? el.value : ''; });
        closeAppModal();
        if (onOk) onOk(values);
    };
    actions.appendChild(okBtn);
    overlay.style.display = 'flex';
}
function closeAppModal() {
    const overlay = document.getElementById('appModalOverlay');
    if (overlay) overlay.style.display = 'none';
}
function appAlert(msg) { showAppModal({ title: '提示', body: String(msg), okText: '知道了', hideCancel: true }); }
function appConfirm(msg, cb) {
    showAppModal({ title: '请确认', body: String(msg), okText: '确认', cancelText: '取消', onOk: () => cb(true), onCancel: () => cb(false) });
}
function appPrompt(msg, cb, def) {
    showAppModal({ title: '请输入', body: String(msg), fields: [{ id: 'val', type: 'text', value: def || '' }], okText: '确定', cancelText: '取消', onOk: v => cb((v.val || '').trim() ? (v.val).trim() : null), onCancel: () => cb(null) });
}
/**
 * 净化分析文本：剥离 crawler 误抓的 JS 代码片段（showPlayer、script 标签等），
 * 防止 AI 提炼区域显示原始代码。
 */
function sanitizeAnalysis(text) {
    if (!text) return '（本文提炼内容正在整理中，请查看完整原文）';
    // 移除 showPlayer({ ... }) 整段调用
    text = text.replace(/showPlayer\s*\([^)]*(?:\([^)]*\)[^)]*)*\)/gs, '');
    // 移除 <script>...</script> 块
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    // 移除独立的 JS 对象字面量（含 videoInfo/posterUrl/scriptId 等视频播放器特征）
    text = text.replace(/\{[^{}]*(?:videoInfo|posterUrl|scriptId|hidPlaybackRates|disableDownload|autoPlay)[^{}]*\}/g, '');
    // 清理连续空行
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    // 如果清理后只剩标题前缀而无实质内容，返回提示语
    if (!text || text.replace(/【[^】]+】/g, '').trim().length < 4) {
        return '（本文提炼内容正在整理中，请查看完整原文）';
    }
    return text;
}

// 接管原生 alert，使 PWA 下也能看到提示
window.alert = (m) => appAlert(m);

// ========== 收藏夹（点赞 / 收藏 统一收纳，持久化到 localStorage） ==========
// 这是「我的收藏」的唯一真相源：点赞👍或收藏❤️都会进这里，刷新/下次打开仍在
let favBox = loadFavBox();
function loadFavBox() {
    try { return JSON.parse(localStorage.getItem('favBox') || '[]'); } catch (e) { return []; }
}
function saveFavBox() { try { localStorage.setItem('favBox', JSON.stringify(favBox)); } catch (e) {} }
function favBoxKey(module, id) { return module + ':' + id; }
function isFaved(module, id) {
    return favBox.some(f => f.module === module && String(f.id) === String(id));
}
function favMeta(item, module) {
    switch (module) {
        case 'shizheng': return { title: item.title, source: item.source, date: item.date, snippet: item.summary || '' };
        case 'shenlun':  return { title: item.title, source: item.source, date: '', snippet: (item.content || '').slice(0, 160) };
        case 'qiushi':   return { title: item.title, source: item.source, date: '', snippet: (item.analysis && item.analysis.mainPoint) || '' };
        case 'renwu':    return { title: item.name, source: item.source, date: '', snippet: item.story || '' };
        case 'quote':    return { title: item.text || item.quote, source: item.source || '', date: '', snippet: (item.text || item.quote || '').slice(0, 120) };
        case 'morning':  return { title: item.title, source: item.source, date: item.date, snippet: (item.content || '').slice(0, 160) };
        default:         return { title: '', source: '', date: '', snippet: '' };
    }
}
function addFav(module, id, type, item) {
    const m = favMeta(item, module);
    if (isFaved(module, id)) {
        const ex = favBox.find(f => f.module === module && String(f.id) === String(id));
        if (ex) { ex.title = m.title; ex.source = m.source; ex.date = m.date; ex.snippet = m.snippet; }
        saveFavBox(); return;
    }
    favBox.push({ key: favBoxKey(module, id), module, id: String(id), type, title: m.title, source: m.source, date: m.date, snippet: m.snippet, ts: Date.now() });
    saveFavBox();
}
function removeFav(module, id) {
    favBox = favBox.filter(f => !(f.module === module && String(f.id) === String(id)));
    saveFavBox();
}
function toggleFavBox(module, id, type, item) {
    if (isFaved(module, id)) removeFav(module, id); else addFav(module, id, type, item);
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    initCountdown();
    startDateTimeClock();
    initGlobalSearch();
    const vEl = document.getElementById('appVersionLabel');
    if (vEl) vEl.textContent = 'v' + APP_VERSION;
    updateStreak();
    switchModule('home');
    initShizheng();
    initShenlun();
    initQiushi();
    initRenwu();
    initSusuan();
    initPlan();
    initMock();
    initMorning();
    bindFavFilters();
    registerSW();
    checkDailyReset();
    // 新增模块初始化
    initIdioms();
    initIdiomPairs();
    initLogic();
    initInterview();
    scheduleDailyPush();
});

// ========== Service Worker 注册 ==========
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('PWA SW registered:', reg.scope);
        }).catch(err => {
            console.log('SW registration failed:', err);
        });
    }
}

// ========== 倒计时计算与显示 ==========
function initCountdown() {
    updateCountdownDisplay();
    setInterval(updateCountdownDisplay, 60000); // 每分钟更新
}

function updateCountdownDisplay() {
    const now = new Date();
    const guokaoTarget = new Date(EXAM_DATES.guokao);
    const hubaoTarget = new Date(EXAM_DATES.hubao);

    const guokaoDays = Math.ceil((guokaoTarget - now) / (1000 * 60 * 60 * 24));
    const hubaoDays = Math.ceil((hubaoTarget - now) / (1000 * 60 * 60 * 24));

    const guokaoEl = document.getElementById('guokaoDays');
    const hubaoEl = document.getElementById('hubaoDays');

    if (guokaoEl) guokaoEl.textContent = Math.max(0, guokaoDays);
    if (hubaoEl) hubaoEl.textContent = Math.max(0, hubaoDays);

    // Day计数
    const startDate = new Date('2026-08-03'); // 项目启动日
    const dayNum = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const guokaoDayNumEl = document.getElementById('guokaoDayNum');
    const hubaoDayNumEl = document.getElementById('hubaoDayNum');
    if (guokaoDayNumEl) guokaoDayNumEl.textContent = `Day ${dayNum}`;
    if (hubaoDayNumEl) hubaoDayNumEl.textContent = `Day ${dayNum}`;
}

// ========== 实时时钟 ==========
function startDateTimeClock() {
    function updateClock() {
        const now = new Date();
        const el = document.getElementById('datetimeDisplay');
        if (el) {
            const pad = n => String(n).padStart(2, '0');
            el.textContent = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        }
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// ========== 模块切换 ==========
function switchModule(moduleName) {
    currentModule = moduleName;

    // 更新导航栏
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.module === moduleName);
    });

    // 更新内容面板
    document.querySelectorAll('.module-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${moduleName}`);
    });

    // 移动端自动收起侧边栏
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }

    // 进入收藏夹时刷新列表
    if (moduleName === 'favbox') renderFavBox();
    // 进入工作台时刷新打卡与数据
    if (moduleName === 'home') { updateStreak(); renderHome(); }
}

// ========== 收藏夹页面 ==========
let currentFavFilter = 'all';
function renderFavBox() {
    const container = document.getElementById('favBoxList');
    if (!container) return;
    const countEl = document.getElementById('favBoxCount');
    if (countEl) countEl.textContent = String(favBox.length);
    let list = favBox;
    if (currentFavFilter !== 'all') {
        list = favBox.filter(f => f.module === currentFavFilter);
    }
    if (favBox.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:64px 20px;">📌 还没有收藏<br/><span style="font-size:12px;">点赞 👍 或收藏 ❤️ 任意文章后，会自动收进这里，下次打开也能看～</span></div>';
        return;
    }
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:48px 20px;">该分类下暂无收藏</div>';
        return;
    }
    const moduleNames = { shizheng: '时政热点', shenlun: '申论范文', qiushi: '求是网文章', renwu: '人物素材', quote: '金句', morning: '今日晨读' };
    const sorted = [...list].sort((a, b) => b.ts - a.ts);
    container.innerHTML = sorted.map(f => `
        <div class="fav-item">
            <div class="fav-item-top">
                <span class="fav-module-tag ${f.module}">${moduleNames[f.module] || f.module}</span>
                <span class="fav-type">${f.type === 'fav' ? '❤️ 收藏' : '👍 点赞'}</span>
            </div>
            <div class="fav-item-title" onclick="gotoFavSource('${f.module}', '${f.id}')">${escapeHTML(f.title || '(无标题)')}</div>
            <div class="fav-item-meta">${escapeHTML(f.source || '')}${f.date ? ' · ' + f.date : ''} · 收藏于 ${new Date(f.ts).toLocaleDateString('zh-CN')}</div>
            <div class="fav-item-snippet">${escapeHTML((f.snippet || '').slice(0, 180))}${(f.snippet || '').length > 180 ? '…' : ''}</div>
            <div class="fav-item-actions">
                <button class="btn-outline btn-sm fav-copy-btn" data-fmod="${f.module}" data-fid="${f.id}" onclick="copyFavItem('${f.module}', '${f.id}')">📋 复制</button>
                <button class="btn-outline btn-sm" onclick="gotoFavSource('${f.module}', '${f.id}')">▶ 查看</button>
                <button class="btn-outline btn-sm" onclick="removeFavItem('${f.module}', '${f.id}')">🗑 删除</button>
            </div>
        </div>
    `).join('');
}

/* 收藏分类筛选标签 */
function bindFavFilters() {
    const box = document.getElementById('favFilters');
    if (!box) return;
    box.querySelectorAll('.tag-btn').forEach(btn => {
        btn.onclick = () => {
            currentFavFilter = btn.dataset.fav;
            box.querySelectorAll('.tag-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderFavBox();
        };
    });
}

/* 导出收藏为 TXT */
function exportFavTxt() {
    if (favBox.length === 0) { alert('还没有收藏内容可导出~'); return; }
    const moduleNames = { shizheng: '时政热点', shenlun: '申论范文', qiushi: '求是网文章', renwu: '人物素材', quote: '金句', morning: '今日晨读' };
    let txt = '【莲莲工作台 · 我的收藏】\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n共 ' + favBox.length + ' 条\n\n';
    const sorted = [...favBox].sort((a, b) => b.ts - a.ts);
    sorted.forEach((f, i) => {
        txt += '━━━ ' + (i + 1) + '. ' + (moduleNames[f.module] || f.module) + ' ━━━\n';
        txt += '标题：' + (f.title || '(无标题)') + '\n';
        if (f.source) txt += '来源：' + f.source + (f.date ? ' · ' + f.date : '') + '\n';
        if (f.snippet) txt += '内容：' + f.snippet + '\n';
        txt += '收藏于：' + new Date(f.ts).toLocaleDateString('zh-CN') + '\n\n';
    });
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '莲莲工作台_收藏_' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* 导出收藏为图片（canvas 拼贴） */
function exportFavImage() {
    if (favBox.length === 0) { alert('还没有收藏内容可导出~'); return; }
    const moduleNames = { shizheng: '时政热点', shenlun: '申论范文', qiushi: '求是网文章', renwu: '人物素材', quote: '金句', morning: '今日晨读' };
    const sorted = [...favBox].sort((a, b) => b.ts - a.ts).slice(0, 30);
    const W = 720;
    const lineH = 22;
    const pad = 28;
    const headH = 90;
    let estH = headH + pad;
    const lines = [];
    sorted.forEach((f, i) => {
        const title = (i + 1) + '. ' + (f.title || '(无标题)');
        const meta = '【' + (moduleNames[f.module] || f.module) + '】' + (f.source ? ' ' + f.source : '') + (f.date ? ' · ' + f.date : '');
        const snippet = (f.snippet || '').slice(0, 80);
        lines.push({ title, meta, snippet });
        estH += lineH + lineH + (snippet ? lineH : 0) + 16;
    });
    estH += pad;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = estH;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFF0F5'; ctx.fillRect(0, 0, W, estH);
    ctx.fillStyle = '#E75480'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🪷 莲莲工作台 · 我的收藏', W / 2, 46);
    ctx.fillStyle = '#888'; ctx.font = '14px sans-serif';
    ctx.fillText('导出时间 ' + new Date().toLocaleString('zh-CN') + ' · 共 ' + favBox.length + ' 条', W / 2, 72);
    ctx.textAlign = 'left';
    let y = headH;
    lines.forEach(l => {
        ctx.fillStyle = '#C2185B'; ctx.font = 'bold 17px sans-serif';
        ctx.fillText(clip(ctx, l.title, W - pad * 2), pad, y); y += lineH;
        ctx.fillStyle = '#999'; ctx.font = '12px sans-serif';
        ctx.fillText(clip(ctx, l.meta, W - pad * 2), pad, y); y += lineH;
        if (l.snippet) { ctx.fillStyle = '#555'; ctx.font = '13px sans-serif'; ctx.fillText(clip(ctx, l.snippet, W - pad * 2), pad, y); y += lineH; }
        y += 16;
    });
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = '莲莲工作台_收藏_' + new Date().toISOString().slice(0, 10) + '.png';
    a.click();
    function clip(c, text, maxW) { if (c.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
}

/* ========== 工作台首页 ========== */
function getTodayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getYesterdayStr() { const d = new Date(Date.now() - 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function updateStreak() {
    let data = { count: 0, last: '' };
    try { const s = localStorage.getItem('gk_streak'); if (s) data = JSON.parse(s); } catch (e) {}
    const today = getTodayStr();
    if (data.last === today) return; // 今天已打卡
    if (data.last === getYesterdayStr()) data.count += 1;
    else data.count = 1;
    data.last = today;
    try { localStorage.setItem('gk_streak', JSON.stringify(data)); } catch (e) {}
}

function renderHome() {
    const statsEl = document.getElementById('homeStats');
    if (!statsEl) return;
    let streak = 0;
    try { const s = localStorage.getItem('gk_streak'); if (s) streak = JSON.parse(s).count || 0; } catch (e) {}

    // 各模块数据概览
    const statCards = [
        { icon: '📰', label: '时政热点', val: (typeof SHIZHENG_NEWS !== 'undefined' ? SHIZHENG_NEWS.length : 0) },
        { icon: '📖', label: '求是文章', val: (typeof QIUSHI_ARTICLES !== 'undefined' ? QIUSHI_ARTICLES.length : 0) },
        { icon: '⭐', label: '人物素材', val: (typeof RENWU_DATABASE !== 'undefined' ? RENWU_DATABASE.length : 0) },
        { icon: '🌅', label: '晨读文章', val: (typeof MORNING_DB !== 'undefined' ? MORNING_DB.length : 0) },
        { icon: '✍️', label: '申论范文', val: (typeof ESSAYS_DB !== 'undefined' ? ESSAYS_DB.length : 0) },
        { icon: '💡', label: '金句', val: (typeof QUOTES_DB !== 'undefined' ? QUOTES_DB.length : 0) },
        { icon: '📌', label: '我的收藏', val: (typeof favBox !== 'undefined' ? favBox.length : 0) }
    ];

    let html = '<div class="home-streak"><div class="home-streak-num">' + streak + '</div><div class="home-streak-label">🔥 连续打卡天数</div></div>';
    html += '<div class="home-stat-grid">';
    statCards.forEach(c => {
        html += '<div class="home-stat-card" onclick="switchModule(\'' + statModule(c.label) + '\')">' +
            '<div class="home-stat-icon">' + c.icon + '</div>' +
            '<div class="home-stat-val">' + c.val + '</div>' +
            '<div class="home-stat-label">' + c.label + '</div>' +
        '</div>';
    });
    html += '</div>';
    statsEl.innerHTML = html;

    renderTodos();
}

function statModule(label) {
    const map = { '时政热点': 'shizheng', '求是文章': 'qiushi', '人物素材': 'renwu', '晨读文章': 'morning', '申论范文': 'shenlun', '金句': 'shenlun', '我的收藏': 'favbox' };
    return map[label] || 'shizheng';
}

/* 今日待办 */
function loadTodos() {
    try { const s = localStorage.getItem('gk_todos'); return s ? JSON.parse(s) : []; } catch (e) { return []; }
}
function saveTodos(list) { try { localStorage.setItem('gk_todos', JSON.stringify(list)); } catch (e) {} }
function addHomeTodo() {
    const inp = document.getElementById('todoInput');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text) return;
    const list = loadTodos();
    list.push({ id: Date.now(), text: text, done: false });
    saveTodos(list);
    inp.value = '';
    renderTodos();
}
function toggleHomeTodo(id) {
    const list = loadTodos();
    const t = list.find(x => x.id === id);
    if (t) { t.done = !t.done; saveTodos(list); renderTodos(); }
}
function removeHomeTodo(id) {
    saveTodos(loadTodos().filter(x => x.id !== id));
    renderTodos();
}
function renderTodos() {
    const ul = document.getElementById('todoList');
    const cnt = document.getElementById('todoCount');
    if (!ul) return;
    const list = loadTodos();
    const done = list.filter(t => t.done).length;
    if (cnt) cnt.textContent = list.length ? (done + '/' + list.length) : '';
    if (list.length === 0) { ul.innerHTML = '<li class="home-todo-empty">还没有待办，添加一条开始今天的学习吧～</li>'; return; }
    ul.innerHTML = list.map(t => '<li class="home-todo-item ' + (t.done ? 'done' : '') + '">' +
        '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' onchange="toggleHomeTodo(' + t.id + ')" />' +
        '<span class="home-todo-text" onclick="toggleHomeTodo(' + t.id + ')">' + escapeHTML(t.text) + '</span>' +
        '<button class="home-todo-del" onclick="removeHomeTodo(' + t.id + ')">✕</button>' +
    '</li>').join('');
}

function gotoFavSource(module, id) {
    if (module === 'quote') {
        switchModule('shenlun');
        alert('已切到「申论 · 金句」面板，往下翻找对应金句即可～');
        return;
    }
    switchModule(module);
    setTimeout(() => {
        const prefix = { shizheng: 'news-', shenlun: 'essay-', qiushi: 'qiushi-', renwu: 'renwu-' }[module] || '';
        const el = document.getElementById(prefix + id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.outline = '2px solid #FFB6C1';
            setTimeout(() => { el.style.outline = ''; }, 2200);
        }
    }, 160);
}

function removeFavItem(module, id) {
    removeFav(module, id);
    renderFavBox();
    if (module === 'shizheng') renderShizhengList();
    else if (module === 'shenlun') renderEssayList();
    else if (module === 'qiushi') renderQiushiArticles(currentQiushiTag, (document.getElementById('qiushiSearchInput') || {}).value || '');
    else if (module === 'renwu') { renderRenwuList(); showRenwuDaily(); }
    else if (module === 'quote') {
        const btn = document.getElementById('btnFavQuote');
        if (btn) btn.innerHTML = isFaved('quote', id) ? '❤️ 已收藏' : '🤍 收藏';
    }
}

/* 单条收藏导出（复制到剪贴板） */
function copyFavItem(module, id) {
    const f = favBox.find(x => x.module === module && x.id === id);
    if (!f) { alert('未找到该收藏项'); return; }
    const moduleNames = { shizheng: '时政热点', shenlun: '申论范文', qiushi: '求是网文章', renwu: '人物素材', quote: '金句', morning: '今日晨读' };
    let txt = '【' + (moduleNames[f.module] || f.module) + '】' + (f.type === 'fav' ? ' ❤️收藏' : ' 👍点赞') + '\n';
    txt += '标题：' + (f.title || '(无标题)') + '\n';
    if (f.source) txt += '来源：' + f.source + (f.date ? ' · ' + f.date : '') + '\n';
    if (f.snippet) txt += '内容：' + f.snippet + '\n';
    navigator.clipboard.writeText(txt).then(function() {
        // 找到对应按钮显示反馈
        const btns = document.querySelectorAll('.fav-copy-btn');
        btns.forEach(function(b) {
            if (b.dataset.fmod === module && b.dataset.fid === id) {
                const orig = b.innerHTML;
                b.innerHTML = '✅ 已复制';
                b.style.color = '#27ae60';
                setTimeout(function() { b.innerHTML = orig; b.style.color = ''; }, 1500);
            }
        });
    }).catch(function() {
        alert('复制失败，请手动选择文本复制');
    });
}

// ========== 全局搜索 ==========
function initGlobalSearch() {
    const input = document.getElementById('globalSearch');
    if (!input) return;
    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const query = input.value.trim();
            if (query.length >= 2) {
                performGlobalSearch(query);
            }
        }, 300);
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            performGlobalSearch(input.value.trim());
        }
    });
}

function performGlobalSearch(query) {
    const results = [];
    // 搜索时政热点
    SHIZHENG_NEWS.forEach(item => {
        if (item.title.includes(query) || item.summary.includes(query)) {
            results.push({ type: '时政热点', title: item.title, source: item.source, module: 'shizheng' });
        }
    });
    // 搜索申论范文
    ESSAYS_DB.forEach(item => {
        if (item.title.includes(query) || item.content.includes(query)) {
            results.push({ type: '申论范文', title: item.title, source: item.source, module: 'shenlun' });
        }
    });
    // 搜索求是网文章
    QIUSHI_ARTICLES.forEach(item => {
        if (item.title.includes(query)) {
            results.push({ type: '求是网文章', title: item.title, source: '求是网', module: 'qiushi' });
        }
    });
    // 搜索人物素材
    RENWU_DATABASE.forEach(item => {
        if (item.name.includes(query) || item.story.includes(query)) {
            results.push({ type: '人物素材', title: item.name, source: item.categoryName, module: 'renwu' });
        }
    });
    // 搜索今日晨读
    MORNING_DB.forEach(item => {
        if (item.title.includes(query) || (item.content && item.content.includes(query))) {
            results.push({ type: '今日晨读', title: item.title, source: item.source, module: 'morning' });
        }
    });

    showSearchResults(results, query);
}

function showSearchResults(results, query) {
    const modal = document.getElementById('searchModal');
    const body = document.getElementById('searchResults');
    modal.style.display = 'flex';

    if (results.length === 0) {
        body.innerHTML = `<p style="text-align:center;color:#999;padding:40px;">未找到与"${query}"相关的内容</p>`;
        return;
    }

    body.innerHTML = results.map(r => `
        <div class="news-card" style="cursor:pointer;margin-bottom:10px;" onclick="switchModule('${r.module}');closeSearchModal();">
            <span class="news-tag">${r.type}</span>
            <div class="news-title" style="font-size:14px;">${r.title}</div>
            <div class="news-footer"><span>来源: ${r.source}</span></div>
        </div>
    `).join('');
}

function closeSearchModal() {
    document.getElementById('searchModal').style.display = 'none';
}

// ================================================================
// 模块1: 时政热点
// ================================================================
function initShizheng() {
    renderShizhengSources();
    renderShizhengList();
    bindShizhengFilters();
    updateShizhengUpdateInfo();
}

/**
 * 动态生成「来源」过滤按钮：直接基于当前真实数据的 source 字段，
 * 避免写死的 sourceMap 与数据对不上导致点某个来源后列表全空（空白页）。
 */
function renderShizhengSources() {
    const wrap = document.getElementById('shizhengSources');
    if (!wrap) return;
    const sources = [...new Set(SHIZHENG_NEWS.map(n => n.source).filter(Boolean))];
    wrap.innerHTML = '<span class="source-label">来源：</span>' +
        `<button class="source-btn${currentShizhengSource === 'all' ? ' active' : ''}" data-source="all">全部</button>` +
        sources.map(s => `<button class="source-btn${currentShizhengSource === s ? ' active' : ''}" data-source="${s}">${s}</button>`).join('');
    wrap.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            wrap.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentShizhengSource = btn.dataset.source;
            renderShizhengList();
        });
    });
}

function renderShizhengList() {
    const container = document.getElementById('shizhengList');
    if (!container) return;

    let filtered = [...SHIZHENG_NEWS];

    // 来源过滤（直接按真实 source 值匹配，避免与数据对不上导致空白页）
    if (currentShizhengSource !== 'all') {
        filtered = filtered.filter(n => n.source === currentShizhengSource);
    }

    // 方向过滤
    if (currentShizhengFilter !== 'all') {
        filtered = filtered.filter(n => n.sourceType === currentShizhengFilter);
    }

    if (filtered.length === 0) {
        const hint = (currentShizhengSource !== 'all' && currentShizhengFilter !== 'all')
            ? `「${currentShizhengSource}」+「${currentShizhengFilter === 'guokao' ? '国考考点' : '湖北省情'}」暂无交叉文章<br/><span style="font-size:12px;">试试切换来源或方向</span>`
            : currentShizhengSource !== 'all'
                ? `「${currentShizhengSource}」暂无文章<br/><span style="font-size:12px;">点「全部」查看所有文章</span>`
                : `该条件下暂无文章<br/><span style="font-size:12px;">点「全部」重置</span>`;
        container.innerHTML = `<div style="text-align:center;color:#999;padding:48px 20px;">🗞️ ${hint}</div>`;
        return;
    }

    container.innerHTML = filtered.map(function(item, idx) {
        var shortSummary = (item.summary || '').slice(0, 100);
        return '<div class="news-card" id="news-' + item.id + '">' +
            '<div class="news-card-header">' +
                '<span class="news-tag ' + (item.sourceType === 'hubao' ? 'hubao' : '') + '">' + (item.sourceType === 'guokao' ? '国考考点' : '湖北省情') + '</span>' +
                '<div class="news-actions">' +
                    '<button class="action-btn ' + (isFaved('shizheng', item.id) ? 'liked' : '') + '" onclick="toggleLike(' + item.id + ', this)">👍 ' + (Number(item.likes) || 0) + '</button>' +
                    '<button class="action-btn ' + (isFaved('shizheng', item.id) ? 'favorited' : '') + '" onclick="toggleFavNews(' + item.id + ', this)">' + (isFaved('shizheng', item.id) ? '❤️' : '🤍') + '</button>' +
                '</div>' +
            '</div>' +
            '<div class="news-title" style="cursor:pointer;" onclick="toggleShizhengExpand(\'' + item.id + '\')">' + item.title + '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;margin:4px 0;">' +
                '<span style="font-size:11px;color:#999;">来源: ' + (item.source || '') + ' · ' + (item.date || '') + '</span>' +
                '<button class="btn-outline btn-sm" onclick="toggleShizhengExpand(\'' + item.id + '\')" style="font-size:11px;padding:1px 8px;margin-left:auto;">展开 ▾</button>' +
            '</div>' +

            /* 默认显示的短摘要 */
            '<div class="news-brief" id="news-brief-' + item.id + '">' + shortSummary + (shortSummary.length >= 100 ? '...' : '') + '</div>' +

            /* 展开后的完整内容（默认隐藏） */
            '<div class="news-detail" id="news-detail-' + item.id + '" style="display:none;">' +
                '<div class="ai-insight">' +
                    '<div class="ai-insight-title">💡 AI 提炼</div>' +
                    sanitizeAnalysis(item.aiInsight).replace(/\n/g, '<br>') +
                '</div>' +
                '<div class="news-summary">' + item.summary + '</div>' +
                '<div class="news-full-text" id="fulltext-' + item.id + '">' + item.fullText + '</div>' +
                '<div class="news-footer">' +
                    '<span>来源: ' + (item.source || '') + ' · ' + (item.date || '') + '</span>' +
                    '<button class="expand-btn" onclick="toggleFullText(' + item.id + ')">展开全文</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

function toggleFullText(id) {
    const el = document.getElementById(`fulltext-${id}`);
    const btn = el.parentElement.querySelector('.expand-btn');
    if (el.classList.contains('show')) {
        el.classList.remove('show');
        btn.textContent = '展开全文';
    } else {
        el.classList.add('show');
        btn.textContent = '收起全文';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/* 时政热点文章折叠/展开 */
function toggleShizhengExpand(id) {
    var detail = document.getElementById('news-detail-' + id);
    var brief = document.getElementById('news-brief-' + id);
    if (!detail) return;
    var isHidden = detail.style.display === 'none';
    detail.style.display = isHidden ? 'block' : 'none';
    if (brief) brief.style.display = isHidden ? 'none' : 'block';
    // 更新按钮文字
    var card = document.getElementById('news-' + id);
    if (!card) return;
    var btns = card.querySelectorAll('.btn-outline');
    btns.forEach(function(b) {
        if (b.textContent.indexOf('展开') >= 0) b.textContent = isHidden ? '收起 ▴' : '展开 ▾';
    });
}

function toggleLike(id, btn) {
    const news = SHIZHENG_NEWS.find(n => n.id === id);
    if (news) {
        const nowFaved = !isFaved('shizheng', id);
        toggleFavBox('shizheng', id, 'like', news);
        news.liked = nowFaved;
        news.likes = (Number(news.likes) || 0) + (nowFaved ? 1 : -1);
        btn.classList.toggle('liked', nowFaved);
        btn.innerHTML = `👍 ${news.likes}`;
        if (nowFaved) btn.classList.add('heart-animate');
        setTimeout(() => btn.classList.remove('heart-animate'), 400);
    }
}

function toggleFavNews(id, btn) {
    const news = SHIZHENG_NEWS.find(n => n.id === id);
    if (news) {
        const nowFaved = !isFaved('shizheng', id);
        toggleFavBox('shizheng', id, 'fav', news);
        news.favorited = nowFaved;
        btn.classList.toggle('favorited', nowFaved);
        btn.innerHTML = nowFaved ? '❤️' : '🤍';
        saveFavorites();
    }
}

// 文章点赞通用逻辑（申论 / 人物 / 求是 共用）
function applyLike(item, btn, module) {
    if (!item || !module) return;
    const nowFaved = !isFaved(module, item.id);
    toggleFavBox(module, item.id, 'like', item);
    item.liked = nowFaved;
    item.likes = (Number(item.likes) || 0) + (nowFaved ? 1 : -1);
    btn.classList.toggle('liked', nowFaved);
    btn.innerHTML = `👍 ${item.likes}`;
    if (nowFaved) btn.classList.add('heart-animate');
    setTimeout(() => btn.classList.remove('heart-animate'), 400);
}
function toggleEssayLike(id, btn) {
    applyLike(ESSAYS_DB.find(e => e.id === id), btn, 'shenlun');
}
function toggleRenwuLike(id, btn) {
    applyLike(RENVU_DATABASE.find(p => String(p.id) === String(id)), btn, 'renwu');
}
function toggleQiushiLike(id, btn) {
    applyLike(QIUSHI_ARTICLES.find(a => a.id === id), btn, 'qiushi');
}

function bindShizhengFilters() {
    document.querySelectorAll('#shizhengFilters .tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#shizhengFilters .tag-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentShizhengFilter = btn.dataset.filter;
            renderShizhengList();
        });
    });
}

function refreshShizheng() {
    const btn = document.querySelector('[onclick="refreshShizheng()"]');
    if (btn) { btn.textContent = '⏳ 同步中…'; btn.disabled = true; }
    // 优先从网络强制刷新最新内容（缓存版本已升级，会拉取干净数据）
    if (typeof window.refreshContent === 'function') {
        window.refreshContent().then(ok => {
            if (btn) { btn.textContent = '🔄 换一批'; btn.disabled = false; }
            if (!ok) alert('网络同步失败，已显示当前缓存内容');
        });
    } else {
        // 无网络刷新能力时退回打乱顺序
        for (let i = SHIZHENG_NEWS.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [SHIZHENG_NEWS[i], SHIZHENG_NEWS[j]] = [SHIZHENG_NEWS[j], SHIZHENG_NEWS[i]];
        }
        renderShizhengList();
        if (btn) { btn.textContent = '🔄 换一批'; btn.disabled = false; }
    }
}

function clearAllCache() {
    const btn = document.querySelector('[onclick="clearAllCache()"]');
    if (btn) { btn.textContent = '⏳ 清除中…'; btn.disabled = true; }
    let done = false;
    const finish = () => { if (done) return; done = true; location.reload(true); };
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                Promise.all(regs.map(r => r.unregister().catch(() => {}))).then(finish).catch(finish);
            }).catch(finish);
        }
    } catch (e) { /* ignore */ }
    try {
        if (window.indexedDB) {
            const req = indexedDB.deleteDatabase('gongzuotai_content');
            req.onsuccess = finish;
            req.onerror = finish;
            req.onblocked = finish;
        }
    } catch (e) { /* ignore */ }
    // 兜底：1.2s 后无论如何都刷新
    setTimeout(finish, 1200);
}

function updateShizhengUpdateInfo() {
    const el = document.getElementById('shizhengUpdateInfo');
    if (!el) return;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = SHIZHENG_NEWS.filter(n => (n.date || '').slice(0, 10) === today).length;
    const total = SHIZHENG_NEWS.length;
    el.textContent = todayCount > 0
        ? `今日更新 ${todayCount} 条 · 库存 ${total} 篇`
        : `库存 ${total} 篇`;
}

// ================================================================
// 模块2: 申论
// ================================================================
function initShenlun() {
    showRandomQuote();
    renderEssayList();
    loadCheckinStats();
}

function switchShenlunTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
}

function showRandomQuote(filter = 'all') {
    let pool = filter === 'all' ? [...QUOTES_DB] : QUOTES_DB.filter(q => q.theme === filter);
    if (pool.length === 0) pool = [...QUOTES_DB];
    const idx = Math.floor(Math.random() * pool.length);
    currentQuoteIndex = QUOTES_DB.indexOf(pool[idx]);
    const quote = pool[idx];
    currentQuote = quote; // 保存当前引用供搜索用

    document.getElementById('quoteCategory').textContent = quote.themeName;
    document.getElementById('quoteText').textContent = `"${quote.text}"`;
    document.getElementById('quoteTheme').textContent = quote.category;
    // 仅在有原文链接时显示跳转按钮
    var sourceHtml = '<span class="quote-source-name">' + quote.source + '</span>';
    if (quote.url) {
        sourceHtml += ' <a class="quote-source-link" onclick="window.open(\'' + quote.url + '\',\'_blank\')" title="查看原文">🔗 查看原文</a>';
    }
    document.getElementById('quoteSource').innerHTML = sourceHtml;

    // 收藏状态（统一从收藏夹读取，刷新后保持）
    const isFav = isFaved('quote', quote.id);
    const btn = document.getElementById('btnFavQuote');
    btn.innerHTML = isFav ? '❤️ 已收藏' : '🤍 收藏';
}

function newQuote() { showRandomQuote(document.getElementById('quoteThemeFilter').value); }

function filterQuotes() {
    const val = document.getElementById('quoteThemeFilter').value;
    showRandomQuote(val);
}

// （原 searchQuoteSource 已移除：数据无URL字段时不显示链接，有url字段则直接跳转原文）

function toggleFavQuote() {
    const quote = QUOTES_DB[currentQuoteIndex];
    if (!quote) return;
    let favs = JSON.parse(localStorage.getItem('favQuotes') || '[]');
    const idx = favs.indexOf(quote.id);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(quote.id);
    localStorage.setItem('favQuotes', JSON.stringify(favs));
    toggleFavBox('quote', quote.id, 'fav', quote);
    const btn = document.getElementById('btnFavQuote');
    btn.innerHTML = favs.includes(quote.id) ? '❤️ 已收藏' : '🤍 收藏';
}

function checkinQuote() {
    const quote = QUOTES_DB[currentQuoteIndex];
    if (!quote) return;
    const today = new Date().toISOString().split('T')[0];
    let checkins = JSON.parse(localStorage.getItem('quoteCheckins') || '{}');
    if (!checkins[today]) checkins[today] = [];
    if (!checkins[today].includes(quote.id)) {
        checkins[today].push(quote.id);
        localStorage.setItem('quoteCheckins', JSON.stringify(checkins));
        alert('✅ 打卡成功！今日已背诵此条金句。');
        loadCheckinStats();
    } else {
        alert('今天已经打过这条卡啦～换一条试试？');
    }
}

function loadCheckinStats() {
    const checkins = JSON.parse(localStorage.getItem('quoteCheckins') || '{}');
    let total = 0;
    Object.values(checkins).forEach(arr => total += arr.length);

    // 计算连续天数
    const dates = Object.keys(checkins).sort().reverse();
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        if (checkins[key] && checkins[key].length > 0) streak++;
        else break;
    }

    const streakEl = document.getElementById('streakDays');
    const totalEl = document.getElementById('totalCheckins');
    if (streakEl) streakEl.textContent = streak;
    if (totalEl) totalEl.textContent = total;
}

let currentEssayTag = 'all';  // 范文库当前筛选标签

function renderEssayList() {
    const container = document.getElementById('essayList');
    if (!container) return;

    let list = ESSAYS_DB;
    // 按标签筛选
    if (currentEssayTag && currentEssayTag !== 'all') {
        list = list.filter(function(e) {
            return (e.tags || []).indexOf(currentEssayTag) !== -1;
        });
    }

    if (list.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px 16px;color:#999;"><div style="font-size:36px;margin-bottom:8px;">📭</div><div>该分类下暂无范文</div><div style="font-size:12px;margin-top:6px;">试试其他标签</div></div>';
        return;
    }

    container.innerHTML = list.map(essay => `
            <div class="essay-card" id="essay-${essay.id}">
            <div class="essay-card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <span class="essay-title">${essay.title}</span>
                <div class="news-actions">
                    <button class="action-btn ${isFaved('shenlun', essay.id) ? 'liked' : ''}" onclick="toggleEssayLike('${essay.id}', this)">👍 ${Number(essay.likes) || 0}</button>
                    <span class="essay-type-badge ${essay.type}">${essay.typeName}</span>
                </div>
            </div>
            <div style="padding:10px 16px;font-size:12px;color:#888;">
                📌 ${essay.tags.join(' · ')} | 📖 ${essay.source}
            </div>
            <div class="essay-body" id="essay-body-${essay.id}">
                <div class="essay-body-content">${essay.content}</div>
            </div>
            <div class="essay-actions">
                <button class="btn-pink btn-sm" onclick="toggleEssayBody('${essay.id}')">展开/收起</button>
                <button class="btn-outline btn-sm" onclick="exportEssayPDF('${essay.id}')">📥 导出PDF</button>
                <button class="btn-outline btn-sm" onclick="copyEssayFull('${essay.id}')">📋 复制原文</button>
            </div>
        </div>
    `).join('');
}

function toggleEssayBody(id) {
    const el = document.getElementById(`essay-body-${id}`);
    el.classList.toggle('expanded');
}

function filterEssays(tag, btn) {
    currentEssayTag = tag;
    // 更新按钮状态
    document.querySelectorAll('#essayTagFilters .tag-btn').forEach(function(b) {
        b.classList.toggle('active', b === btn);
    });
    renderEssayList();
}

/* ========== 今日晨读模块 ========== */
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (!sb) return;
    const isCollapsed = sb.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
    if (ov) ov.classList.toggle('show', !isCollapsed);
    // 更新按钮文字
    const btn = document.getElementById('sidebarToggle');
    if (btn) btn.textContent = isCollapsed ? '☰' : '✕';
}

// 点击主内容区域时自动收起侧边栏（手机端）
document.addEventListener('click', function(e) {
    const sb = document.getElementById('sidebar');
    if (!sb || sb.classList.contains('collapsed')) return;
    // 如果点击的是主内容区且不是导航项
    const contentArea = document.getElementById('contentArea');
    if (contentArea && contentArea.contains(e.target)) {
        // 只在手机端自动收起
        if (window.innerWidth <= 768) {
            sb.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            const ov = document.getElementById('sidebarOverlay');
            if (ov) ov.classList.remove('show');
            const btn = document.getElementById('sidebarToggle');
            if (btn) btn.textContent = '☰';
        }
    }
});

function renderMorningList() {
    const container = document.getElementById('morningList');
    if (!container) return;

    let list = [...MORNING_DB];
    if (currentMorningSource !== 'all') {
        list = list.filter(m => m.source === currentMorningSource);
    }

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#999;">
            <div style="font-size:40px;margin-bottom:10px;">🌅</div>
            <div>暂无晨读内容</div>
            <div style="font-size:12px;margin-top:6px;">每日自动更新权威媒体评论</div>
        </div>`;
        return;
    }

    container.innerHTML = list.map(function(item, idx) {
        var displayDate = item.date || '今日';
        var tagsHtml = item.tags && item.tags.length
            ? ('<div class="morning-tags">' + item.tags.map(function(t) { return '<span class="morning-tag">#' + t + '</span>'; }).join('') + '</div>')
            : '';
        return '<div class="morning-card" id="morning-' + item.id + '">' +
            '<div class="morning-card-header">' +
                '<span class="morning-source-tag">' + (item.source || '权威媒体') + '</span>' +
                '<span class="morning-date">📅 ' + displayDate + '</span>' +
            '</div>' +
            '<div class="morning-title" onclick="toggleMorningExpand(\'' + item.id + '\')">' + (item.title || '') + '</div>' +
            tagsHtml +
            '<div class="morning-summary" id="morning-summary-' + item.id + '">' + ((item.content || '').slice(0, 200)) + '</div>' +
            '<div class="morning-full-content" id="morning-full-' + item.id + '">' + ((item.content || '').replace(/\n/g, '<br>')) + '</div>' +
            '<button class="morning-expand-btn" id="morning-expand-btn-' + item.id + '" onclick="toggleMorningExpand(\'' + item.id + '\')">展开 ▾</button>' +
            '<div class="morning-card-actions">' +
                '<button class="action-btn" onclick="toggleMorningLike(' + idx + ', this)">👍 0</button>' +
                '<button class="action-btn" onclick="toggleFavMorning(\'' + item.id + '\', this)">🤍</button>' +
            '</div>' +
        '</div>';
    }).join('');

    // 更新来源标签
    renderMorningSources();
    updateMorningInfo();
}

function toggleMorningExpand(id) {
    const summary = document.getElementById(`morning-summary-${id}`);
    const full = document.getElementById(`morning-full-${id}`);
    const btn = document.getElementById(`morning-expand-btn-${id}`);
    if (!summary || !full || !btn) return;
    const isExpanded = full.classList.contains('show');
    summary.classList.toggle('expanded', !isExpanded);
    full.classList.toggle('show', !isExpanded);
    btn.textContent = isExpanded ? '展开 ▾' : '收起 ▴';
}

function toggleMorningLike(idx, btnEl) {
    if (!btnEl) return;
    const liked = btnEl.classList.toggle('liked');
    const txt = btnEl.textContent.trim();
    const num = parseInt(txt) || 0;
    btnEl.textContent = `👍 ${liked ? num + 1 : num - 1}`;
}

function toggleFavMorning(id, btnEl) {
    const item = MORNING_DB.find(m => m.id === id);
    if (!item) return;
    if (isFaved('morning', id)) {
        removeFav('morning', id);
        if (btnEl) { btnEl.textContent = '🤍'; btnEl.classList.remove('liked'); }
    } else {
        addFav('morning', id, 'morning', item);
        if (btnEl) { btnEl.textContent = '❤️'; btnEl.classList.add('liked'); }
    }
}

function refreshMorning() {
    // 随机打乱顺序展示（换一批效果）
    for (let i = MORNING_DB.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [MORNING_DB[i], MORNING_DB[j]] = [MORNING_DB[j], MORNING_DB[i]];
    }
    renderMorningList();
}

function showMorningHistory() {
    // 切换到显示全部模式（取消来源过滤）
    currentMorningSource = 'all';
    renderMorningList();
    // 滚动到顶部
    const panel = document.getElementById('panel-morning');
    if (panel) panel.scrollTop = 0;
}

function renderMorningSources() {
    const container = document.getElementById('morningSources');
    if (!container) return;
    const sources = [...new Set(MORNING_DB.map(m => m.source).filter(Boolean))];
    if (sources.length <= 1) { container.innerHTML = ''; return; }
    let html = '<button class="source-btn ' + (currentMorningSource === 'all' ? 'active' : '') + '" onclick="currentMorningSource=\'all\';renderMorningList()">全部</button>';
    sources.forEach(s => {
        html += '<button class="source-btn ' + (currentMorningSource === s ? 'active' : '') + '" onclick="currentMorningSource=\'' + s.replace(/'/g, "\\'") + '\';renderMorningList()">' + s + '</button>';
    });
    container.innerHTML = html;
}

function updateMorningInfo() {
    const el = document.getElementById('morningUpdateInfo');
    if (el) el.textContent = '共 ' + MORNING_DB.length + ' 篇';
    // 设置日期标签
    const dateLabel = document.getElementById('morningDateLabel');
    if (dateLabel) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        dateLabel.textContent = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} 晨读 · 权威媒体评论每日精选`;
    }
}

function initMorning() {
    renderMorningList();
}

function copyEssayFull(id) {
    const essay = ESSAYS_DB.find(e => e.id === id);
    if (essay) {
        navigator.clipboard.writeText(essay.content).then(() => {
            alert('✅ 完整范文已复制到剪贴板！');
        }).catch(() => {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = essay.content; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            alert('✅ 已复制！');
        });
    }
}

function exportEssayPDF(id) {
    const essay = ESSAYS_DB.find(e => e.id === id);
    if (!essay) return;
    // 使用浏览器打印功能模拟导出
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html><head><title>${essay.title}</title>
        <style>body{font-family:serif;padding:40px;line-height:2.2;font-size:15px;}h1{text-align:center;}</style>
        </head><body>
        <h1>${essay.title}</h1>
        <p style="text-align:center;color:#666;">${essay.typeName} | ${essay.source}</p>
        <hr/>
        <pre style="white-space:pre-wrap;font-family:inherit;">${essay.content}</pre>
        </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// ================================================================
// 模块3: 求是网文章
// ================================================================
function initQiushi() {
    renderQiushiArticles();
    bindQiushiTags();
}

function renderQiushiArticles(filter = 'all', searchQuery = '') {
    const container = document.getElementById('qiushiArticleList');
    if (!container) return;

    let articles = [...QIUSHI_ARTICLES];

    if (filter !== 'all') {
        const tagMap = { 'jiceng': '基层治理', 'jingji': '经济发展', 'dangjian': '党建', 'sannong': '三农', 'wenlv': '文旅', 'quyu': '区域发展(湖北中部崛起)' };
        articles = articles.filter(a => a.tags.includes(tagMap[filter]));
    }

    if (searchQuery) {
        articles = articles.filter(a =>
            a.title.includes(searchQuery) ||
            a.analysis.mainPoint.includes(searchQuery) ||
            a.originalText.includes(searchQuery)
        );
    }

    container.innerHTML = articles.map(function(article) {
        var summary = (article.analysis.mainPoint || '').slice(0, 150);
        return '<div class="qiushi-article" id="qiushi-' + article.id + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
                '<div class="qiushi-title" style="cursor:pointer;" onclick="toggleQiushiExpand(\'' + article.id + '\')">' + article.title + '</div>' +
                '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                    '<button class="action-btn ' + (isFaved('qiushi', article.id) ? 'liked' : '') + '" onclick="toggleQiushiLike(' + article.id + ', this)">👍 ' + (Number(article.likes) || 0) + '</button>' +
                    '<button class="btn-outline btn-sm" onclick="toggleQiushiExpand(\'' + article.id + '\')" style="font-size:12px;padding:2px 8px;">展开 ▾</button>' +
                '</div>' +
            '</div>' +
            '<div class="qiushi-tags-row">' +
                article.tags.map(function(t) { return '<span class="qiushi-tag">' + t + '</span>'; }).join('') +
            '</div>' +

            /* 折叠时显示摘要 */
            '<div class="qiushi-summary" id="qiushi-summary-' + article.id + '">' + summary + (summary.length >= 150 ? '...' : '') + '</div>' +

            /* 展开后的完整分析（默认隐藏） */
            '<div class="qiushi-analysis" id="qiushi-analysis-' + article.id + '" style="display:none;">' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">📌 中心论点</div>' +
                    '<div class="qiushi-analysis-content">' + article.analysis.mainPoint + '</div>' +
                '</div>' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">🔑 分论点</div>' +
                    '<div class="qiushi-analysis-content">' +
                        article.analysis.subPoints.map(function(p, i) { return (i+1) + '. ' + p; }).join('<br/>') +
                    '</div>' +
                '</div>' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">📋 政策表述</div>' +
                    '<div class="qiushi-analysis-content">' +
                        article.analysis.policyExpressions.map(function(p) { return '· "' + p + '"'; }).join('<br/>') +
                    '</div>' +
                '</div>' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">✨ 高级书面话术</div>' +
                    '<div class="qiushi-analysis-content">' +
                        article.analysis.advancedPhrases.map(function(p) { return '· ' + p; }).join('<br/>') +
                    '</div>' +
                '</div>' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">🕐 时政背景</div>' +
                    '<div class="qiushi-analysis-content">' + article.analysis.background + '</div>' +
                '</div>' +
                '<div class="qiushi-analysis-section">' +
                    '<div class="qiushi-analysis-label">🛠️ 对策模板</div>' +
                    '<div class="qiushi-analysis-content">' +
                        article.analysis.countermeasures.map(function(c, i) { return (i+1) + '. ' + c; }).join('<br/>') +
                    '</div>' +
                '</div>' +
            '</div>' +

            /* 操作按钮（始终可见） */
            '<div class="qiushi-actions" id="qiushi-actions-' + article.id + '">' +
                '<button class="btn-outline btn-sm" onclick="showQiushiOriginal(' + article.id + ')">📄 查看完整原文</button>' +
                '<button class="btn-outline btn-sm" onclick="copyQiushiAnalysis(' + article.id + ')">📋 复制拆解内容</button>' +
                '<button class="btn-outline btn-sm" onclick="exportQiushiMaterial(' + article.id + ')">📥 导出对策素材</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

/* 求是网文章折叠/展开 */
function toggleQiushiExpand(id) {
    var analysis = document.getElementById('qiushi-analysis-' + id);
    var summary = document.getElementById('qiushi-summary-' + id);
    if (!analysis) return;
    var isHidden = analysis.style.display === 'none';
    analysis.style.display = isHidden ? 'block' : 'none';
    if (summary) summary.style.display = isHidden ? 'none' : 'block';
    // 更新按钮文字
    var btns = document.querySelectorAll('#qiushi-' + id + ' .btn-outline');
    btns.forEach(function(b) {
        if (b.textContent.indexOf('展开') >= 0) b.textContent = isHidden ? '收起 ▴' : '展开 ▾';
    });
}

function bindQiushiTags() {
    document.querySelectorAll('#qiushiTags .tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#qiushiTags .tag-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentQiushiTag = btn.dataset.tag;
            renderQiushiArticles(currentQiushiTag, document.getElementById('qiushiSearchInput')?.value || '');
        });
    });
}

function searchQiushi() {
    const query = document.getElementById('qiushiSearchInput')?.value || '';
    renderQiushiArticles(currentQiushiTag, query);
}

function showQiushiOriginal(id) {
    const article = QIUSHI_ARTICLES.find(a => a.id === id);
    if (!article) return;
    const modal = document.getElementById('articleModal');
    const title = document.getElementById('articleModalTitle');
    const body = document.getElementById('articleModalBody');
    title.textContent = `📄 《${article.title}》完整原文`;
    body.innerHTML = `<div class="qiushi-original-text" style="max-height:70vh;">${article.originalText}</div>`;
    modal.style.display = 'flex';
}

function closeArticleModal() {
    document.getElementById('articleModal').style.display = 'none';
}

function copyQiushiAnalysis(id) {
    const article = QIUSHI_ARTICLES.find(a => a.id === id);
    if (!article) return;
    const text = `【${article.title}】\n\n中心论点: ${article.analysis.mainPoint}\n\n分论点:\n${article.analysis.subPoints.map((p,i)=>`${i+1}. ${p}`).join('\n')}\n\n政策表述:\n${article.analysis.policyExpressions.map(p=>`"${p}"`).join('\n')}\n\n高级话术:\n${article.analysis.advancedPhrases.join('\n')}\n\n对策模板:\n${article.analysis.countermeasures.map((c,i)=>`${i+1}. ${c}`).join('\n')}`;
    navigator.clipboard.writeText(text).then(() => alert('✅ 拆解内容已复制！')).catch(() => alert('复制失败，请手动选择复制'));
}

function exportQiushiMaterial(id) {
    const article = QIUSHI_ARTICLES.find(a => a.id === id);
    if (!article) return;
    const text = `《${article.title}》对策素材\n${'='.repeat(30)}\n\n【中心论点】\n${article.analysis.mainPoint}\n\n【分论点】\n${article.analysis.subPoints.map((p,i)=>`${i+1}. ${p}`).join('\n')}\n\n【对策模板】\n${article.analysis.countermeasures.map((c,i)=>`${i+1}. ${c}`).join('\n')}\n\n【政策表述】\n${article.analysis.policyExpressions.join('\n')}\n\n【高级书面话术】\n${article.analysis.advancedPhrases.join('\n')}`;
    downloadFile(text, `${article.title}_对策素材.txt`, 'text/plain');
}

// ================================================================
// 模块4: 人物素材库
// ================================================================
function initRenwu() {
    showRenwuDaily();
    renderRenwuList();
    bindRenwuCategories();
}

function showRenwuDaily() {
    const idx = Math.floor(Math.random() * RENWU_DATABASE.length);
    currentRenwuDailyIndex = idx;
    const person = RENWU_DATABASE[idx];
    const card = document.getElementById('renwuDailyCard');
    card.innerHTML = `
        <div class="renwu-daily-header">
            <span class="renwu-daily-title">⭐ 今日推荐人物</span>
        </div>
        <div class="renwu-daily-name">${person.name}</div>
        <span class="renwu-daily-category">${person.categoryName}</span>
        <div class="renwu-daily-story">${person.story}</div>
        <div>
            ${person.themes.map(t => `<span class="renwu-theme-tag">${t}</span>`).join('')}
        </div>
        <div class="renwu-paragraph">
            <strong>可直接套用段落：</strong><br/>${person.paragraph}
        </div>
        <div class="renwu-golden-sentence">💎 ${person.goldenSentence}</div>
        <div class="renwu-daily-actions">
            <button class="btn-pink btn-sm" onclick="generateShenlunPara('${person.id}')">✍️ 生成申论段落</button>
            <button class="btn-outline btn-sm" onclick="toggleFavRenwu('${person.id}')">🤍 收藏</button>
            <button class="btn-outline btn-sm" onclick="showRenwuOriginal('${person.id}')">📄 查看原文</button>
        </div>
    `;
}

/** 统一查人（兼容数字 id 与字符串 id） */
function findRenwu(id) {
    return RENWU_DATABASE.find(p => String(p.id) === String(id));
}

/**
 * 查看人物完整原文
 * 有抓取到的官方原文 → 应用内渲染完整段落（零截断）
 * 没有原文 → 跳官方站内检索页
 */
function showRenwuOriginal(id) {
    const person = findRenwu(id);
    if (!person) return;

    const hasFull = Array.isArray(person.paragraphs) && person.paragraphs.length > 0;
    const modal = document.getElementById('articleModal');
    document.getElementById('articleModalTitle').textContent = `📄 ${person.name} · 官方报道原文`;

    if (!hasFull) {
        const url = person.searchUrl || person.originalUrl;
        document.getElementById('articleModalBody').innerHTML = `
            <div style="line-height:1.9;">
                <div style="background:#FFF0F5;border-radius:8px;padding:14px;border-left:3px solid #FFB6C1;">
                    这条素材暂未抓取到官方原文全文。可点下方按钮前往官方平台检索 <strong>${person.name}</strong> 的原始报道。
                </div>
                <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                    ${url && url !== '#' ? `<button class="btn-pink btn-sm" onclick="window.open('${url}','_blank')">🔗 共产党员网检索</button>` : ''}
                    <button class="btn-outline btn-sm" onclick="window.open('https://search.12371.cn/search.php?t=newsmerge&client=no&q=${encodeURIComponent(person.name)}','_blank')">🔍 站内搜索</button>
                </div>
            </div>`;
        modal.style.display = 'flex';
        return;
    }

    const src = person.articleTitle || person.name;
    document.getElementById('articleModalBody').innerHTML = `
        <div class="original-wrap">
            <div class="original-meta">
                <strong>${src}</strong><br/>
                <span style="font-size:12px;color:#999;">
                    来源：${person.source}${person.date ? ' · ' + person.date : ''} · 全文 ${person.wordCount || person.fullText.length} 字 · 官方原文未删减
                </span>
            </div>
            <div class="original-body">
                ${person.paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}
            </div>
            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn-pink btn-sm" onclick="window.open('${person.originalUrl}','_blank')">🔗 前往官网</button>
                <button class="btn-outline btn-sm" onclick="copyRenwuOriginal('${person.id}')">📋 复制全文</button>
            </div>
        </div>`;
    modal.style.display = 'flex';
}

function copyRenwuOriginal(id) {
    const person = findRenwu(id);
    if (!person || !person.fullText) return;
    navigator.clipboard.writeText(person.fullText)
        .then(() => alert('✅ 完整原文已复制到剪贴板'))
        .catch(() => alert('复制失败，请手动选中文本复制'));
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function newRenwuDaily() { showRenwuDaily(); }

function generateShenlunPara(id) {
    const person = findRenwu(id);
    if (!person) return;
    const para = `${person.name}，${person.categoryName}。${person.story.slice(0, 80)}……${person.paragraph}${person.goldenSentence}`;
    navigator.clipboard.writeText(para).then(() => {
        alert('✅ 适配申论段落已生成并复制到剪贴板！\n\n可直接粘贴到作文中使用。');
    }).catch(() => alert('生成成功！请手动复制以下内容：\n' + para));
}

function toggleFavRenwu(id) {
    id = String(id);
    const person = findRenwu(id);
    let favs = JSON.parse(localStorage.getItem('favRenwu') || '[]').map(String);
    const idx = favs.indexOf(id);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(id);
    localStorage.setItem('favRenwu', JSON.stringify(favs));
    toggleFavBox('renwu', id, 'fav', person);
    alert(favs.includes(id) ? '❤️ 已收藏' : '已取消收藏');
    showRenwuDaily(); // 刷新当前卡片
    renderRenwuList(); // 刷新列表收藏高亮
}

function bindRenwuCategories() {
    document.querySelectorAll('#renwuCategories .cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#renwuCategories .cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRenwuCat = btn.dataset.cat;
            renderRenwuList();
        });
    });
}

function searchRenwu() {
    renderRenwuList();
}

function renderRenwuList() {
    const container = document.getElementById('renwuList');
    if (!container) return;
    const query = document.getElementById('renwuSearchInput')?.value?.toLowerCase() || '';

    let list = [...RENWU_DATABASE];
    if (currentRenwuCat !== 'all') {
        list = list.filter(p => p.category === currentRenwuCat);
    }
    if (query) {
        list = list.filter(p =>
            p.name.toLowerCase().includes(query) ||
            p.themes.some(t => t.toLowerCase().includes(query)) ||
            p.story.toLowerCase().includes(query)
        );
    }

    container.innerHTML = list.map(person => `
            <div class="renwu-card" id="renwu-${person.id}">
            <div class="renwu-card-name">${person.name} <span style="font-weight:400;font-size:12px;color:#FFB6C1;">· ${person.categoryName}</span></div>
            <div class="renwu-card-meta">${person.themes.join(' | ')}</div>
            <div class="renwu-card-brief">${person.story.slice(0, 120)}...</div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <button class="action-btn ${isFaved('renwu', person.id) ? 'liked' : ''}" onclick="toggleRenwuLike('${person.id}', this)">👍 ${Number(person.likes) || 0}</button>
                <button class="btn-outline btn-sm" onclick="showRenwuDetail('${person.id}')">查看详情</button>
                <button class="btn-pink btn-sm" onclick="showRenwuOriginal('${person.id}')">📄 查看原文</button>
                <button class="btn-outline btn-sm" onclick="generateShenlunPara('${person.id}')">生成段落</button>
            </div>
        </div>
    `).join('');
}

function showRenwuDetail(id) {
    const person = findRenwu(id);
    if (!person) return;
    const hasFull = Array.isArray(person.paragraphs) && person.paragraphs.length > 0;
    const modal = document.getElementById('articleModal');
    document.getElementById('articleModalTitle').textContent = `⭐ ${person.name} - 详细素材`;
    document.getElementById('articleModalBody').innerHTML = `
        <div style="line-height:1.8;">
            <p><strong>分类：</strong>${person.categoryName}</p>
            <p><strong>适用主题：</strong>${person.themes.join('、')}</p>
            <hr style="margin:12px 0;border:none;border-top:1px dashed #FFB6C1;"/>
            <h4 style="color:#E891A3;">人物事迹</h4>
            <p>${person.story}</p>
            <h4 style="color:#E891A3;">可直接套用段落</h4>
            <div style="background:#FDF6F0;padding:12px;border-radius:8px;border-left:3px solid #FFB6C1;">
                ${person.paragraph}
            </div>
            <h4 style="color:#E891A3;">高分金句结尾</h4>
            <div style="background:linear-gradient(135deg,#FFF8F0,#FFF0F5);padding:12px;border-radius:8px;font-style:italic;">
                ${(person.goldenSentences && person.goldenSentences.length
            ? person.goldenSentences.map(g => `💎 ${g}`).join('<br/><br/>')
            : (person.goldenSentence || '—'))}
            </div>
            ${hasFull ? `
            <h4 style="color:#E891A3;margin-top:16px;">📄 完整原文（官方原生文本 · 未删减）</h4>
            <div class="original-meta">
                <strong>${person.articleTitle || person.name}</strong><br/>
                <span style="font-size:12px;color:#999;">${person.source}${person.date ? ' · ' + person.date : ''} · 全文 ${person.wordCount || person.fullText.length} 字</span>
            </div>
            <div class="original-body">
                ${person.paragraphs.map(p => `<p>${escapeHTML(p)}</p>`).join('')}
            </div>` : ''}
            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <button class="action-btn ${isFaved('renwu', person.id) ? 'liked' : ''}" onclick="toggleRenwuLike('${person.id}', this)">👍 ${Number(person.likes) || 0}</button>
                ${person.originalUrl && person.originalUrl !== '#'
            ? `<button class="btn-pink btn-sm" onclick="window.open('${person.originalUrl}','_blank')">🔗 前往官网</button>` : ''}
                ${hasFull ? `<button class="btn-outline btn-sm" onclick="copyRenwuOriginal('${person.id}')">📋 复制全文</button>` : ''}
                <button class="btn-outline btn-sm" onclick="window.open('https://search.12371.cn/search.php?t=newsmerge&client=no&q=${encodeURIComponent(person.name)}','_blank')">🔍 官方检索</button>
            </div>
            <p style="margin-top:12px;font-size:12px;color:#999;">来源: ${person.source}</p>
        </div>
    `;
    modal.style.display = 'flex';
}

// ================================================================
// 模块5: 资料分析速算
// ================================================================
function initSusuan() {
    renderFormulaCards();
    renderBaifenbiTable();
    initPracticeMode();
    loadErrorList();
    renderSpeedMultiList();
}

function switchSusuanTab(tab) {
    document.querySelectorAll('.susuan-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
    document.querySelectorAll('.susuan-panel').forEach(p => p.classList.toggle('active', p.id === `susuan-${tab}`));
}

// ========== 多解法速算模块 ==========
let currentMmCategory = 'all';
let mmOriginalOrder = [];
let mmShowSolutions = false; // false=做题模式(隐藏解法), true=看解法模式

function renderSpeedMultiList() {
    const container = document.getElementById('mmList');
    if (!container) return;
    const db = (typeof SPEED_MULTI_DB !== 'undefined') ? SPEED_MULTI_DB : [];
    if (db.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;"><div style="font-size:36px;">🔢</div><div>题库加载中...</div></div>';
        return;
    }
    // 保存原始顺序（首次）
    if (mmOriginalOrder.length !== db.length) mmOriginalOrder = db.map(function(x) { return x.id; });

    let list = db;
    if (currentMmCategory && currentMmCategory !== 'all') {
        list = db.filter(function(q) { return q.category === currentMmCategory; });
    }

    document.getElementById('mmCount').textContent = '共 ' + list.length + ' 题';

    container.innerHTML = list.map(function(q, idx) {
        var methodsHtml = q.methods.map(function(m, mi) {
            return '<div class="mm-method' + (mi === 0 ? ' mm-method-best' : '') + '" data-mid="' + q.id + '-' + mi + '" onclick="toggleSpeedMethod(this)">' +
                '<div class="mm-method-header">' +
                    '<span class="mm-method-name">' + m.name + '</span>' +
                    '<span class="mm-speed">' + m.speedRating + '</span>' +
                    '<span class="mm-toggle">▼</span>' +
                '</div>' +
                '<div class="mm-method-body">' +
                    '<div class="mm-steps">' + m.steps.map(function(s) { return '<div class="mm-step">' + s + '</div>'; }).join('') + '</div>' +
                    '<div class="mm-insight">💡 ' + m.insight + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        return '<div class="mm-card" id="mm-' + q.id + '">' +
            '<div class="mm-q-header">' +
                '<span class="mm-idx">#' + (idx + 1) + '</span>' +
                '<span class="mm-cat">' + q.category + '</span>' +
                '<span class="mm-diff">' + q.difficulty + '</span>' +
            '</div>' +
            '<div class="mm-question">' + q.question + '</div>' +
            '<div class="mm-options">' + q.options.join('　') + '</div>' +
            (mmShowSolutions
                ? '<div class="mm-answer">✅ 答案：<b>' + q.answer + '</b></div>' +
                  '<div class="mm-methods-label">📐 多种解法（点击展开）：</div>' +
                  '<div class="mm-methods">' + methodsHtml + '</div>'
                : '<div class="mm-answer-blind" id="mm-blind-' + q.id + '">' +
                    '<button class="btn-pink btn-sm" onclick="this.parentElement.innerHTML=\'<div class=\\\'mm-answer\\\'>✅ 答案：<b>' + q.answer + '</b></div><div class=\\\'mm-methods-label\\\'>📐 多种解法（点击展开）：</div><div class=\\\'mm-methods\\\'>' + methodsHtml.replace(/'/g, "\\'") + '</div>\';this.parentElement.classList.remove(\\\'mm-answer-blind\\\');">👁 查看答案与解法</button>' +
                    '<div style="font-size:11px;color:#999;margin-top:4px;">先自己算一算，再看答案和解法～</div>' +
                  '</div>'
            ) +
        '</div>';
    }).join('');
}

function filterSpeedMulti() {
    var sel = document.getElementById('mmCatFilter');
    currentMmCategory = sel ? sel.value : 'all';
    renderSpeedMultiList();
}

function toggleSpeedMethod(el) {
    if (!el) return;
    var isExpanded = el.classList.contains('expanded');
    // 先收起同题其他展开的解法（手风琴效果）
    var parent = el.closest('.mm-methods');
    if (parent) {
        parent.querySelectorAll('.mm-method.expanded').forEach(function(m) { m.classList.remove('expanded'); });
    }
    // 切换当前
    if (!isExpanded) {
        el.classList.add('expanded');
    }
}

function shuffleSpeedMulti() {
    if (typeof SPEED_MULTI_DB === 'undefined' || !SPEED_MULTI_DB.length) return;
    // Fisher-Yates shuffle in place
    for (var i = SPEED_MULTI_DB.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = SPEED_MULTI_DB[i];
        SPEED_MULTI_DB[i] = SPEED_MULTI_DB[j];
        SPEED_MULTI_DB[j] = tmp;
    }
    renderSpeedMultiList();
}

/* 切换做题/看解法模式 */
function toggleMmShowSolutions() {
    mmShowSolutions = !mmShowSolutions;
    renderSpeedMultiList();
    // 更新按钮文字
    var btn = document.getElementById('mmToggleSolBtn');
    if (btn) btn.textContent = mmShowSolutions ? '🙈 隐藏解法（做题模式）' : '👁 显示全部解法';
}

function renderFormulaCards() {
    const container = document.getElementById('formulaCards');
    if (!container) return;
    container.innerHTML = FORMULAS_DB.map(f => `
        <div class="formula-card">
            <div class="formula-card-header" onclick="toggleFormulaCard(this)">
                <span>📋 ${f.title} <small style="font-weight:400;color:#999;">[${f.category}]</small></span>
                <span class="formula-card-arrow">▶</span>
            </div>
            <div class="formula-card-body">
                <div class="formula-formula">${f.formula}</div>
                <div class="formula-content">${f.content.replace(/\n/g, '<br/>')}</div>
            </div>
        </div>
    `).join('');
}

function toggleFormulaCard(header) {
    header.classList.toggle('open');
    const body = header.nextElementSibling;
    body.classList.toggle('open');
}

function renderBaifenbiTable() {
    const container = document.getElementById('baifenbiTable');
    if (!container) return;
    // 按百分数数值排序
    var sorted = BAIFENBI_TABLE.slice().sort(function(a, b) { return parseFloat(a.percent) - parseFloat(b.percent); });
    // 分组：必背 > 常用 > 其他
    var mustKnow = sorted.filter(function(b) { return b.note && b.note.indexOf('必背') >= 0; });
    var common = sorted.filter(function(b) { return b.note && b.note.indexOf('常用') >= 0; });
    var basic = sorted.filter(function(b) { return (!b.note || (b.note.indexOf('必背') < 0 && b.note.indexOf('常用') < 0)); });

    function renderGroup(title, items, cls) {
        if (items.length === 0) return '';
        var html = '<div class="bfb-group ' + cls + '">' +
            '<div class="bfb-group-header">' + title + ' <span class="bfb-group-count">' + items.length + '条</span></div>' +
            '<div class="bfb-grid">';
        items.forEach(function(b) {
            html += '<div class="bfb-cell">' +
                '<span class="bfb-pct">' + b.percent + '</span>' +
                '<span class="bfb-frac">' + b.fraction + '</span>' +
            '</div>';
        });
        html += '</div></div>';
        return html;
    }

    container.innerHTML =
        '<div class="bfb-legend">⭐必背（考试高频）　🔥常用（建议熟记）　其余为基础参考 · 共' + sorted.length + '条</div>' +
        renderGroup('⭐ 必背', mustKnow, 'bfb-g-must') +
        renderGroup('🔥 常用', common, 'bfb-g-common') +
        renderGroup('📋 基础', basic, 'bfb-g-basic');
}

// 练习模式
function initPracticeMode() {
    practiceState.questions = shuffleArray([...PRACTICE_QUESTIONS]).slice(0, 10);
    practiceState.currentIndex = 0;
    practiceState.correct = 0;
    practiceState.wrong = 0;
    practiceState.active = false;
    showPracticeQuestion();
}

function startPractice() {
    if (practiceState.active) return;
    practiceState.active = true;
    practiceState.startTime = Date.now();
    practiceState.timerInterval = setInterval(updatePracticeTimer, 1000);
    showPracticeQuestion();
}

function updatePracticeTimer() {
    if (!practiceState.startTime) return;
    const elapsed = Math.floor((Date.now() - practiceState.startTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    const el = document.getElementById('practiceTimer');
    if (el) el.textContent = `⏱️ 用时: ${min}:${sec}`;
}

function showPracticeQuestion() {
    if (practiceState.currentIndex >= practiceState.questions.length) {
        endPractice();
        return;
    }
    const q = practiceState.questions[practiceState.currentIndex];
    const qEl = document.getElementById('practiceQuestion');
    const progressEl = document.getElementById('practiceProgress');
    const barEl = document.getElementById('practiceProgressBar');
    if (qEl) qEl.innerHTML = `<div><small style="color:#FFB6C1;">[${q.type}]</small><br/><br/>${q.q}</div>`;
    if (progressEl) progressEl.textContent = `第 ${practiceState.currentIndex + 1}/10 题`;
    if (barEl) barEl.style.width = `${((practiceState.currentIndex + 1) / 10) * 100}%`;

    const answerInput = document.getElementById('practiceAnswer');
    if (answerInput) answerInput.value = '';
    const resultEl = document.getElementById('practiceResult');
    if (resultEl) { resultEl.className = 'practice-result'; resultEl.style.display = 'none'; }

    if (!practiceState.active) startPractice();
}

function submitPracticeAnswer() {
    const input = document.getElementById('practiceAnswer');
    const resultEl = document.getElementById('practiceResult');
    if (!input || !resultEl) return;

    const userAns = input.value.trim();
    const q = practiceState.questions[practiceState.currentIndex];
    const correct = userAns === q.a || userAns.replace('%', '') === q.a.replace('%', '');

    if (correct) {
        practiceState.correct++;
        resultEl.className = 'practice-result correct';
        resultEl.innerHTML = `✅ 正确！答案: ${q.a}`;
    } else {
        practiceState.wrong++;
        resultEl.className = 'practice-result wrong';
        resultEl.innerHTML = `❌ 错误。正确答案: ${q.a}`;
        // 保存错题
        saveErrorQuestion(q, userAns);
    }
    resultEl.style.display = 'block';

    setTimeout(() => {
        practiceState.currentIndex++;
        showPracticeQuestion();
    }, 1200);
}

function endPractice() {
    clearInterval(practiceState.timerInterval);
    practiceState.active = false;
    const elapsed = practiceState.startTime ? Math.floor((Date.now() - practiceState.startTime) / 1000) : 0;
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const accuracy = ((practiceState.correct / 10) * 100).toFixed(1);

    const statsEl = document.getElementById('practiceStats');
    if (statsEl) statsEl.innerHTML = `
        <h4>📊 本次练习完成!</h4>
        <p>⏱️ 总用时: ${min}分${sec}秒</p>
        <p>✅ 正确: ${practiceState.correct} 题 | ❌ 错误: ${practiceState.wrong} 题</p>
        <p>📈 正确率: <strong style="color:#FFB6C1;font-size:20px;">${accuracy}%</strong></p>
        <button class="btn-pink" style="margin-top:12px;" onclick="initPracticeMode()">🔄 再练一轮</button>
    `;

    document.getElementById('practiceQuestion').innerHTML = '<p style="color:#999;">练习已完成！点击上方按钮重新开始。</p>';
    document.getElementById('practiceProgressBar').style.width = '100%';

    // 保存成绩
    savePracticeRecord({ date: new Date().toISOString(), correct: practiceState.correct, wrong: practiceState.wrong, time: elapsed });
}

// 错题本
function saveErrorQuestion(question, userAnswer) {
    let errors = JSON.parse(localStorage.getItem('susuanErrors') || '[]');
    errors.unshift({
        q: question.q, a: question.a, userAnswer,
        type: question.type, date: new Date().toISOString(),
        reason: '' // 用户后续可标记
    });
    localStorage.setItem('susuanErrors', JSON.stringify(errors.slice(0, 200)));
    loadErrorList();
}

function loadErrorList() {
    const container = document.getElementById('errorList');
    if (!container) return;
    const errors = JSON.parse(localStorage.getItem('susuanErrors') || '[]');
    if (errors.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#999;padding:30px;">暂无错题记录，继续加油！💪</p>';
        return;
    }
    container.innerHTML = errors.slice(0, 50).map((e, i) => `
        <div class="error-item">
            <div class="error-question"><strong>[${e.type}]</strong> ${e.q}</div>
            <div class="error-detail">你的答案: ${e.userAnswer || '(空)'} | 正确答案: ${e.a}</div>
            <select onchange="markErrorReason(${i}, this.value)" style="margin-top:4px;padding:2px 6px;border-radius:6px;border:1px solid #ddd;font-size:11px;">
                <option value="">标记错误原因...</option>
                <option value="截位失误" ${e.reason==='截位失误'?'selected':''}>截位失误</option>
                <option value="量级错误" ${e.reason==='量级错误'?'selected':''}>量级错误</option>
                <option value="计算粗心" ${e.reason==='计算粗心'?'selected':''}>计算粗心</option>
                <option value="知识点盲区" ${e.reason==='知识点盲区'?'selected':''}>知识点盲区</option>
            </select>
        </div>
    `).join('');
}

function markErrorReason(index, reason) {
    let errors = JSON.parse(localStorage.getItem('susuanErrors') || '[]');
    if (errors[index]) {
        errors[index].reason = reason;
        localStorage.setItem('susuanErrors', JSON.stringify(errors));
    }
}

function savePracticeRecord(record) {
    let records = JSON.parse(localStorage.getItem('practiceRecords') || '[]');
    records.push(record);
    localStorage.setItem('practiceRecords', JSON.stringify(records.slice(-365)));
}

// ================================================================
// 模块6: 每日计划
// ================================================================
function initPlan() {
    loadPlanItems();
    renderPlanStats();
    renderHistoryStats();
}

function getTodayKey() { return new Date().toISOString().split('T')[0]; }

function loadPlanItems() {
    const key = getTodayKey();
    let items = JSON.parse(localStorage.getItem(`plan_${key}`));
    if (!items) {
        items = DEFAULT_PLAN_ITEMS.map(i => ({ ...i }));
        localStorage.setItem(`plan_${key}`, JSON.stringify(items));
    }
    renderPlanTable(items);
}

function renderPlanTable(items) {
    const tbody = document.getElementById('planTableBody');
    if (!tbody) return;
    tbody.innerHTML = items.map(item => `
        <tr>
            <td><input type="checkbox" class="plan-checkbox" ${item.done ? 'checked' : ''} onchange="togglePlanDone('${item.id}', this.checked)"/></td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;background:${getCategoryColor(item.category)};color:#fff;">${item.category}</span></td>
            <td>${item.task}</td>
            <td><input type="range" class="plan-progress-slider" min="0" max="100" value="${item.progress}" onchange="updatePlanProgress('${item.id}', this.value)"/><span style="margin-left:6px;font-size:12px;color:#4A90D9;">${item.progress}%</span></td>
            <td><button class="btn-outline btn-sm" onclick="deletePlanItem('${item.id}')">删除</button></td>
        </tr>
    `).join('');
}

function getCategoryColor(cat) {
    const colors = { '行测': '#FFB6C1', '申论': '#E891A3', '资料分析': '#4A90D9', '常识时政': '#68C07D' };
    return colors[cat] || '#999';
}

function togglePlanDone(id, done) {
    const key = getTodayKey();
    let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
    const item = items.find(i => String(i.id) === String(id));
    if (item) { item.done = done; localStorage.setItem(`plan_${key}`, JSON.stringify(items)); }
    renderPlanStats();
}

function updatePlanProgress(id, progress) {
    const key = getTodayKey();
    let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
    const item = items.find(i => String(i.id) === String(id));
    if (item) { item.progress = parseInt(progress); localStorage.setItem(`plan_${key}`, JSON.stringify(items)); }
    loadPlanItems(); // 刷新显示
    renderPlanStats();
}

function addPlanItem() {
    showAppModal({
        title: '➕ 添加今日任务',
        fields: [
            { id: 'task', label: '任务内容', type: 'text', placeholder: '如：做2套言语真题' },
            { id: 'cat', label: '分类', type: 'select', options: ['行测', '申论', '资料分析', '常识时政'], value: '行测' }
        ],
        okText: '保存', cancelText: '取消',
        onOk: (v) => {
            const task = (v.task || '').trim();
            if (!task) { appAlert('请填写任务内容哦～'); return; }
            const cat = v.cat || '行测';
            const key = getTodayKey();
            let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
            items.push({ id: Date.now(), category: cat, task, done: false, progress: 0 });
            localStorage.setItem(`plan_${key}`, JSON.stringify(items));
            loadPlanItems();
            renderPlanStats();
        }
    });
}

function deletePlanItem(id) {
    const key = getTodayKey();
    let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
    items = items.filter(i => String(i.id) !== String(id));
    localStorage.setItem(`plan_${key}`, JSON.stringify(items));
    loadPlanItems();
    renderPlanStats();
}

function renderPlanStats() {
    const key = getTodayKey();
    const items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
    const doneCount = items.filter(i => i.done).length;
    const avgProgress = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length) : 0;

    const container = document.getElementById('planStats');
    if (!container) return;
    container.innerHTML = `
        <div class="plan-stat-card">
            <div class="plan-stat-value">${doneCount}/${items.length}</div>
            <div class="plan-stat-label">今日完成</div>
        </div>
        <div class="plan-stat-card">
            <div class="plan-stat-value">${avgProgress}%</div>
            <div class="plan-stat-label">平均进度</div>
        </div>
        <div class="plan-stat-card">
            <div class="plan-stat-value">${getStreakDays()}</div>
            <div class="plan-stat-label">连续备考天数</div>
        </div>
    `;
}

function getStreakDays() {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        const items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
        if (items.some(i => i.done)) streak++;
        else break;
    }
    return streak;
}

function renderHistoryStats() {
    const container = document.getElementById('planHistoryStats');
    if (!container) return;

    // 获取本月数据
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    let totalDone = 0, totalTasks = 0, daysActive = 0;

    for (let d = 1; d <= now.getDate(); d++) {
        const key = `${monthKey}-${String(d).padStart(2,'0')}`;
        const items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
        if (items.length > 0) {
            daysActive++;
            totalTasks += items.length;
            totalDone += items.filter(i => i.done).length;
        }
    }

    container.innerHTML = `
        <h4 style="margin-bottom:10px;color:#E891A3;">📊 本月统计 (${monthKey})</h4>
        <p>活跃天数: <strong>${daysActive}</strong> 天</p>
        <p>总任务数: <strong>${totalTasks}</strong> 项</p>
        <p>已完成: <strong>${totalDone}</strong> 项</p>
        <p>月度完成率: <strong style="color:#FFB6C1;">${totalTasks > 0 ? ((totalDone/totalTasks)*100).toFixed(1) : 0}%</strong></p>
        <p>连续备考: <strong style="color:#FFB6C1;">${getStreakDays()}</strong> 天</p>
    `;
}

// 每日5点自动重置检查
function checkDailyReset() {
    const lastReset = localStorage.getItem('lastPlanResetDate');
    const today = getTodayKey();
    if (lastReset !== today) {
        const hour = new Date().getHours();
        if (hour >= 5 && lastReset && lastReset !== today) {
            // 新的一天且过了5点，重置计划但保留历史
            localStorage.setItem('lastPlanResetDate', today);
        } else if (!lastReset) {
            localStorage.setItem('lastPlanResetDate', today);
        }
    }
}

// ================================================================
// 模块7: 模考记录
// ================================================================
function initMock() {
    renderRecordForm();
    renderRecentRecords();
    initChart();
}

function switchMockTab(tab) {
    document.querySelectorAll('.mock-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mtab === tab));
    document.querySelectorAll('.mock-panel').forEach(p => p.classList.toggle('active', p.id === `mock-${tab}`));
    if (tab === 'charts') setTimeout(renderChart, 100);
    if (tab === 'analysis') renderAnalysis();
}

function renderRecordForm() {
    const form = document.getElementById('recordForm');
    if (!form) return;
    const editing = editingMockId !== null;
    const today = new Date().toISOString().slice(0, 10);
    form.innerHTML = `
        <h4 style="margin-bottom:14px;">${editing ? '✏️ 编辑记录' : '📝 录入模考 / 刷题记录'}</h4>
        <div class="form-row">
            <div class="form-group">
                <label>模块</label>
                <select id="mockModule" onchange="onMockModuleChange()">
                    ${MOCK_MODULES.map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>日期</label>
                <input type="date" id="mockDate" value="${today}"/>
            </div>
        </div>
        <!-- 刷题记录字段（行测言语 / 资料分析 等） -->
        <div id="practiceFields">
            <div class="form-row">
                <div class="form-group">
                    <label>做题总题量</label>
                    <input type="number" id="mockTotal" placeholder="如: 40" min="1"/>
                </div>
                <div class="form-group">
                    <label>答对题数</label>
                    <input type="number" id="mockCorrect" placeholder="如: 32" min="0"/>
                </div>
            </div>
            <div class="form-group">
                <label>用时（分钟）</label>
                <input type="number" id="mockTime" placeholder="如: 35" min="1"/>
            </div>
        </div>
        <!-- 模考成绩字段（选「模考成绩」时显示） -->
        <div id="scoreFields" style="display:none;">
            <div class="form-row">
                <div class="form-group">
                    <label>行测成绩</label>
                    <input type="number" id="mockXingce" placeholder="如: 72.5" min="0" step="0.1" oninput="updateMockScorePreview()"/>
                </div>
                <div class="form-group">
                    <label>申论成绩</label>
                    <input type="number" id="mockShenlun" placeholder="如: 65" min="0" step="0.1" oninput="updateMockScorePreview()"/>
                </div>
            </div>
            <div class="form-group">
                <label>总分（自动合计）</label>
                <input type="text" id="mockScorePreview" readonly placeholder="行测 + 申论" style="background:#fff0f3;color:#e91e63;font-weight:600;"/>
            </div>
            <div class="form-group">
                <label>排名 / 分差（可选）</label>
                <input type="text" id="mockRank" placeholder="如: 岗位第2 / 分差+3.5"/>
            </div>
        </div>
        <div class="form-group">
            <label>备注（可选）</label>
            <textarea id="mockNote" rows="2" placeholder="记录错题原因或模考得失..."></textarea>
        </div>
        <button class="btn-pink" onclick="submitMockRecord()" style="width:100%;margin-top:8px;">${editing ? '💾 更新记录' : '✅ 保存记录'}</button>
        ${editing ? '<button class="btn-outline" onclick="cancelEditMock()" style="width:100%;margin-top:6px;">✖ 取消编辑</button>' : ''}
        <button class="btn-outline" onclick="importSusuanErrors()" style="width:100%;margin-top:6px;">📥 同步速算错题</button>
    `;
    if (editing) {
        const r = getMockRecordById(editingMockId);
        if (r) {
            document.getElementById('mockModule').value = r.module;
            document.getElementById('mockDate').value = (r.date || today).slice(0, 10);
            document.getElementById('mockNote').value = r.note || '';
            if (r.module === '模考成绩') {
                document.getElementById('mockXingce').value = r.xingce ?? '';
                document.getElementById('mockShenlun').value = r.shenlun ?? '';
                document.getElementById('mockRank').value = r.rank || '';
            } else {
                document.getElementById('mockTotal').value = r.total ?? '';
                document.getElementById('mockCorrect').value = r.correct ?? '';
                document.getElementById('mockTime').value = r.time ?? '';
            }
        }
    }
    onMockModuleChange();
    if (editing && getMockRecordById(editingMockId) && getMockRecordById(editingMockId).module === '模考成绩') updateMockScorePreview();
}

function submitMockRecord() {
    const module = document.getElementById('mockModule').value;
    const dateVal = document.getElementById('mockDate').value || new Date().toISOString().slice(0, 10);
    const date = dateVal + 'T00:00:00.000Z';
    const note = document.getElementById('mockNote').value.trim();

    let records = JSON.parse(localStorage.getItem('mockRecords') || '[]');

    // ---- 模考成绩（总成绩）----
    if (module === '模考成绩') {
        const xingce = parseFloat(document.getElementById('mockXingce').value);
        const shenlun = parseFloat(document.getElementById('mockShenlun').value) || 0;
        const rank = document.getElementById('mockRank').value.trim();
        if (isNaN(xingce)) { alert('请填写行测成绩！'); return; }
        const score = +(xingce + shenlun).toFixed(1);
        if (editingMockId !== null) {
            const idx = records.findIndex(r => r.id === editingMockId);
            if (idx !== -1) records[idx] = { ...records[idx], date, module, xingce, shenlun, score, rank, note, total: null, correct: null, accuracy: null, time: 0 };
            editingMockId = null;
            localStorage.setItem('mockRecords', JSON.stringify(records));
            alert('✅ 模考成绩已更新！');
            renderRecordForm(); renderRecentRecords();
            return;
        }
        records.unshift({ id: Date.now(), date, module, xingce, shenlun, score, rank, note, total: null, correct: null, accuracy: null, time: 0 });
        localStorage.setItem('mockRecords', JSON.stringify(records));
        alert('✅ 模考成绩已保存！');
        renderRecordForm(); renderRecentRecords();
        return;
    }

    // ---- 刷题记录（行测言语 / 资料分析 等）----
    const total = parseInt(document.getElementById('mockTotal').value);
    const correct = parseInt(document.getElementById('mockCorrect').value);
    const time = parseInt(document.getElementById('mockTime').value);
    if (!total || isNaN(correct)) { alert('请填写完整的题量和正确数！'); return; }
    if (correct > total) { alert('答对数不能超过总题量！'); return; }
    const accuracy = ((correct / total) * 100).toFixed(1);

    if (editingMockId !== null) {
        const idx = records.findIndex(r => r.id === editingMockId);
        if (idx !== -1) records[idx] = { ...records[idx], date, module, total, correct, accuracy, time: time || 0, note, xingce: null, shenlun: null, score: null, rank: '' };
        editingMockId = null;
        localStorage.setItem('mockRecords', JSON.stringify(records));
        alert('✅ 记录已更新！');
        renderRecordForm(); renderRecentRecords();
        return;
    }

    const record = {
        id: Date.now(),
        date, module, total, correct, accuracy,
        time: time || 0, note,
        xingce: null, shenlun: null, score: null, rank: ''
    };
    records.unshift(record);
    localStorage.setItem('mockRecords', JSON.stringify(records));

    // 清空表单
    document.getElementById('mockTotal').value = '';
    document.getElementById('mockCorrect').value = '';
    document.getElementById('mockTime').value = '';
    document.getElementById('mockNote').value = '';

    alert('✅ 记录保存成功！');
    renderRecentRecords();
}

function importSusuanErrors() {
    const errors = JSON.parse(localStorage.getItem('susuanErrors') || '[]');
    if (errors.length === 0) { alert('速算错题本暂无数据'); return; }
    let count = 0;
    errors.forEach(e => {
        if (!e.imported) {
            let records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
            records.unshift({
                id: Date.now() + count,
                date: e.date,
                module: '资料分析',
                total: 1, correct: 0,
                accuracy: '0',
                time: 0,
                note: `[速算错题] ${e.q} | 原因: ${e.reason || '未标记'}`
            });
            localStorage.setItem('mockRecords', JSON.stringify(records));
            e.imported = true;
            count++;
        }
    });
    localStorage.setItem('susuanErrors', JSON.stringify(errors));
    alert(`✅ 已同步 ${count} 条速算错题到模考记录！`);
    renderRecentRecords();
}

function renderRecentRecords() {
    const container = document.getElementById('recentRecords');
    if (!container) return;
    const all = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    const records = all.slice(0, 50);

    if (records.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">暂无记录，开始录入吧！📝</p>';
        return;
    }

    container.innerHTML = `
        <h4 style="margin-bottom:10px;">📋 全部记录（共 ${all.length} 条，可编辑 / 删除）</h4>
        ${records.map(r => {
            const isScore = r.module === '模考成绩';
            const detail = isScore
                ? `行测 ${r.xingce}${r.shenlun ? ' / 申论 ' + r.shenlun : ''} → <b style="color:#e91e63;">${r.score}</b> 分${r.rank ? ' · ' + r.rank : ''}`
                : `${r.total}题 · 对${r.correct} · <b style="color:#e91e63;">${r.accuracy}%</b>`;
            return `
            <div class="record-item">
                <div class="record-item-main">
                    <span class="record-item-module">${r.module}</span>
                    <span style="font-size:11px;color:#999;">${(r.date || '').slice(0, 10)}</span>
                    <br/><span style="font-size:12px;color:#444;">${detail}</span>
                    ${r.note ? `<br/><span style="font-size:11px;color:#999;">${r.note.slice(0, 40)}</span>` : ''}
                </div>
                <div class="record-ops">
                    <button class="mini-btn edit" title="编辑" onclick="editMockRecord(${r.id})">✏️</button>
                    <button class="mini-btn del" title="删除" onclick="deleteMockRecord(${r.id})">🗑</button>
                </div>
            </div>`;
        }).join('')}
    `;
}

function onMockModuleChange() {
    const sel = document.getElementById('mockModule');
    if (!sel) return;
    const isScore = sel.value === '模考成绩';
    const pf = document.getElementById('practiceFields');
    const sf = document.getElementById('scoreFields');
    if (pf) pf.style.display = isScore ? 'none' : 'block';
    if (sf) sf.style.display = isScore ? 'block' : 'none';
}

function updateMockScorePreview() {
    const xc = parseFloat(document.getElementById('mockXingce').value) || 0;
    const sl = parseFloat(document.getElementById('mockShenlun').value) || 0;
    const el = document.getElementById('mockScorePreview');
    if (el) el.value = (xc + sl).toFixed(1) + ' 分';
}

function getMockRecordById(id) {
    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    return records.find(r => r.id === id);
}

function editMockRecord(id) {
    editingMockId = id;
    renderRecordForm();
    const f = document.getElementById('recordForm');
    if (f) {
        try { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
        const first = f.querySelector('input, select, textarea');
        if (first) setTimeout(() => { try { first.focus(); } catch (e) {} }, 200);
    }
}

function cancelEditMock() {
    editingMockId = null;
    renderRecordForm();
}

function deleteMockRecord(id) {
    appConfirm('确定删除这条记录吗？', (ok) => {
        if (!ok) return;
        let records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
        records = records.filter(r => r.id !== id);
        localStorage.setItem('mockRecords', JSON.stringify(records));
        if (editingMockId === id) editingMockId = null;
        renderRecordForm();
        renderRecentRecords();
        appAlert('🗑 已删除');
    });
}

// 图表渲染
function initChart() {
    // 延迟加载图表
}

function switchChartType(type) {
    currentChartType = type;
    document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.chart === type));
    renderChart();
}

function renderChart() {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]')
        .filter(r => r.module !== '模考成绩'); // 模考总成绩无正确率，不计入刷题图表

    // 设置canvas尺寸
    canvas.width = canvas.parentElement.offsetWidth - 40;
    canvas.height = 320;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (records.length === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据，请先录入模考记录', canvas.width/2, canvas.height/2);
        return;
    }

    if (currentChartType === 'line') {
        renderLineChart(ctx, canvas, records);
    } else if (currentChartType === 'bar') {
        renderBarChart(ctx, canvas, records);
    } else if (currentChartType === 'pie') {
        renderPieChart(ctx, canvas, records);
    }
}

function renderLineChart(ctx, canvas, records) {
    const padding = { top: 40, right: 30, bottom: 50, left: 50 };
    const w = canvas.width - padding.left - padding.right;
    const h = canvas.height - padding.top - padding.bottom;

    // 按日期分组取最近15条
    const recent = records.slice(0, 15).reverse();

    // 坐标轴
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + h);
    ctx.lineTo(padding.left + w, padding.top + h);
    ctx.stroke();

    // Y轴标签
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + h - (h * i / 5);
        const val = i * 20;
        ctx.fillText(`${val}%`, padding.left - 8, y + 4);
        ctx.beginPath(); ctx.strokeStyle = '#f0f0f0';
        ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + w, y); ctx.stroke();
    }

    // 数据点和线
    const points = recent.map((r, i) => ({
        x: padding.left + (w * i / (recent.length - 1 || 1)),
        y: padding.top + h - (h * parseFloat(r.accuracy) / 100),
        acc: r.accuracy,
        mod: r.module,
        date: r.date.slice(5, 10)
    }));

    // 渐变填充
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
    gradient.addColorStop(0, 'rgba(255,182,193,0.3)');
    gradient.addColorStop(1, 'rgba(255,182,193,0.02)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + h);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length-1].x, padding.top + h);
    ctx.closePath();
    ctx.fill();

    // 线条
    ctx.strokeStyle = '#FFB6C1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((p, i) => { if (i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.stroke();

    // 数据点
    points.forEach(p => {
        ctx.fillStyle = '#FFB6C1';
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill();
    });

    // X轴标签
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    points.forEach(p => {
        ctx.fillText(p.date, p.x, padding.top + h + 16);
    });

    // 标题
    ctx.fillStyle = '#E891A3';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('各模块正确率变化趋势', canvas.width/2, 22);
}

function renderBarChart(ctx, canvas, records) {
    const padding = { top: 40, right: 20, bottom: 60, left: 45 };
    const w = canvas.width - padding.left - padding.right;
    const h = canvas.height - padding.top - padding.bottom;

    // 按模块聚合最近7天
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekRecords = records.filter(r => new Date(r.date) >= weekAgo);

    const moduleData = {};
    MOCK_MODULES.filter(m => m !== '模考成绩').forEach(m => moduleData[m] = { total: 0, count: 0 });
    weekRecords.forEach(r => {
        if (moduleData[r.module]) {
            moduleData[r.module].total += parseInt(r.total);
            moduleData[r.module].count++;
        }
    });

    const modules = Object.keys(moduleData);
    const maxVal = Math.max(...modules.map(m => moduleData[m].total), 1);
    const barWidth = (w / modules.length) * 0.6;
    const gap = (w / modules.length) * 0.4;

    // 标题
    ctx.fillStyle = '#E891A3';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('近7天各模块刷题量对比', canvas.width/2, 22);

    modules.forEach((mod, i) => {
        const x = padding.left + (w / modules.length) * i + gap/2;
        const bh = (moduleData[mod].total / maxVal) * (h - 20);
        const y = padding.top + h - bh;

        // 柱子渐变
        const grad = ctx.createLinearGradient(x, y, x, padding.top + h);
        grad.addColorStop(0, '#FFB6C1');
        grad.addColorStop(1, '#FFD1DC');
        ctx.fillStyle = grad;
        roundRect(ctx, x, y, barWidth, bh, 4);

        // 数值
        ctx.fillStyle = '#333';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(moduleData[mod].total.toString(), x + barWidth/2, y - 6);

        // X轴标签
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        const shortName = mod.replace(/推理|关系|判断/g, '');
        ctx.save();
        ctx.translate(x + barWidth/2, padding.top + h + 12);
        ctx.rotate(-Math.PI/6);
        ctx.textAlign = 'right';
        ctx.fillText(shortName, 0, 0);
        ctx.restore();
    });
}

function renderPieChart(ctx, canvas, records) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 + 10;
    const radius = Math.min(cx, cy) - 50;

    // 统计错误原因
    const reasons = {};
    ERROR_REASONS.forEach(r => reasons[r] = 0);
    records.forEach(r => {
        if (r.note) {
            ERROR_REASONS.forEach(er => {
                if (r.note.includes(er)) reasons[er]++;
            });
            if (parseFloat(r.accuracy) < 60) reasons['其他']++;
        }
    });

    const total = Object.values(reasons).reduce((a,b) => a+b, 0);
    if (total === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无足够的错因数据', cx, cy);
        return;
    }

    const colors = ['#FFB6C1', '#E891A3', '#FFD1DC', '#4A90D9', '#68C07D'];
    let startAngle = -Math.PI/2;

    const data = Object.entries(reasons).filter(([k,v]) => v > 0);

    data.forEach(([reason, count], i) => {
        const slice = (count / total) * Math.PI * 2;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
        ctx.closePath();
        ctx.fill();

        // 标签
        const midAngle = startAngle + slice/2;
        const labelX = cx + Math.cos(midAngle) * (radius + 25);
        const labelY = cy + Math.sin(midAngle) * (radius + 25);
        ctx.fillStyle = '#333';
        ctx.font = '11px sans-serif';
        ctx.textAlign = midAngle > Math.PI/2 && midAngle < Math.PI*1.5 ? 'right' : 'left';
        const pct = ((count/total)*100).toFixed(1);
        ctx.fillText(`${reason} ${pct}%`, labelX, labelY);

        startAngle += slice;
    });

    // 中心文字
    ctx.fillStyle = '#E891A3';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('错题原因占比', cx, cy - 8);
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.fillText(`共${total}条记录`, cx, cy + 10);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    ctx.fill();
}

// 进阶分析
function renderAnalysis() {
    const summaryEl = document.getElementById('analysisSummary');
    const weakEl = document.getElementById('weakModules');
    const reportEl = document.getElementById('monthlyReport');
    if (!summaryEl) return;

    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    const prac = records.filter(r => r.module !== '模考成绩'); // 仅刷题记录参与正确率分析

    // 近7天平均
    const now = new Date();
    const days7 = new Date(now); days7.setDate(days7.getDate() - 7);
    const days30 = new Date(now); days30.setDate(days30.getDate() - 30);
    const r7 = prac.filter(r => new Date(r.date) >= days7);
    const r30 = prac.filter(r => new Date(r.date) >= days30);

    const avg7 = r7.length > 0 ? (r7.reduce((s,r) => s + parseFloat(r.accuracy), 0) / r7.length).toFixed(1) : '-';
    const avg30 = r30.length > 0 ? (r30.reduce((s,r) => s + parseFloat(r.accuracy), 0) / r30.length).toFixed(1) : '-';

    summaryEl.innerHTML = `
        <h4>📊 数据概览</h4>
        <p>总记录数: <strong>${records.length}</strong> 条</p>
        <p>近7天平均正确率: <strong style="color:#FFB6C1;font-size:18px;">${avg7}%</strong></p>
        <p>近30天平均正确率: <strong style="color:#FFB6C1;font-size:18px;">${avg30}%</strong></p>
    `;

    // 薄弱模块
    const modAcc = {};
    MOCK_MODULES.filter(m => m !== '模考成绩').forEach(m => modAcc[m] = []);
    r30.forEach(r => { if (modAcc[r.module]) modAcc[r.module].push(parseFloat(r.accuracy)); });

    const sortedMods = Object.entries(modAcc)
        .filter(([k,v]) => v.length > 0)
        .map(([k,v]) => ({ module: k, avg: (v.reduce((a,b)=>a+b,0)/v.length).toFixed(1), count: v.length }))
        .sort((a,b) => parseFloat(a.avg) - parseFloat(b.avg));

    weakEl.innerHTML = `
        <h4 style="color:#E891A3;">⚠️ 薄弱模块排行（按正确率从低到高）</h4>
        ${sortedMods.length > 0 ? sortedMods.map((m,i) => `
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:${i<2?'#FFF0F5':'#f9f9f9'};border-radius:6px;margin-bottom:4px;">
                <span>${i+1}. ${m.module}</span>
                <span><strong style="color:${parseFloat(m.avg)<60?'#E57373':'#FFB6C1'}">${m.avg}%</strong> (${m.count}次)</span>
            </div>
        `).join('') : '<p style="color:#999;">数据不足，继续积累中...</p>'}
    `;

    // 月度报告
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthRecs = prac.filter(r => r.date.startsWith(thisMonth));
    const monthAvg = monthRecs.length > 0 ? (monthRecs.reduce((s,r) => s + parseFloat(r.accuracy), 0) / monthRecs.length).toFixed(1) : '-';

    reportEl.innerHTML = `
        <h4 style="color:#E891A3;">📋 ${thisMonth} 月度备考报告</h4>
        <p>本月练习次数: <strong>${monthRecs.length}</strong> 次</p>
        <p>月均正确率: <strong style="color:#FFB6C1;font-size:16px;">${monthAvg}%</strong></p>
        <p>提升明显板块: <strong style="color:#68C07D;">${sortedMods.length > 0 ? sortedMods[sortedMods.length-1]?.module || '-' : '-'}</strong></p>
        <p>待加强板块: <strong style="color:#E57373;">${sortedMods.length > 0 ? sortedMods[0]?.module || '-' : '-'}</strong></p>
    `;
}

function exportMockReport() {
    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    if (records.length === 0) { alert('暂无数据可导出'); return; }

    let csv = '日期,模块,题量/行测,答对/申论,正确率/总分,用时/排名,备注\n';
    records.forEach(r => {
        if (r.module === '模考成绩') {
            csv += `${r.date},模考成绩,行测${r.xingce},申论${r.shenlun || 0},总分${r.score},${r.rank || ''},"${r.note || ''}"\n`;
        } else {
            csv += `${r.date},${r.module},${r.total},${r.correct},${r.accuracy}%,${r.time},"${r.note || ''}"\n`;
        }
    });

    downloadFile(csv, `模考记录_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8');
}

function confirmArchiveData() {
    appConfirm('确定要归档所有历史数据吗？归档后数据将被清空（建议先导出备份）。', (ok) => {
        if (!ok) return;
        localStorage.removeItem('mockRecords');
        appAlert('✅ 数据已归档清空');
        renderRecentRecords();
        renderAnalysis();
    });
}

// ================================================================
// 工具函数
// ================================================================
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function saveFavorites() {
    const favNews = SHIZHENG_NEWS.filter(n => n.favorited).map(n => n.id);
    localStorage.setItem('favNews', JSON.stringify(favNews));
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 点击弹窗外部关闭
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});

/* ========== 更新提示（对比上次查看总量） ========== */
let _noticeShown = false;
function showUpdateNotice(meta) {
    if (_noticeShown || !meta || !meta.totals) return;
    _noticeShown = true;
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem('gk_prev_totals') || 'null'); } catch (e) {}
    const cur = meta.totals;
    const names = { shizheng: '时政', qiushi: '求是', renwu: '人物', essays: '范文', quotes: '金句', morning: '晨读' };
    if (!prev) { try { localStorage.setItem('gk_prev_totals', JSON.stringify(cur)); } catch (e) {} return; }
    const parts = [];
    for (const k in names) {
        const c = cur[k] || 0, p = prev[k] || 0;
        if (c > p) parts.push(names[k] + ' +' + (c - p));
    }
    try { localStorage.setItem('gk_prev_totals', JSON.stringify(cur)); } catch (e) {}
    if (parts.length === 0) return;
    showToast('🎉 内容已更新：' + parts.join(' · '));
}
function showToast(text) {
    let t = document.getElementById('gkToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'gkToast';
        t.style.cssText = 'position:fixed;left:50%;top:76px;transform:translateX(-50%);z-index:2000;background:linear-gradient(135deg,#FFD6E6,#FFB6C1);color:#fff;padding:10px 18px;border-radius:24px;font-size:14px;box-shadow:0 4px 16px rgba(231,84,128,.35);max-width:90%;text-align:center;transition:opacity .4s ease;';
        document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.display = 'block';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 400); }, 4500);
}

/* =====================================================================
 * 新增模块：高频成语 · 混淆配对 · 逻辑口诀 · 面试短句 · 每日碎片推送
 * ===================================================================== */

// ========== 全局状态 ==========
let currentIdiomTier = 'all';
let idiomTestMode = false;
let idiomFavOnly = false;
let idiomCursor = 0;
let idiomRevealId = null;
let currentPairTag = 'all';
let pairCursor = 0;
let currentLogicCat = 'all';
let currentInterviewTag = 'all';
let currentInterviewType = 'all';
let interviewCursor = 0;
let currentInterview = null; // 当前显示的面试短句（供搜索用）

// 易错成语收藏（独立于全局收藏夹，单独归类）
let favIdioms = loadFavIdioms();
function loadFavIdioms() { try { return JSON.parse(localStorage.getItem('favIdioms') || '[]'); } catch (e) { return []; } }
function saveFavIdioms() { try { localStorage.setItem('favIdioms', JSON.stringify(favIdioms)); } catch (e) {} }
function isFavIdiom(id) { return favIdioms.indexOf(String(id)) >= 0; }
function toggleFavIdiom(id) {
    const k = String(id);
    if (isFavIdiom(id)) favIdioms = favIdioms.filter(x => x !== k); else favIdioms.push(k);
    saveFavIdioms();
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function getTodayStr() {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---------------- 高频成语 ---------------- */
function getIdiomList() {
    let list = (typeof IDIOMS_DB !== 'undefined') ? IDIOMS_DB.slice() : [];
    if (idiomFavOnly) list = list.filter(x => isFavIdiom(x.id));
    else if (currentIdiomTier !== 'all') list = list.filter(x => x.tier === currentIdiomTier);
    return list;
}
function renderIdioms() {
    const wrap = document.getElementById('idiomCardWrap');
    if (!wrap) return;
    const list = getIdiomList();
    const prog = document.getElementById('idiomProgress');
    if (list.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;padding:34px 16px;color:#999;">暂无成语<br><span style="font-size:12px;">试试切换分级，或取消「易错收藏」筛选</span></div>';
        const lst = document.getElementById('idiomList'); if (lst) lst.innerHTML = '';
        if (prog) prog.textContent = idiomFavOnly ? '易错收藏夹为空，去收藏易错成语吧～' : '';
        return;
    }
    if (idiomCursor >= list.length) idiomCursor = 0;
    if (idiomCursor < 0) idiomCursor = list.length - 1;
    const it = list[idiomCursor];
    const faved = isFavIdiom(it.id);
    const tierColor = it.tier === '必考' ? '#E75D80' : (it.tier === '高频' ? '#FF9F43' : '#8E8E93');
    const showMeaning = !idiomTestMode || (it.id === idiomRevealId);
    wrap.innerHTML =
        '<div class="idiom-card" id="idiomCard">' +
            '<div class="idiom-card-top">' +
                '<span class="idiom-tier" style="background:' + tierColor + '">' + it.tier + '</span>' +
                '<button class="idiom-fav-btn ' + (faved ? 'faved' : '') + '" onclick="toggleFavIdiom(\'' + it.id + '\');renderIdioms()">' + (faved ? '⭐' : '☆') + '</button>' +
            '</div>' +
            '<div class="idiom-word">' + it.word + '</div>' +
            '<div class="idiom-pinyin">' + it.pinyin + '</div>' +
            (showMeaning
                ? '<div class="idiom-meaning">' + it.meaning + '</div>' +
                  '<div class="idiom-block"><span class="idiom-label">易混辨析</span>' + (it.distinguish || '（暂无专项易混辨析，重点把握本义与陷阱）') + '</div>' +
                  '<div class="idiom-block"><span class="idiom-label">真题例句</span>' + it.example + '</div>' +
                  '<div class="idiom-block trap"><span class="idiom-label">易错陷阱</span>' + it.trap + '</div>'
                : '<div class="idiom-hidden" onclick="revealIdiom(\'' + it.id + '\')">🔒 点击显示释义 / 自测</div>') +
        '</div>' +
        '<div class="idiom-nav">' +
            '<button class="btn-outline btn-sm" onclick="idiomStep(-1)">‹ 上一个</button>' +
            '<span class="idiom-pos">' + (idiomCursor + 1) + ' / ' + list.length + '</span>' +
            '<button class="btn-outline btn-sm" onclick="idiomStep(1)">下一个 ›</button>' +
        '</div>';
    renderIdiomList(list);
    bindIdiomSwipe();
    if (prog) prog.textContent = '共 ' + list.length + ' 条 · 易错收藏 ' + favIdioms.length + ' 条';
}
function revealIdiom(id) { idiomRevealId = Number(id); renderIdioms(); }
function idiomStep(d) { const list = getIdiomList(); if (!list.length) return; idiomCursor += d; idiomRevealId = null; if (idiomCursor < 0) idiomCursor = list.length - 1; if (idiomCursor >= list.length) idiomCursor = 0; renderIdioms(); }
function newIdiom() { const list = getIdiomList(); if (list.length) { idiomCursor = Math.floor(Math.random() * list.length); idiomRevealId = null; renderIdioms(); } }
function toggleIdiomTest() {
    idiomTestMode = !idiomTestMode; idiomRevealId = null;
    const b = document.getElementById('btnIdiomTest');
    if (b) b.textContent = idiomTestMode ? '🔓 退出自测' : '🂠 自测模式';
    renderIdioms();
}
function toggleFavIdiomView() {
    idiomFavOnly = !idiomFavOnly;
    if (idiomFavOnly) {
        currentIdiomTier = 'all';
        const f = document.getElementById('idiomTierFilters');
        if (f) f.querySelectorAll('.tag-btn').forEach(x => x.classList.toggle('active', (x.dataset.tier || 'all') === 'all'));
    }
    idiomCursor = 0; idiomRevealId = null; renderIdioms();
}
function renderIdiomList(list) {
    const lst = document.getElementById('idiomList'); if (!lst) return;
    lst.innerHTML = list.map(it =>
        '<div class="idiom-row ' + (isFavIdiom(it.id) ? 'faved' : '') + '" onclick="goIdiom(' + it.id + ')">' +
            '<span class="idiom-row-word">' + it.word + '</span>' +
            '<span class="idiom-row-pinyin">' + it.pinyin + '</span>' +
            '<span class="idiom-row-tier tier-' + it.tier + '">' + it.tier + '</span>' +
        '</div>'
    ).join('');
}
function goIdiom(id) {
    const list = getIdiomList();
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) { idiomCursor = idx; idiomRevealId = null; renderIdioms(); const w = document.getElementById('idiomCardWrap'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function bindIdiomSwipe() {
    const card = document.getElementById('idiomCard'); if (!card) return;
    let sx = null;
    card.addEventListener('touchstart', e => { sx = e.changedTouches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
        if (sx === null) return;
        const dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 40) idiomStep(dx < 0 ? 1 : -1);
        sx = null;
    }, { passive: true });
}
function initIdioms() {
    const f = document.getElementById('idiomTierFilters');
    if (f) f.addEventListener('click', e => {
        const b = e.target.closest('.tag-btn'); if (!b) return;
        f.querySelectorAll('.tag-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentIdiomTier = b.dataset.tier || 'all';
        idiomFavOnly = false; idiomCursor = 0; idiomRevealId = null; renderIdioms();
    });
    renderIdioms();
}

/* ---------------- 混淆成语配对 ---------------- */
function getIdiomPairList() {
    let list = (typeof IDIOM_PAIRS_DB !== 'undefined') ? IDIOM_PAIRS_DB.slice() : [];
    if (currentPairTag !== 'all') list = list.filter(x => (x.tags || []).indexOf(currentPairTag) >= 0);
    return list;
}
function renderIdiomPairs() {
    const wrap = document.getElementById('pairCardWrap'); if (!wrap) return;
    const list = getIdiomPairList();
    if (list.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">暂无配对</div>';
        const l = document.getElementById('pairList'); if (l) l.innerHTML = '';
        return;
    }
    if (pairCursor >= list.length) pairCursor = 0;
    if (pairCursor < 0) pairCursor = list.length - 1;
    const p = list[pairCursor];
    const tagsHtml = (p.tags || []).map(t => '<span class="pair-tag">' + t + '</span>').join('');
    wrap.innerHTML =
        '<div class="pair-card" id="pairCard">' +
            '<div class="pair-side"><div class="pair-word">' + p.a.word + '</div><div class="pair-pinyin">' + p.a.pinyin + '</div><div class="pair-meaning">' + p.a.meaning + '</div></div>' +
            '<div class="pair-vs">VS</div>' +
            '<div class="pair-side"><div class="pair-word">' + p.b.word + '</div><div class="pair-pinyin">' + p.b.pinyin + '</div><div class="pair-meaning">' + p.b.meaning + '</div></div>' +
        '</div>' +
        '<div class="pair-note">' + p.note + '</div>' +
        '<div class="pair-tags">' + tagsHtml + '</div>' +
        '<div class="idiom-nav">' +
            '<button class="btn-outline btn-sm" onclick="pairStep(-1)">‹ 上一个</button>' +
            '<span class="idiom-pos">' + (pairCursor + 1) + ' / ' + list.length + '</span>' +
            '<button class="btn-outline btn-sm" onclick="pairStep(1)">下一个 ›</button>' +
        '</div>';
    const lst = document.getElementById('pairList');
    if (lst) lst.innerHTML = list.map((x, i) =>
        '<div class="pair-row" onclick="pairCursor=' + i + ';renderIdiomPairs()">' +
            '<span class="pair-row-a">' + x.a.word + '</span><span class="pair-row-vs">/</span><span class="pair-row-b">' + x.b.word + '</span>' +
            '<span class="pair-row-tags">' + (x.tags || []).join('·') + '</span>' +
        '</div>'
    ).join('');
}
function pairStep(d) { const list = getIdiomPairList(); if (!list.length) return; pairCursor += d; if (pairCursor < 0) pairCursor = list.length - 1; if (pairCursor >= list.length) pairCursor = 0; renderIdiomPairs(); }
function newIdiomPair() { const list = getIdiomPairList(); if (list.length) { pairCursor = Math.floor(Math.random() * list.length); renderIdiomPairs(); } }
function initIdiomPairs() {
    const f = document.getElementById('pairTagFilters');
    if (f) f.addEventListener('click', e => {
        const b = e.target.closest('.tag-btn'); if (!b) return;
        f.querySelectorAll('.tag-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentPairTag = b.dataset.ptag || 'all'; pairCursor = 0; renderIdiomPairs();
    });
    renderIdiomPairs();
}

/* ---------------- 判断推理逻辑口诀 ---------------- */
function getLogicList() {
    let list = (typeof LOGIC_DB !== 'undefined') ? LOGIC_DB.slice() : [];
    if (currentLogicCat !== 'all') list = list.filter(x => x.category === currentLogicCat);
    return list;
}
function renderLogicSvg(key) {
    switch (key) {
        case 'symmetry': return '<svg viewBox="0 0 100 60" class="lgsvg"><line x1="50" y1="4" x2="50" y2="56" stroke="#FFB6C1" stroke-dasharray="4 3"/><path d="M30 20 Q50 6 70 20 Q60 34 50 30 Q40 34 30 20 Z" fill="#FFD6E6" stroke="#E75D80"/><path d="M30 40 Q50 54 70 40 Q60 28 50 32 Q40 28 30 40 Z" fill="#FFD6E6" stroke="#E75D80" opacity="0.6"/></svg>';
        case 'strokes': return '<svg viewBox="0 0 100 60" class="lgsvg"><rect x="28" y="8" width="44" height="44" fill="none" stroke="#E75D80" stroke-width="3"/><line x1="50" y1="8" x2="50" y2="52" stroke="#FFB6C1" stroke-width="2"/><line x1="28" y1="30" x2="72" y2="30" stroke="#FFB6C1" stroke-width="2"/></svg>';
        case 'faces': return '<svg viewBox="0 0 100 60" class="lgsvg"><circle cx="25" cy="30" r="16" fill="none" stroke="#E75D80" stroke-width="3"/><circle cx="25" cy="30" r="5" fill="#E75D80"/><rect x="58" y="14" width="32" height="32" rx="4" fill="none" stroke="#E75D80" stroke-width="3"/><circle cx="74" cy="30" r="5" fill="#E75D80"/></svg>';
        case 'bwops': return '<svg viewBox="0 0 100 60" class="lgsvg"><rect x="14" y="8" width="20" height="20" fill="#333"/><rect x="40" y="8" width="20" height="20" fill="#fff" stroke="#333"/><rect x="66" y="8" width="20" height="20" fill="#333"/><rect x="14" y="34" width="20" height="20" fill="#fff" stroke="#333"/><rect x="40" y="34" width="20" height="20" fill="#333"/><rect x="66" y="34" width="20" height="20" fill="#fff" stroke="#333"/></svg>';
        case 'points': return '<svg viewBox="0 0 100 60" class="lgsvg"><line x1="20" y1="50" x2="80" y2="10" stroke="#E75D80" stroke-width="3"/><line x1="20" y1="10" x2="80" y2="50" stroke="#FFB6C1" stroke-width="3"/><circle cx="50" cy="30" r="4" fill="#333"/><circle cx="20" cy="50" r="4" fill="#333"/><circle cx="80" cy="10" r="4" fill="#333"/></svg>';
        case 'curve': return '<svg viewBox="0 0 100 60" class="lgsvg"><path d="M18 42 A22 22 0 1 1 62 42" fill="none" stroke="#E75D80" stroke-width="3"/><line x1="55" y1="20" x2="84" y2="48" stroke="#FFB6C1" stroke-width="3"/></svg>';
        case 'traverse': return '<svg viewBox="0 0 100 60" class="lgsvg"><circle cx="22" cy="16" r="9" fill="none" stroke="#E75D80" stroke-width="3"/><rect x="52" y="7" width="18" height="18" fill="#FFD6E6" stroke="#E75D80" stroke-width="2"/><polygon points="84,16 76,8 76,24" fill="#E75D80"/><rect x="14" y="38" width="18" height="18" fill="none" stroke="#E75D80" stroke-width="3"/><circle cx="60" cy="47" r="9" fill="#FFD6E6" stroke="#E75D80" stroke-width="2"/><polygon points="84,56 76,38 92,38" fill="#E75D80"/></svg>';
        default: return '';
    }
}
function renderLogic() {
    const wrap = document.getElementById('logicList'); if (!wrap) return;
    const list = getLogicList();
    if (list.length === 0) { wrap.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">暂无口诀</div>'; return; }
    wrap.innerHTML = list.map(x => {
        if (x.category === '图推特征图') {
            return '<div class="logic-card feature">' +
                '<div class="logic-cat">' + x.category + '</div>' +
                '<div class="logic-title">' + x.title + '</div>' +
                '<div class="logic-feature-svg">' + renderLogicSvg(x.svg) + '</div>' +
                '<div class="logic-content">' + x.content.replace(/\n/g, '<br>') + '</div>' +
                '<div class="logic-detail">' + x.detail + '</div>' +
            '</div>';
        }
        return '<div class="logic-card">' +
            '<div class="logic-cat">' + x.category + '</div>' +
            '<div class="logic-title">' + x.title + '</div>' +
            '<div class="logic-content">' + x.content.replace(/\n/g, '<br>') + '</div>' +
            '<div class="logic-detail">' + x.detail + '</div>' +
        '</div>';
    }).join('');
}
function initLogic() {
    const f = document.getElementById('logicCatFilters');
    if (f) f.addEventListener('click', e => {
        const b = e.target.closest('.tag-btn'); if (!b) return;
        f.querySelectorAll('.tag-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentLogicCat = b.dataset.lcat || 'all'; renderLogic();
    });
    renderLogic();
}

/* ---------------- 结构化面试短句 ---------------- */
function getInterviewList() {
    let list = (typeof INTERVIEW_DB !== 'undefined') ? INTERVIEW_DB.slice() : [];
    if (currentInterviewTag !== 'all') list = list.filter(x => x.tag === currentInterviewTag);
    if (currentInterviewType !== 'all') list = list.filter(x => x.type === currentInterviewType);
    return list;
}
function renderInterview() {
    const wrap = document.getElementById('interviewCardWrap'); if (!wrap) return;
    const list = getInterviewList();
    if (list.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">暂无短句</div>';
        const l = document.getElementById('interviewList'); if (l) l.innerHTML = '';
        return;
    }
    if (interviewCursor >= list.length) interviewCursor = 0;
    if (interviewCursor < 0) interviewCursor = list.length - 1;
    const it = list[interviewCursor];
    currentInterview = it; // 保存当前面试短句供搜索用
    // 仅在有原文链接时显示跳转按钮
    var linkHtml = '';
    if (it.url) {
        linkHtml = '<a class="interview-source-link" onclick="window.open(\'' + it.url + '\',\'_blank\')" title="查看原文">🔗 查看原文</a>';
    }
    wrap.innerHTML =
        '<div class="interview-card" id="interviewCard">' +
            '<div class="interview-type">' + it.type + '</div>' +
            '<div class="interview-text">' + it.text + '</div>' +
            '<div class="interview-tag tag-' + it.tag + '">' + it.tag + '</div>' +
            linkHtml +
        '</div>' +
        '<div class="idiom-nav">' +
            '<button class="btn-outline btn-sm" onclick="interviewStep(-1)">‹ 上一个</button>' +
            '<span class="idiom-pos">' + (interviewCursor + 1) + ' / ' + list.length + '</span>' +
            '<button class="btn-outline btn-sm" onclick="interviewStep(1)">下一个 ›</button>' +
        '</div>';
    bindInterviewSwipe();
    const lst = document.getElementById('interviewList');
    if (lst) lst.innerHTML = list.map((x, i) =>
        '<div class="interview-row" onclick="interviewCursor=' + i + ';renderInterview()">' +
            '<span class="interview-row-text">' + x.text + '</span>' +
            '<span class="interview-row-tag tag-' + x.tag + '">' + x.tag + '</span>' +
        '</div>'
    ).join('');
}
function interviewStep(d) { const list = getInterviewList(); if (!list.length) return; interviewCursor += d; if (interviewCursor < 0) interviewCursor = list.length - 1; if (interviewCursor >= list.length) interviewCursor = 0; renderInterview(); }
function newInterview() { const list = getInterviewList(); if (list.length) { interviewCursor = Math.floor(Math.random() * list.length); renderInterview(); } }

// （原 searchInterviewSource 已移除：数据无URL字段时不显示链接，有url字段则直接跳转原文）

function bindInterviewSwipe() {
    const card = document.getElementById('interviewCard'); if (!card) return;
    let sx = null;
    card.addEventListener('touchstart', e => { sx = e.changedTouches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
        if (sx === null) return;
        const dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 40) interviewStep(dx < 0 ? 1 : -1);
        sx = null;
    }, { passive: true });
}
function showTransitionSentences() {
    const list = (typeof TRANSITION_DB !== 'undefined') ? TRANSITION_DB : [];
    const body = document.getElementById('articleModalBody');
    const title = document.getElementById('articleModalTitle');
    if (title) title.textContent = '🔗 过渡衔接句（卡壳备用素材）';
    if (body) body.innerHTML = '<div class="transition-list">' + list.map(t => '<div class="transition-item">' + t.text + '</div>').join('') + '</div>';
    const ov = document.getElementById('articleModal'); if (ov) ov.style.display = 'flex';
}
function initInterview() {
    const f1 = document.getElementById('interviewTagFilters');
    if (f1) f1.addEventListener('click', e => {
        const b = e.target.closest('.tag-btn'); if (!b) return;
        f1.querySelectorAll('.tag-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentInterviewTag = b.dataset.itag || 'all'; interviewCursor = 0; renderInterview();
    });
    const f2 = document.getElementById('interviewTypeFilters');
    if (f2) f2.addEventListener('click', e => {
        const b = e.target.closest('.tag-btn'); if (!b) return;
        f2.querySelectorAll('.tag-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentInterviewType = b.dataset.itype || 'all'; interviewCursor = 0; renderInterview();
    });
    renderInterview();
}

/* ---------------- 每日碎片推送（早晚自动弹窗） ---------------- */
let dailyPushData = { idioms: [], interview: [] };
function buildDailyPush() {
    const today = getTodayStr();
    let rec = null; try { rec = JSON.parse(localStorage.getItem('gk_daily_push') || 'null'); } catch (e) {}
    const idm = (typeof IDIOMS_DB !== 'undefined') ? IDIOMS_DB : [];
    const iv = (typeof INTERVIEW_DB !== 'undefined') ? INTERVIEW_DB : [];
    if (rec && rec.date === today && rec.idiomIds) {
        dailyPushData.idioms = idm.filter(x => rec.idiomIds.indexOf(String(x.id)) >= 0);
        dailyPushData.interview = iv.filter(x => rec.interviewIds.indexOf(String(x.id)) >= 0);
        return;
    }
    const idmC = idm.slice(), ivC = iv.slice();
    shuffle(idmC); shuffle(ivC);
    dailyPushData.idioms = idmC.slice(0, Math.min(10, idmC.length));
    dailyPushData.interview = ivC.slice(0, Math.min(5, ivC.length));
    try { localStorage.setItem('gk_daily_push', JSON.stringify({ date: today, idiomIds: dailyPushData.idioms.map(x => String(x.id)), interviewIds: dailyPushData.interview.map(x => String(x.id)), checked: false })); } catch (e) {}
}
function showDailyPush() {
    buildDailyPush();
    const ov = document.getElementById('dailyPushOverlay'); if (!ov) return;
    const title = document.getElementById('dailyPushTitle');
    const h = new Date().getHours();
    if (title) title.textContent = (h < 12 ? '🌅 早安 · ' : '🌙 晚安 · ') + '今日碎片推送';
    switchDailyPushTab('idiom');
    ov.style.display = 'flex';
}
function switchDailyPushTab(tab) {
    document.querySelectorAll('.dp-tab').forEach(b => b.classList.toggle('active', b.dataset.dptab === tab));
    const body = document.getElementById('dailyPushBody'); if (!body) return;
    if (tab === 'idiom') {
        body.innerHTML = dailyPushData.idioms.length
            ? dailyPushData.idioms.map(x => '<div class="dp-item"><div class="dp-word">' + x.word + ' <span class="dp-pinyin">' + x.pinyin + '</span></div><div class="dp-meaning">' + x.meaning + '</div></div>').join('')
            : '<div style="color:#999;padding:20px;text-align:center;">成语库暂无数据</div>';
    } else {
        body.innerHTML = dailyPushData.interview.length
            ? dailyPushData.interview.map(x => '<div class="dp-item"><div class="dp-text">' + x.text + '</div><div class="dp-tag">' + x.tag + '</div></div>').join('')
            : '<div style="color:#999;padding:20px;text-align:center;">面试库暂无数据</div>';
    }
}
function reshuffleDailyPush() {
    const today = getTodayStr();
    const idmC = (typeof IDIOMS_DB !== 'undefined' ? IDIOMS_DB : []).slice();
    const ivC = (typeof INTERVIEW_DB !== 'undefined' ? INTERVIEW_DB : []).slice();
    shuffle(idmC); shuffle(ivC);
    dailyPushData.idioms = idmC.slice(0, Math.min(10, idmC.length));
    dailyPushData.interview = ivC.slice(0, Math.min(5, ivC.length));
    try { localStorage.setItem('gk_daily_push', JSON.stringify({ date: today, idiomIds: dailyPushData.idioms.map(x => String(x.id)), interviewIds: dailyPushData.interview.map(x => String(x.id)), checked: false })); } catch (e) {}
    switchDailyPushTab('idiom');
}
function checkinDailyPush() {
    const today = getTodayStr();
    let rec = null; try { rec = JSON.parse(localStorage.getItem('gk_daily_push') || 'null'); } catch (e) {}
    if (!rec || rec.date !== today) rec = { date: today, idiomIds: dailyPushData.idioms.map(x => String(x.id)), interviewIds: dailyPushData.interview.map(x => String(x.id)), checked: true };
    else rec.checked = true;
    try { localStorage.setItem('gk_daily_push', JSON.stringify(rec)); } catch (e) {}
    showToast('✅ 今日碎片已打卡！明天见～');
    setTimeout(closeDailyPush, 900);
}
function closeDailyPush() { const ov = document.getElementById('dailyPushOverlay'); if (ov) ov.style.display = 'none'; }
function scheduleDailyPush() {
    // 内容由 loader 异步加载，延迟触发，确保用最新数据生成今日推送
    setTimeout(() => {
        const today = getTodayStr();
        let rec = null; try { rec = JSON.parse(localStorage.getItem('gk_daily_push') || 'null'); } catch (e) {}
        // 当天未生成过，或生成了未打卡，都弹出（每天最多一次视觉提醒）
        if (!rec || rec.date !== today || !rec.checked) showDailyPush();
    }, 1500);
}

