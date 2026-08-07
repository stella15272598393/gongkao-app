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
const APP_VERSION = '2026-08-07-v57';

// 调试开关：默认关闭生产环境日志。URL 加 ?debug=1 可重新打开（如 https://.../?debug=1）
window.__DEBUG__ = /[?&]debug=1(\b|&|$)/.test(location.search);

/* ================================================================
   全局时间基准：北京时间（UTC+8） —— v34 全站统一
   ----------------------------------------------------------------
   历史坑（已全部堵上）：
   1) new Date().toISOString() 取的是 UTC 日期，北京时间 00:00-08:00
      会被算成「前一天」。凌晨打卡/录入会写到昨天的键上。
   2) 部分模块用本地时间（getFullYear 等）、部分用 UTC，两套基准混用，
      跨月当天会出现「数据看起来凭空消失」。
   3) 设备时区若不是东八区（出国 / 手机时区设错），本地时间同样不可靠。

   规则：凡是「哪一天」这种日期归属语义，一律走下面的工具函数；
        凡是「精确到毫秒的事件时刻」（exportedAt / crawledAt 等），
        保留标准 ISO UTC 字符串（带 Z），那是正确用法，不要改。
   ================================================================ */
function getBJNow() {
    const n = new Date();
    // 把时间戳平移到「本地 getter 读出来正好是北京时间」的状态
    return new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
}
function fmtYMD(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 北京时间「今天」，格式 YYYY-MM-DD
function bjToday() { return fmtYMD(getBJNow()); }
// 北京时间偏移 N 天后的 Date 对象（负数往前）
function bjDateOffset(days) { const d = getBJNow(); d.setDate(d.getDate() + days); return d; }
// 北京时间偏移 N 天后的日期键，格式 YYYY-MM-DD
function bjDayKey(days) { return fmtYMD(bjDateOffset(days || 0)); }
/* 两个 YYYY-MM-DD 相差多少天（toKey - fromKey）。
   纯日期差，不掺当前时刻，避免「倒计时/Day 计数」被小时数带偏一天。
   注意补 'T00:00:00'：否则 new Date('2026-11-29') 会按 UTC 零点解析。 */
function daysBetweenYMD(fromKey, toKey) {
    const a = new Date(String(fromKey).slice(0, 10) + 'T00:00:00');
    const b = new Date(String(toKey).slice(0, 10) + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
}
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
function saveFavBox() { try { localStorage.setItem('favBox', JSON.stringify(favBox)); } catch (e) {} monitorDrop('favBox', '收藏'); }
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

// ========== 数据防护：数量骤降检测 + 备份提醒（v37） ==========
// 用户曾因爬虫/版本更新丢失收藏，故新增：保存时检测数量骤降并警告；启动与备份超时提醒。
const MONITOR_KEYS = [
    { k: 'favBox', label: '收藏' },
    { k: 'favQuotes', label: '金句收藏' },
    { k: 'favIdioms', label: '成语收藏' },
    { k: 'mockRecords', label: '模考记录' },
    { k: 'quoteCheckins', label: '金句打卡' },
    { k: 'susuanErrors', label: '速算错题' },
    { k: 'idiomErrors', label: '成语错词' }
];
function _lenOf(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v).length : 0; }
    catch (e) { return 0; }
}
function monitorDrop(key, label) {
    const base = parseInt(localStorage.getItem('__base_' + key) || '-1', 10);
    const cur = _lenOf(key);
    if (base >= 0 && cur > 0 && cur < base * 0.7) {
        const msg = '⚠️ ' + label + '从 ' + base + ' 条骤降到 ' + cur + ' 条，数据可能丢失，建议立即备份！';
        if (typeof showToast === 'function') showToast(msg); else alert(msg);
    }
    if (cur > 0) localStorage.setItem('__base_' + key, String(cur));
}
function saveMockRecords(records) {
    try { saveMockRecords(records); } catch (e) {}
    monitorDrop('mockRecords', '模考记录');
}
function touchBackup() { try { localStorage.setItem('lastBackupAt', new Date().toISOString()); localStorage.removeItem('backupDismissUntil'); } catch (e) {} }
function daysSinceBackup() {
    const t = localStorage.getItem('lastBackupAt');
    if (!t) return -1; // -1 表示从未备份
    const d = (Date.now() - new Date(t).getTime()) / 86400000;
    return isNaN(d) ? -1 : Math.floor(d);
}
function showBackupBanner() {
    if (document.getElementById('backupReminder')) return;
    // 用户手动关闭过且未到期，不再弹
    const until = localStorage.getItem('backupDismissUntil');
    if (until && Date.now() < new Date(until).getTime()) return;
    // 没有收藏数据可备份，不弹
    try { const fav = JSON.parse(localStorage.getItem('favBox') || '[]'); if (!fav || fav.length === 0) return; } catch(e) {}
    const days = daysSinceBackup();
    const b = document.createElement('div');
    b.id = 'backupReminder';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#fff4e5;border:1px solid #ffb74d;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,.15);display:flex;align-items:center;gap:10px;font-size:13px;color:#5d4037;';
    const dayText = days < 0 ? '尚未备份' : days + ' 天';
    b.innerHTML = '<span style="font-size:18px;">💾</span><span style="flex:1;">距离上次备份已 <b>' + dayText + '</b>，建议备份本机数据，防止丢失。</span>';
    const btn = document.createElement('button');
    btn.textContent = '立即备份';
    btn.style.cssText = 'border:none;background:#ff9800;color:#fff;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;';
    btn.onclick = function () { if (typeof exportFavTxt === 'function') exportFavTxt(); touchBackup(); b.remove(); };
    const close = document.createElement('span');
    close.textContent = '✕';
    close.style.cssText = 'cursor:pointer;color:#999;font-size:16px;';
    close.onclick = function () { try { localStorage.setItem('backupDismissUntil', new Date(Date.now() + 7 * 86400000).toISOString()); } catch(e){} b.remove(); };
    b.appendChild(btn); b.appendChild(close);
    document.body.appendChild(b);
}
function checkBackupReminder() {
    MONITOR_KEYS.forEach(function (m) {
        const base = parseInt(localStorage.getItem('__base_' + m.k) || '-1', 10);
        const cur = _lenOf(m.k);
        if (base >= 0 && cur > 0 && cur < base * 0.7) {
            const msg = '⚠️ 检测到' + m.label + '数量骤降（' + base + '→' + cur + '），建议立即备份';
            if (typeof showToast === 'function') showToast(msg); else alert(msg);
        }
        if (cur > 0) localStorage.setItem('__base_' + m.k, String(cur));
    });
    const days = daysSinceBackup();
    // 仅当已备份超过7天 或 从未备份但有收藏数据时才提示（showBackupBanner内部会再检查收藏+dismiss状态）
    if (days >= 7 || (days < 0 && JSON.parse(localStorage.getItem('favBox') || '[]').length > 0)) showBackupBanner();
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    initCountdown();
    startDateTimeClock();
    initGlobalSearch();
    const vEl = document.getElementById('appVersionLabel');
    if (vEl) vEl.textContent = 'v' + APP_VERSION;
    // v37：启动时检测数据数量骤降 + 备份提醒
    try { checkBackupReminder(); } catch (e) {}
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
    checkVersion();
    showWelcomeScreen();
    checkDailyReset();
    // 新增模块初始化
    initIdioms();
    initIdiomPairs();
    initLogic();
    initInterview();
    initGoldLedger();
    scheduleDailyPush();
});

// ========== Service Worker 注册 ==========
function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    const swUrl = './sw.js?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1');

    // ★ v25 增强：检测到旧 SW 仍在控制页面时，强制 unregister 后重新注册
    //    解决"代码已发版但手机 SW 缓存了旧 index.html"导致永远用旧版的问题
    navigator.serviceWorker.getRegistration().then(oldReg => {
        // 如果有旧注册且 scope 匹配，检查是否需要强制更新
        if (oldReg && oldReg.scope.includes(location.hostname)) {
            // 检查 controller 是否存在——如果存在但版本可能过期，强制刷新
            if (navigator.serviceWorker.controller) {
                // 发送版本检查消息
                navigator.serviceWorker.controller.postMessage({ type: 'CHECK_VERSION', version: APP_VERSION });
            }
            // 主动触发更新检查
            if (oldReg.update) { try { oldReg.update(); } catch (e) {} }
        }

        // 注册/更新 SW（URL 带版本戳确保浏览器不复用 HTTP 缓存的旧 sw.js 字节）
        return navigator.serviceWorker.register(swUrl);
    }).then(reg => {
        if (window.__DEBUG__) console.log('PWA SW registered:', reg.scope, 'url=', swUrl, 'version=', APP_VERSION);

        // ★ 关键：新 SW 安装完成后立即激活，不让它进入 waiting 状态
        function activateNew(sw) {
            if (sw) sw.postMessage({ type: 'SKIP_WAITING' });
        }
        activateNew(reg.waiting);
        activateNew(reg.installing);

        reg.onupdatefound = () => {
            const installing = reg.installing;
            if (installing) {
                installing.onstatechange = () => {
                    if (window.__DEBUG__) console.log('SW state:', installing.state);
                    if (installing.state === 'installed') {
                        // 有活跃 controller 说明是更新（非首次安装）→ 立即激活
                        if (navigator.serviceWorker.controller) {
                            installing.postMessage({ type: 'SKIP_WAITING' });
                            // ★ 延迟刷新页面，让新 SW 接管后重新加载最新资源
                            setTimeout(() => {
                                if (!navigator.serviceWorker.controller || navigator.serviceWorker.controller.state === 'activated') {
                                    if (window.__DEBUG__) console.log('v25: SW 已更新，建议用户刷新');
                                }
                            }, 1000);
                        }
                    }
                };
            }
        };

        // 监听 controllerchange —— 新 SW 接管后自动刷新页面获取最新资源
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                if (window.__DEBUG__) console.log('v25: 新 SW 已接管，刷新页面获取最新资源');
                window.location.reload();
            }
        });

        // v51：SW 通知强制刷新（防止旧 SW 缓存导致手机端卡在旧版本，sessionStorage 防循环）
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'FORCE_RELOAD') {
                const key = '__reloaded_' + APP_VERSION;
                if (!sessionStorage.getItem(key)) {
                    sessionStorage.setItem(key, '1');
                    window.location.reload();
                }
            }
        });

        if (reg.update) { try { reg.update(); } catch (e) {} }
    }).catch(err => {
        if (window.__DEBUG__) console.log('SW registration failed:', err);
    });
}

// ========== 强制更新（终极兜底：注销 SW 后硬刷新，确保从网络拉取最新）==========
function forceUpdate() {
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                let p = Promise.resolve();
                regs.forEach(r => { p = p.then(() => r.unregister()); });
                p.then(() => { window.location.reload(true); })
                 .catch(() => { window.location.reload(true); });
            }).catch(() => { window.location.reload(true); });
        } else {
            window.location.reload(true);
        }
    } catch (e) {
        window.location.reload(true);
    }
}

