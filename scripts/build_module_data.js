/* 读取 js/data-modules.js，生成 content/*.json 远程数据集
 * 用法：node scripts/build_module_data.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'content');
const { IDIOMS_DB, IDIOM_PAIRS_DB, LOGIC_DB, INTERVIEW_DB, TRANSITION_DB, MODULE_META } = require('../js/data-modules.js');
const { IDIOMS_EXTRA } = require('../js/idioms_extra.js');
const { IDIOMS_FILLER } = require('../js/idioms_filler.js');

/* 成语库扩展：合并基类(原120) + 新增1080 + 补足若干，按词去重，
 * 重新分级为 必考300 / 高频400 / 低频500，顺号重排，目标 1200 条。
 */
function buildIdioms() {
  const seen = new Set();
  const merged = [];
  for (const x of [...IDIOMS_DB, ...IDIOMS_EXTRA, ...IDIOMS_FILLER]) {
    if (!x || !x.word) continue;
    if (seen.has(x.word)) continue;
    seen.add(x.word);
    merged.push(x);
  }
  // 截取前 1200（补足库足够时恰好 1200）
  const capped = merged.slice(0, 1200);
  // 重新分级
  capped.forEach((x, i) => {
    x.tier = i < 300 ? '必考' : i < 700 ? '高频' : '低频';
    x.id = i + 1;
  });
  return capped;
}

function stamp(items) {
  return {
    updatedAt: new Date().toISOString(),
    updatedAtLocal: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    count: items.length,
    items
  };
}

function write(name, data) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log('  写入 ' + name + ' (' + data.count + ' 条)');
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

console.log('生成模块数据 JSON：');
const IDIOMS_FULL = buildIdioms();
if (IDIOMS_FULL.length !== 1200) {
  console.warn('  ⚠️ 成语总数 = ' + IDIOMS_FULL.length + '（目标 1200），请检查 fillers 是否足够/有重复词');
}
write('idioms.json', stamp(IDIOMS_FULL));
write('idiom-pairs.json', stamp(IDIOM_PAIRS_DB));
write('logic.json', stamp(LOGIC_DB));
write('interview.json', stamp(INTERVIEW_DB));
write('transitions.json', stamp(TRANSITION_DB));

// meta 合并进现有 meta.json（若已有则保留旧字段）
const metaFile = path.join(OUT, 'meta.json');
let meta = {};
try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {}
meta.modules = MODULE_META;
meta.updatedAt = new Date().toISOString();
meta.updatedAtLocal = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
console.log('  更新 meta.json（含 modules 配置）');
console.log('完成。');
