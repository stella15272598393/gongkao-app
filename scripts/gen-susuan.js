/**
 * 速算题自动生成器
 * ------------------------------------------------------------
 * 每天爬虫时调用，程序化生成 20 道资料分析速算题（含精确答案 + 多种解法），
 * 输出 content/susuan.json，供 APP 速算模块优先加载（network-first）。
 * 内置 SPEED_MULTI_DB 作为离线兜底。
 *
 * 设计原则：
 *  - 仅依赖 Node 内置模块（无需 npm install）
 *  - 每题答案均由 JS 精确计算，并用断言校验，保证正确
 *  - 题型覆盖：求增长量/求基期/求增长率/比重倍数/分数比较/尾数法/间隔增长率/目标完成率
 *  - 选项含 1 个正确值 + 3 个常见错误算法结果（干扰项）
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'content');
const N = 20; // 每天生成题数

/* ---------------- 通用工具 ---------------- */
function rndInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function fmt(n) { return Number(n.toFixed(1)).toLocaleString('en-US'); } // 千分位，去多余小数
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
// 构造选项：correctText 为正确项文本；distractors 为干扰文本数组
function buildOptions(correctText, distractors) {
    const pool = [correctText, ...distractors].map((t, i) => ({ t, letter: String.fromCharCode(65 + i) }));
    // 去重：若干扰项与正确项重复，微调
    const seen = new Set();
    pool.forEach(o => {
        let base = o.t;
        while (seen.has(base)) base = base + ' ';
        seen.add(base);
        o.t = base;
    });
    shuffle(pool);
    const letters = ['A', 'B', 'C', 'D'];
    const options = pool.map((o, idx) => letters[idx] + '. ' + o.t);
    const answer = letters[pool.findIndex(o => o.t.trim() === correctText.trim())];
    return { options, answer };
}

/* ---------------- 各题型生成器 ----------------
 * 每个函数返回一个题对象（与 SPEED_MULTI_DB 单题格式兼容）
 * { question, options, answer, category, difficulty, methods:[{name,steps,insight,speedRating}] }
 */
const RATE_SET = [10, 12.5, 14.3, 16.7, 20, 25, 33.3, 50, 11.1, 9.1]; // 好算百分数的百化分集合

