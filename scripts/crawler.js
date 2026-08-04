/**
 * 个人专属工作台 - 官方内容抓取脚本
 * ------------------------------------------------------------
 * 原则：完整原文 100% 保留官方原生文本，不做任何 AI 概括或截断。
 * 输出：content/*.json
 *
 * 用法：node scripts/crawler.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');

// 复用 crawler-essay 中已验证对粉笔/中公详情页有效的正文抽取器
const { extractArticle: extractFenbi } = require('./crawler-essay');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ============================================================
 * 关键词体系
 * ========================================================== */
const KEYWORDS_GUOKAO = [
    '二十届六中全会', '二十届三中全会', '新质生产力', '十五五', '十四五',
    '中国式现代化', '高质量发展', '全过程人民民主', '共同富裕', '乡村振兴',
    '生态文明', '双碳', '碳达峰', '碳中和', '数字经济', '人工智能',
    '基层治理', '全面依法治国', '党的建设', '习近平', '中央政治局',
    '深化改革', '扩大内需', '民生', '就业', '教育强国', '科技创新',
    '文化自信', '健康中国', '统一大市场', '对外开放'
];

/** 湖北强信号词：出现即可判定为湖北方向 */
const KEYWORDS_HUBEI_STRONG = [
    '湖北省委', '湖北省人民政府', '湖北省政府', '省委常委会', '省政府常务会议',
    '湖北省', '武汉市', '襄阳', '宜昌', '荆州', '黄冈', '孝感', '十堰',
    '随州', '荆门', '鄂州', '黄石', '咸宁', '恩施', '仙桃', '潜江', '天门', '神农架',
    '中部崛起', '长江经济带', '光谷', '东湖高新', '三峡', '汉江',
    '省委书记', '荆楚大地', '湖北日报', '长江大保护'
];

/** 湖北弱信号词：仅当出现在标题或正文前段才算数（避免页脚噪音误判） */
const KEYWORDS_HUBEI_WEAK = ['湖北', '武汉', '荆楚', '东湖', '江城'];

const KEYWORDS_HUBEI = [...KEYWORDS_HUBEI_STRONG, ...KEYWORDS_HUBEI_WEAK];

/** 负面词：命中即丢弃（与备考无关的娱乐、体育、国际八卦、商业促销） */
const NEGATIVE_RE = /(足球|篮球|球员|球队|联赛|世界杯|欧冠|夺冠|比分|明星|演唱会|电影票房|明星八卦|门票送|优惠票价|打折|促销|彩票|星座|减肥|游戏攻略|因凡蒂诺|梅西|C罗)/;

/* ============================================================
 * 数据源配置
 * ========================================================== */
const SOURCES = [
    {
        id: 'people',
        name: '人民网',
        direction: '国考',
        entry: 'http://www.people.com.cn/',
        referer: 'http://www.people.com.cn/',
        linkRe: /href="(https?:\/\/[^"]*people\.com\.cn\/n1\/20\d\d\/[^"]+\.html)"/g,
        max: 45
    },
    {
        id: 'people_theory',
        name: '人民网·理论',
        direction: '国考',
        entry: 'http://theory.people.com.cn/',
        referer: 'http://www.people.com.cn/',
        linkRe: /href="(https?:\/\/[^"]*people\.com\.cn\/n1\/20\d\d\/[^"]+\.html)"/g,
        max: 30
    },
    {
        id: 'qiushi',
        name: '求是网',
        direction: '国考',
        entry: 'http://www.qstheory.cn/',
        referer: 'https://www.qstheory.cn/',
        linkRe: /href="(?:https?:\/\/www\.qstheory\.cn)?\/?(20\d{6}\/[0-9a-f]{32}\/c\.html)"/g,
        base: 'https://www.qstheory.cn/',
        max: 45
    },
    {
        id: 'cnhubei',
        name: '湖北日报',
        direction: '湖北',
        entry: 'http://news.cnhubei.com/',
        referer: 'http://news.cnhubei.com/',
        linkRe: /href="(https?:\/\/[^"]*cnhubei\.com\/content\/20\d\d-\d\d\/\d\d\/content_\d+\.html?)"/g,
        max: 60
    }
];