// ========== 进入APP欢迎页（每日一次：日期星期 + 问候 + 当日随机金句 + 开始按钮）==========
function showWelcomeScreen() {
    if (document.getElementById('welcomeScreen')) return;
    // ★ 每天只展示一次：用 localStorage 记录最近展示日期（北京时间）
    const bjNow = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000);
    const p2 = x => String(x).padStart(2, '0');
    const todayKey = bjNow.getFullYear() + '-' + p2(bjNow.getMonth() + 1) + '-' + p2(bjNow.getDate());
    try {
        if (localStorage.getItem('welcomeShownDate') === todayKey) return; // 今天已展示过 → 不弹
    } catch (e) {}

    const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][bjNow.getDay()];
    const dateStr = bjNow.getFullYear() + '年' + (bjNow.getMonth() + 1) + '月' + bjNow.getDate() + '日 ' + wd;

    // 每日夸赞金句（按日期稳定随机，同一天不变）
    const QUOTES = [
        '今天的你，比昨天又进步了一点点 ✨',
        '认真努力的人，运气都不会太差',
        '离上岸又近了一天，超棒的！',
        '你的坚持，正在悄悄开花结果',
        '慢慢来，比较快，你已经做得很好',
        '相信你自己，你就是那个天选公务员',
        '每天进步 1%，一年后就是 37 倍的你',
        '你认真的样子，真的很好看',
        '所有的从容，都是厚积薄发',
        '今天的努力，是明天上岸的运气',
        '别慌，你比想象中更厉害',
        '保持热爱，奔赴山海，你一定行'
    ];
    let seed = 0;
    for (const ch of todayKey) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const quote = QUOTES[seed % QUOTES.length];

    const w = document.createElement('div');
    w.id = 'welcomeScreen';
    w.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(160deg,#FFF0F5,#FFD6E6);' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .4s ease;padding:24px;text-align:center;';
    w.innerHTML =
        '<img src="./icons/icon-512.png?v=' + APP_VERSION + '" width="118" height="118" alt="logo" ' +
        'style="border-radius:26px;box-shadow:0 8px 26px rgba(231,84,128,.28);">' +
        '<div style="margin-top:16px;font-size:14px;color:#C2185B;letter-spacing:1px;">' + dateStr + '</div>' +
        '<div style="margin-top:10px;font-size:25px;font-weight:800;color:#E75480;letter-spacing:2px;">嗨，小公务员</div>' +
        '<div style="margin-top:12px;font-size:15px;color:#AD1457;max-width:290px;line-height:1.6;">' + quote + '</div>' +
        '<button id="welcomeStartBtn" style="margin-top:26px;border:none;background:linear-gradient(135deg,#FF8FB1,#FF6FA5);' +
        'color:#fff;font-size:16px;font-weight:700;padding:12px 34px;border-radius:26px;cursor:pointer;' +
        'box-shadow:0 6px 18px rgba(231,84,128,.35);">开始今天 ✨</button>';
    document.body.appendChild(w);

    const dismiss = () => {
        try { localStorage.setItem('welcomeShownDate', todayKey); } catch (e) {}
        w.style.opacity = '0';
        setTimeout(() => { if (w.parentNode) w.parentNode.removeChild(w); }, 400);
    };
    const btn = document.getElementById('welcomeStartBtn');
    if (btn) btn.onclick = dismiss;
    // 兜底：10秒后自动消失，避免卡住（通常用户会直接点按钮进入）
    setTimeout(() => { if (document.getElementById('welcomeScreen') === w) dismiss(); }, 10000);
}

// ========== 版本自检（v52：防止手机端静默卡在旧版本）==========
// 打开任意旧版本时，向服务端查询最新版本号（带时间戳绕过 SW 缓存），
// 若与服务端不一致则弹出"发现新版本"横幅，点"立即刷新"即可拉取最新。
function checkVersion() {
    fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
        .then(r => (r && r.ok ? r.json() : null))
        .then(data => {
            if (data && data.version && String(data.version) !== String(APP_VERSION)) {
                const key = '__reloaded_' + data.version;
                if (!sessionStorage.getItem(key)) {
                    sessionStorage.setItem(key, '1');
                    showUpdateBanner(data.version);
                }
            }
        })
        .catch(() => {});
}
function showUpdateBanner(newVer) {
    if (document.getElementById('updateBanner')) return;
    const b = document.createElement('div');
    b.id = 'updateBanner';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#fff0f5;border:1px solid #FFB6C1;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(231,84,128,.3);display:flex;align-items:center;gap:10px;font-size:13px;color:#c2185b;';
    b.innerHTML = '<span style="font-size:18px;">🔄</span><span style="flex:1;">发现新版本 <b>' + newVer + '</b>（当前 v' + APP_VERSION + '），建议刷新获取最新内容。</span>';
    const btn = document.createElement('button');
    btn.textContent = '立即刷新';
    btn.style.cssText = 'border:none;background:#FF6FA5;color:#fff;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;';
    btn.onclick = function () { forceUpdate(); };
    const close = document.createElement('span');
    close.textContent = '✕';
    close.style.cssText = 'cursor:pointer;color:#bbb;font-size:16px;';
    close.onclick = function () { b.remove(); };
    b.appendChild(btn); b.appendChild(close);
    document.body.appendChild(b);
}

// ========== 倒计时计算与显示 ==========
function initCountdown() {
    updateCountdownDisplay();
    setInterval(updateCountdownDisplay, 60000); // 每分钟更新
}

function updateCountdownDisplay() {
    /* v34 修复：旧写法用 new Date('2026-11-29')（UTC零点）减去本地当前时刻再 ceil，
       会被「当天已过的小时数」带偏一天——实测 8/5 距 11/29 应为 116 天却显示 117，
       Day 计数则反过来少一天。改为纯日期差，任何时刻打开结果都稳定。 */
    const todayKey = bjToday();
    const guokaoDays = daysBetweenYMD(todayKey, EXAM_DATES.guokao);
    const hubaoDays = daysBetweenYMD(todayKey, EXAM_DATES.hubao);

    const guokaoEl = document.getElementById('guokaoDays');
    const hubaoEl = document.getElementById('hubaoDays');

    if (guokaoEl) guokaoEl.textContent = Math.max(0, guokaoDays);
    if (hubaoEl) hubaoEl.textContent = Math.max(0, hubaoDays);

    // Day计数（启动日当天为 Day 1）
    const dayNum = daysBetweenYMD('2026-08-03', todayKey) + 1;
    const guokaoDayNumEl = document.getElementById('guokaoDayNum');
    const hubaoDayNumEl = document.getElementById('hubaoDayNum');
    if (guokaoDayNumEl) guokaoDayNumEl.textContent = `Day ${dayNum}`;
    if (hubaoDayNumEl) hubaoDayNumEl.textContent = `Day ${dayNum}`;
}

