/**
 * 人物素材抓取器
 * ------------------------------------------------------------
 * 目标：为人物素材库提供【真实可查看的官方原文】
 *
 * 两条抓取路线：
 *   1. 定名搜索 —— 对内置经典人物（张富清、黄文秀…）走共产党员网站内搜索，
 *      锁定该人物的官方报道页，抓完整原文
 *   2. 栏目巡航 —— 从「先进典型」栏目持续发现新人物
 *
 * 原文策略：paragraphs / fullText 原样透传，零截断、零改写。
 *          事迹、套用段落、金句全部从原文中【摘取原句】，不做 AI 概括。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ============================================================
 * 内置经典人物名单（走定名搜索，保证素材库主干稳定）
 * ========================================================== */
const NAMED_FIGURES = [
    { name: '张富清', category: 'shidai', categoryName: '时代楷模', hubei: true },
    { name: '黄文秀', category: 'qingnian', categoryName: '青年榜样' },
    { name: '黄旭华', category: 'keyan', categoryName: '科研学者', hubei: true },
    { name: '廖俊波', category: 'jiceng', categoryName: '基层干部' },
    { name: '赵久富', category: 'xiangcun', categoryName: '乡村振兴带头人', hubei: true },
    { name: '桂希恩', category: 'hubei', categoryName: '湖北先进人物', hubei: true },
    { name: '张定宇', category: 'hubei', categoryName: '湖北先进人物', hubei: true },
    { name: '毛相林', category: 'xiangcun', categoryName: '乡村振兴带头人' },
    { name: '黄大年', category: 'keyan', categoryName: '科研学者' },
    { name: '孙家栋', category: 'keyan', categoryName: '科研学者' },
    { name: '王焰新', category: 'keyan', categoryName: '科研学者', hubei: true },
    { name: '吴天一', category: 'keyan', categoryName: '科研学者' },
    { name: '张桂梅', category: 'shidai', categoryName: '时代楷模' },
    { name: '李夏', category: 'jiceng', categoryName: '基层干部' },
    { name: '秦振华', category: 'jiceng', categoryName: '基层干部' },
    { name: '余家军', category: 'hubei', categoryName: '湖北先进人物', hubei: true },
    { name: '孙东林', category: 'hubei', categoryName: '湖北先进人物', hubei: true },
    { name: '甘金华', category: 'hubei', categoryName: '湖北先进人物', hubei: true }
];

/* ============================================================
 * 栏目巡航源
 * ========================================================== */
const SEARCH_URL = q => `https://search.12371.cn/search.php?t=newsmerge&client=no&q=${encodeURIComponent(q)}`;
const ARTI_RE = () => /href="(https?:\/\/[^"]*12371\.cn\/20\d\d\/\d\d\/\d\d\/ARTI[^"]+\.shtml)"/g;

const COLUMN_SOURCES = [
    { name: '共产党员网·先进典型', entry: 'https://www.12371.cn/special/dzby/', max: 20 },
    { name: '共产党员网·首页要闻', entry: 'https://www.12371.cn/', max: 15 },
    // 专题检索式发现：这几个关键词能批量捞出人物专稿
    { name: '七一勋章获得者', entry: SEARCH_URL('七一勋章获得者'), max: 25 },
    { name: '国家荣誉称号获得者', entry: SEARCH_URL('国家荣誉称号获得者'), max: 25 },
    { name: '时代楷模', entry: SEARCH_URL('时代楷模先进事迹'), max: 25 },
    { name: '最美基层干部', entry: SEARCH_URL('最美基层干部'), max: 20 },
    { name: '湖北先进典型', entry: SEARCH_URL('湖北 道德模范 事迹'), max: 20 },
    { name: '乡村振兴带头人', entry: SEARCH_URL('乡村振兴 带头人 事迹'), max: 20 }
].map(s => ({ ...s, referer: 'https://www.12371.cn/', linkRe: ARTI_RE() }));

/* ============================================================
 * HTTP
 * ========================================================== */
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
    if (bad > 20) {
        try { s = new TextDecoder('gb18030').decode(buf); } catch (e) { }
    }
    return s;
}

/* ============================================================
 * 正文提取（与主爬虫同源策略）
 * ========================================================== */