/* ============================================================
 * HTTP 请求（含 gzip 解压 + 编码自适应）
 * ========================================================== */
function request(url, referer, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('too many redirects'));
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': UA,
                'Referer': referer || '',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'close'
            },
            timeout: 20000,
            rejectUnauthorized: false
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                const next = new URL(res.headers.location, url).href;
                res.resume();
                return resolve(request(next, referer, redirects + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode));
            }
            const chunks = [];
            let stream = res;
            const enc = res.headers['content-encoding'];
            if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
            else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
            stream.on('data', c => chunks.push(c));
            stream.on('end', () => resolve(decode(Buffer.concat(chunks))));
            stream.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}

/** 编码自适应：优先 UTF-8，乱码过多则回退 GB18030 */
function decode(buf) {
    let html = buf.toString('utf8');
    const bad = (html.match(/\uFFFD/g) || []).length;
    if (bad > 30) {
        try { html = new TextDecoder('gb18030').decode(buf); } catch (e) { /* keep utf8 */ }
    }
    return html;
}

/* ============================================================
 * 正文提取（保留完整原文，绝不截断）
 * ========================================================== */
const CONTENT_ANCHORS = [
    'rm_txt_zw', 'rm_txt_con', 'rwb_zw',           // 人民网
    'highlight', 'article-content', 'content_area', // 求是网
    'content_area', 'contentText', 'article_content', 'text_con' // 湖北日报等
];

const END_ANCHORS = ['share_con', 'txt_float', 'edit_bar', 'article-footer', 'copyright', 'foot'];

function cleanText(s) {
    return s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&emsp;/g, '　')
        .replace(/&nbsp;/g, ' ')
        .replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/&lsquo;|&rsquo;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&hellip;/g, '…')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

const NOISE_RE = /^(来源|责编|编辑|分享|扫码|点击|相关阅读|原标题|版权|声明|【纠错】|返回|上一篇|下一篇|\(责任编辑|网站声明|违法和不良)/;

function extractArticle(html) {
    // 标题
    let title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    title = title.split(/--|_|\|/)[0].trim();
    const h1 = html.match(/<h1[^>]*>([\s\S]{2,200}?)<\/h1>/);
    if (h1) {
        const t = cleanText(h1[1]);
        if (t.length > 4) title = t;
    }

    // 发布时间
    let date = '';
    const dm = html.match(/20\d\d[-年]\d{1,2}[-月]\d{1,2}[日]?(?:\s*\d{2}:\d{2}(?::\d{2})?)?/);
    if (dm) date = dm[0];

    // 正文起点：命中任一锚点
    let start = -1;
    for (const a of CONTENT_ANCHORS) {
        const i = html.indexOf(a);
        if (i >= 0 && (start < 0 || i < start)) start = i;
    }
    if (start < 0) start = 0;

    // 正文终点
    let end = html.length;
    for (const a of END_ANCHORS) {
        const i = html.indexOf(a, start + 50);
        if (i > start && i < end) end = i;
    }

    let seg = html.slice(start, end);
    let paras = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
        .map(m => cleanText(m[1]))
        .filter(t => t.length > 8 && !NOISE_RE.test(t));

    // 兜底：锚点失效时全页扫描
    if (paras.length < 3) {
        paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
            .map(m => cleanText(m[1]))
            .filter(t => t.length > 20 && !NOISE_RE.test(t));
    }

    // 去重（部分站点重复输出）
    const seen = new Set();
    paras = paras.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });

    return { title, date, paragraphs: paras, fullText: paras.join('\n\n') };
}

/* ============================================================
 * 关键词命中
 * ========================================================== */
function matchKeywords(text, list) {
    const hit = [];
    for (const k of list) if (text.includes(k)) hit.push(k);
    return hit;
}

/**
 * 分类判定
 * 关键：只在「标题 + 正文前段」范围内匹配，避免页脚/导航栏噪音导致误判。
 * 湖北弱信号词必须出现在标题或正文前 600 字才算数。
 */