// ========== 实时时钟 ==========
function startDateTimeClock() {
    function updateClock() {
        const now = getBJNow(); // v34：始终显示北京时间，设备时区设错也不受影响
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
    // 进入数据备份页时刷新统计与云同步配置
    if (moduleName === 'settings') { renderDataStats(); renderCloudConfig(); }
    // 进入工作台时刷新数据（打卡改为手动，不自动触发）
    if (moduleName === 'home') { renderHome(); }
    // 进入金币台账时刷新（计划任务/打卡/流水/统计）
    if (moduleName === 'gold') { renderGoldLedger(); }
    // 进入每日计划时刷新表格（跨天/金币变动同步）
    if (moduleName === 'plan') { loadPlanItems(); renderPlanStats(); }
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
    a.download = '莲莲工作台_收藏_' + bjToday() + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    touchBackup();
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
    a.download = '莲莲工作台_收藏_' + bjToday() + '.png';
    a.click();
    touchBackup();
    function clip(c, text, maxW) { if (c.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
}

/* ========== 工作台首页 ========== */
// 打卡/推送等共用的「今天」，统一北京时间基准（v34）
function getTodayStr() { return bjToday(); }

// ★ v28 彻底重写：打卡数据结构简化为纯 history 数组
//   localStorage.gk_streak = { history: ['2026-08-03', '2026-08-04', '2026-08-05'] }
//   count 从 history 动态计算，不再单独维护

function _getStreakData() {
    try { return JSON.parse(localStorage.getItem('gk_streak') || '{}'); } catch (e) { return {}; }
}
function _saveStreakData(d) {
    try { localStorage.setItem('gk_streak', JSON.stringify(d)); } catch (e) {}
}

// 计算连续打卡天数（从今天往前数连续的天数）
function _calcStreak(history) {
    if (!history || !history.length) return 0;
    const sorted = [...history].sort().reverse(); // 最新在前
    let streak = 0;
    for (let i = 0; i < sorted.length; i++) {
        // v34：按北京时间往前推，与 getTodayStr() 的写入基准保持一致
        if (sorted[i] === bjDayKey(-i)) streak++;
        else break;
    }
    return streak;
}

// 手动打卡：直接往 history 里追加今天，然后重新计算连续天数
function manualCheckin() {
    const d = _getStreakData();
    if (!Array.isArray(d.history)) d.history = [];
    const today = getTodayStr();

    // 已打过 → 刷新显示即可
    if (d.history.indexOf(today) >= 0) {
        renderHome();
        return;
    }

    // ★ 直接写入，不经过任何可能提前返回的逻辑
    d.history.push(today);
    // 保持排序（去重+排序）
    const uniq = [...new Set(d.history)].sort();
    d.history = uniq;
    _saveStreakData(d);

    if (window.__DEBUG__) console.log('[checkin v28] 打卡成功, history=', JSON.stringify(d.history), ', 连续=', _calcStreak(d.history));
    renderHome();
    if (typeof showToast === 'function') showToast('✅ 打卡成功！已记录到热力图 🔥');
}

function renderHome() {
    const statsEl = document.getElementById('homeStats');
    if (!statsEl) return;

    // ★ v28: 连续天数从 history 动态计算
    const sd = _getStreakData();
    const history = (sd && sd.history) || [];
    const streak = _calcStreak(history);

    // 各模块数据概览
    const statCards = [
        { icon: '📰', label: '时政热点', val: (typeof SHIZHENG_NEWS !== 'undefined' ? SHIZHENG_NEWS.length : 0) },
        { icon: '📖', label: '求是文章', val: (typeof QIUSHI_ARTICLES !== 'undefined' ? QIUSHI_ARTICLES.length : 0) },
        { icon: '⭐', label: '人物素材', val: (typeof RENWU_DATABASE !== 'undefined' ? RENWU_DATABASE.length : 0) },
        { icon: '🌅', label: '晨读文章', val: (typeof MORNING_DB !== 'undefined' ? MORNING_DB.length : 0) },
        { icon: '✍️', label: '申论范文', val: (typeof ESSAYS_DB !== 'undefined' ? ESSAYS_DB.length : 0) },
        { icon: '💡', label: '金句', val: (typeof QUOTES_DB !== 'undefined' ? QUOTES_DB.filter(q => !q.excludeFromDaily).length : 0) },
        { icon: '📌', label: '我的收藏', val: (typeof favBox !== 'undefined' ? favBox.length : 0) }
    ];

    let html = '<div class="home-streak"><div class="home-streak-num">' + streak + '</div><div class="home-streak-label">🔥 连续打卡天数</div></div>';

    // 手动打卡按钮
    const today = getTodayStr();
    const todayDone = history.indexOf(today) >= 0;
    if (todayDone) {
        html += '<div class="home-checkin done">✅ 今日已打卡</div>';
    } else {
        html += '<button class="home-checkin-btn" onclick="manualCheckin()">📍 点击打卡</button>';
    }
    html += '<div class="home-stat-grid">';
    statCards.forEach(c => {
        html += '<div class="home-stat-card" onclick="switchModule(\'' + statModule(c.label) + '\')">' +
            '<div class="home-stat-icon">' + c.icon + '</div>' +
            '<div class="home-stat-val">' + c.val + '</div>' +
            '<div class="home-stat-label">' + c.label + '</div>' +
        '</div>';
    });
    html += '</div>';

    // ★ 驾驶舱：常用模块快捷入口（一键直达高频场景）
    const quickEntries = [
        { icon: '🔢', label: '速算练习', act: "switchModule('susuan');switchSusuanTab('practice');setTimeout(startPractice,250);" },
        { icon: '📚', label: '多解法', act: "switchModule('susuan');switchSusuanTab('multimethod');" },
        { icon: '🌅', label: '晨读', act: "switchModule('morning');" },
        { icon: '📌', label: '收藏夹', act: "switchModule('favbox');" },
        { icon: '📊', label: '模考成绩', act: "switchModule('mock');" },
        { icon: '🀄', label: '高频成语', act: "switchModule('idioms');" },
        { icon: '🎤', label: '面试短句', act: "switchModule('interview');" },
        { icon: '🗞️', label: '时政热点', act: "switchModule('shizheng');" }
    ];
    html += '<div class="home-quick"><div class="home-quick-title">🚀 快捷入口</div><div class="home-quick-grid">';
    quickEntries.forEach(q => {
        html += '<button class="home-quick-btn" onclick="' + q.act + '"><span class="home-quick-icon">' + q.icon + '</span>' + q.label + '</button>';
    });
    html += '</div></div>';

    statsEl.innerHTML = html;

    renderStreakHeatmap();
    renderTodos();
}

/* ★ v30 热力图 —— 最新日期在左侧（GitHub 风格），修复"粉色格子在屏幕外不可见"问题 */
function renderStreakHeatmap() {
    var el = document.getElementById('streakHeatmap');
    if (!el) return;

    // ====== 读取数据 ======
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem('gk_streak') || '{}'); } catch(e){}
    var hist = (raw && raw.history) || [];
    if (!Array.isArray(hist)) hist = [];

    // 旧格式迁移
    if (hist.length === 0 && raw && typeof raw.count === 'number' && raw.count > 0 && raw.last) {
        // v34：'YYYY-MM-DD' 被 new Date() 当成 UTC 零点解析，非东八区设备会整体错一天，
        //      补 'T00:00:00' 强制按本地墙上时间解析，保证读回来就是原字符串那一天
        var rb = [], rd = new Date(String(raw.last).slice(0, 10) + 'T00:00:00');
        for (var ri = 0; ri < Math.min(raw.count, 999); ri++) {
            rb.unshift(fmtYMD(rd));
            rd.setDate(rd.getDate()-1);
        }
        hist = rb; raw.history = rb; delete raw.count; delete raw.last;
        try { localStorage.setItem('gk_streak', JSON.stringify(raw)); } catch(e){}
    }

    // 兜底补今天
    var todayStr = bjToday();
    if (hist.indexOf(todayStr) < 0 && raw && raw.last === todayStr) {
        hist.push(todayStr); raw.history = hist;
        try { localStorage.setItem('gk_streak', JSON.stringify(raw)); } catch(e){}
    }

    var checked = {};
    for (var hi = 0; hi < hist.length; hi++) checked[hist[hi]] = true;

    // ====== 渲染（最新在左）======
    var C_ON  = '#E75480';
    var C_OFF = '#e8e8e8';
    var C_FUT = '#f5f5f5';
    var weeks = 26;
    // v34：以北京时间的「今天零点」为基准，保证格子日期与打卡写入的键完全对齐
    var now = getBJNow(); now.setHours(0,0,0,0);

    // ★ 关键改动：从今天往回推，最新的一周在最左边

    // 计算本周日（作为网格的右边界基准）
    var endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay())); // 本周六

    var html = '<div class="heatmap-title">📅 打卡热力图（近半年）</div><div class="heatmap-grid">';
    var pinkCnt = 0;

    // 从最新的周开始，往前遍历（w=0 是最近一周，在最左边）
    for (var w = 0; w < weeks; w++) {
        html += '<div class="heatmap-week">';
        // 每周从周日到周六
        for (var d = 6; d >= 0; d--) {
            var cellDate = new Date(endOfWeek);
            cellDate.setDate(endOfWeek.getDate() - (w * 7 + (6 - d)));
            var k = fmtYMD(cellDate);
            var fut = cellDate > now;
            var done = !!checked[k];
            if (done && !fut) pinkCnt++;
            var bg = fut ? C_FUT : (done ? C_ON : C_OFF);
            html += '<div class="heat-cell" style="background:'+bg+';" title="'+k+(done?' ✅':(fut?' · 未到':' · 未打卡'))+'"></div>';
        }
        html += '</div>';
    }
    html += '</div>';

    // 图例
    html += '<div class="heatmap-legend"><span>未打卡</span>'+
        '<div class="heat-cell" style="background:'+C_OFF+';"></div>'+
        '<div class="heat-cell" style="background:'+C_ON+';"></div>'+
        '<span>已打卡</span>'+
        '<span class="heat-count">累计 '+pinkCnt+' 天</span></div>';

    el.innerHTML = html;
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
    const q = query.toLowerCase();
    const hit = (text) => String(text || '').toLowerCase().indexOf(q) >= 0;
    const results = [];
    const DB = (name) => (typeof name !== 'undefined' ? name : []);

    // 搜索时政热点
    DB(SHIZHENG_NEWS).forEach(item => {
        if (hit(item.title) || hit(item.summary)) results.push({ type: '时政热点', title: item.title, source: item.source, module: 'shizheng' });
    });
    // 搜索申论范文
    DB(ESSAYS_DB).forEach(item => {
        if (hit(item.title) || hit(item.content)) results.push({ type: '申论范文', title: item.title, source: item.source, module: 'shenlun' });
    });
    // 搜索求是网文章
    DB(QIUSHI_ARTICLES).forEach(item => {
        if (hit(item.title) || hit(item.summary)) results.push({ type: '求是网文章', title: item.title, source: '求是网', module: 'qiushi' });
    });
    // 搜索人物素材
    DB(RENVU_DATABASE).forEach(item => {
        if (hit(item.name) || hit(item.story) || hit(item.categoryName)) results.push({ type: '人物素材', title: item.name, source: item.categoryName, module: 'renwu' });
    });
    // 搜索今日晨读
    DB(MORNING_DB).forEach(item => {
        if (hit(item.title) || hit(item.content)) results.push({ type: '今日晨读', title: item.title, source: item.source, module: 'morning' });
    });
    // 搜索金句
    DB(QUOTES_DB).forEach(item => {
        if (hit(item.text) || hit(item.themeName) || hit(item.category) || hit(item.source)) {
            const t = (item.text || '').slice(0, 42);
            results.push({ type: '金句', title: t + (item.text && item.text.length > 42 ? '…' : ''), source: item.source || item.category, module: 'shenlun' });
        }
    });
    // 搜索高频成语
    DB(IDIOMS_DB).forEach(item => {
        if (hit(item.word) || hit(item.pinyin) || hit(item.meaning)) results.push({ type: '高频成语', title: item.word + '（' + item.pinyin + '）', source: item.tier, module: 'idioms' });
    });
    // 搜索成语混淆配对
    DB(IDIOM_PAIRS_DB).forEach(item => {
        if (hit(item.a && item.a.word) || hit(item.b && item.b.word) || hit(item.note) || hit((item.tags || []).join(' '))) {
            results.push({ type: '成语辨析', title: (item.a && item.a.word) + ' vs ' + (item.b && item.b.word), source: (item.tags || []).join('/'), module: 'idiomPairs' });
        }
    });
    // 搜索逻辑口诀
    DB(LOGIC_DB).forEach(item => {
        if (hit(item.title) || hit(item.content) || hit(item.category)) results.push({ type: '逻辑口诀', title: item.title, source: item.category, module: 'logic' });
    });
    // 搜索面试短句
    DB(INTERVIEW_DB).forEach(item => {
        if (hit(item.text) || hit(item.type) || hit(item.tag)) {
            const t = (item.text || '').slice(0, 42);
            results.push({ type: '面试短句', title: t + (item.text && item.text.length > 42 ? '…' : ''), source: item.type, module: 'interview' });
        }
    });
    // 搜索速算题（远程每日生成 + 累积）
    const susuan = (typeof window !== 'undefined' && window.__SUSUAN_REMOTE__) || [];
    susuan.forEach(item => {
        if (hit(item.question) || hit(item.category)) results.push({ type: '速算题', title: (item.question || '').slice(0, 50), source: item.category, module: 'susuan' });
    });

    // 结果过多时截断，避免弹窗 DOM 过大
    let truncated = false;
    if (results.length > 80) { results.length = 80; truncated = true; }
    showSearchResults(results, query, truncated);
}