const CONTENT_ANCHORS = ['word_show', 'text_box', 'article-content', 'con_txt', 'rm_txt_zw', 'TRS_Editor', 'content_area', 'artical_content'];
const END_ANCHORS = ['share_con', 'edit_bar', 'copyright', 'foot', 'relevant', 'ewm_box'];
const NOISE_RE = /^(来源|责编|编辑|分享|扫码|点击|相关阅读|原标题|版权|声明|【纠错】|返回|上一篇|下一篇|\(责任编辑|网站声明|违法和不良|共产党员网|发布时间|微信|微博|字号|打印|投稿|我要)/;

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

function extractArticle(html) {
    const rawTitle = ((html.match(/<title>([^<]+)<\/title>/) || [])[1] || '').trim();
    let title = rawTitle.split(/[-_|]{1,2}/)[0].trim();
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) { const t = cleanText(h1[1]); if (t.length >= 4 && t.length <= 80) title = t; }

    const dm = html.match(/20\d\d[-年]\d{1,2}[-月]\d{1,2}/);
    let date = '';
    if (dm) date = dm[0].replace(/年|月/g, '-').replace(/日/, '');

    // 定位正文区
    let start = -1;
    for (const a of CONTENT_ANCHORS) {
        const i = html.indexOf(a);
        if (i >= 0) { start = i; break; }
    }
    if (start < 0) start = 0;
    let end = html.length;
    for (const a of END_ANCHORS) {
        const i = html.indexOf(a, start + 50);
        if (i > start && i < end) end = i;
    }
    const seg = html.slice(start, end);

    let paragraphs = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
        .map(m => cleanText(m[1]))
        .filter(t => t.length > 12 && !NOISE_RE.test(t));

    // 兜底：正文区没抓到就全页扫
    if (paragraphs.length < 3) {
        paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
            .map(m => cleanText(m[1]))
            .filter(t => t.length > 20 && !NOISE_RE.test(t));
    }

    // 去重
    const seen = new Set();
    paragraphs = paragraphs.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });

    return { title, date, paragraphs, fullText: paragraphs.join('\n') };
}

/* ============================================================
 * 素材加工：全部从原文【摘取原句】，不做改写
 * ========================================================== */
const THEME_RULES = [
    { theme: '担当作为', re: /(担当|作为|挺身而出|冲锋|扛起|responsibility|使命)/ },
    { theme: 'initiative', re: /(^$)/ },
    { theme: '奉献牺牲', re: /(奉献|牺牲|无私|付出|舍小家|默默)/ },
    { theme: '基层治理', re: /(基层|社区|村|乡镇|网格|群众工作|一线)/ },
    { theme: '乡村振兴', re: /(乡村振兴|脱贫|扶贫|农村|农民|致富|产业带动)/ },
    { theme: '青年奋斗', re: /(青年|年轻|90后|80后|大学生|接班人|新时代青年)/ },
    { theme: '科技创新', re: /(科研|科技|创新|技术|实验|攻关|自主研发|院士)/ },
    { theme: '初心使命', re: /(初心|使命|信仰|理想信念|党性|入党)/ },
    { theme: '艰苦奋斗', re: /(艰苦|奋斗|拼搏|坚守|克服|困难|咬牙)/ },
    { theme: '为民服务', re: /(为民|服务群众|老百姓|人民至上|办实事|解难题)/ },
    { theme: '生态文明', re: /(生态|环保|绿色|长江|治污|美丽中国)/ },
    { theme: '医疗卫生', re: /(医生|护士|医院|病人|救治|防疫|health)/ },
    { theme: '教育文化', re: /(教师|学校|学生|教育|支教|文化传承)/ },
    { theme: '湖北发展', re: /(湖北|武汉|荆楚|长江经济带|中部崛起|光谷)/ }
];

function pickThemes(text) {
    const hit = THEME_RULES.filter(r => r.re.test(text)).map(r => r.theme);
    return [...new Set(hit)].filter(t => t !== 'initiative').slice(0, 5);
}

/** 摘取最具申论价值的原句（含评价性/精神性表述，长度适中） */
const GOLDEN_RE = /(精神|品格|信念|担当|奉献|初心|使命|坚守|榜样|楷模|情怀|本色|忠诚|无私|平凡|伟大|责任|奋斗)/;

// 次选：有申论价值的评价性/判断性长句
const VALUE_RE = /(始终|一辈子|一生|从未|从不|正是|就是|不仅|更是|越是|哪怕|无论|即便|把.{1,12}当作|用.{1,12}诠释|以.{1,12}为)/;