function classify(title, paragraphs) {
    const head = paragraphs.slice(0, 6).join(' ');      // 正文前段
    const scope = title + ' ' + head.slice(0, 2500);     // 判定范围
    const nearHead = title + ' ' + head.slice(0, 600);   // 弱信号判定范围

    const guokao = matchKeywords(scope, KEYWORDS_GUOKAO);

    const hubeiStrong = matchKeywords(scope, KEYWORDS_HUBEI_STRONG);
    const hubeiWeak = matchKeywords(nearHead, KEYWORDS_HUBEI_WEAK);
    const hubei = [...new Set([...hubeiStrong, ...hubeiWeak])];

    return { guokao, hubei, hubeiStrong, isNegative: NEGATIVE_RE.test(title + head.slice(0, 400)) };
}

/** 申论主题标签 */
const TOPIC_RULES = [
    ['基层治理', ['基层', '社区', '网格', '治理', '群众工作', '为民服务']],
    ['经济发展', ['经济', '产业', '制造业', '消费', '内需', '市场', '新质生产力', '企业']],
    ['党建', ['党建', '党的建设', '党员', '党组织', '廉政', '作风', '党风']],
    ['三农', ['乡村振兴', '农业', '农村', '农民', '粮食', '种业', '脱贫']],
    ['文旅', ['文化', '旅游', '文旅', '非遗', '文物', '文明']],
    ['区域发展', ['中部崛起', '长江经济带', '区域', '协调发展', '城市群', '都市圈']],
    ['生态文明', ['生态', '环保', '绿色', '碳达峰', '碳中和', '污染', '长江大保护']],
    ['科技创新', ['科技', '创新', '人工智能', '数字', '芯片', '研发', '实验室']],
    ['民生保障', ['民生', '就业', '医疗', '教育', '养老', '社保', '住房', '健康']],
    ['法治建设', ['法治', '依法', '司法', '法律', '条例', '监管']]
];

function tagTopics(text) {
    const tags = [];
    for (const [tag, kws] of TOPIC_RULES) {
        if (kws.some(k => text.includes(k))) tags.push(tag);
    }
    return tags.length ? tags.slice(0, 4) : ['时政要闻'];
}

/* ============================================================
 * 申论维度拆解（基于原文抽取，非改写）
 * 说明：这里做的是"定位并摘取原句"，不生成新文本，
 *      因此不违反"完整原文不得 AI 概括"的要求。
 * ========================================================== */
const POLICY_RE = /(必须|要|应当|坚持|加快|推动|深化|完善|健全|加强|统筹|强化|构建|建立|落实|提升|优化|扩大|保障)[^。！？\n]{8,80}[。！？]/g;
const RHETORIC_RE = /[^。！？\n]{6,60}(格局|体系|机制|路径|抓手|引擎|动能|底色|成色|支撑|保障|基石|命脉|主线|centerpiece)[^。！？\n]{0,40}[。！？]/g;

function decompose(paragraphs) {
    const full = paragraphs.join('\n');
    // 总论点：首个实质段落
    const thesis = paragraphs.find(p => p.length > 30 && !/^【/.test(p)) || paragraphs[0] || '';

    // 分论点：以序号或关键连接词开头的段落
    const subPoints = paragraphs.filter(p =>
        /^(一|二|三|四|五|六|七|八|九|十)[、．.]|^[（(]\s*[一二三四五六七八九十\d]+\s*[)）]|^\d+[、．.]/.test(p)
    ).slice(0, 8);

    // 政策表述
    const policy = [...new Set((full.match(POLICY_RE) || []).map(s => s.trim()))]
        .filter(s => s.length >= 12).slice(0, 12);

    // 高级书面话术
    const rhetoric = [...new Set((full.match(RHETORIC_RE) || []).map(s => s.trim()))]
        .filter(s => s.length >= 12).slice(0, 10);

    // 对策模板：含"要/必须/加快"且带动宾结构的句子
    const measures = policy.filter(s => /(必须|要|加快|推动|深化|健全|完善|加强)/.test(s)).slice(0, 10);

    // 金句：短而有力、含对仗或比喻
    const sentences = full.split(/[。！？\n]/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 60);
    const goldens = sentences.filter(s =>
        /[，,].*[，,]/.test(s) || /(既.*又|不仅.*更|越.*越|是.*也是)/.test(s)
    ).slice(0, 8);

    return {
        thesis,
        subPoints,
        policyExpressions: policy,
        rhetoric,
        measures,
        goldenSentences: goldens
    };
}