function showSearchResults(results, query, truncated) {
    const modal = document.getElementById('searchModal');
    const body = document.getElementById('searchResults');
    modal.style.display = 'flex';

    if (results.length === 0) {
        body.innerHTML = `<p style="text-align:center;color:#999;padding:40px;">未找到与"${query}"相关的内容</p>`;
        return;
    }

    const header = `<div style="font-size:13px;color:#C2185B;font-weight:600;margin-bottom:10px;">🔍 共找到 ${results.length} 条${truncated ? '（已截断显示前 80 条，请缩小关键词）' : ''}</div>`;
    body.innerHTML = header + results.map(r => `
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

// 时政列表分页状态：避免一次渲染几百张卡片卡顿
let shizhengFiltered = [];
let shizhengRendered = 0;
let shizhengSig = '';
const SHIZHENG_PAGE = 24;

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

    // 列表内容未变（如点赞/收藏后局部刷新、或远程数据未变动）时保持已渲染进度，不重置滚动位置
    const sig = currentShizhengSource + '|' + currentShizhengFilter + '|' + filtered.length;
    if (sig === shizhengSig && shizhengRendered > 0 && filtered.length >= shizhengRendered) return;

    shizhengSig = sig;
    shizhengFiltered = filtered;
    shizhengRendered = 0;
    container.innerHTML = '';

    if (filtered.length === 0) {
        const hint = (currentShizhengSource !== 'all' && currentShizhengFilter !== 'all')
            ? `「${currentShizhengSource}」+「${currentShizhengFilter === 'guokao' ? '国考考点' : '湖北省情'}」暂无交叉文章<br/><span style="font-size:12px;">试试切换来源或方向</span>`
            : currentShizhengSource !== 'all'
                ? `「${currentShizhengSource}」暂无文章<br/><span style="font-size:12px;">点「全部」查看所有文章</span>`
                : `该条件下暂无文章<br/><span style="font-size:12px;">点「全部」重置</span>`;
        container.innerHTML = `<div style="text-align:center;color:#999;padding:48px 20px;">🗞️ ${hint}</div>`;
        return;
    }

    appendShizhengChunk();
}

function appendShizhengChunk() {
    const container = document.getElementById('shizhengList');
    if (!container) return;
    const total = shizhengFiltered.length;
    const start = shizhengRendered;
    if (start >= total) return;
    const end = Math.min(start + SHIZHENG_PAGE, total);
    const slice = shizhengFiltered.slice(start, end);
    const oldMore = document.getElementById('shizhengMore');
    if (oldMore) oldMore.remove();
    container.insertAdjacentHTML('beforeend', slice.map(function (item) {
        return buildNewsCardHtml(item);
    }).join(''));
    shizhengRendered = end;
    if (end < total) {
        const more = document.createElement('button');
        more.id = 'shizhengMore';
        more.className = 'btn-outline btn-sm';
        more.style.cssText = 'display:block;margin:16px auto;';
        more.textContent = '加载更多 (' + (total - end) + ')';
        more.onclick = appendShizhengChunk;
        container.appendChild(more);
    }
}

function buildNewsCardHtml(item) {
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
        '<div class="news-brief" id="news-brief-' + item.id + '">' + shortSummary + (shortSummary.length >= 100 ? '...' : '') + '</div>' +
        '<div class="news-detail" id="news-detail-' + item.id + '" style="display:none;">' +
            '<div class="ai-insight">' +
                '<div class="ai-insight-title">💡 AI 提炼</div>' +
                sanitizeAnalysis(item.aiInsight).replace(/\n/g, '<br>') +
            '</div>' +
            '<div class="news-summary">' + item.summary + '</div>' +
            '<div class="news-full-text" id="fulltext-' + item.id + '">' + item.fullText + '</div>' +
            '<div class="news-footer">' +
                '<span>来源: ' + (item.source || '') + ' · ' + (item.date || '') + '</span>' +
                (item.url ? '<a class="quote-source-link" onclick="window.open(\'' + item.url + '\',\'_blank\')" title="查看原文">🔗 查看原文</a>' : '') +
                '<button class="expand-btn" onclick="toggleFullText(' + item.id + ')">展开全文</button>' +
            '</div>' +
        '</div>' +
    '</div>';
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

/* ---------------- 全量学习数据备份 / 导入 / 云同步 ---------------- */
function buildBackupPayload() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const raw = localStorage.getItem(k);
        try { data[k] = JSON.parse(raw); } catch (e) { data[k] = raw; }
    }
    return { app: '莲莲工作台', version: APP_VERSION, exportedAt: new Date().toISOString(), data };
}
function applyBackupData(parsed) {
    const data = parsed.data || parsed; // 兼容直接导出的 localStorage 快照
    let n = 0;
    for (const k in data) {
        const v = data[k];
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        n++;
    }
    return n;
}
function exportAllData() {
    const payload = buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '莲莲工作台_学习数据_' + bjToday() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    if (typeof showToast === 'function') showToast('已导出 ' + Object.keys(payload.data).length + ' 项学习数据 ✅');
    else alert('已导出 ' + Object.keys(payload.data).length + ' 项学习数据 ✅\n（含收藏/成语错词/打卡/待办/速算错题/模考记录等）');
}
function importAllData(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            const n = applyBackupData(parsed);
            if (typeof showToast === 'function') showToast('已导入 ' + n + ' 项数据，即将刷新页面恢复～');
            else alert('已导入 ' + n + ' 项数据，即将刷新页面恢复～');
            setTimeout(() => location.reload(), 800);
        } catch (err) {
            if (typeof showToast === 'function') showToast('导入失败：文件格式不正确或损坏');
            else alert('导入失败：文件格式不正确或损坏');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

/* ---------------- 跨设备云同步（GitHub Gist，零后端） ---------------- */
const GITHUB_API = 'https://api.github.com';
const CLOUD_FILE = 'lianlian-backup.json';
function cloudLoadConfig() {
    return {
        gistId: localStorage.getItem('gk_cloud_gist') || '',
        pat: localStorage.getItem('gk_cloud_pat') || ''
    };
}
function renderCloudConfig() {
    const cfg = cloudLoadConfig();
    const gi = document.getElementById('cloudGistId');
    const pt = document.getElementById('cloudPat');
    if (gi) gi.value = cfg.gistId;
    if (pt && cfg.pat) pt.value = cfg.pat; // token 已存则回填掩码（不显示明文，提示已配置）
    if (pt && !cfg.pat) pt.value = '';
    if (pt && cfg.pat && !pt.value) pt.placeholder = 'GitHub Token 已配置（留空 = 沿用已存 token）';
}
function cloudSaveConfig() {
    const gistId = (document.getElementById('cloudGistId') || {}).value || '';
    const pat = (document.getElementById('cloudPat') || {}).value || '';
    localStorage.setItem('gk_cloud_gist', gistId);
    if (pat) localStorage.setItem('gk_cloud_pat', pat);
    cloudStatus('配置已保存到本机 ✅', true);
}
function cloudStatus(msg, ok) {
    const el = document.getElementById('cloudStatus');
    if (el) { el.textContent = msg; el.style.color = ok ? '#2e9e5b' : '#c0392b'; }
}
async function cloudBackup() {
    const { gistId, pat } = cloudLoadConfig();
    const uiPat = (document.getElementById('cloudPat') || {}).value || '';
    const uiGist = (document.getElementById('cloudGistId') || {}).value || '';
    const token = uiPat || pat;           // 优先用输入框里的（刚填的），否则用已存的
    const gid = uiGist || gistId;
    if (!token) { cloudStatus('请先填写 GitHub Token（需 gist 权限）后保存/备份', false); return; }
    const payload = buildBackupPayload();
    const content = JSON.stringify(payload);
    try {
        let res, url, method;
        if (gid) {
            url = GITHUB_API + '/gists/' + gid;
            method = 'PATCH';
            res = await fetch(url, {
                method,
                headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: { [CLOUD_FILE]: { content } } })
            });
        } else {
            url = GITHUB_API + '/gists';
            method = 'POST';
            res = await fetch(url, {
                method,
                headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: '莲莲工作台学习数据备份（自动生成，勿手动修改）', public: false, files: { [CLOUD_FILE]: { content } } })
            });
        }
        if (!res.ok) {
            const t = await res.text();
            cloudStatus('备份失败：' + res.status + ' ' + t.slice(0, 140), false);
            return;
        }
        const json = await res.json();
        const newId = json.id;
        localStorage.setItem('gk_cloud_gist', newId);
        touchBackup();
        const inp = document.getElementById('cloudGistId');
        if (inp) inp.value = newId;
        cloudStatus('已备份到云端 ✅（' + Object.keys(payload.data).length + ' 项，Gist ID 已回填）', true);
    } catch (e) {
        cloudStatus('备份失败：' + (e && e.message ? e.message : e), false);
    }
}
async function cloudRestore() {
    const { gistId, pat } = cloudLoadConfig();
    const uiPat = (document.getElementById('cloudPat') || {}).value || '';
    const uiGist = (document.getElementById('cloudGistId') || {}).value || '';
    const token = uiPat || pat;
    const gid = uiGist || gistId;
    if (!gid) { cloudStatus('请先填写 Gist ID', false); return; }
    if (!token) { cloudStatus('请先填写 GitHub Token 后保存/恢复', false); return; }
    try {
        const res = await fetch(GITHUB_API + '/gists/' + gid, {
            headers: { 'Authorization': 'token ' + token }
        });
        if (!res.ok) { cloudStatus('恢复失败：' + res.status + (res.status === 404 ? '（Gist 不存在或无权限）' : ''), false); return; }
        const json = await res.json();
        const file = json.files && json.files[CLOUD_FILE];
        if (!file || !file.content) { cloudStatus('该 Gist 中没有备份文件', false); return; }
        const parsed = JSON.parse(file.content);
        const n = applyBackupData(parsed);
        cloudStatus('已从云端恢复 ' + n + ' 项，即将刷新～', true);
        setTimeout(() => location.reload(), 800);
    } catch (e) {
        cloudStatus('恢复失败：' + (e && e.message ? e.message : e), false);
    }
}
function renderDataStats() {
    const el = document.getElementById('dataStats');
    if (!el) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) keys.push(k); }
    // 各模块数据量概览
    const labels = {
        favBox: '收藏', favQuotes: '金句收藏', favIdioms: '成语收藏', idiomErrors: '成语错词',
        gk_streak: '打卡', gk_todos: '待办', susuanErrors: '速算错题', quoteCheckins: '金句打卡',
        mockRecords: '模考记录'
    };
    let html = '📊 当前本机数据：共 ' + keys.length + ' 项';
    const parts = keys.filter(k => labels[k]).map(k => labels[k] + ' ' + (function () {
        try { return JSON.parse(localStorage.getItem(k)).length; } catch (e) { return 1; }
    })());
    if (parts.length) html += '（' + parts.join(' · ') + '）';
    el.textContent = html;
}

function updateShizhengUpdateInfo() {
    const el = document.getElementById('shizhengUpdateInfo');
    if (!el) return;
    const today = bjToday(); // v34：北京时间，凌晨不再把"今日更新"算成 0
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
    updateEssayFilterCounts();
    loadCheckinStats();
}

function switchShenlunTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
}

function showRandomQuote(filter = 'all') {
    // v37：剔除被标记为 excludeFromDaily 的新闻陈述风条目（不当作可背诵金句）
    const recitePool = QUOTES_DB.filter(q => !q.excludeFromDaily);
    let pool = filter === 'all' ? [...recitePool] : recitePool.filter(q => q.theme === filter);
    if (pool.length === 0) pool = [...recitePool];
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
    const today = bjToday(); // v34：北京时间，凌晨背金句不再记到昨天
    let checkins = JSON.parse(localStorage.getItem('quoteCheckins') || '{}');
    if (!checkins[today]) checkins[today] = [];
    if (!checkins[today].includes(quote.id)) {
        checkins[today].push(quote.id);
        localStorage.setItem('quoteCheckins', JSON.stringify(checkins));
        monitorDrop('quoteCheckins', '金句打卡');
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
    for (let i = 0; i < 365; i++) {
        // v34：按北京时间往前推，与 checkinQuote 的写入基准一致
        const key = bjDayKey(-i);
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

/* 话题筛选按钮显示各话题范文数量 */
function updateEssayFilterCounts() {
    const box = document.getElementById('essayTagFilters');
    if (!box || typeof ESSAYS_DB === 'undefined') return;
    const counts = {};
    ESSAYS_DB.forEach(function(e) { (e.tags || []).forEach(function(t) { counts[t] = (counts[t] || 0) + 1; }); });
    box.querySelectorAll('.tag-btn').forEach(function(btn) {
        if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
        const tag = btn.dataset.etag;
        const n = tag === 'all' ? ESSAYS_DB.length : (counts[tag] || 0);
        btn.innerHTML = btn.dataset.label + ' <i>' + n + '</i>';
    });
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
            (item.url ? '<div style="text-align:right;margin:2px 8px 6px;"><a class="quote-source-link" onclick="window.open(\'' + item.url + '\',\'_blank\')" title="查看原文">🔗 查看原文</a></div>' : '') +
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
        dateLabel.textContent = `${bjToday()} 晨读 · 权威媒体评论每日精选`;
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
let mmRevealedIds = {}; // 做题模式下已手动查看答案的题目ID集合

function renderSpeedMultiList() {
    const container = document.getElementById('mmList');
    if (!container) return;
    // ★ 优先用每日自动生成的远程速算题（最新在前），内置 SPEED_MULTI_DB 作为离线兜底
    // 累积后远程题量可能很大：多解法库只展示最近 150 道（避免一次性渲染过多 DOM）；练习池在 getPracticePool 使用全量
    const remoteAll = (typeof window !== 'undefined' && window.__SUSUAN_REMOTE__ && window.__SUSUAN_REMOTE__.length) ? window.__SUSUAN_REMOTE__ : [];
    const remote = remoteAll.slice(0, 150);
    const builtin = (typeof SPEED_MULTI_DB !== 'undefined') ? SPEED_MULTI_DB : [];
    const db = remote.concat(builtin);
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

        // 看解法模式：直接显示全部（答案+选项+所有解法）
        if (mmShowSolutions) {
            return '<div class="mm-card" id="mm-' + q.id + '">' +
                '<div class="mm-q-header">' +
                    '<span class="mm-idx">#' + (idx + 1) + '</span>' +
                    '<span class="mm-cat">' + q.category + '</span>' +
                    '<span class="mm-diff">' + q.difficulty + '</span>' +
                '</div>' +
                '<div class="mm-question">' + q.question + '</div>' +
                '<div class="mm-options">' + q.options.join('　') + '</div>' +
                '<div class="mm-answer">✅ 答案：<b>' + q.answer + '</b></div>' +
                '<div class="mm-methods-label">📐 多种解法（点击展开）：</div>' +
                '<div class="mm-methods">' + methodsHtml + '</div>' +
            '</div>';
        }

        // 做题模式(mmShowSolutions=false)：默认隐藏答案和解法，只显示题目+选项
        var isRevealed = !!mmRevealedIds[q.id];
        return '<div class="mm-card" id="mm-' + q.id + '">' +
            '<div class="mm-q-header">' +
                '<span class="mm-idx">#' + (idx + 1) + '</span>' +
                '<span class="mm-cat">' + q.category + '</span>' +
                '<span class="mm-diff">' + q.difficulty + '</span>' +
            '</div>' +
            '<div class="mm-question">' + q.question + '</div>' +
            '<div class="mm-options">' + q.options.join('　') + '</div>' +
            (isRevealed
                ? '<div class="mm-answer">✅ 答案：<b>' + q.answer + '</b></div>' +
                  '<div class="mm-methods-label">📐 多种解法（点击展开）：</div>' +
                  '<div class="mm-methods">' + methodsHtml + '</div>'
                : '<div class="mm-blind-area" id="mm-blind-' + q.id + '">' +
                    '<button class="btn-pink btn-sm" onclick="revealMmAnswer(' + q.id + ')">👁 查看答案与解法</button>' +
                    '<div class="mm-blind-hint">先自己算一算，再看答案～</div>' +
                  '</div>'
            ) +
        '</div>';
    }).join('');
}

/* 做题模式：单题查看答案（只展开这一题） */
function revealMmAnswer(qId) {
    mmRevealedIds[qId] = true;
    renderSpeedMultiList();
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
    if (!mmShowSolutions) mmRevealedIds = {}; // 切回做题模式时，隐藏所有已查看的答案
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
// ★ 每日练习题库：优先用每日自动生成的远程速算题（最新、含 correctText 纯答案），内置 PRACTICE_QUESTIONS 兜底
function getPracticePool() {
    const remote = (typeof window !== 'undefined' && window.__SUSUAN_REMOTE__ && window.__SUSUAN_REMOTE__.length)
        ? window.__SUSUAN_REMOTE__ : [];
    const remotePractice = remote.map(function (it) {
        return { q: it.question, a: it.correctText, type: it.category, remote: true };
    });
    const builtin = (typeof PRACTICE_QUESTIONS !== 'undefined') ? PRACTICE_QUESTIONS : [];
    return remotePractice.concat(builtin); // 远程新题在前
}

function initPracticeMode() {
    practiceState.questions = shuffleArray(getPracticePool()).slice(0, 10);
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
    const correct = isPracticeAnswerAcceptable(userAns, q.a);

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

/* 速算练判分：非数值精确匹配；数值允许±2%（或1个单位）的估算误差，
   因为资料分析速算本就是估算，答案"差不多就行"，不要求完全一致 */
function isPracticeAnswerAcceptable(userAns, correctAns) {
    if (!userAns) return false;
    const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
    const u = norm(userAns);
    const c = norm(correctAns);
    if (u === c) return true;
    const toNum = s => parseFloat(s.replace(/[%,≈~]/g, ''));
    const un = toNum(u), cn = toNum(c);
    if (isFinite(un) && isFinite(cn) && cn !== 0) {
        const diff = Math.abs(un - cn);
        const tol = Math.max(1, Math.abs(cn) * 0.02);
        if (diff <= tol) return true;
    }
    return false;
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

// 每日计划的日期键（北京时间，工具函数见文件顶部「全局时间基准」）
function getTodayKey() { return bjToday(); }

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
        <tr class="${item.done ? 'plan-row-done' : ''}">
            <td><input type="checkbox" class="plan-checkbox" ${item.done ? 'checked' : ''} onchange="togglePlanDone('${item.id}', this.checked)"/></td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;background:${getCategoryColor(item.category)};color:#fff;">${item.category}</span></td>
            <td>${item.task}</td>
            <td class="plan-gold-cell">
                <input type="number" class="plan-gold-input" min="0" step="1" value="${Number(item.gold) || 0}" onchange="updatePlanGold('${item.id}', this.value)" title="完成该任务可得金币" />
                <span class="plan-gold-unit ${item.done ? 'earned' : ''}">${item.done ? '✓已得' : '🪙'}</span>
            </td>
            <td><input type="range" class="plan-progress-slider" min="0" max="100" value="${item.progress}" onchange="updatePlanProgress('${item.id}', this.value)"/><span style="margin-left:6px;font-size:12px;color:#4A90D9;">${item.progress}%</span></td>
            <td><button class="btn-outline btn-sm" onclick="deletePlanItem('${item.id}')">删除</button></td>
        </tr>
    `).join('');
    renderPlanGoldBar(items);
}

