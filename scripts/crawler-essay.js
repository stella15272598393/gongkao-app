/**
 * 申论范文抓取器
 * ------------------------------------------------------------
 * 目标：让「申论 · 范文库」每天自动更新，和时政/求是网同步刷新。
 *
 * 两条路线：
 *   1. 派生路线（零额外网络，稳定可靠）：
 *      每日 crawler.js 已抓回 人民网（时政）+ 求是网（理论）文章，
 *      这些本就是申论写作的范本素材。取其中【长文 / 说理文】
 *      （fullText≥1200 字），按湖北方向区分 国考/湖北省考范文，
 *      直接作为每日更新的范文库。
 *   2. 增量路线（best-effort）：
 *      抓取人民网「人民时评」栏目，补充更标准的评论员文章。
 *      失败不影响整体——派生路线已保证有内容。
 *
 * 原文策略：fullText 原样透传，零改写、零截断。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------- 复用同源 HTTP / 正文抽取（与 crawler-renwu.js 一致） ---------- */
function request(url, referer, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('重定向过多'));
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Referer': referer || url,
                'Connection': 'close'
            },
            timeout: 20000,
            rejectUnauthorized: false
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                res.resume();
                return resolve(request(next, referer, redirects + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const chunks = [];
            let stream = res;
            const enc = res.headers['content-encoding'];
            if (enc === 'gzip') { stream = res.pipe(zlib.createGunzip()); }
            else if (enc === 'deflate') { stream = res.pipe(zlib.createInflate()); }
            stream.on('data', c => chunks.push(c));
            stream.on('end', () => resolve(decode(Buffer.concat(chunks))));
            stream.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
        req.on('error', reject);
    });
}

function decode(buf) {
    let s = buf.toString('utf8');
    const bad = (s.match(/\uFFFD/g) || []).length;
    if (bad > 20) { try { s = new TextDecoder('gb18030').decode(buf); } catch (e) { } }
    return s;
}

function cleanText(s) {
    return s.replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/&lsquo;|&rsquo;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&amp;/g, '&')
        .replace(/&hellip;/g, '…')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

const CONTENT_ANCHORS = ['word_show', 'text_box', 'article-content', 'con_txt', 'rm_txt_zw', 'TRS_Editor', 'content_area', 'artical_content'];
const END_ANCHORS = ['share_con', 'edit_bar', 'copyright', 'foot', 'relevant', 'ewm_box'];
const NOISE_RE = /^(来源|责编|编辑|分享|扫码|点击|相关阅读|原标题|版权|声明|【纠错】|返回|上一篇|下一篇|\(责任编辑|网站声明|违法和不良|共产党员网|发布时间|微信|微博|字号|打印|投稿|我要)/;

function extractArticle(html) {
    const rawTitle = ((html.match(/<title>([^<]+)<\/title>/) || [])[1] || '').trim();
    let title = rawTitle.split(/[-_|]{1,2}/)[0].trim();
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) { const t = cleanText(h1[1]); if (t.length >= 4 && t.length <= 80) title = t; }
    const dm = html.match(/20\d\d[-年]\d{1,2}[-月]\d{1,2}/);
    let date = '';
    if (dm) date = dm[0].replace(/年|月/g, '-').replace(/日/, '');
    let start = -1;
    for (const a of CONTENT_ANCHORS) { const i = html.indexOf(a); if (i >= 0) { start = i; break; } }
    if (start < 0) start = 0;
    let end = html.length;
    for (const a of END_ANCHORS) { const i = html.indexOf(a, start + 50); if (i > start && i < end) end = i; }
    const seg = html.slice(start, end);
    let paragraphs = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
        .map(m => cleanText(m[1]))
        .filter(t => t.length > 12 && !NOISE_RE.test(t));
    if (paragraphs.length < 3) {
        paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
            .map(m => cleanText(m[1]))
            .filter(t => t.length > 20 && !NOISE_RE.test(t));
    }
    const seen = new Set();
    paragraphs = paragraphs.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });
    return { title, date, paragraphs, fullText: paragraphs.join('\n') };
}

function stableId(prefix, text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return prefix + '_' + h.toString(36);
}

const HUBEI_RE = /(湖北|武汉|荆楚|宜昌|襄阳|荆州|黄冈|十堰|长江大保护|中部崛起|光谷)/;

function classifyType(text) {
    return HUBEI_RE.test(text) ? 'hubao' : 'guokao';
}

const TYPE_NAME = { guokao: '国考通用范文', hubao: '湖北省考范文' };