/* ============================================================
 * 抓取主流程
 * ========================================================== */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function crawlSource(src) {
    const out = [];
    process.stdout.write(`\n[${src.name}] 抓取入口页 ... `);
    let indexHtml;
    try {
        indexHtml = await request(src.entry, src.referer);
        process.stdout.write('OK\n');
    } catch (e) {
        console.log('失败:', e.message);
        return out;
    }

    // 收集链接
    const urls = [];
    const seen = new Set();
    let m;
    src.linkRe.lastIndex = 0;
    while ((m = src.linkRe.exec(indexHtml)) !== null) {
        let u = m[1];
        if (src.base && !/^https?:/.test(u)) u = src.base + u;
        if (!seen.has(u)) { seen.add(u); urls.push(u); }
    }
    console.log(`  发现文章链接 ${urls.length} 条，计划抓取 ${Math.min(urls.length, src.max)} 条`);

    let ok = 0, fail = 0;
    for (const url of urls.slice(0, src.max)) {
        try {
            const html = await request(url, src.referer);
            const art = extractArticle(html);

            // 门槛1：正文长度（备考素材至少 800 字，短讯无价值）
            if (!art.title || art.fullText.length < 800) { fail++; continue; }

            const cls = classify(art.title, art.paragraphs);

            // 门槛2：负面词过滤（体育/娱乐/促销）
            if (cls.isNegative) { fail++; continue; }

            // 门槛3：备考相关性
            //   湖北源：需强信号词，或（弱信号 + 国考考点词）
            //   国考源：需命中至少 2 个国考考点词，避免泛泛而谈
            let relevant, direction;
            if (src.direction === '湖北') {
                relevant = cls.hubeiStrong.length > 0 || (cls.hubei.length > 0 && cls.guokao.length > 0);
                direction = cls.hubeiStrong.length > 0 ? '湖北' : (cls.guokao.length >= 2 ? '国考' : '湖北');
            } else {
                relevant = cls.guokao.length >= 2;
                direction = cls.hubeiStrong.length > 0 ? '湖北' : '国考';
            }
            if (!relevant) { fail++; continue; }

            out.push({
                id: src.id + '_' + Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16),
                title: art.title,
                source: src.name,
                direction,
                date: art.date || new Date().toISOString().slice(0, 10),
                url,
                tags: tagTopics(art.title + art.fullText.slice(0, 2000)),
                keywordsGuokao: cls.guokao.slice(0, 8),
                keywordsHubei: cls.hubei.slice(0, 8),
                paragraphs: art.paragraphs,   // 完整原文段落，未截断
                fullText: art.fullText,       // 完整原文全文，未截断
                wordCount: art.fullText.length,
                analysis: decompose(art.paragraphs),
                crawledAt: new Date().toISOString()
            });
            ok++;
            process.stdout.write(`\r  已抓取 ${ok} 篇 / 跳过 ${fail} 篇`);
            await sleep(350); // 礼貌延时
        } catch (e) {
            fail++;
        }
    }
    console.log(`\r  [${src.name}] 完成：有效 ${ok} 篇，跳过 ${fail} 篇`);
    return out;
}

/* ============================================================
 * 粉笔·时政热点（补充源，best-effort）
 * 粉笔时政热点栏目为服务端渲染，列表页含
 *   /page/exam-preparation-material-detail/12/编号  链接，
 * 详情页正文干净（约 5000 字）。天然为时政备考素材，
 * 直接 relevant，不做国考关键词门槛。仅用于补充，失败不影响整体。
 * ========================================================== */
