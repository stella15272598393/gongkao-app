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

/* 叠加汉典权威核验结果（scripts/verify_idioms.py 生成）：
 * 用权威「解释/出处/示例」覆盖 AI 撰写的释义文本，并标记 verified。
 * 缺失权威数据的条目保留原释义（后续可补跑校验）。
 */
function applyZdicOverlay(items) {
  const cacheFile = path.join(OUT, '_cache', 'idioms_zd.json');
  if (!fs.existsSync(cacheFile)) {
    console.warn('  ⚠️ 未找到汉典核验缓存 content/_cache/idioms_zd.json，跳过 overlay（请先运行 python3 scripts/verify_idioms.py）');
    return { verified: 0, total: items.length };
  }
  const overlay = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let verified = 0;
  for (const x of items) {
    const z = overlay[x.word];
    if (z && z.meaning && z.meaning.length >= 4) {
      x.meaning = z.meaning;
      if (z.source) x.source = z.source;
      if (z.example) x.example = z.example;
      if (z.pinyin && z.pinyin.split(/\s+/).length === (x.word.match(/[一-鿿]/g) || []).length) {
        x.pinyin = z.pinyin;
      }
      x.verified = '汉典';
      verified++;
    }
  }
  return { verified, total: items.length };
}

/* 拼音 sanity 校验：音节数应与汉字数一致，仅告警 */
function checkPinyin(items) {
  const cn = (s) => (s || '').match(/[一-鿿]/g) || [];
  const PINY = /[a-zāáǎàêēéěèîíǐìīĭôōóǒòûūúǔùüǖǘǚǜĀÁǍÀĒÉĚÈÎÍǏÌĪĬÔÓǑÒÛŪÚǓÙÜǕǗǙǛ]/i;
  const syl = (s) => (s || '').trim().split(/[\s']+/).filter(t => PINY.test(t));
  const bad = [];
  for (const x of items) {
    const nCn = cn(x.word).length;
    const nSyl = syl(x.pinyin).length;
    if (nCn !== nSyl) bad.push({ word: x.word, pinyin: x.pinyin, nCn, nSyl });
  }
  return bad;
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
// 叠加汉典权威释义 overlay
const overlayStat = applyZdicOverlay(IDIOMS_FULL);
console.log('  汉典核验覆盖：' + overlayStat.verified + '/' + overlayStat.total + ' 条已采用权威释义');
// 拼音 sanity 校验（仅告警）
const pinyinBad = checkPinyin(IDIOMS_FULL);
if (pinyinBad.length) {
  console.warn('  ⚠️ 拼音音节数疑似异常（需人工复核）：');
  pinyinBad.slice(0, 30).forEach(b => console.warn('     ' + b.word + ' | ' + b.pinyin + ' (汉字' + b.nCn + '/音节' + b.nSyl + ')'));
  if (pinyinBad.length > 30) console.warn('     …（共 ' + pinyinBad.length + ' 条）');
}
write('idioms.json', stamp(IDIOMS_FULL));
/* 注意：idiom-pairs / logic / interview / transitions 为手工维护内容（content/*.json 是唯一真源，
 * 含 v44/v45 的汉典权威核验结果）。切勿在此用 js/data-modules.js 里的常量重写，否则会覆盖
 * 已核验数据、并把混淆配对从 182 组退回 40 组（曾于 v42 因此丢失 142 组）。
 * 若需重建这些模块，请直接编辑 content/*.json，不要用本脚本。 */
console.log('  跳过 idiom-pairs/logic/interview/transitions：以 content/*.json 手工内容为准（含权威核验）');

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