function toEssay(it) {
    const full = it.fullText || (it.paragraphs || []).join('\n');
    if (!full || full.length < 1200) return null;
    const type = classifyType(full);
    let tags = [];
    if (Array.isArray(it.tags) && it.tags.length) tags = it.tags.slice(0, 4);
    else tags = [...(it.keywordsGuokao || []), ...(it.keywordsHubei || [])].slice(0, 4);
    return {
        id: stableId('essay', it.title || full.slice(0, 40)),
        type,
        typeName: TYPE_NAME[type],
        title: it.title || (full.slice(0, 40) + '…'),
        source: it.source || '人民网',
        tags: tags.length ? tags : ['时政要闻'],
        content: full,
        date: it.date || '',
        url: it.url || '',
        _remote: true
    };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 路线2+：权威媒体增量（best-effort） ----------
 * 依据「申论优秀范文权威出处」清单接入可公开访问的权威渠道：
 *   中央权威媒体：人民日报要闻、人民网观点库（由路线2人民时评覆盖）、
 *                 新华社新华人物、央视《新闻联播》典型报道
 *   官方专题网站：党建网时代先锋、旗帜网新时代先锋、
 *                 共产党员网先锋文汇、中国文明网时代楷模
 *   权威学习平台：学习强国APP人物频道、半月谈评论
 * 说明：学习强国 APP、央视《新闻联播》为视频/需登录形态，无法自动抓取，
 *       此处以同机构可公开访问的网站（新华社、半月谈等）作为替代源，
 *       素材范畴与上方权威出处清单一致。
 */
const AUTHORITY_SOURCES = [
    { name: '人民日报·要闻', entry: 'http://paper.people.com.cn/', domain: 'people.com.cn', ref: 'http://paper.people.com.cn/' },
    { name: '新华社·新华人物', entry: 'http://www.news.cn/character/', domain: 'news.cn', ref: 'http://www.news.cn/' },
    { name: '半月谈·评论', entry: 'http://www.banyuetan.org/', domain: 'banyuetan.org', ref: 'http://www.banyuetan.org/' },
    { name: '党建网·时代先锋', entry: 'http://www.dangjian.cn/', domain: 'dangjian.cn', ref: 'http://www.dangjian.cn/' },
    { name: '旗帜网·新时代先锋', entry: 'http://www.qizhiwang.org/', domain: 'qizhiwang.org', ref: 'http://www.qizhiwang.org/' },
    { name: '共产党员网·先锋文汇', entry: 'https://www.12371.cn/', domain: '12371.cn', ref: 'https://www.12371.cn/' },
    { name: '中国文明网·时代楷模', entry: 'http://www.wenming.cn/', domain: 'wenming.cn', ref: 'http://www.wenming.cn/' }
];

async function crawlAuthority(src) {
    let html;
    try {
        html = await request(src.entry, src.ref);
    } catch (e) {
        console.log('  [' + src.name + '] 入口抓取失败（跳过）: ' + e.message);
        return [];
    }
    // 提取本站含年份的文章链接；导航/列表页交由 extractArticle 长度阈值兜底过滤
    const links = [...new Set(
        [...html.matchAll(/href="(https?:\/\/[^"]+?)"/g)]
            .map(m => m[1])
            .filter(u => u.includes(src.domain) && /20\d\d/.test(u) && u.endsWith('.html'))
    )].slice(0, 14);
    const out = [];
    for (const url of links) {
        try {
            const page = await request(url, src.ref);
            const art = extractArticle(page);
            if (!art.title || art.fullText.length < 1500) continue;
            const e = toEssay({ ...art, source: src.name, url });
            if (e) out.push(e);
            await sleep(250);
        } catch (e) { /* 单篇失败忽略 */ }
    }
    console.log('  [' + src.name + '] 新增 ' + out.length + ' 篇');
    return out;
}

/* ---------- 路线2：人民时评增量（best-effort） ---------- */
async function crawlPeopleComment() {
    const out = [];
    let html;
    try {
        html = await request('http://opinion.people.com.cn/', 'http://opinion.people.com.cn/');
    } catch (e) { console.log('  [人民时评] 入口抓取失败（跳过）: ' + e.message); return out; }
    const links = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]*people\.com\.cn\/n1\/20\d\d\/[^"]+\.html)"/g)].map(m => m[1]))].slice(0, 12);
    for (const url of links) {
        try {
            const page = await request(url, 'http://opinion.people.com.cn/');
            const art = extractArticle(page);
            if (!art.title || art.fullText.length < 1500) continue;
            const e = toEssay({ ...art, source: '人民网·人民时评', url });
            if (e) out.push(e);
            await sleep(250);
        } catch (e) { /* skip */ }
    }
    console.log(`  [人民时评] 新增 ${out.length} 篇`);
    return out;
}

/* ---------- 中公教育·申论热点（补充源，best-effort） ----------
 * 中公申论热点栏目为服务端渲染，列表页含 /shenlun/年/月日/编号.html 详情链接
 * （部分为协议相对 //www.offcn.com/...，需规范化为 https:），正文干净，
 * 文章形态即「申论热点背景+分析+对策」，与范文库高度契合。
 * 仅用于补充，失败不影响整体。
 */