// 计划任务金币汇总条（显示在统计卡区域，实时反映今日已得/可得）
function renderPlanGoldBar(items) {
    const host = document.getElementById('planStats');
    if (!host) return;
    let bar = document.getElementById('planGoldBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'planGoldBar';
        bar.className = 'plan-gold-bar';
        host.parentNode.insertBefore(bar, host.nextSibling);
    }
    const earned = items.filter(i => i.done).reduce((s, i) => s + (Number(i.gold) || 0), 0);
    const totalGold = items.reduce((s, i) => s + (Number(i.gold) || 0), 0);
    bar.innerHTML = `<span class="pg-earned">今日已得 <b>${earned}</b> 金币</span>
        <span class="pg-sep">/</span>
        <span class="pg-total">全部完成可得 ${totalGold}</span>
        <button class="btn-outline btn-sm" onclick="switchModule('gold')">查看金币台账 →</button>`;
}

// 修改某条计划任务的金币奖励
function updatePlanGold(id, val) {
    const n = Number(val);
    if (isNaN(n) || n < 0) { appAlert('金币需为非负数字'); loadPlanItems(); return; }
    const key = getTodayKey();
    let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
    const item = items.find(i => String(i.id) === String(id));
    if (item) {
        item.gold = n;
        localStorage.setItem(`plan_${key}`, JSON.stringify(items));
    }
    loadPlanItems();
    if (typeof renderGoldLedger === 'function') renderGoldLedger();
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
    if (!planStatMonth) renderHistoryStats(); // 完成率随勾选实时更新
    // v57：完成任务即得金币，实时同步到「考公金币台账」
    loadPlanItems();
    if (typeof renderGoldLedger === 'function') renderGoldLedger();
    if (item && typeof showToast === 'function') {
        const g = Number(item.gold) || 0;
        if (g > 0) showToast(done ? `完成「${item.task}」 +${g} 金币` : `已取消「${item.task}」 -${g} 金币`);
    }
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
            { id: 'cat', label: '分类', type: 'select', options: ['行测', '申论', '资料分析', '常识时政'], value: '行测' },
            { id: 'gold', label: '完成可得金币', type: 'number', value: 5, placeholder: '如：10' }
        ],
        okText: '保存', cancelText: '取消',
        onOk: (v) => {
            const task = (v.task || '').trim();
            if (!task) { appAlert('请填写任务内容哦～'); return; }
            const cat = v.cat || '行测';
            let gold = Number(v.gold);
            if (isNaN(gold) || gold < 0) gold = 0;
            const key = getTodayKey();
            let items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
            items.push({ id: Date.now(), category: cat, task, done: false, progress: 0, gold });
            localStorage.setItem(`plan_${key}`, JSON.stringify(items));
            loadPlanItems();
            renderPlanStats();
            if (!planStatMonth) renderHistoryStats(); // 看本月时同步刷新月度统计
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
    if (!planStatMonth) renderHistoryStats(); // 看本月时同步刷新月度统计
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
    const base = getBJNow(); // 北京时间基准，避免凌晨算成前一天
    for (let i = 0; i < 365; i++) {
        const d = new Date(base); d.setDate(d.getDate() - i);
        const items = JSON.parse(localStorage.getItem(`plan_${fmtYMD(d)}`) || '[]');
        if (items.some(i => i.done)) streak++;
        else break;
    }
    return streak;
}

/* 当前正在查看的统计月份，'YYYY-MM'；null 表示跟随本月 */
let planStatMonth = null;

/* 扫描本地已有的最早计划月份，作为往前翻的下限 */
function getPlanEarliestMonth() {
    let min = null;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('plan_') !== 0) continue;
        const ym = k.slice(5, 12); // plan_2026-08-01 → 2026-08
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        if (!min || ym < min) min = ym;
    }
    return min;
}

/* 月份翻页：delta = -1 上一月 / +1 下一月，越界自动忽略 */
function shiftPlanStatMonth(delta) {
    const thisMonth = fmtYMD(getBJNow()).slice(0, 7);
    const cur = planStatMonth || thisMonth;
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const earliest = getPlanEarliestMonth();
    if (next > thisMonth) return;                    // 不能翻到未来
    if (earliest && next < earliest) return;         // 不能翻到最早记录之前
    planStatMonth = next;
    renderHistoryStats();
}

function backToThisMonth() {
    planStatMonth = null;
    renderHistoryStats();
}

function renderHistoryStats() {
    const container = document.getElementById('planHistoryStats');
    if (!container) return;

    const bjNow = getBJNow();
    const thisMonth = fmtYMD(bjNow).slice(0, 7);
    const monthKey = planStatMonth || thisMonth;
    const isCurrent = monthKey === thisMonth;

    const [y, m] = monthKey.split('-').map(Number);
    // 本月只统计到今天；历史月份统计整月
    const lastDay = isCurrent ? bjNow.getDate() : new Date(y, m, 0).getDate();

    let totalDone = 0, totalTasks = 0, daysActive = 0;
    for (let d = 1; d <= lastDay; d++) {
        const key = `${monthKey}-${String(d).padStart(2, '0')}`;
        const items = JSON.parse(localStorage.getItem(`plan_${key}`) || '[]');
        if (items.length > 0) {
            daysActive++;
            totalTasks += items.length;
            totalDone += items.filter(i => i.done).length;
        }
    }

    const earliest = getPlanEarliestMonth();
    const canPrev = !earliest || monthKey > earliest;
    const canNext = monthKey < thisMonth;
    const rate = totalTasks > 0 ? ((totalDone / totalTasks) * 100).toFixed(1) : '0.0';

    const body = daysActive === 0
        ? '<p style="color:#999;padding:6px 0;">该月暂无计划记录</p>'
        : `<p>活跃天数: <strong>${daysActive}</strong> 天 <span style="color:#bbb;font-size:12px;">/ ${lastDay} 天</span></p>
           <p>总任务数: <strong>${totalTasks}</strong> 项</p>
           <p>已完成: <strong>${totalDone}</strong> 项</p>
           <p>月度完成率: <strong style="color:#FFB6C1;">${rate}%</strong></p>`;

    container.innerHTML = `
        <div class="plan-hist-head">
            <button class="plan-hist-nav" onclick="shiftPlanStatMonth(-1)" ${canPrev ? '' : 'disabled'} title="上一月">◀</button>
            <h4 class="plan-hist-title">📊 ${monthKey} 月度统计${isCurrent ? '<span class="plan-hist-tag">本月</span>' : ''}</h4>
            <button class="plan-hist-nav" onclick="shiftPlanStatMonth(1)" ${canNext ? '' : 'disabled'} title="下一月">▶</button>
        </div>
        ${body}
        ${isCurrent
            ? `<p>连续备考: <strong style="color:#FFB6C1;">${getStreakDays()}</strong> 天</p>`
            : `<p style="margin-top:8px;"><button class="btn-outline btn-sm" onclick="backToThisMonth()">回到本月</button>
               <span style="font-size:12px;color:#bbb;margin-left:8px;">历史月份 · 只读</span></p>`}
    `;
}

