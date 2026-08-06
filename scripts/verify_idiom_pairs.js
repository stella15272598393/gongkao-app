/**
 * 混淆成语配对 · 权威性核验（v35）
 * ------------------------------------------------------------
 * 数据源：百度百科（权威汉语成语释义，源自《现代汉语词典》等）。
 * 调用：由 scripts/update-all.js 在每日抓取流程末尾调用。
 *
 * 设计：
 *  - 只对「超过 REVERIFY_DAYS 天未核验」的整组重新核验（温和，约等于每周每组一次）。
 *  - 仅回填溯源字段（verifiedAt / source / refDefinition），
 *    绝不自动改写人工撰写的 meaning / note / pinyin。
 *  - 抓取失败 / 被反爬拦截（如 403）：不污染已核验状态，仅记录 lastError，
 *    保留基线权威字段（汉典出处），等源可访问时再补验。绝不会把正常内容误标为待复核。
 *  - 全程仅用 Node 内置模块，CI 可直接 node 运行，无需 npm install。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'content', 'idiom-pairs.json');
const SOURCE_NAME = '百度百科';
const REVERIFY_DAYS = 7;
const REQUEST_DELAY = 150; // 礼貌节流，避免触发反爬

function bjToday() {
    const n = new Date();
    const d = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysSince(yyyymmdd) {
    if (!yyyymmdd) return Infinity;
    const t = new Date(String(yyyymmdd).slice(0, 10) + 'T00:00:00').getTime();
    if (isNaN(t)) return Infinity;
    return Math.floor((Date.now() - t) / 86400000);
}
function baikeUrl(word) {
    return 'https://baike.baidu.com/item/' + encodeURIComponent(word);
}
function fetchUrl(url, depth) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            }
        }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 4) {
                const loc = res.headers.location;
                const next = loc.startsWith('http')
                    ? loc
                    : (url.startsWith('https') ? 'https://' + res.headers.host : 'http://' + res.headers.host) + loc;
                return resolve(fetchUrl(next, depth + 1));
            }
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}
function extractDefinition(html) {
    let m = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta\s+content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (m && m[1] && m[1].length > 4) return m[1].replace(/\s+/g, ' ').trim();
    return '';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        console.error('[verify_idiom_pairs] 读取失败：', e.message);
        process.exit(1);
    }
    const items = data.items || data.idiomPairs || [];
    if (!items.length) {
        console.log('[verify_idiom_pairs] 无配对数据，跳过');
        return;
    }

    let verified = 0, skipped = 0, errored = 0;
    const today = bjToday();
    // v37：无论是否复验，都记录「巡检脚本上次运行日」，让用户看到脚本每日确实执行
    data.lastVerifyRun = today;
    console.log(`[verify_idiom_pairs] 共 ${items.length} 组，逐组核验中（${SOURCE_NAME}，每 ${REVERIFY_DAYS} 天复验一次）...`);

    for (const it of items) {
        if (it.verifiedAt && daysSince(it.verifiedAt) < REVERIFY_DAYS) { skipped++; continue; }
        it.refDefinition = it.refDefinition || {};
        let okSides = 0, total = 0;
        let errMsg = '';
        for (const side of ['a', 'b']) {
            const w = it[side];
            if (!w || !w.word) continue;
            total++;
            const url = baikeUrl(w.word);
            try {
                const html = await fetchUrl(url, 0);
                const def = extractDefinition(html);
                if (def) { it.refDefinition[side] = def; okSides++; }
                else errMsg += ` ${w.word}:空释义`;
            } catch (e) {
                errMsg += ` ${w.word}:${e.message}`;
            }
            await sleep(REQUEST_DELAY);
        }
        // 仅在整组成功抓取时，才把权威出处更新为本次实抓来源
        if (total > 0 && okSides === total) it.source = SOURCE_NAME;
        it.lastAttempt = today;
        if (errMsg.trim()) { it.lastError = errMsg.trim(); errored++; }
        else delete it.lastError;
        // 仅当两侧都成功抓取时才前移「已核验」日期；否则保留基线（汉典出处）不变
        if (total > 0 && okSides === total) {
            it.verifiedAt = today;
            delete it.lastError;
            verified++;
        } else if (okSides > 0) {
            verified++; // 部分成功也计入已更新侧
        }
    }

    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[verify_idiom_pairs] 完成 ✅ 本次更新 ${verified} 组 · 跳过 ${skipped} 组 · 抓取异常 ${errored} 组（异常组保留基线权威字段）`);
})();
