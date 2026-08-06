#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
成语权威核验脚本（汉典 zdic.net 作权威源）

- 对 idioms.json 中每条成语抓取汉典成语页
- 抽取 解释(释义) / 出处(来源) / 示例(例句) 三个权威字段
- 结果缓存到 content/_cache/idioms_zd.json，作为构建管线 overlay
- 支持断点续跑（已缓存的跳过），礼貌限速 + 失败退避

用法:
  python3 scripts/verify_idioms.py            # 全量
  python3 scripts/verify_idioms.py --limit 15 # 抽样前15条
  python3 scripts/verify_idioms.py --force    # 忽略缓存重抓
"""
import os, sys, re, json, time, argparse, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDIOMS_JSON = os.path.join(ROOT, 'content', 'idioms.json')
CACHE_DIR = os.path.join(ROOT, 'content', '_cache')
CACHE_JSON = os.path.join(CACHE_DIR, 'idioms_zd.json')

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

def fetch(word):
    url = 'https://zdic.net/hans/' + urllib.parse.quote(word)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode('utf-8', errors='ignore')

def extract(html, word, depth=0):
    """返回 (meaning, source, example, pinyin)
    兼容三种汉典模板：
      A) idiom-entry__line 区块（解释/出处/示例），含经典成语完整词条
      C) 词语解释模板（拼音+注音+释义+书证），覆盖大量成语/词语
      B) JSON-LD description（兜底）
    对纯重定向词条（如「见『一脉相传』」）自动跟随到目标词条取其权威释义。
    """
    _CUR_WORD = word
    meaning = source = example = pinyin = None

    # ---------- 模板 A：idiom-entry ----------
    blocks = re.findall(
        r'idiom-entry__line[^>]*>\s*<span class="idiom-entry__label">([^<]+)</span>\s*'
        r'<span class="idiom-entry__text">(.*?)</span>', html, re.S)
    for label, txt in blocks:
        clean = re.sub(r'<[^>]+>', '', txt).strip()
        clean = clean.replace('\u3000', ' ').strip()
        if label == '解释' and len(clean) >= 4:
            meaning = clean
        elif label == '出处' and len(clean) >= 2:
            source = clean
        elif label == '示例' and len(clean) >= 2:
            example = clean

    if meaning:
        return meaning, source, example, pinyin

    # ---------- 模板 C：词语解释（拼音/注音 直接跟在词目后，或带「拼音」标签） ----------
    h = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    h = re.sub(r'<style[^>]*>.*?</style>', '', h, flags=re.S)
    txt = re.sub(r'<[^>]+>', ' ', h)
    txt = re.sub(r'\s+', ' ', txt).strip()
    BOPO = r'[ㄅ-ㄪㄫ-ㄬㄱ-ㄺㄻ-ㄿㅀ-ㅄㅇ-ㅣ]+'
    PINY = r'[a-zāáǎàêēéěèîíǐìīĭôōóǒòûūúǔùüǖǘǚǜĀÁǍÀĒÉĚÈÎÍǏÌĪĬÔÓǑÒÛŪÚǓÙÜǕǗǙǛ]+'
    PINYRUN = PINY + r'(?:\s+' + PINY + r'){1,6}'

    def _clean(s):
        s = re.sub(BOPO, '', s)
        s = re.sub(r'\[\[.*?\]\]', '', s)
        s = re.sub(r'[a-zA-Z]', '', s)
        s = re.sub(r'[ˉˊˇˋ\u02c9\u02ca\u02cb\u02cc·]', '', s)
        s = re.sub(r'\s+', '', s).strip('，。、（）()｜|\'\"')
        return s.replace(',', '，').replace(':', '：')

    # 锚定真实词条块：以「词语解释 + 词目」为入口，其后的窗口内应出现拼音/注音
    entry = -1
    for m in re.finditer(r'词语解释\s*' + re.escape(_CUR_WORD), txt):
        seg = txt[m.end():m.end() + 200]
        if re.search(r'拼音\s*' + PINY, seg) or re.search(BOPO, seg) or re.search(PINYRUN, seg):
            entry = m.end(); break
    # 兜底：词目后直接跟拼音/注音（无「词语解释」标签）
    if entry < 0:
        for m in re.finditer(re.escape(_CUR_WORD), txt):
            seg = txt[m.end():m.end() + 200]
            if re.search(r'拼音\s*' + PINY, seg) or re.search(BOPO, seg) or re.search(r'^\s*' + PINYRUN, seg):
                entry = m.end(); break

    if entry >= 0:
        body = txt[entry:]
        # 抽取拼音（可能无「拼音」标签，拼音音节直接出现在词目后）
        pm = re.search(r'(?:拼音\s*)?(' + PINYRUN + r')', body[:200])
        if pm:
            pinyin = pm.group(1).strip()
            phon_end = pm.end()
        else:
            bm = re.search(BOPO + r'+', body[:200])
            phon_end = bm.end() if bm else 0
        # 释义：从拼音/注音后，到最早的结束关键词（取最小位置，而非列表顺序首个）
        cut = len(body)
        for kw in ['英文', '反馈', '书证', '例句', '近义词', '反义词', '翻译']:
            j = body.find(kw, phon_end)
            if j > 0:
                cut = min(cut, j)
        mean_seg = body[phon_end:cut]
        # 截断到「例如/如：/见“」避免混入例句或异体重定向
        for kw in ['例如', '如：', '如"', '如“', '见“', '见"']:
            k = mean_seg.find(kw)
            if k > 3:
                mean_seg = mean_seg[:k]; break
        meaning = _clean(mean_seg) if len(_clean(mean_seg)) >= 4 else None
        # 书证 → 出处/权威例句
        shu = body.find('书证', phon_end)
        if shu > 0:
            end = len(body)
            for kw in ['英文', '反馈', '近义词', '反义词', '翻译', '例句']:
                j = body.find(kw, shu)
                if j > 0:
                    end = min(end, j)
            source = _clean(body[shu + 2:end])
            source = source[:140] if len(source) > 4 else None

    if meaning:
        return meaning, source, example, pinyin

    # ---------- 模板 B：JSON-LD description（兜底） ----------
    m = re.search(r'"description"\s*:\s*"((?:[^"\\]|\\.)*)"', html)
    if m:
        desc = m.group(1).encode().decode('unicode_escape') if '\\u' in m.group(1) else m.group(1)
        desc = re.sub(r'<[^>]+>', '', desc).strip()
        desc = desc.replace('\\"', '"').replace('“”', '"')
        if len(desc) >= 6 and '词语的详细解释' not in desc and not desc.startswith('汉典「'):
            meaning = desc

    # ---------- 重定向跟随：纯跳转词条（见「X」/[[X]]） ----------
    if not meaning and depth < 2:
        h2 = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
        h2 = re.sub(r'<style[^>]*>.*?</style>', '', h2, flags=re.S)
        t2 = re.sub(r'<[^>]+>', ' ', h2)
        t2 = re.sub(r'\s+', ' ', t2).strip()
        rm = re.search(r'见[“\"]([^”\"]+)[”\"]', t2) or re.search(r'\[\[([^\]]+)\]\]', t2)
        if rm:
            target = rm.group(1).strip().strip('[]')
            if target and target != word:
                try:
                    thtml = fetch(target)
                    return extract(thtml, target, depth + 1)
                except Exception:
                    pass
    return meaning, source, example, pinyin

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--delay', type=float, default=0.45)
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = {}
    if os.path.exists(CACHE_JSON) and not args.force:
        try:
            cache = json.load(open(CACHE_JSON, encoding='utf-8'))
        except Exception:
            cache = {}

    idioms = json.load(open(IDIOMS_JSON, encoding='utf-8'))['items']
    words = [x['word'] for x in idioms]
    if args.limit:
        words = words[:args.limit]

    done = 0
    ok = 0
    fail = 0
    for i, w in enumerate(words):
        if (not args.force) and w in cache and isinstance(cache[w], dict) and cache[w].get('meaning'):
            done += 1
            continue
        try:
            html = fetch(w)
            meaning, source, example, pinyin = extract(html, w)
            if meaning:
                rec = {'meaning': meaning}
                if source:
                    rec['source'] = source
                if example:
                    # 汉典示例用 ～ 作成语占位符，替换成词目更易读
                    rec['example'] = example.replace('～', w).replace('~', w)
                if pinyin:
                    rec['pinyin'] = pinyin
                cache[w] = rec
                ok += 1
                if i % 20 == 0:
                    print(f'[{i+1}/{len(words)}] {w} OK  解释={meaning[:24]}...')
            else:
                cache[w] = {'error': 'no_meaning', 'meaning': None}
                fail += 1
                print(f'[{i+1}/{len(words)}] {w} 无解释(可能页面结构变化)')
        except Exception as e:
            fail += 1
            cache[w] = {'error': str(e)[:80], 'meaning': None}
            print(f'[{i+1}/{len(words)}] {w} 失败: {e}')
            # 退避
            time.sleep(2.0)
        # 即时落盘，避免中断丢失
        json.dump(cache, open(CACHE_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        time.sleep(args.delay)

    print(f'\n=== 完成 === 已缓存 {len(cache)} 词 | 本次新增OK {ok} | 失败 {fail} | 跳过(已缓存) {done}')
    hit = sum(1 for v in cache.values() if v.get('meaning'))
    print(f'含权威释义: {hit}/{len(cache)}')

if __name__ == '__main__':
    main()
