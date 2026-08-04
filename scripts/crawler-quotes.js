/**
 * 金句库抓取器（离线聚合版）
 * ------------------------------------------------------------
 * 目标：让「申论 · 金句库」每天自动更新，和时政/求是网同步刷新。
 *
 * 策略：金句天生就藏在每日爬取的时政/求是文章里——
 *   每篇文章的 analysis 已抽取出：
 *     - goldenSentences  申论金句（原文原句）
 *     - policyExpressions 规范表述
 *     - measures          对策模板
 *   本脚本把这些【原文原句】跨全部文章聚合成金句库，按 8 大申论主题分类，
 *   去重后写出 content/quotes.json。无需任何额外联网。
 *
 * 说明：完全复用 crawler.js 抓取成果，不新增网络请求，CI 中零失败风险。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'content');

/* 与 index.html 金句筛选器、QUOTES_DB 完全对齐的 8 大主题 */
const THEMES = {
    jiceng: '基层治理',
    xiangcun: '乡村振兴',
    qingnian: '青年奋斗',
    shengtai: '生态文明',
    minsheng: '民生医疗',
    wenhua: '文化传承',
    fazhi: '法治建设',
    hubei: '湖北地域发展'
};

/* 每个主题的判定关键词（命中越多越优先） */
const THEME_KEYWORDS = {
    jiceng: ['基层', '社区', '网格', '治理', '干部', '一线', '群众工作', '街', '村', '乡镇'],
    xiangcun: ['乡村', '振兴', '农业', '农民', '农村', '脱贫', '扶贫', '产业', '致富'],
    qingnian: ['青年', '青春', '年轻', '奋斗', '新时代青年', '接力', '团员'],
    shengtai: ['生态', '绿色', '环保', '长江', '环境', '美丽中国', '污染', '低碳'],
    minsheng: ['民生', '健康', '医疗', '社保', '就业', '百姓', '群众', '教育', '养老', '住房'],
    wenhua: ['文化', '文物', '传统', '自信', '文艺', '精神', '文明', '传承'],
    fazhi: ['法治', '法律', '司法', '公平', '正义', '立法', '执法', '宪法'],
    hubei: ['湖北', '武汉', '荆楚', '长江经济带', '中部', '光谷', '汉江']
};

function classify(text) {
    let best = null, bestScore = 0;
    for (const [theme, kws] of Object.entries(THEME_KEYWORDS)) {
        let s = 0;
        for (const k of kws) if (text.includes(k)) s += 1;
        if (s > bestScore) { bestScore = s; best = theme; }
    }
    return { theme: best, score: bestScore };
}

/** 文章级主题：优先湖北方向，其次用标题/标签/关键词综合判定 */
function articleTheme(it) {
    if (it.direction === '湖北') return 'hubei';
    const blob = [
        it.title || '',
        (it.tags || []).join(' '),
        (it.keywordsGuokao || []).join(' '),
        (it.keywordsHubei || []).join(' ')
    ].join(' ');
    const r = classify(blob);
    return r.theme || 'jiceng';
}

/** 稳定 id：基于文本哈希，保证跨天去重与收藏夹 key 稳定 */
function stableId(prefix, text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = (h * 31 + text.charCodeAt(i)) >>> 0;
    }
    return prefix + '_' + h.toString(36);
}

function cleanSentence(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
}

function main() {
    console.log('='.repeat(56));
    console.log('  金句库聚合（来自每日时政/求是文章原句）');
    console.log('='.repeat(56));

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const sources = ['shizheng.json', 'qiushi.json'];
    const quotes = [];
    const seen = new Set();

    for (const file of sources) {
        const fp = path.join(OUT_DIR, file);
        if (!fs.existsSync(fp)) continue;
        let data;
        try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
        const items = data.items || [];
        for (const it of items) {
            const a = it.analysis || {};
            const baseTheme = articleTheme(it);
            const buckets = [
                ...(a.goldenSentences || []).map(s => ({ t: s, kind: '金句' })),
                ...(a.policyExpressions || []).map(s => ({ t: s, kind: '规范表述' })),
                ...(a.measures || []).map(s => ({ t: s, kind: '对策模板' }))
            ];
            for (const b of buckets) {
                const text = cleanSentence(b.t);
                if (text.length < 12 || text.length > 160) continue;
                const id = stableId('q', text);
                if (seen.has(id)) continue;
                seen.add(id);
                // 句子自身关键词命中更准；否则沿用文章主题
                const hit = classify(text);
                const theme = hit.score > 0 ? hit.theme : baseTheme;
                quotes.push({
                    id,
                    theme,
                    themeName: THEMES[theme],
                    kind: b.kind,
                    text,
                    source: it.source || '官方媒体',
                    // 透传原文链接：文章本身带有 url 字段，金句即可「查看原文」直接跳转
                    url: it.url || '',
                    category: THEMES[theme]
                });
            }
        }
    }

    // 按主题均衡取样：每类上限，避免某一主题（如基层治理）把其他主题挤掉
    const MAX_PER_THEME = 12;
    const byTheme = {};
    quotes.forEach(q => { (byTheme[q.theme] = byTheme[q.theme] || []).push(q); });
    let balanced = [];
    for (const th of Object.keys(THEMES)) {
        balanced = balanced.concat((byTheme[th] || []).slice(0, MAX_PER_THEME));
    }

    const file = path.join(OUT_DIR, 'quotes.json');
    const old = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).items || []) : [];
    const mergedMap = new Map();
    // 新数据优先：相同 id 以本次分类为准
    for (const q of [...balanced, ...old]) {
        if (!mergedMap.has(q.id)) mergedMap.set(q.id, q);
    }
    const merged = [...mergedMap.values()].slice(0, 55);

    fs.writeFileSync(file, JSON.stringify({
        updatedAt: new Date().toISOString(),
        count: merged.length,
        items: merged
    }, null, 1), 'utf8');

    const dist = {};
    merged.forEach(q => dist[q.themeName] = (dist[q.themeName] || 0) + 1);
    console.log('\n' + '='.repeat(56));
    console.log(`  本次新增 ${quotes.length} 条 · 均衡入选 ${balanced.length} 条 · 库存总计 ${merged.length} 条`);
    console.log('  主题分布：' + Object.entries(dist).map(([k, v]) => k + ' ' + v).join('  '));
    console.log('='.repeat(56));
}

main();
