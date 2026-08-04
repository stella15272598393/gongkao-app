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

function writeMeta() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    // ★ 显式转换为北京时间（东八区）：GitHub Actions runner 默认 TZ=UTC，
    //    若直接用 now.getHours() 会写出 UTC 时间（如 16:0x），导致 APP 显示"16点更新"而非"00点更新"
    const bjTime = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const local = `${bjTime.getFullYear()}/${pad(bjTime.getMonth() + 1)}/${pad(bjTime.getDate())} ${pad(bjTime.getHours())}:${pad(bjTime.getMinutes())}:${pad(bjTime.getSeconds())}`;
    const meta = {
        updatedAt: now.toISOString(),
        updatedAtLocal: local,
        todayNew: readCount('shizheng.json') + readCount('qiushi.json') + readCount('renwu.json') + readCount('essays.json') + readCount('quotes.json') + readCount('morning.json'),
        totals: {
            shizheng: readCount('shizheng.json'),
            qiushi: readCount('qiushi.json'),
            renwu: readCount('renwu.json'),
            essays: readCount('essays.json'),
            quotes: readCount('quotes.json'),
            morning: readCount('morning.json')
        }
    };
    fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 1), 'utf8');
    console.log('\n========== meta.json 已更新 ==========');
    console.log(`  时政 ${meta.totals.shizheng} · 求是 ${meta.totals.qiushi} · 人物 ${meta.totals.renwu} · 范文 ${meta.totals.essays} · 金句 ${meta.totals.quotes} · 晨读 ${meta.totals.morning}`);
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
    const ok1 = runSafe('scripts/crawler.js');
    const ok2 = runSafe('scripts/crawler-renwu.js');
    // 金句 / 范文 派生自上面的抓取成果，必须在其后执行
    const ok3 = runSafe('scripts/crawler-quotes.js');
    const ok4 = runSafe('scripts/crawler-essay.js');
    const ok5 = runSafe('scripts/crawler-morning.js');
    writeMeta();
    if (ok1 && ok2 && ok3 && ok4 && ok5) {
        console.log('\n✅ 全部内容抓取完成');
    } else {
        console.log('\n⚠️ 部分内容抓取失败，已保留上次内容，meta.json 仍为最新');
    }
} catch (e) {
    console.error('\n❌ 更新失败：', e.message);
    process.exit(1);
}