async function crawlFenbiShizheng() {
    const out = [];
    const listUrl = 'https://www.fenbi.com/page/exams-preparation-materials-list/12';
    let html;
    try {
        html = await request(listUrl, listUrl);
    } catch (e) {
        console.log('  [粉笔时政] 列表抓取失败（跳过）: ' + e.message);
        return out;
    }
    const links = [...new Set(
        [...html.matchAll(/href="([^"]*exam-preparation-material-detail\/12\/[^"]*)"/g)]
            .map(m => m[1])
            .map(u => u.startsWith('http') ? u : 'https://www.fenbi.com' + u)
            .filter(u => /\/12\/\d+$/.test(u))
    )].slice(0, 15);
    console.log('  [粉笔时政] 发现详情链接 ' + links.length + ' 条');
    for (const url of links) {
        try {
            const page = await request(url, listUrl);
            const art = extractFenbi(page);
            if (!art.title || art.fullText.length < 400) continue;
            const cls = classify(art.title, art.paragraphs);
            out.push({
                id: 'fenbi_' + Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16),
                title: art.title.replace(/^时政汇总\|\s*/, ''),
                source: '粉笔·时政热点',
                direction: '国考',
                date: art.date || new Date().toISOString().slice(0, 10),
                url,
                tags: tagTopics(art.title + art.fullText.slice(0, 2000)),
                keywordsGuokao: cls.guokao.slice(0, 8),
                keywordsHubei: cls.hubei.slice(0, 8),
                paragraphs: art.paragraphs,
                fullText: art.fullText,
                wordCount: art.fullText.length,
                analysis: decompose(art.paragraphs),
                crawledAt: new Date().toISOString()
            });
            await sleep(300);
        } catch (e) { /* 单篇失败忽略 */ }
    }
    console.log('  [粉笔时政] 新增 ' + out.length + ' 篇');
    return out;
}

/* ============================================================
 * 入口
 * ========================================================== */
async function main() {
    console.log('='.repeat(56));
    console.log('  个人专属工作台 · 官方内容抓取');
    console.log('  ' + new Date().toLocaleString('zh-CN'));
    console.log('='.repeat(56));

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    let all = [];
    for (const src of SOURCES) {
        try {
            const items = await crawlSource(src);
            all = all.concat(items);
        } catch (e) {
            console.log('  [' + (src.name || src.id) + '] 抓取失败（已跳过）: ' + e.message);
        }
    }

    // 粉笔时政热点补充源
    try {
        const fenbi = await crawlFenbiShizheng();
        all = all.concat(fenbi);
    } catch (e) {
        console.log('  [粉笔时政] 抓取失败（忽略）: ' + e.message);
    }

    // 按日期倒序
    all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // 拆分：求是网单独成库，其余进时政
    const qiushi = all.filter(a => a.source === '求是网');
    const shizheng = all.filter(a => a.source !== '求是网');

    // 合并历史数据（去重累积，越积越多）
    const merged = {
        shizheng: mergeHistory(path.join(OUT_DIR, 'shizheng.json'), shizheng, 300),
        qiushi: mergeHistory(path.join(OUT_DIR, 'qiushi.json'), qiushi, 150)
    };

    fs.writeFileSync(path.join(OUT_DIR, 'shizheng.json'),
        JSON.stringify({ updatedAt: new Date().toISOString(), count: merged.shizheng.length, items: merged.shizheng }, null, 1), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'qiushi.json'),
        JSON.stringify({ updatedAt: new Date().toISOString(), count: merged.qiushi.length, items: merged.qiushi }, null, 1), 'utf8');

    // 元信息
    fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify({
        updatedAt: new Date().toISOString(),
        updatedAtLocal: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        todayNew: shizheng.length + qiushi.length,
        totals: { shizheng: merged.shizheng.length, qiushi: merged.qiushi.length }
    }, null, 1), 'utf8');

    console.log('\n' + '='.repeat(56));
    console.log(`  本次新增：时政 ${shizheng.length} 篇，求是 ${qiushi.length} 篇`);
    console.log(`  库存总计：时政 ${merged.shizheng.length} 篇，求是 ${merged.qiushi.length} 篇`);
    console.log(`  输出目录：${OUT_DIR}`);
    console.log('='.repeat(56));
}

/** 与历史数据合并去重，保留最新 limit 条 */
function mergeHistory(file, fresh, limit) {
    let old = [];
    if (fs.existsSync(file)) {
        try { old = (JSON.parse(fs.readFileSync(file, 'utf8')).items) || []; } catch (e) { old = []; }
    }
    const map = new Map();
    for (const it of [...fresh, ...old]) {
        const key = it.url || it.title;
        if (!map.has(key)) map.set(key, it);
    }
    return [...map.values()]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, limit);
}

main().catch(e => { console.error('\n致命错误:', e); process.exit(1); });
