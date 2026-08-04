/* 读取 js/data-modules.js，生成 content/*.json 远程数据集
 * 用法：node scripts/build_module_data.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'content');
const { IDIOMS_DB, IDIOM_PAIRS_DB, LOGIC_DB, INTERVIEW_DB, TRANSITION_DB, MODULE_META } = require('../js/data-modules.js');

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
write('idioms.json', stamp(IDIOMS_DB));
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