// 每日5点自动重置检查
function checkDailyReset() {
    const lastReset = localStorage.getItem('lastPlanResetDate');
    const today = getTodayKey();
    if (lastReset !== today) {
        const hour = getBJNow().getHours(); // 北京时间小时，与 getTodayKey 基准保持一致
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
    const today = bjToday(); // v34：表单默认日期用北京时间，凌晨不再默认成昨天
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
    const dateVal = document.getElementById('mockDate').value || bjToday();
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
            saveMockRecords(records);
            alert('✅ 模考成绩已更新！');
            renderRecordForm(); renderRecentRecords();
            return;
        }
        records.unshift({ id: Date.now(), date, module, xingce, shenlun, score, rank, note, total: null, correct: null, accuracy: null, time: 0 });
        saveMockRecords(records);
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
        saveMockRecords(records);
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
    saveMockRecords(records);

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
            saveMockRecords(records);
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
        saveMockRecords(records);
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
    /* v34：记录里存的是 'YYYY-MM-DDT00:00:00.000Z'（UTC零点），旧写法用 new Date()
       解析后跟本地时刻比，会有 8 小时边界漂移。改为直接比日期字符串——
       YYYY-MM-DD 的字典序等价于时间序，既准确又零时区歧义。 */
    const weekAgoKey = bjDayKey(-7);
    const weekRecords = records.filter(r => (r.date || '').slice(0, 10) >= weekAgoKey);

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
    // v34：同上，按北京时间的日期字符串比较，消除 UTC/本地混用的边界漂移
    const key7 = bjDayKey(-7);
    const key30 = bjDayKey(-30);
    const r7 = prac.filter(r => (r.date || '').slice(0, 10) >= key7);
    const r30 = prac.filter(r => (r.date || '').slice(0, 10) >= key30);

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

    // 月度报告（支持历史月份翻页，逻辑同每日计划月度统计）
    renderMockMonthReport();
}

/* ---------------- 模考月度备考报告：历史月份翻页（v35） ---------------- */
let mockReportMonth = null; // null = 看本月

/* 扫描本地模考记录里最早的月份，作为往前翻的下限 */
function getMockEarliestMonth() {
    const recs = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    let min = null;
    recs.forEach(r => {
        const d = (r.date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(d)) return;
        if (!min || d < min) min = d;
    });
    return min;
}

/* 月份翻页：delta = -1 上一月 / +1 下一月，越界自动忽略 */
function shiftMockReportMonth(delta) {
    const thisMonth = bjToday().slice(0, 7);
    const cur = mockReportMonth || thisMonth;
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const earliest = getMockEarliestMonth();
    if (next > thisMonth) return;                  // 不能翻到未来
    if (earliest && next < earliest) return;       // 不能翻到最早记录之前
    mockReportMonth = next;
    renderMockMonthReport();
}

function backToMockReportMonth() {
    mockReportMonth = null;
    renderMockMonthReport();
}

