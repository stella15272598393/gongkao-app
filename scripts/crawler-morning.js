/**
 * 今日晨读抓取器
 * ------------------------------------------------------------
 * 目标：为「今日晨读」模块每天自动抓取权威媒体评论/时评文章，
 *       供考公用户每日晨读积累素材。
 *
 * 来源策略（按优先级）：
 *   1. 人民日报·人民时评 / 人民论坛（opinion.people.com.cn）
 *      —— 申论写作范本，评论员文章，观点鲜明、论证严谨
 *   2. 新华社·新华时评（www.news.cn）
 *      —— 权威时政评论，紧扣国家大政方针
 *   3. 光明日报·光明时评（epaper.gmw.cn）
 *      —— 文化/教育/科技视角的深度评论
 *   4. 半月谈·评论（www.banyuetan.org）
 *      —— 面向基层公务员的政策解读与热点分析
 *   5. 经济日报·经济时评（paper.ce.cn）
 *      —— 经济政策解读，申论常考领域
 *
 * 输出：content/morning.json { items: [...] }
 * 每条字段：id / title / source / date / content(全文) / tags / url
 * 合并策略：按 id 去重保留历史，cap 60 篇（约 30 天量）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------- HTTP 工具（复用 crawler-essay.js 同款） ---------- */