/** 句子清洗：去掉不成对的引号残片，剔除半截句 */
function tidySentence(t) {
    let s = t.trim();
    // 去掉开头孤立的引号
    s = s.replace(/^["'“”‘’]+/, '').trim();
    // 引号不成对则整体去掉引号
    const dq = (s.match(/[“”"]/g) || []).length;
    if (dq % 2 === 1) s = s.replace(/[“”"]/g, '');
    return s;
}

function extractGolden(paragraphs) {
    const primary = [], secondary = [];
    paragraphs.forEach(p => {
        p.split(/(?<=[。！？])/).forEach(raw => {
            const t = tidySentence(raw);
            if (t.length < 15 || t.length > 90) return;
            if (!/[。！？]$/.test(t)) return;            // 必须是完整句
            if (/^(记者|图为|新华社|本报|来源|摄影|编辑)/.test(t)) return;
            if (GOLDEN_RE.test(t)) primary.push(t);
            else if (VALUE_RE.test(t)) secondary.push(t);
        });
    });
    const merged = [...new Set([...primary, ...secondary])];
    // 优先长度适中（20~60字）的句子，更适合申论直接引用
    merged.sort((a, b) => {
        const score = s => (s.length >= 20 && s.length <= 60 ? 0 : 1);
        return score(a) - score(b);
    });
    return merged.slice(0, 6);
}

/** 事迹：取原文中最具叙事性的段落原句（不改写） */
function extractStory(paragraphs) {
    const cands = paragraphs.filter(p => p.length >= 40 && p.length <= 300 && !/^["'"]/.test(p));
    return cands.slice(0, 2).join(' ') || (paragraphs[0] || '').slice(0, 300);
}

/** 可套用段落：事迹原句 + 金句原句拼接（材料均来自原文） */
function buildParagraph(name, story, goldens) {
    const g = goldens[0] || '';
    const body = story.length > 220 ? story.slice(0, 220) + '……' : story;
    return `${body}${g ? ' ' + g : ''}`;
}

/* ============================================================
 * 人物名识别（用于栏目巡航发现新人物）
 * ========================================================== */
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const NAME_RE = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, 'g');

/**
 * 严格人名识别
 * 核心规则：人名【必须出现在标题中】，且左右两侧是分隔符边界。
 * 这一条能砍掉绝大多数误判 —— "从严治党"里的"严治党"、
 * "培养造就一支高素质县委书记队伍"里的"高素质"，
 * 因为它们左侧紧贴的是普通汉字而非分隔符。
 */
// 模式A：人名左右均为分隔符边界（含全角竖线｜、间隔号·）
const TITLE_NAME_RE = new RegExp(
    `(?:^|[|｜丨:：、，,—·\\-\\s《（(“”"'‘’])([${SURNAMES}][\\u4e00-\\u9fa5]{1,2})(?=[：:，,、|｜丨\\s“”"'‘’）)》—]|$)`,
    'g'
);

// 模式B：「职务/称谓 + 人名：」格式，右侧冒号是强信号
//   例：“七一勋章”获得者丨人民调解员马善祥：做群众需要的人
const TITLE_NAME_COLON_RE = new RegExp(
    `([${SURNAMES}][\\u4e00-\\u9fa5]{1,2})(?=[：:])`,
    'g'
);

// 领导人 / 地名 / 常见词误伤名单
const EXCLUDE_NAME = /^(习近平|李强|赵乐际|王沪宁|蔡奇|丁薛祥|李希|韩正|马克思|恩格斯|列宁|毛泽东|邓小平|江泽民|胡锦涛|中国|中央|人民|方向|方面|方法|高质量|高水平|高素质|严治党|于深化|向党中|史充分|龙头|周年|万元|万人|石油|叶片|白色|江苏|江西|陆续|田间|董事|任务|严格|向上|金融|金句|余人|余年|余万|程度|苏区|吕梁|沈阳|夏季|付出|方式|白天|孟子|熊猫|秦岭|江河|段落|雷锋|龙江|史书|陶瓷|黎明|贺卡|顾问|毛病|万里|钱塘|严肃|武汉|孔子|向阳|全过程|新时代|新征程|新发展|党中央|总书记|国务院|全社会|各地区)$/;

function detectPersonName(title, paragraphs) {
    const text = paragraphs.join('');
    TITLE_NAME_RE.lastIndex = 0;
    TITLE_NAME_COLON_RE.lastIndex = 0;

    const cands = [
        ...[...title.matchAll(TITLE_NAME_RE)].map(m => m[1]),
        ...[...title.matchAll(TITLE_NAME_COLON_RE)].map(m => m[1])
    ];

    // 按正文出现频次排序，取最主要的那位
    const scored = [...new Set(cands)]
        .filter(n => n.length >= 2 && !EXCLUDE_NAME.test(n))
        .map(n => ({ n, c: (text.match(new RegExp(n, 'g')) || []).length }))
        .sort((a, b) => b.c - a.c);

    for (const { n, c } of scored) {
        // 正文至少提 4 次，确认是报道主角而非顺带提及
        if (c >= 4) return n;
    }
    return null;
}

function guessCategory(name, text) {
    // 湖北本土优先（用户重点关注省考）—— 需强信号，避免顺带提及
    const hbHits = (text.match(/湖北|武汉|荆楚|宜昌|襄阳|荆州|黄冈|十堰|孝感|恩施/g) || []).length;
    if (hbHits >= 3) return { category: 'hubei', categoryName: '湖北先进人物' };

    if (/科研|科学家|院士|实验室|技术攻关|自主研发|总设计师|教授/.test(text))
        return { category: 'keyan', categoryName: '科研学者' };
    if (/乡村振兴|脱贫攻坚|驻村|村支书|村党支部|第一书记|带领村民/.test(text))
        return { category: 'xiangcun', categoryName: '乡村振兴带头人' };
    // 青年判定严格化：泛用的"青年"二字不算
    if (/90后|00后|85后|年轻干部|大学生村官|青年突击队|青年榜样/.test(text))
        return { category: 'qingnian', categoryName: '青年榜样' };
    if (/时代楷模|全国道德模范|最美奋斗者|七一勋章|共和国勋章|国家荣誉称号|英雄模范/.test(text))
        return { category: 'shidai', categoryName: '时代楷模' };
    return { category: 'jiceng', categoryName: '基层干部' };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
 * 路线1：定名搜索
 * ========================================================== */
async function crawlNamed(fig) {
    let html;
    try {
        html = await request(SEARCH_URL(fig.name), 'https://www.12371.cn/');
    } catch (e) {
        return null;
    }

    // 搜索结果里挑文章页（排除视频页 VIDE）
    const links = [...new Set(
        [...html.matchAll(/href="(https?:\/\/[^"]*12371\.cn\/20\d\d\/\d\d\/\d\d\/ARTI[^"]+\.shtml)"/g)].map(m => m[1])
    )];
    if (!links.length) return null;

    // 全部候选打分，挑最像"人物专稿"的那篇
    const cands = [];
    for (const url of links.slice(0, 6)) {
        try {
            const page = await request(url, 'https://www.12371.cn/');
            const art = extractArticle(page);
            if (!art.title || art.fullText.length < 600) continue;
            const cnt = (art.fullText.match(new RegExp(fig.name, 'g')) || []).length;
            if (cnt < 3) continue;

            let score = cnt * 2;
            if (art.title.includes(fig.name)) score += 100;          // 标题点名 = 人物专稿
            if (art.fullText.length >= 800 && art.fullText.length <= 9000) score += 40;
            if (/(通知|会议|印发|决定|公告|名单|投票|评选活动)/.test(art.title)) score -= 80; // 公文类降权
            cands.push({ url, art, cnt, score });
        } catch (e) { /* 下一条 */ }
        await sleep(280);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    // 硬门槛：最优候选的标题必须点到这个人，否则宁缺毋滥
    if (!cands[0].art.title.includes(fig.name)) return null;

    {
        const { url, art } = cands[0];
        {
            const goldens = extractGolden(art.paragraphs);
            const story = extractStory(art.paragraphs);
            return {
                id: 'rw_' + Buffer.from(fig.name).toString('hex').slice(0, 12),
                name: fig.name,
                category: fig.category,
                categoryName: fig.categoryName,
                story,
                themes: pickThemes(art.fullText),
                paragraph: buildParagraph(fig.name, story, goldens),
                goldenSentence: goldens[0] || '',
                goldenSentences: goldens,
                source: '共产党员网',
                date: art.date || '',
                hasOriginalLink: true,
                originalUrl: url,
                searchUrl: SEARCH_URL(fig.name),
                articleTitle: art.title,
                paragraphs: art.paragraphs,
                fullText: art.fullText,
                wordCount: art.fullText.length,
                crawledAt: new Date().toISOString()
            };
        }
    }
}

/* ============================================================
 * 路线2：栏目巡航
 * ========================================================== */
async function crawlColumn(src, knownNames) {
    const out = [];
    let indexHtml;
    try { indexHtml = await request(src.entry, src.referer); }
    catch (e) { console.log(`  [${src.name}] 入口失败: ${e.message}`); return out; }

    const urls = [...new Set([...indexHtml.matchAll(src.linkRe)].map(m => m[1]))].slice(0, src.max);
    let ok = 0;
    for (const url of urls) {
        try {
            const html = await request(url, src.referer);
            const art = extractArticle(html);
            if (!art.title || art.fullText.length < 700) continue;

            const name = detectPersonName(art.title, art.paragraphs);
            if (!name || knownNames.has(name)) continue;

            // 必须是人物报道：该名字出现足够多次
            const cnt = (art.fullText.match(new RegExp(name, 'g')) || []).length;
            if (cnt < 4) continue;

            const cat = guessCategory(name, art.fullText);
            const goldens = extractGolden(art.paragraphs);
            const story = extractStory(art.paragraphs);
            if (!goldens.length && story.length < 60) continue;

            knownNames.add(name);
            out.push({
                id: 'rw_' + Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-14),
                name,
                category: cat.category,
                categoryName: cat.categoryName,
                story,
                themes: pickThemes(art.fullText),
                paragraph: buildParagraph(name, story, goldens),
                goldenSentence: goldens[0] || '',
                goldenSentences: goldens,
                source: src.name,
                date: art.date || '',
                hasOriginalLink: true,
                originalUrl: url,
                searchUrl: SEARCH_URL(name),
                articleTitle: art.title,
                paragraphs: art.paragraphs,
                fullText: art.fullText,
                wordCount: art.fullText.length,
                crawledAt: new Date().toISOString()
            });
            ok++;
            process.stdout.write(`\r  [${src.name}] 发现人物 ${ok} 位`);
            await sleep(300);
        } catch (e) { /* skip */ }
    }
    console.log(`\r  [${src.name}] 完成：新增 ${ok} 位`);
    return out;
}

/* ============================================================
 * 主流程
 * ========================================================== */
async function main() {
    console.log('='.repeat(56));
    console.log('  人物素材抓取（真实官方原文）');
    console.log('='.repeat(56));

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const results = [];
    const known = new Set();

    console.log('\n【路线1】定名搜索经典人物');
    for (const fig of NAMED_FIGURES) {
        process.stdout.write(`  搜索 ${fig.name} ... `);
        const r = await crawlNamed(fig);
        if (r) {
            results.push(r);
            known.add(fig.name);
            console.log(`✓ ${r.wordCount}字 · ${r.articleTitle.slice(0, 24)}`);
        } else {
            console.log('未找到合适原文');
        }
        await sleep(400);
    }

    console.log('\n【路线2】栏目巡航发现新人物');
    for (const src of COLUMN_SOURCES) {
        const items = await crawlColumn(src, known);
        results.push(...items);
    }

    // 合并历史
    const file = path.join(OUT_DIR, 'renwu.json');
    let old = [];
    if (fs.existsSync(file)) {
        try { old = JSON.parse(fs.readFileSync(file, 'utf8')).items || []; } catch (e) { }
    }
    const map = new Map();
    for (const it of [...results, ...old]) {
        if (!map.has(it.name)) map.set(it.name, it);
    }
    const merged = [...map.values()].slice(0, 120);

    fs.writeFileSync(file, JSON.stringify({
        updatedAt: new Date().toISOString(),
        count: merged.length,
        items: merged
    }, null, 1), 'utf8');

    console.log('\n' + '='.repeat(56));
    console.log(`  本次抓取：${results.length} 位   库存总计：${merged.length} 位`);
    const byCat = {};
    merged.forEach(m => byCat[m.categoryName] = (byCat[m.categoryName] || 0) + 1);
    console.log('  分类分布：' + Object.entries(byCat).map(([k, v]) => k + ' ' + v).join('  '));
    console.log('='.repeat(56));
}

main().catch(e => { console.error('\n致命错误:', e); process.exit(1); });