async function crawlZhonggong() {
    const out = [];
    let html;
    try {
        html = await request('https://www.offcn.com/shenlun/', 'https://www.offcn.com/shenlun/');
    } catch (e) {
        console.log('  [中公申论] 列表抓取失败（跳过）: ' + e.message);
        return out;
    }
    const norm = u => u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? 'https://www.offcn.com' + u : u);
    const links = [...new Set(
        [...html.matchAll(/href="([^"]*shenlun[^"]*)"/g)].map(m => m[1]).map(norm)
    )].filter(u => /offcn\.com\/shenlun\/\d{4}\/\d{4}\/\d+\.html$/.test(u)).slice(0, 20);
    console.log('  [中公申论] 发现详情链接 ' + links.length + ' 条');
    for (const url of links) {
        try {
            const page = await request(url, 'https://www.offcn.com/shenlun/');
            let art = extractArticle(page);
            // 清除「您现在的位置：首页 > …」面包屑噪音行
            art.paragraphs = art.paragraphs.filter(p => !/您现在的位置|首页\s*>/.test(p));
            art.fullText = art.paragraphs.join('\n');
            const e = toEssay({ ...art, source: '中公教育·申论热点', url });
            if (e) out.push(e);
            await sleep(300);
        } catch (e) { /* 单篇失败忽略 */ }
    }
    console.log('  [中公申论] 新增 ' + out.length + ' 篇');
    return out;
}

/* ---------- 主流程 ---------- */
async function main() {
    console.log('='.repeat(56));
    console.log('  申论范文抓取（每日时政/求是长文派生 + 人民时评增量）');
    console.log('='.repeat(56));

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const derived = [];
    for (const file of ['shizheng.json', 'qiushi.json']) {
        const fp = path.join(OUT_DIR, file);
        if (!fs.existsSync(fp)) continue;
        let data;
        try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
        for (const it of (data.items || [])) {
            // 只取 人民网 / 求是网 的官方长文
            const src = it.source || '';
            if (!/人民网|求是网/.test(src)) continue;
            const e = toEssay(it);
            if (e) derived.push(e);
        }
    }
    console.log(`  [派生] 从时政/求是长文得到 ${derived.length} 篇`);

    let incremental = [];
    try {
        incremental = await crawlPeopleComment();
    } catch (e) {
        console.log('  [人民时评] 增量失败（忽略）: ' + e.message);
    }

    let authority = [];
    for (const src of AUTHORITY_SOURCES) {
        try {
            authority = authority.concat(await crawlAuthority(src));
        } catch (e) {
            console.log('  [' + src.name + '] 抓取失败（忽略）: ' + e.message);
        }
    }
    console.log('  [权威源] 合计新增 ' + authority.length + ' 篇');

    let zhonggong = [];
    try {
        zhonggong = await crawlZhonggong();
    } catch (e) {
        console.log('  [中公申论] 抓取失败（忽略）: ' + e.message);
    }

    finish(derived, incremental, authority, zhonggong);
}

function finish(derived, incremental, authority, zhonggong = []) {
    const all = [...authority, ...zhonggong, ...incremental, ...derived];

    // 合并历史（按 id 去重，保证每日新增且旧文不丢）
    const file = path.join(OUT_DIR, 'essays.json');
    let old = [];
    if (fs.existsSync(file)) {
        try { old = (JSON.parse(fs.readFileSync(file, 'utf8')).items || []); } catch (e) { }
    }
    const map = new Map();
    for (const it of [...all, ...old]) {
        if (!map.has(it.id)) map.set(it.id, it);
    }
    // 优先保留长篇优质范文，控制总量
    const merged = [...map.values()]
        .sort((a, b) => (b.content || '').length - (a.content || '').length)
        .slice(0, 80);

    fs.writeFileSync(file, JSON.stringify({
        updatedAt: new Date().toISOString(),
        count: merged.length,
        items: merged
    }, null, 1), 'utf8');

    const byType = {};
    merged.forEach(m => byType[m.typeName] = (byType[m.typeName] || 0) + 1);
    console.log('\n' + '='.repeat(56));
    console.log(`  本次入库 ${all.length} 篇（权威源 ${authority.length} · 中公 ${zhonggong.length} · 时评 ${incremental.length} · 派生 ${derived.length}）· 库存总计 ${merged.length} 篇`);
    console.log('  分类分布：' + Object.entries(byType).map(([k, v]) => k + ' ' + v).join('  '));
    console.log('='.repeat(56));
}

if (require.main === module) {
    main().catch(e => { console.error('\n致命错误:', e); process.exit(1); });
}

module.exports = { extractArticle, toEssay, crawlAuthority, crawlZhonggong, AUTHORITY_SOURCES, classifyType, stableId, request };
