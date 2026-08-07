/**
 * 统一内容更新脚本
 * ------------------------------------------------------------
 * 顺序执行：时政/求是抓取 → 人物素材抓取 → 写出统一 meta.json
 * 用法：node scripts/update-all.js
 *
 * 设计原则：
 *  - 原文 100% 保留官方原生文本，零截断、零 AI 改写
 *  - 仅依赖 Node 内置模块，无需 npm install，便于 CI / 定时任务
 *  - 顺序执行两个爬虫，保证 meta.json 在所有抓取完成后统一写出
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');
const node = process.execPath;

// 每个脚本负责写出的内容文件 → 对应模块键
const MODULE_FILES = {
    shizheng: 'shizheng.json',
    qiushi: 'qiushi.json',
    renwu: 'renwu.json',
    essays: 'essays.json',
    quotes: 'quotes.json',
    morning: 'morning.json',
    susuan: 'susuan.json'
};
// 脚本 → 它负责的模块（用于按脚本快照前后数量，统计「今日新增」）
const SCRIPT_MODULES = {
    'scripts/crawler.js': ['shizheng', 'qiushi'],
    'scripts/crawler-renwu.js': ['renwu'],
    'scripts/crawler-quotes.js': ['quotes'],
    'scripts/crawler-essay.js': ['essays'],
    'scripts/crawler-morning.js': ['morning'],
    'scripts/gen-susuan.js': ['susuan']
};

function run(script) {
    console.log('\n========== 执行 ' + script + ' ==========');
    execSync('"' + node + '" "' + path.join(ROOT, script) + '"', {
        stdio: 'inherit',
        cwd: ROOT
    });
}

function readCount(file) {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
        return (d.items || []).length;
    } catch (e) { return 0; }
}

// 读取某个内容文件里所有条目的唯一标识集合
// ★ 为什么用 id 集合而不是条目数量：时政/晨读等模块是「滚动窗口」（超出上限会丢弃最旧的），
//   抓到 3 条新内容的同时会顶掉 3 条旧内容，条目总数不变 → 用数量差会永远算出「新增 0 条」。
//   改为比对 id 集合，才能得到真实的当日新增条目数。
function readIds(file) {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
        const items = d.items || [];
        const s = new Set();
        items.forEach((it, idx) => {
            if (!it) return;
            // 优先 id，其次 url，最后退化为 标题+日期，确保任何模块都有稳定标识
            const key = it.id != null ? String(it.id)
                : (it.url ? 'u:' + it.url
                    : (it.title || it.name || it.text ? 't:' + (it.title || it.name || it.text) + '|' + (it.date || '') : 'i:' + idx));
            s.add(key);
        });
        return s;
    } catch (e) { return new Set(); }
}

function idsOf(modules) {
    const o = {};
    modules.forEach(m => { o[m] = readIds(MODULE_FILES[m]); });
    return o;
}

// 抓取后相对抓取前，真正新出现的条目数
function countNewIds(beforeSet, afterSet) {
    let n = 0;
    afterSet.forEach(id => { if (!beforeSet.has(id)) n++; });
    return n;
}

// 北京时间「今天」键 YYYY-MM-DD（与前端 bjDayKey 保持一致）
function bjDayKeyNow() {
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const p = n => String(n).padStart(2, '0');
    return `${bj.getFullYear()}-${p(bj.getMonth() + 1)}-${p(bj.getDate())}`;
}

// 合并本次 dailyNew 与历史 meta.dailyNew，仅保留最近 14 天
function mergeDailyNew(fresh) {
    const todayKey = bjDayKeyNow();
    let prev = {};
    try {
        const m = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'meta.json'), 'utf8'));
        if (m && m.dailyNew) prev = m.dailyNew;
    } catch (e) { /* 首次运行无 meta */ }
    const merged = Object.assign({}, prev, fresh);
    // 删除 14 天前的旧键
    const keepFrom = new Date(todayKey + 'T00:00:00');
    keepFrom.setDate(keepFrom.getDate() - 13);
    Object.keys(merged).forEach(k => {
        if (k < keepFrom.toISOString().slice(0, 10)) delete merged[k];
    });
    return merged;
}

function writeMeta(dailyNew) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    // ★ 显式转换为北京时间（东八区）：GitHub Actions runner 默认 TZ=UTC，
    //    若直接用 now.getHours() 会写出 UTC 时间（如 16:0x），导致 APP 显示"16点更新"而非"00点更新"
    const bjTime = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const local = `${bjTime.getFullYear()}/${pad(bjTime.getMonth() + 1)}/${pad(bjTime.getDate())} ${pad(bjTime.getHours())}:${pad(bjTime.getMinutes())}:${pad(bjTime.getSeconds())}`;
    const meta = {
        updatedAt: now.toISOString(),
        updatedAtLocal: local,
        todayNew: readCount('shizheng.json') + readCount('qiushi.json') + readCount('renwu.json') + readCount('essays.json') + readCount('quotes.json') + readCount('morning.json') + readCount('susuan.json'),
        totals: {
            shizheng: readCount('shizheng.json'),
            qiushi: readCount('qiushi.json'),
            renwu: readCount('renwu.json'),
            essays: readCount('essays.json'),
            quotes: readCount('quotes.json'),
            morning: readCount('morning.json'),
            susuan: readCount('susuan.json')
        },
        // v56：每日每模块「今日新增」条目数，供前端展示「今日新增 X 条 / 新增 0 条」
        dailyNew: dailyNew || {}
    };
    fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 1), 'utf8');
    console.log('\n========== meta.json 已更新 ==========');
    console.log(`  时政 ${meta.totals.shizheng} · 求是 ${meta.totals.qiushi} · 人物 ${meta.totals.renwu} · 范文 ${meta.totals.essays} · 金句 ${meta.totals.quotes} · 晨读 ${meta.totals.morning} · 速算 ${meta.totals.susuan}`);
    const dk = bjDayKeyNow();
    const dn = (meta.dailyNew && meta.dailyNew[dk]) || {};
    console.log('  今日新增：' + Object.keys(meta.totals).map(k => `${k} +${dn[k] || 0}`).join(' · '));
    console.log(`  更新于 ${local}`);
}

function runSafe(script) {
    try {
        run(script);
        return true;
    } catch (e) {
        console.error('\n⚠️ ' + script + ' 抓取失败，保留上次内容：' + e.message);
        return false;
    }
}

try {
    const todayKey = bjDayKeyNow();
    const dailyNew = {};
    dailyNew[todayKey] = {};
    let allOk = true;
    for (const [script, modules] of Object.entries(SCRIPT_MODULES)) {
        const before = idsOf(modules);
        const ok = runSafe(script);
        if (!ok) allOk = false;
        const after = idsOf(modules);
        // 本次新增 = 抓取后出现的、抓取前不存在的条目数（滚动窗口下依然准确）
        modules.forEach(m => {
            const added = countNewIds(before[m] || new Set(), after[m] || new Set());
            dailyNew[todayKey][m] = (dailyNew[todayKey][m] || 0) + added;
        });
    }
    const merged = mergeDailyNew(dailyNew);
    writeMeta(merged);
    if (allOk) {
        console.log('\n✅ 全部内容抓取完成');
    } else {
        console.log('\n⚠️ 部分内容抓取失败，已保留上次内容，meta.json 仍为最新');
    }
} catch (e) {
    console.error('\n❌ 更新失败：', e.message);
    process.exit(1);
}