/* 渲染当前所选月份的备考报告（本月统计到今天，历史月统计整月） */
function renderMockMonthReport() {
    const reportEl = document.getElementById('monthlyReport');
    if (!reportEl) return;

    const thisMonth = bjToday().slice(0, 7);
    const mk = mockReportMonth || thisMonth;
    const isCurrent = mk === thisMonth;

    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    const prac = records.filter(r => r.module !== '模考成绩'); // 仅刷题记录参与正确率
    const monthRecs = prac.filter(r => (r.date || '').slice(0, 7) === mk);
    const monthAvg = monthRecs.length > 0
        ? (monthRecs.reduce((s, r) => s + parseFloat(r.accuracy), 0) / monthRecs.length).toFixed(1)
        : '-';

    // 本月各模块平均正确率，用于「提升明显 / 待加强」
    const modAcc = {};
    MOCK_MODULES.filter(mm => mm !== '模考成绩').forEach(mm => modAcc[mm] = []);
    monthRecs.forEach(r => { if (modAcc[r.module]) modAcc[r.module].push(parseFloat(r.accuracy)); });
    const sortedMods = Object.entries(modAcc)
        .filter(([k, v]) => v.length > 0)
        .map(([k, v]) => ({ module: k, avg: (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), count: v.length }))
        .sort((a, b) => parseFloat(a.avg) - parseFloat(b.avg));

    const earliest = getMockEarliestMonth();
    const canPrev = !earliest || mk > earliest;
    const canNext = mk < thisMonth;

    reportEl.innerHTML = `
        <div class="plan-hist-head">
            <button class="plan-hist-nav" onclick="shiftMockReportMonth(-1)" ${canPrev ? '' : 'disabled'} title="上一月">◀</button>
            <h4 style="color:#E891A3;margin:0;">📋 ${mk} 月度备考报告${isCurrent ? '<span class="plan-hist-tag">本月</span>' : ''}</h4>
            <button class="plan-hist-nav" onclick="shiftMockReportMonth(1)" ${canNext ? '' : 'disabled'} title="下一月">▶</button>
        </div>
        <p>本月练习次数: <strong>${monthRecs.length}</strong> 次</p>
        <p>月均正确率: <strong style="color:#FFB6C1;font-size:16px;">${monthAvg}%</strong></p>
        ${sortedMods.length > 0
            ? `<p>提升明显板块: <strong style="color:#68C07D;">${sortedMods[sortedMods.length - 1].module}</strong></p>
               <p>待加强板块: <strong style="color:#E57373;">${sortedMods[0].module}</strong></p>`
            : '<p style="color:#999;">该月暂无刷题记录</p>'}
        ${isCurrent
            ? ''
            : `<p style="margin-top:8px;"><button class="btn-outline btn-sm" onclick="backToMockReportMonth()">回到本月</button>
               <span style="font-size:12px;color:#bbb;margin-left:8px;">历史月份 · 只读</span></p>`}
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

    downloadFile(csv, `模考记录_${bjToday()}.csv`, 'text/csv;charset=utf-8');
}

// 归档 = 先导出一份 JSON 快照（永久备份文件），再清空当前记录。
// 语义不同于「删除」：数据以快照形式留存，不会无声丢失。
function confirmArchiveData() {
    const records = JSON.parse(localStorage.getItem('mockRecords') || '[]');
    if (records.length === 0) { appAlert('当前没有可归档的模考记录'); return; }
    appConfirm('归档 = 先下载一份 JSON 快照（永久备份），再清空当前 ' + records.length + ' 条记录。\n已导出的 CSV 报表不受影响，归档后仍可重新导出。确定继续？', (ok) => {
        if (!ok) return;
        // 1) 导出快照备份
        const snapshot = { app: '莲莲工作台', type: 'mock-archive', archivedAt: new Date().toISOString(), count: records.length, records };
        downloadFile(JSON.stringify(snapshot, null, 2), '模考归档_' + bjToday() + '.json', 'application/json');
        // 2) 清空当前记录
        localStorage.removeItem('mockRecords');
        if (typeof showToast === 'function') showToast('✅ 已导出归档快照并清空当前 ' + records.length + ' 条记录');
        else appAlert('✅ 已导出归档快照并清空当前 ' + records.length + ' 条记录');
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
    // ★ 数据新鲜度检查（每次加载都执行，不受下方 _noticeShown 守卫限制）
    checkDataFreshness(meta);
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

/* 数据新鲜度检查：若内容超过 N 天未更新（爬虫/cron-job 失效），顶部显示提醒，避免无感失效 */
function checkDataFreshness(meta) {
    const el = document.getElementById('dataStaleBanner');
    if (!el) return;
    const d = parseMetaDate(meta);
    if (!d) { el.style.display = 'none'; return; }
    const sod = dt => { const x = new Date(dt); x.setHours(0, 0, 0, 0); return x; };
    const days = Math.floor((sod(new Date()) - sod(d)) / 86400000);
    const THRESHOLD = 2; // 爬虫每天北京时间 00:00 跑，超过 2 天未更新即视为异常（留 1 天容错，避免偶发延迟误报）
    if (days >= THRESHOLD) {
        el.textContent = '⚠️ 数据已 ' + days + ' 天未更新，爬虫可能未运行，请检查 cron-job / GitHub Actions';
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}
function parseMetaDate(meta) {
    if (!meta) return null;
    if (meta.updatedAtLocal) {
        // 北京时间字符串：2026/08/04 16:11:17 → 2026-08-04T16:11:17+08:00（带时区，无解析歧义）
        let s = String(meta.updatedAtLocal).trim().replace(/\//g, '-').replace(' ', 'T');
        if (!s.includes('+') && !s.includes('Z')) s += '+08:00';
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d;
    }
    if (meta.updatedAt) {
        const d = new Date(meta.updatedAt);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
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
let idiomErrOnly = false; // 错词本筛选
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
function saveFavIdioms() { try { localStorage.setItem('favIdioms', JSON.stringify(favIdioms)); } catch (e) {} monitorDrop('favIdioms', '成语收藏'); }
function isFavIdiom(id) { return favIdioms.indexOf(String(id)) >= 0; }
function toggleFavIdiom(id) {
    const k = String(id);
    if (isFavIdiom(id)) favIdioms = favIdioms.filter(x => x !== k); else favIdioms.push(k);
    saveFavIdioms();
}

// 错词本：自测答错/手动标记的易错成语
let idiomErrors = loadIdiomErrors();
function loadIdiomErrors() { try { return JSON.parse(localStorage.getItem('idiomErrors') || '[]'); } catch (e) { return []; } }
function saveIdiomErrors() { try { localStorage.setItem('idiomErrors', JSON.stringify(idiomErrors)); } catch (e) {} }
function isIdiomError(id) { return idiomErrors.indexOf(String(id)) >= 0; }
function toggleIdiomError(id) {
    const k = String(id);
    if (isIdiomError(id)) idiomErrors = idiomErrors.filter(x => x !== k); else idiomErrors.push(k);
    saveIdiomErrors();
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// （原此处有 getTodayStr 的重复定义，v34 已合并到首页那一处，统一北京时间基准）

/* ---------------- 高频成语 ---------------- */
function getIdiomList() {
    let list = (typeof IDIOMS_DB !== 'undefined') ? IDIOMS_DB.slice() : [];
    if (idiomErrOnly) list = list.filter(x => isIdiomError(x.id));
    else if (idiomFavOnly) list = list.filter(x => isFavIdiom(x.id));
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
        if (prog) prog.textContent = idiomErrOnly ? '错词本还是空的，去自测时点击「🔒 显示释义」自动收录，或点卡片 ➕ 手动加入～' : (idiomFavOnly ? '易错收藏夹为空，去收藏易错成语吧～' : '');
        return;
    }
    if (idiomCursor >= list.length) idiomCursor = 0;
    if (idiomCursor < 0) idiomCursor = list.length - 1;
    const it = list[idiomCursor];
    const faved = isFavIdiom(it.id);
    const erred = isIdiomError(it.id);
    const tierColor = it.tier === '必考' ? '#E75D80' : (it.tier === '高频' ? '#FF9F43' : '#8E8E93');
    const showMeaning = !idiomTestMode || (it.id === idiomRevealId);
    wrap.innerHTML =
        '<div class="idiom-card" id="idiomCard">' +
            '<div class="idiom-card-top">' +
                '<span class="idiom-tier" style="background:' + tierColor + '">' + it.tier + '</span>' +
                '<button class="idiom-fav-btn ' + (faved ? 'faved' : '') + '" onclick="toggleFavIdiom(\'' + it.id + '\');renderIdioms()">' + (faved ? '⭐' : '☆') + '</button>' +
                '<button class="idiom-err-btn ' + (erred ? 'erred' : '') + '" onclick="toggleIdiomError(\'' + it.id + '\');renderIdioms()" title="加入/移出错词本">' + (erred ? '📕' : '➕') + '</button>' +
            '</div>' +
            '<div class="idiom-word">' + it.word + (it.verified ? ' <span class="idiom-verified" title="释义已与汉典权威源逐条核验">✅ 汉典核验</span>' : '') + '</div>' +
            '<div class="idiom-pinyin">' + it.pinyin + '</div>' +
            (showMeaning
                ? '<div class="idiom-meaning">' + it.meaning + '</div>' +
                  (it.source ? '<div class="idiom-block"><span class="idiom-label">📚 出处</span>' + it.source + '</div>' : '') +
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
    if (prog) prog.textContent = '共 ' + list.length + ' 条 · ⭐收藏 ' + favIdioms.length + ' · 📕错词 ' + idiomErrors.length;
}
function revealIdiom(id) {
    // 自测模式下点击「显示释义」= 没记住，自动收录进错词本
    if (idiomTestMode) toggleIdiomError(Number(id));
    idiomRevealId = Number(id);
    renderIdioms();
}
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
        idiomErrOnly = false;
        const f = document.getElementById('idiomTierFilters');
        if (f) f.querySelectorAll('.tag-btn').forEach(x => x.classList.toggle('active', (x.dataset.tier || 'all') === 'all'));
    }
    idiomCursor = 0; idiomRevealId = null; renderIdioms();
}
function toggleIdiomErrView() {
    idiomErrOnly = !idiomErrOnly;
    if (idiomErrOnly) {
        idiomFavOnly = false;
        currentIdiomTier = 'all';
        const f = document.getElementById('idiomTierFilters');
        if (f) f.querySelectorAll('.tag-btn').forEach(x => x.classList.toggle('active', (x.dataset.tier || 'all') === 'all'));
    }
    idiomCursor = 0; idiomRevealId = null; renderIdioms();
}
// 成语索引列表分页状态：避免几百条一次性渲染
let idiomListFull = [];
let idiomListRendered = 0;
let idiomListSig = '';
const IDIOM_PAGE = 40;

function renderIdiomList(list) {
    idiomListFull = list;
    const sig = list.map(x => x.id).join(',');
    if (list.length === 0) {
        const lst = document.getElementById('idiomList'); if (lst) lst.innerHTML = '';
        idiomListSig = sig; idiomListRendered = 0; return;
    }
    // 列表内容未变（如切卡片/自测/翻页）时保持已渲染进度，不重置
    if (sig === idiomListSig && idiomListRendered > 0) return;
    idiomListSig = sig;
    idiomListRendered = 0;
    const lst = document.getElementById('idiomList'); if (!lst) return;
    lst.innerHTML = '';
    appendIdiomChunk();
}
function appendIdiomChunk() {
    const lst = document.getElementById('idiomList'); if (!lst || !idiomListFull) return;
    const total = idiomListFull.length;
    const start = idiomListRendered;
    if (start >= total) return;
    const end = Math.min(start + IDIOM_PAGE, total);
    const slice = idiomListFull.slice(start, end);
    const oldMore = document.getElementById('idiomMore'); if (oldMore) oldMore.remove();
    lst.insertAdjacentHTML('beforeend', slice.map(it =>
        '<div class="idiom-row ' + (isFavIdiom(it.id) ? 'faved' : '') + '" onclick="goIdiom(' + it.id + ')">' +
            '<span class="idiom-row-word">' + it.word + '</span>' +
            '<span class="idiom-row-pinyin">' + it.pinyin + '</span>' +
            '<span class="idiom-row-tier tier-' + it.tier + '">' + it.tier + '</span>' +
        '</div>'
    ).join(''));
    idiomListRendered = end;
    if (end < total) {
        const more = document.createElement('button');
        more.id = 'idiomMore'; more.className = 'btn-outline btn-sm';
        more.style.cssText = 'display:block;margin:14px auto;font-size:12px;';
        more.textContent = '加载更多 (' + (total - end) + ')';
        more.onclick = appendIdiomChunk;
        lst.appendChild(more);
    }
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
    const dayIdx = (function(){ const n = daysBetweenYMD('2026-01-01', bjToday()); return ((n % list.length) + list.length) % list.length; })();
    const isDailyPick = pairCursor === dayIdx;
    wrap.innerHTML =
        '<div class="pair-card" id="pairCard">' +
            '<div class="pair-side"><div class="pair-word">' + p.a.word + '</div><div class="pair-pinyin">' + p.a.pinyin + '</div><div class="pair-meaning">' + p.a.meaning + '</div></div>' +
            '<div class="pair-vs">VS</div>' +
            '<div class="pair-side"><div class="pair-word">' + p.b.word + '</div><div class="pair-pinyin">' + p.b.pinyin + '</div><div class="pair-meaning">' + p.b.meaning + '</div></div>' +
        '</div>' +
        '<div class="pair-note">' + p.note + '</div>' +
        '<div class="pair-tags">' + tagsHtml + '</div>' +
        (p.verifiedAt ? '<div class="pair-verify">✅ 已核验 · ' + (p.source || '汉典') + ' · ' + p.verifiedAt + '</div>' : '') +
        '<div class="idiom-nav">' +
            (isDailyPick ? '<span class="pair-daily">📅 今日配对</span>' : '<span></span>') +
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
    // 每日自动轮换：以北京时间日期为种子，确定性选取今日配对（每天不同、当天稳定）
    const _plist = getIdiomPairList();
    if (_plist.length) {
        const _day = daysBetweenYMD('2026-01-01', bjToday());
        pairCursor = ((_day % _plist.length) + _plist.length) % _plist.length;
    }
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
    const h = getBJNow().getHours(); // v34：按北京时间判断早/晚安
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

/* ================================================================
   考公金币台账（v56 新增）
   ----------------------------------------------------------------
   设计要点：
   - 本工作台「只记账」，不持有全局金币余额；复制出的数字需粘贴到
     日常生活工作台、选来源「考公任务」入账，才会进入全局总账。
   - 今日合计应得金币 = 每日任务勾选金币 + 四模块打卡金币 + 手动录入金币
   - 今日合计可被「手动调整」覆盖（覆盖自动计算值）
   - 所有记录存 localStorage，刷新不丢失
   ================================================================ */

// 参与打卡奖励的四个侧边模块
const GOLD_MODULES = ['susuan', 'morning', 'idiomPairs', 'idioms'];
const GOLD_MODULE_NAMES = { susuan: '速算', morning: '晨读', idiomPairs: '混淆配对', idioms: '高频成语' };

function goldEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function loadGold(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
}
function saveGold(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
function goldId() {
    return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// 状态（从 localStorage 恢复）
let goldTasks = loadGold('gk_gold_tasks', []);
let goldTaskDone = loadGold('gk_gold_taskDone', {});   // { 'YYYY-MM-DD': { taskId: true } }
let goldOverride = loadGold('gk_gold_override', {});   // { 'YYYY-MM-DD': number|null }
let goldCheckins = loadGold('gk_gold_checkins', []);  // [{ id, date, module, gold }]
let goldLedger = loadGold('gk_gold_ledger', []);       // [{ id, date, task, gold }]
let goldModuleDefault = loadGold('gk_gold_moduleDefault', { susuan: 5, morning: 5, idiomPairs: 5, idioms: 5 });

// ---- 计算 ----
// v57：任务金币来源改为「每日计划」模块中已完成的任务（不再单独维护一套任务）
// 同时兼容 v56 遗留的 gk_gold_tasks 数据，避免用户已录入的金币丢失
function planDoneItems(dateKey) {
    try {
        const items = JSON.parse(localStorage.getItem('plan_' + dateKey) || '[]');
        return Array.isArray(items) ? items.filter(i => i && i.done) : [];
    } catch (e) { return []; }
}
function dayTaskGold(dateKey) {
    const planGold = planDoneItems(dateKey).reduce((s, i) => s + (Number(i.gold) || 0), 0);
    // 兼容旧版单独任务（v56），无数据时为 0
    const done = goldTaskDone[dateKey] || {};
    const legacyGold = goldTasks.reduce((s, t) => s + (done[t.id] ? (Number(t.gold) || 0) : 0), 0);
    return planGold + legacyGold;
}
function dayCheckinGold(dateKey) {
    return goldCheckins.filter(c => c.date === dateKey).reduce((s, c) => s + (Number(c.gold) || 0), 0);
}
function dayLedgerGold(dateKey) {
    return goldLedger.filter(l => l.date === dateKey).reduce((s, l) => s + (Number(l.gold) || 0), 0);
}
function dayAutoTotal(dateKey) {
    return dayTaskGold(dateKey) + dayCheckinGold(dateKey) + dayLedgerGold(dateKey);
}
function dayTotal(dateKey) {
    const ov = goldOverride[dateKey];
    if (ov !== undefined && ov !== null && ov !== '') {
        const n = Number(ov);
        if (!isNaN(n)) return n;
    }
    return dayAutoTotal(dateKey);
}

// ---- 初始化 ----
function initGoldLedger() {
    const dEl = document.getElementById('goldLedgerDate');
    if (dEl && !dEl.value) dEl.value = bjToday();
    renderGoldLedger();
    renderAllCheckinBars();
    loadContentMetaForBadges();
}

// ---- 渲染：金币台账主模块 ----
function renderGoldLedger() {
    const today = bjToday();
    const total = dayTotal(today);
    const numEl = document.getElementById('goldTodayNum');
    if (numEl) numEl.textContent = String(total);
    const subEl = document.getElementById('goldTodaySub');
    if (subEl) {
        const auto = dayAutoTotal(today);
        const ov = goldOverride[today];
        if (ov !== undefined && ov !== null && ov !== '') {
            subEl.textContent = `手动调整为 ${total}（自动计算 ${auto}）`;
        } else {
            const t = dayTaskGold(today), c = dayCheckinGold(today), l = dayLedgerGold(today);
            subEl.textContent = `计划任务 ${t} + 模块打卡 ${c} + 手动录入 ${l} = ${auto}`;
        }
    }
    renderGoldPlanSummary();
    renderGoldFlow();
    renderGoldStats();
}

// v57：今日计划任务金币摘要（只读，任务在「每日计划」模块管理）
function renderGoldPlanSummary() {
    const wrap = document.getElementById('goldPlanSummary');
    if (!wrap) return;
    const today = bjToday();
    let items = [];
    try { items = JSON.parse(localStorage.getItem('plan_' + today) || '[]'); } catch (e) { items = []; }
    if (!Array.isArray(items) || items.length === 0) {
        wrap.innerHTML = '<div class="gold-empty">今天还没有计划任务，去「每日计划」添加吧～</div>';
        return;
    }
    const doneList = items.filter(i => i.done);
    const earned = doneList.reduce((s, i) => s + (Number(i.gold) || 0), 0);
    const totalGold = items.reduce((s, i) => s + (Number(i.gold) || 0), 0);
    wrap.innerHTML = `
        <div class="gold-plan-head">
            已完成 <b>${doneList.length}</b>/${items.length} 项 · 已得 <b class="gp-num">${earned}</b> 金币（全部完成可得 ${totalGold}）
        </div>
        <div class="gold-plan-items">
            ${items.map(i => `
                <div class="gold-plan-item ${i.done ? 'done' : ''}">
                    <span class="gp-check">${i.done ? '✅' : '⬜'}</span>
                    <span class="gp-task">${goldEsc(i.task || '')}</span>
                    <span class="gp-cat">${goldEsc(i.category || '')}</span>
                    <span class="gp-gold">${i.done ? '+' : ''}${Number(i.gold) || 0}</span>
                </div>`).join('')}
        </div>`;
}

function renderGoldFlow() {
    const wrap = document.getElementById('goldFlowList');
    if (!wrap) return;
    const rows = [];
    goldCheckins.forEach(c => rows.push({ kind: 'checkin', id: c.id, date: c.date, src: GOLD_MODULE_NAMES[c.module] || c.module, srcKey: 'checkin', task: '模块打卡', gold: c.gold }));
    goldLedger.forEach(l => rows.push({ kind: 'ledger', id: l.id, date: l.date, src: '录入', srcKey: 'ledger', task: l.task, gold: l.gold }));
    // v57：把「每日计划」中已完成的任务也并入流水（只读，编辑请回每日计划模块）
    collectPlanGoldRows().forEach(r => rows.push(r));
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || 0);
    if (rows.length === 0) {
        wrap.innerHTML = '<div class="gold-empty">还没有任何记录，去各模块顶部打卡、或在每日计划完成任务吧～</div>';
        return;
    }
    wrap.innerHTML = rows.map(r => `
        <div class="gold-flow-item">
            <div class="gold-flow-main">
                <div class="gold-flow-top">
                    <span class="gold-flow-src ${r.srcKey}">${goldEsc(r.src)}</span>
                    <span class="gold-flow-task">${goldEsc(r.task || '')}</span>
                </div>
                <div class="gold-flow-date">${goldEsc(r.date)}</div>
            </div>
            <div class="gold-flow-gold">+${Number(r.gold) || 0}</div>
            <div class="gold-flow-ops">
                ${r.kind === 'plan'
            ? '<button class="mini-btn" onclick="switchModule(\'plan\')" title="去每日计划修改">📅</button>'
            : `<button class="mini-btn edit" onclick="editGoldFlow('${r.kind}','${r.id}')" title="编辑">✏️</button>
                   <button class="mini-btn del" onclick="delGoldFlow('${r.kind}','${r.id}')" title="删除">🗑</button>`}
            </div>
        </div>`).join('');
}

// 扫描 localStorage 中所有 plan_YYYY-MM-DD，收集已完成且有金币的任务作为流水
function collectPlanGoldRows() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !/^plan_\d{4}-\d{2}-\d{2}$/.test(k)) continue;
            const date = k.slice(5);
            let items = [];
            try { items = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { continue; }
            if (!Array.isArray(items)) continue;
            items.forEach(it => {
                const g = Number(it && it.gold) || 0;
                if (it && it.done && g > 0) {
                    out.push({ kind: 'plan', id: String(it.id), date, src: '计划任务', srcKey: 'plan', task: it.task || '', gold: g });
                }
            });
        }
    } catch (e) {}
    return out;
}

function renderGoldStats() {
    const weekEl = document.getElementById('goldWeekNum');
    const monthEl = document.getElementById('goldMonthNum');
    if (weekEl) weekEl.textContent = String(weekTotal(bjToday()));
    if (monthEl) monthEl.textContent = String(monthTotal(bjToday()));
}

function weekTotal(refKey) {
    const ref = new Date(refKey + 'T00:00:00');
    const dow = ref.getDay(); // 0=周日
    const monOffset = dow === 0 ? -6 : -(dow - 1);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(ref); d.setDate(ref.getDate() + monOffset + i);
        sum += dayTotal(fmtYMD(d));
    }
    return sum;
}
function monthTotal(refKey) {
    const ref = new Date(refKey + 'T00:00:00');
    const y = ref.getFullYear(), m = ref.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    let sum = 0;
    for (let i = 1; i <= days; i++) {
        sum += dayTotal(`${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`);
    }
    return sum;
}

/* v57：原「每日任务」独立表单已移除，任务改在【每日计划】模块管理，
   完成即由 dayTaskGold() 计入今日合计。goldTasks / goldTaskDone 仅保留读取，
   用于兼容 v56 已录入的旧数据，不再提供新增入口。 */

// ---- 交互：手动录入台账 ----
function addGoldLedger() {
    let date = document.getElementById('goldLedgerDate').value;
    if (!date) date = bjToday();
    const gold = Number(document.getElementById('goldLedgerGold').value || 0);
    const task = (document.getElementById('goldLedgerTask').value || '').trim();
    if (isNaN(gold) || gold < 0) { appAlert('金币需为非负数字'); return; }
    if (!task) { appAlert('请填写任务描述'); return; }
    goldLedger.push({ id: goldId(), date, task, gold });
    saveGold('gk_gold_ledger', goldLedger);
    document.getElementById('goldLedgerGold').value = '';
    document.getElementById('goldLedgerTask').value = '';
    renderGoldLedger();
    showToast('已记一笔：' + task + ' +' + gold);
}
function editGoldFlow(kind, id) {
    const isCheckin = kind === 'checkin';
    const rec = isCheckin ? goldCheckins.find(c => c.id === id) : goldLedger.find(l => l.id === id);
    if (!rec) return;
    showAppModal({
        title: isCheckin ? '编辑打卡记录' : '编辑录入记录',
        body: '',
        fields: [
            { id: 'date', type: 'date', value: rec.date },
            { id: 'task', type: 'text', value: isCheckin ? (GOLD_MODULE_NAMES[rec.module] || rec.module + '打卡') : rec.task, placeholder: '任务描述' },
            { id: 'gold', type: 'number', value: rec.gold }
        ],
        okText: '保存', cancelText: '取消',
        onOk: v => {
            const date = v.date || bjToday();
            const gold = Number(v.gold || 0);
            if (isNaN(gold) || gold < 0) { appAlert('金币需为非负数字'); return; }
            if (isCheckin) { rec.date = date; rec.gold = gold; saveGold('gk_gold_checkins', goldCheckins); }
            else { rec.date = date; rec.task = (v.task || '').trim() || rec.task; rec.gold = gold; saveGold('gk_gold_ledger', goldLedger); }
            renderGoldLedger();
        }
    });
}
function delGoldFlow(kind, id) {
    appConfirm('确定删除这条记录？', ok => {
        if (!ok) return;
        if (kind === 'checkin') { goldCheckins = goldCheckins.filter(c => c.id !== id); saveGold('gk_gold_checkins', goldCheckins); }
        else { goldLedger = goldLedger.filter(l => l.id !== id); saveGold('gk_gold_ledger', goldLedger); }
        renderGoldLedger();
    });
}

// ---- 今日合计：复制 / 手动调整 ----
function copyTodayGold() {
    const total = dayTotal(bjToday());
    const txt = String(total);
    const done = () => showToast('已复制今日应得金币：' + txt + '（粘贴到日常生活工作台、选来源「考公任务」入账）');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(() => goldFallbackCopy(txt, done));
    } else { goldFallbackCopy(txt, done); }
}
function goldFallbackCopy(txt, done) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { appAlert('复制失败，请手动记录：' + txt); }
    document.body.removeChild(ta);
}
function editTodayOverride() {
    const today = bjToday();
    const cur = goldOverride[today];
    const curVal = (cur === undefined || cur === null) ? '' : cur;
    showAppModal({
        title: '手动调整今日合计',
        body: '留空则使用自动计算值（每日任务 + 四模块打卡）。填写后会覆盖自动计算的结果。',
        fields: [{ id: 'val', type: 'number', value: curVal, placeholder: '如：120' }],
        okText: '保存', cancelText: '清除',
        onOk: v => {
            const raw = (v.val || '').trim();
            if (raw === '') { delete goldOverride[today]; }
            else { const n = Number(raw); if (isNaN(n)) { appAlert('请输入数字'); return; } goldOverride[today] = n; }
            saveGold('gk_gold_override', goldOverride);
            renderGoldLedger();
        },
        onCancel: () => {
            delete goldOverride[today]; saveGold('gk_gold_override', goldOverride); renderGoldLedger();
            showToast('已清除手动调整，恢复自动计算');
        }
    });
}

// ---- 四模块底部打卡奖励组件 ----
function renderModuleCheckin(moduleKey) {
    const el = document.getElementById('checkin-' + moduleKey);
    if (!el) return;
    const today = bjToday();
    const def = goldModuleDefault[moduleKey];
    const todays = goldCheckins.filter(c => c.date === today && c.module === moduleKey);
    const todayGold = todays.reduce((s, c) => s + (Number(c.gold) || 0), 0);
    const hist = goldCheckins.filter(c => c.module === moduleKey).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    el.innerHTML = `
        <div class="checkin-bar">
            <span class="checkin-title">🏅 打卡奖励 · ${GOLD_MODULE_NAMES[moduleKey]}</span>
            <span class="checkin-default">默认 <input type="number" min="0" id="cd-${moduleKey}" value="${def}" onchange="setModuleDefault('${moduleKey}', this.value)" /> 金币</span>
            <input type="number" min="0" class="checkin-amount" id="ca-${moduleKey}" value="${def}" placeholder="本次金币" />
            <button class="btn-pink btn-sm" onclick="doCheckIn('${moduleKey}')">✅ 打卡</button>
            <span class="checkin-today">今日已打卡 <b>${todays.length}</b> 次 · <b>+${todayGold}</b></span>
        </div>
        ${hist.length ? `<div class="checkin-history">${hist.map(h => `<div class="checkin-hist-item"><span>${h.date}</span><span class="ch-gold">+${h.gold}</span></div>`).join('')}</div>` : ''}
    `;
}
function renderAllCheckinBars() { GOLD_MODULES.forEach(renderModuleCheckin); }
function setModuleDefault(moduleKey, val) {
    const n = Number(val || 0);
    if (isNaN(n) || n < 0) return;
    goldModuleDefault[moduleKey] = n;
    saveGold('gk_gold_moduleDefault', goldModuleDefault);
    const inp = document.getElementById('ca-' + moduleKey);
    if (inp) inp.value = n;
}
function doCheckIn(moduleKey) {
    const today = bjToday();
    const inp = document.getElementById('ca-' + moduleKey);
    let gold = Number(inp ? inp.value : goldModuleDefault[moduleKey]);
    if (isNaN(gold) || gold < 0) gold = goldModuleDefault[moduleKey];
    goldCheckins.push({ id: goldId(), date: today, module: moduleKey, gold });
    saveGold('gk_gold_checkins', goldCheckins);
    renderModuleCheckin(moduleKey);
    renderGoldLedger();
    showToast(`${GOLD_MODULE_NAMES[moduleKey]} 打卡 +${gold} 已计入今日合计`);
}

/* ================================================================
   各模块「今日新增 X 条 / 新增 0 条」徽章（v56 新增）
   ----------------------------------------------------------------
   数据来源：content/meta.json 的 dailyNew[北京时间今天][模块]，
   由爬虫在每次抓取时写入。今天没抓到（或抓取失败）则显示「新增 0 条」。
   ================================================================ */
function renderModuleTodayNew(meta) {
    const today = bjToday();
    // meta.json 尚未包含 dailyNew（旧版爬虫产出）时，不谎报「新增 0 条」，改为提示等待今晚更新
    if (!meta || !meta.dailyNew) {
        ['shizheng', 'shenlun', 'qiushi', 'renwu', 'morning', 'susuan', 'idioms', 'idiomPairs', 'logic', 'interview'].forEach(k => {
            const el = document.getElementById('tn-' + k);
            if (el) { el.textContent = '今日待更新'; el.classList.remove('has-new'); }
        });
        return;
    }
    const dn = meta.dailyNew[today] || {};
    const map = {
        shizheng: dn.shizheng || 0,
        shenlun: (dn.essays || 0) + (dn.quotes || 0),
        qiushi: dn.qiushi || 0,
        renwu: dn.renwu || 0,
        morning: dn.morning || 0,
        susuan: dn.susuan || 0,
        idioms: 0, idiomPairs: 0, logic: 0, interview: 0
    };
    Object.keys(map).forEach(k => {
        const el = document.getElementById('tn-' + k);
        if (!el) return;
        const n = map[k];
        if (n > 0) { el.textContent = '今日新增 ' + n + ' 条'; el.classList.add('has-new'); }
        else { el.textContent = '新增 0 条'; el.classList.remove('has-new'); }
    });
}
function loadContentMetaForBadges() {
    // 优先用 loader 已加载的 meta；否则自行拉取（网络优先，离线则保持默认「新增 0 条」）
    if (window.__contentMeta) { try { renderModuleTodayNew(window.__contentMeta); return; } catch (e) {} }
    fetch('content/meta.json?t=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(m => { if (m) renderModuleTodayNew(m); })
        .catch(() => {});
}