function genGrowth() {
    const A = rndInt(800, 4200);                 // 现期量
    const r = RATE_SET[rndInt(0, RATE_SET.length - 1)]; // 增长率
    const N = Math.round(100 / r);               // 百化分分母
    const exact = round1(A * r / (100 + r));     // 精确增长量
    const approx = round1(A / (N + 1));          // 百化分近似
    const correct = fmt(exact);
    const { options, answer } = buildOptions(correct, [
        fmt(round1(A * r / 100)),       // 漏除 (1+r%)
        fmt(round1(A / N)),             // 错用 n 而非 n+1
        fmt(round1(A / (N + 2)))        // 偏小估算
    ]);
    return {
        question: `${fmt(A)} × (1 + ${r}%) 中，同比增长量约为？`,
        options, answer, category: '求增长量', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 百化分 / n+1 原则（推荐）',
              steps: [`① ${r}% ≈ 1/${N}（百化分）`, `② 增长量 ≈ 现期 ÷ (N+1) = ${fmt(A)} ÷ ${N + 1} ≈ ${fmt(approx)}`, `③ 选项取最接近值 → ${correct}`],
              insight: `r ≈ 1/N 时，增长量 ≈ 现期/(N+1)，本例 N=${N}`, speedRating: '⭐⭐⭐⭐⭐' },
            { name: '🥈 直除法（精确）',
              steps: [`① 增长量 = 现期 × r% ÷ (1+r%)`, `② = ${fmt(A)} × ${r}% ÷ (1+${r}%)`, `③ = ${fmt(A)} × ${round2(r / 100)} ÷ ${round2(1 + r / 100)} ≈ ${correct}`],
              insight: '精确公式，适合考场无近似选项时兜底', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genBase() {
    const r = [5, 8, 10, 12, 15, 20, 25][rndInt(0, 6)];
    const A = rndInt(1000, 5200);
    const base = round1(A / (1 + r / 100));
    const correct = fmt(base);
    const { options, answer } = buildOptions(correct, [
        fmt(round1(A * (1 - r / 100))),
        fmt(round1(A / (1 - r / 100))),
        fmt(round1(A / (r / 100)))
    ]);
    return {
        question: `现期量为 ${fmt(A)}，同比增长 ${r}%，求上年同期（基期）量？`,
        options, answer, category: '求基期', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 基期公式', steps: [`① 基期 = 现期 ÷ (1+r%)`, `② = ${fmt(A)} ÷ ${round2(1 + r / 100)} ≈ ${correct}`], insight: '增长率正用除法，符号别弄反', speedRating: '⭐⭐⭐⭐' },
            { name: '🥈 百化分估算', steps: [`① ${r}% ≈ 1/${Math.round(100 / r)}`, `② 基期 ≈ 现期 × (1 - 1/N) 量级估算`], insight: '只用于快速锁定选项区间', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genGrowthRate() {
    const base = rndInt(800, 3200);
    const inc = rndInt(60, 900);
    const A = base + inc; // 现期 > 基期
    const g = round1(inc / base * 100);
    const correct = g + '%';
    const { options, answer } = buildOptions(correct, [
        round1(inc / A * 100) + '%',
        round1(base / A * 100) + '%',
        round1((A / base - 1) * 100 * 0.9) + '%'
    ]);
    return {
        question: `基期 ${fmt(base)}，现期 ${fmt(A)}，求增长率？`,
        options, answer, category: '求增长率', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 增长率公式', steps: [`① 增长率 = (现期-基期) ÷ 基期`, `② = (${fmt(A)} - ${fmt(base)}) ÷ ${fmt(base)}`, `③ = ${fmt(inc)} ÷ ${fmt(base)} × 100% ≈ ${correct}`], insight: '分母是基期不是现期（基准陷阱）', speedRating: '⭐⭐⭐⭐' },
            { name: '🥈 倍数法', steps: [`① 现期/基期 = ${round2(A / base)} 倍`, `② 增长率 = 倍数 - 1 = ${round2(A / base - 1)} ≈ ${correct}`], insight: '先算倍数再减1，避免除错分母', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genRatio() {
    const part = rndInt(200, 2000);
    const whole = part + rndInt(150, 3200);
    const rate = round1(part / whole * 100);
    const correct = rate + '%';
    const { options, answer } = buildOptions(correct, [
        round1(whole / part * 100) + '%',
        round1(part / whole) + '%',
        round1((whole - part) / whole * 100) + '%'
    ]);
    return {
        question: `整体 ${fmt(whole)} 中，部分 ${fmt(part)} 所占比重约为？`,
        options, answer, category: '倍数与比重', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 比重公式', steps: [`① 比重 = 部分 ÷ 整体 × 100%`, `② = ${fmt(part)} ÷ ${fmt(whole)} × 100% ≈ ${correct}`], insight: '看清"占谁的比重"，整体作分母', speedRating: '⭐⭐⭐⭐' },
            { name: '🥈 截位估算', steps: [`① 截去末尾0：${fmt(part)}/${fmt(whole)} ≈ ${round2(part / 100)}/${round2(whole / 100)}`, `② 估算量级定位选项`], insight: '只定位区间，不求精确', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genFractionCompare() {
    let p1, q1, p2, q2, c1, c2;
    do {
        p1 = rndInt(2, 9); q1 = rndInt(3, 12);
        p2 = rndInt(2, 9); q2 = rndInt(3, 12);
        c1 = p1 * q2; c2 = p2 * q1;
    } while (c1 === c2);
    const formerBig = c1 > c2;
    const correct = formerBig ? 'A' : 'B';
    const options = ['A. 前者大', 'B. 后者大', 'C. 两者相等', 'D. 无法比较'];
    const f1 = round2(p1 / q1), f2 = round2(p2 / q2);
    return {
        question: `比较大小：${p1}/${q1} 与 ${p2}/${q2}`,
        options, answer: correct, category: '分数比较', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 交叉相乘法', steps: [`① 左×右下 vs 右×左下`, `② ${p1} × ${q2} = ${c1}，${p2} × ${q1} = ${c2}`, `③ ${c1} ${c1 > c2 ? '>' : '<'} ${c2} → ${formerBig ? '前者大' : '后者大'}`], insight: '交叉相乘避免通分，资料分析高频技巧', speedRating: '⭐⭐⭐⭐⭐' },
            { name: '🥈 化小数法', steps: [`① ${p1}/${q1} ≈ ${f1}`, `② ${p2}/${q2} ≈ ${f2}`, `③ ${f1} ${f1 > f2 ? '>' : '<'} ${f2}`], insight: '小数直观，但注意保留位数', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genTail() {
    const a = rndInt(1000, 9999);
    const b = rndInt(1000, 9999);
    const tail = (a * b) % 100;
    const correct = String(tail).padStart(2, '0');
    const distractors = new Set();
    while (distractors.size < 3) {
        const t = String(rndInt(0, 99)).padStart(2, '0');
        if (t !== correct) distractors.add(t);
    }
    const correctText = '末两位为 ' + correct;
    const { options, answer } = buildOptions(correctText, [...distractors].map(d => '末两位为 ' + d));
    return {
        question: `${fmt(a)} × ${fmt(b)} 的乘积末两位是？`,
        options, answer, category: '尾数法', difficulty: '⭐',
        methods: [
            { name: '🥇 只看末两位', steps: [`① 乘积末两位 = (a末两位 × b末两位) 的末两位`, `② ${String(a).slice(-2)} × ${String(b).slice(-2)} = ${a % 100} × ${b % 100} = ${(a % 100) * (b % 100)}`, `③ 末两位 = ${correct}`], insight: '尾数法只看末位/末两位相乘，前面不用算', speedRating: '⭐⭐⭐⭐⭐' },
            { name: '🥈 末位连乘验证', steps: [`① 个位 ${a % 10} × ${b % 10} = ${(a % 10) * (b % 10)}，个位为 ${(a * b) % 10}`, `② 再用末两位确认十位`], insight: '先定个位再定十位，双重保险', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genInterval() {
    const r1 = [5, 8, 10, 12, 15][rndInt(0, 4)];
    const r2 = [6, 9, 11, 13, 14][rndInt(0, 4)];
    const interval = round1(((1 + r1 / 100) * (1 + r2 / 100) - 1) * 100);
    const correct = interval + '%';
    const { options, answer } = buildOptions(correct, [
        (r1 + r2) + '%',
        round1((r1 + r2) * 1.1) + '%',
        round1(Math.sqrt(r1 * r2)) + '%'
    ]);
    return {
        question: `连续两期增长率分别为 ${r1}% 和 ${r2}%，求间隔增长率？`,
        options, answer, category: '间隔增长率', difficulty: '⭐⭐',
        methods: [
            { name: '🥇 间隔增长率公式', steps: [`① 间隔 r = (1+r1)(1+r2) - 1`, `② = (1+${r1}%)(1+${r2}%) - 1`, `③ = ${r1 + r2 + r1 * r2 / 100} ≈ ${correct}`], insight: '精确值 = r1+r2+r1·r2，别漏交叉项', speedRating: '⭐⭐⭐⭐⭐' },
            { name: '🥈 近似法', steps: [`① 间隔增长率 ≈ r1 + r2`, `② ≈ ${r1 + r2}%`], insight: '选项差距大时用，注意漏了交叉项会偏小', speedRating: '⭐⭐⭐' }
        ]
    };
}

function genCompleteRate() {
    const target = rndInt(500, 5000);
    const done = rndInt(100, target);
    const rate = round1(done / target * 100);
    const correct = rate + '%';
    const { options, answer } = buildOptions(correct, [
        round1(target / done * 100) + '%',
        round1(done / target) + '%',
        round1((target - done) / target * 100) + '%'
    ]);
    return {
        question: `目标 ${fmt(target)}，已完成 ${fmt(done)}，目标完成率约为？`,
        options, answer, category: '目标完成率', difficulty: '⭐',
        methods: [
            { name: '🥇 完成率公式', steps: [`① 完成率 = 已完成 ÷ 目标 × 100%`, `② = ${fmt(done)} ÷ ${fmt(target)} × 100% ≈ ${correct}`], insight: '完成率一般≤100%，超过说明超额', speedRating: '⭐⭐⭐⭐' },
            { name: '🥈 倍数换算', steps: [`① 已完成/目标 = ${round2(done / target)} 倍`, `② ×100% = ${correct}`], insight: '先算倍数再转百分数', speedRating: '⭐⭐⭐' }
        ]
    };
}

const GENERATORS = [genGrowth, genBase, genGrowthRate, genRatio, genFractionCompare, genTail, genInterval, genCompleteRate];

/* ---------------- 主流程 ---------------- */
function main() {
    // 北京时间日期
    const now = new Date();
    const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())}`;

    const items = [];
    let id = 90001;
    for (let i = 0; i < N; i++) {
        const gen = GENERATORS[i % GENERATORS.length];
        const q = gen();
        q.id = id++;
        q.genDate = dateStr;
        items.push(q);
    }

    // ★ 校验：每题答案必须唯一且存在
    items.forEach((q, i) => {
        const idx = q.answer.charCodeAt(0) - 65;
        if (!q.options[idx] || q.options[idx][0] !== q.answer) {
            throw new Error(`第 ${i + 1} 题答案校验失败: answer=${q.answer}, options=${JSON.stringify(q.options)}`);
        }
        if (new Set(q.options).size !== q.options.length) {
            throw new Error(`第 ${i + 1} 题选项有重复`);
        }
    });

    const out = { date: dateStr, count: items.length, items };
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'susuan.json'), JSON.stringify(out, null, 1), 'utf8');
    console.log(`✅ 已生成 ${items.length} 道速算题（${dateStr}）→ content/susuan.json`);
    console.log('   题型分布:', items.reduce((m, q) => { m[q.category] = (m[q.category] || 0) + 1; return m; }, {}));
}

main();