function request(url, referer, redirects) {
    if (redirects === undefined) redirects = 0;
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

/* ---------- 正文抽取（同 crawler-essay.js extractArticle） ---------- */
const CONTENT_ANCHORS = ['word_show', 'text_box', 'article-content', 'con_txt', 'rm_txt_zw', 'TRS_Editor', 'content_area', 'artical_content', 'detail_content', 'content', 'article'];
const END_ANCHORS = ['share_con', 'edit_bar', 'copyright', 'foot', 'relevant', 'ewm_box', 'footer', 'pageft', 'related'];
const NOISE_RE = /^(来源|责编|编辑|分享|扫码|点击|相关阅读|原标题|版权|声明|【纠错】|返回|上一篇|下一篇|\(责任编辑|网站声明|违法和不良|共产党员网|发布时间|微信|微博|字号|打印|投稿|我要|查看余下全文|请使用浏览器|首页\s*&gt;|首页\s*滚动|2026年《|2026年《时事)/;
// JS/代码噪音行检测（不用^锚点，匹配行内任意位置）
const CODE_NOISE_RE = /(function\s+\w+\s*\(|var\s+\w+\s*=|const\s+\w+\s*=|let\s+\w+\s*=|document\.(write|addEventListener)|showPlayer\(|window\.|console\.|\.innerHTML|\.src\s*=|posterUrl|playbackRates|videoInfo|createPageHTML|WeixinJSBridge|_bdhmProtocol|unescape\(|handleFontSize|wd_paramtracker|\$\(|ajaxurl|wx\.config|scriptid|label:\s*['"]|type:\s*['"]?(video|mp4|javascript)|hidPlaybackRates|nextOver|nCurrIndex|_nPageCount|_sPageName|_sPageExt|encodeURIComponent|\.on\(|\.ready\(|function\s*\(\s*\)\s*\{|typeof\s+WeixinJSBridge|setFontSizeCallback|menu[:.]setfont)/;

/**
 * 预清理 HTML：移除 script/style/noscript 标签及其内容，避免 JS 代码混入正文
 */
function stripTags(html) {
    // 移除 <script>...</script>（含多行）
    let s = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    // 移除 <style>...</style>
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    // 移除 <noscript>...</noscript>
    s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    return s;
}

function extractArticle(html) {
    // 先清除 script/style 等标签，防止 JS 代码混入正文
    html = stripTags(html);

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
        .filter(t => {
            if (t.length <= 12) return false;
            if (NOISE_RE.test(t)) return false;
            // 过滤 JS/代码噪音行
            if (CODE_NOISE_RE.test(t)) return false;
            // 过滤超长单行（>300字符且不含中文句号，大概率是压缩代码）
            if (t.length > 300 && !/[。！？]/.test(t)) return false;
            // 过滤含代码特征的比例符号过多的行（如 { } ( ) ; = 等占比过高）
            const codeChars = (t.match(/[{}();=\[\]<>]/g) || []).length;
            if (t.length > 60 && codeChars / t.length > 0.15) return false;
            return true;
        });
    if (paragraphs.length < 3) {
        paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
            .map(m => cleanText(m[1]))
            .filter(t => {
                if (t.length <= 20) return false;
                if (NOISE_RE.test(t)) return false;
                if (CODE_NOISE_RE.test(t)) return false;
                if (t.length > 300 && !/[。！？]/.test(t)) return false;
                const codeChars = (t.match(/[{}();=\[\]<>]/g) || []).length;
                if (t.length > 60 && codeChars / t.length > 0.15) return false;
                return true;
            });
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 晨读来源配置 ---------- */
const MORNING_SOURCES = [
    {
        name: '人民日报·人民时评',
        entry: 'http://opinion.people.com.cn/',
        domain: 'people.com.cn',
        ref: 'http://opinion.people.com.cn/',
        linkPattern: /href="(https?:\/\/[^"]*people\.com\.cn\/n1\/\d{4}\/[^"]+\.html)"/g,
        minLen: 800,
        maxLinks: 8
    },
    {
        name: '新华社·新华时评',
        entry: 'https://www.news.cn/comments/',
        domain: 'news.cn',
        ref: 'https://www.news.cn/',
        linkPattern: /href="(https?:\/\/[^"]*news\.cn\/comments\/\d{8}\/[^"]+\/c\.html)"/g,
        minLen: 800,
        maxLinks: 8
    },
    {
        name: '经济日报·经济时评',
        entry: 'http://views.ce.cn/',
        domain: 'ce.cn',
        ref: 'http://www.ce.cn/',
        linkPattern: /href="(https?:\/\/[^"]*ce\.cn\/[^"]*\/t\d{8}_\d+\.s?html)"/g,
        minLen: 600,
        maxLinks: 8
    },
    {
        name: '光明日报·光明时评',
        entry: 'https://news.gmw.cn/',
        domain: 'gmw.cn',
        ref: 'https://news.gmw.cn/',
        linkPattern: /href="(https?:\/\/[^"]*gmw\.cn\/\d{4}-\d{2}\/\d{2}\/content_\d+\.htm)"/g,
        minLen: 600,
        maxLinks: 8
    },
    {
        name: '半月谈·评论',
        entry: 'http://www.banyuetan.org/',
        domain: 'banyuetan.org',
        ref: 'http://www.banyuetan.org/',
        linkPattern: /href="(https?:\/\/[^"]*banyuetan\.org\/[^"]+\.html)"/g,
        minLen: 600,
        maxLinks: 6
    }
];

/**
 * 清洗正文中的页面噪音（面包屑导航、来源行、版权等）
 */
function cleanPageNoise(text) {
    // 移除常见的页面头部噪音模式（通常出现在正文开头）
    let s = text
        // 面包屑 + 来源行: "首页 > 滚动 标题 2026-08-04 08:08 来源：xxx"
        .replace(/^[\s\S]*?(\d{4}[-年]\d{1,2}[-月]\d{1,2}\s*[\d:]*\s*来源[：:][^\n]*?\(责任编辑[^\n]*?\))\s*/g, '')
        // "首页 > 滚动" 开头
        .replace(/^[\s]*首页\s*&gt;\s*滚动\s+/g, '')
        // "查看余下全文"
        .replace(/查看余下全文\s*/g, '')
        // "(责任编辑：xxx)"
        .replace(/\(责任编辑[^\)]*\)\s*/g, '')
        // "X" 单独字符（经济日报常见分隔符）
        .replace(/^X\s+/gm, '')
        // 多余空行
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return s;
}

/**
 * 从单条文章数据转为晨读标准格式
 */
function toMorning(art, sourceName, url) {
    let full = art.fullText || (art.paragraphs || []).join('\n');
    if (!full || full.length < 400) return null;
    // 清洗页面噪音（面包屑、来源行、版权等）
    full = cleanPageNoise(full);
    if (full.length < 400) return null;
    // 最终安全检查：如果内容仍含明显 JS 代码特征，整篇丢弃
    const jsSignatures = ['WeixinJSBridge', 'createPageHTML', '_bdhmProtocol', 'showPlayer(', 'posterUrl', 'playbackRates', 'videoInfo', 'handleFontSize', 'wd_paramtracker'];
    for (const sig of jsSignatures) {
        if (full.includes(sig)) return null;
    }
    // 自动提取标签：从标题和正文前 200 字中匹配高频主题词
    const sample = art.title + ' ' + full.slice(0, 200);
    const tagKeywords = [
        ['高质量发展', '新质生产力', '科技创新'], ['乡村振兴', '农业', '粮食'],
        ['民生', '就业', '社保', '医疗'], ['文化', '教育', '传承'],
        ['生态', '绿色', '双碳'], ['法治', '治理', '改革'],
        ['数字经济', '人工智能', '产业'], ['基层', '社区', '服务']
    ];
    const tags = [];
    for (const group of tagKeywords) {
        if (group.some(kw => sample.includes(kw))) {
            tags.push(group[0]);
            if (tags.length >= 3) break;
        }
    }
    if (!tags.length) tags.push('时政要闻');

    return {
        id: stableId('morning', art.title || full.slice(0, 40)),
        title: art.title || (full.slice(0, 40) + '…'),
        source: sourceName,
        date: art.date || '',
        content: full,
        tags: tags,
        url: url || '',
        _remote: true
    };
}

/**
 * 抓取单个来源
 */
async function crawlSource(src) {
    let html;
    try {
        html = await request(src.entry, src.ref);
    } catch (e) {
        console.log('  [' + src.name + '] 入口抓取失败（跳过）: ' + e.message);
        return [];
    }

    // 提取文章链接（兼容相对路径 /xxx 形式）
    const root = (() => { try { return new URL(src.entry).origin; } catch (e) { return 'https://' + src.domain; } })();
    const rawLinks = [...html.matchAll(src.linkPattern)].map(m => m[1]);
    const links = [...new Set(
        rawLinks
            .map(u => u.startsWith('/') ? root + u : u)
            .filter(u => u.includes(src.domain))
    )].slice(0, src.maxLinks);

    // 如果正则没匹配到链接，用通用 fallback
    if (links.length === 0) {
        const fallbackLinks = [...new Set(
            [...html.matchAll(/href="([^"]+?)"/g)]
                .map(m => m[1])
                .map(u => u.startsWith('/') ? root + u : u)
                .filter(u => u.includes(src.domain) && /\.html?$/.test(u))
        )].slice(0, src.maxLinks);
        links.push(...fallbackLinks);
    }

    const out = [];
    for (const url of links) {
        try {
            const page = await request(url, src.ref);
            const art = extractArticle(page);
            if (!art.title || art.fullText.length < src.minLen) continue;
            // 来源级标题关键词过滤（如光明日报只保留评论类）
            if (src.mustContain && !src.mustContain.some(kw => (art.title || '').includes(kw))) continue;
            const m = toMorning(art, src.name, url);
            if (m) out.push(m);
            await sleep(300);
        } catch (e) { /* 单篇失败忽略 */ }
    }
    console.log('  [' + src.name + '] 获取 ' + out.length + ' 篇');
    return out;
}

/* ---------- 主流程 ---------- */
async function main() {
    console.log('='.repeat(56));
    console.log('  今日晨读抓取（权威媒体评论/时评每日更新）');
    console.log('='.repeat(56));

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const all = [];
    for (const src of MORNING_SOURCES) {
        try {
            const items = await crawlSource(src);
            all.push(...items);
        } catch (e) {
            console.log('  [' + src.name + '] 抓取异常（忽略）: ' + e.message);
        }
    }

    // 合并历史（按 id 去重）
    const file = path.join(OUT_DIR, 'morning.json');
    let old = [];
    if (fs.existsSync(file)) {
        try { old = (JSON.parse(fs.readFileSync(file, 'utf8')).items || []); } catch (e) { }
    }
    const map = new Map();
    for (const it of [...all, ...old]) {
        if (!map.has(it.id)) map.set(it.id, it);
    }

    // 控制总量 cap 60，优先保留长文
    const merged = [...map.values()]
        .sort((a, b) => (b.content || '').length - (a.content || '').length)
        .slice(0, 60);

    fs.writeFileSync(file, JSON.stringify({
        updatedAt: new Date().toISOString(),
        count: merged.length,
        items: merged
    }, null, 1), 'utf8');

    const bySource = {};
    merged.forEach(m => bySource[m.source] = (bySource[m.source] || 0) + 1);

    console.log('\n' + '='.repeat(56));
    console.log(`  本次新增 ${all.length} 篇 · 库存总计 ${merged.length} 篇`);
    console.log('  来源分布：' + Object.entries(bySource).map(([k, v]) => k + ' ' + v).join('  '));
    console.log('='.repeat(56));
}

if (require.main === module) {
    main().catch(e => { console.error('\n致命错误:', e); process.exit(1); });
}

module.exports = { extractArticle, toMorning, MORNING_SOURCES, stableId, crawlSource, NOISE_RE, CODE_NOISE_RE };
