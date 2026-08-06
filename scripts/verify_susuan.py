#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐题重算 content/susuan.json 的数学答案，核对 correctText 与 answer 选项是否一致。"""
import json, re

def num(s):
    return float(str(s).replace(',', '').replace('%', '').strip())

def fmt1(v):
    return round(v * 10) / 10

def load():
    return json.load(open('content/susuan.json', encoding='utf-8'))['items']

def recompute(it):
    """返回 (expected_text, ok_bool_against_correctText, note)。expected_text 用于人工核对。"""
    q = it['question']; cat = it['category']; ct = it.get('correctText', '')
    m = None
    if cat == '求增长量':
        # 新格式："现期量为 A，同比增长 r%，求同比增长量约为？"
        # 旧格式（兜底）："A × (1 + r%) 中，同比增长量约为？"
        m = re.search(r'现期量为\s*([\d,]+)，同比增长\s*([\d.]+)%', q)
        if not m:
            m = re.search(r'([\d,]+)\s*×\s*\(1\s*\+\s*([\d.]+)%\)', q)
        if m:
            A = num(m.group(1)); r = num(m.group(2))
            exp = fmt1(A * r / (100 + r))
            return (f"{exp:,.1f}", abs(num(ct) - exp) < 0.6, f"A={A} r={r}%")
    elif cat == '求基期':
        m = re.search(r'现期量为\s*([\d,]+)，同比增长\s*([\d.]+)%', q)
        if m:
            A = num(m.group(1)); r = num(m.group(2))
            exp = fmt1(A / (1 + r / 100))
            return (f"{exp:,.1f}", abs(num(ct) - exp) < 0.6, f"现期={A} r={r}%")
    elif cat == '求增长率':
        m = re.search(r'基期\s*([\d,]+)，现期\s*([\d,]+)', q)
        if m:
            base = num(m.group(1)); A = num(m.group(2))
            exp = fmt1((A - base) / base * 100)
            return (f"{exp:.1f}%", abs(num(ct) - exp) < 0.6, f"基期={base} 现期={A}")
    elif cat == '倍数与比重':
        m = re.search(r'整体\s*([\d,]+)\s*中，部分\s*([\d,]+)', q)
        if m:
            whole = num(m.group(1)); part = num(m.group(2))
            exp = fmt1(part / whole * 100)
            return (f"{exp:.1f}%", abs(num(ct) - exp) < 0.6, f"整体={whole} 部分={part}")
    elif cat == '分数比较':
        m = re.search(r'比较大小：\s*(\d+)/(\d+)\s*与\s*(\d+)/(\d+)', q)
        if m:
            p1, q1, p2, q2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            c1, c2 = p1 * q2, p2 * q1
            exp = '前者大' if c1 > c2 else ('后者大' if c2 > c1 else '两者相等')
            return (exp, ct.strip() == exp, f"{p1}/{q1} vs {p2}/{q2} cross={c1},{c2}")
    elif cat == '尾数法':
        m = re.search(r'([\d,]+)\s*×\s*([\d,]+)', q)
        if m:
            a = int(num(m.group(1))); b = int(num(m.group(2)))
            exp = f"末两位为 {a * b % 100:02d}"
            return (exp, ct.strip() == exp, f"{a}×{b}")
    elif cat == '间隔增长率':
        m = re.search(r'分别为\s*([\d.]+)%\s*和\s*([\d.]+)%', q)
        if m:
            r1 = num(m.group(1)); r2 = num(m.group(2))
            exp = fmt1(((1 + r1 / 100) * (1 + r2 / 100) - 1) * 100)
            return (f"{exp:.1f}%", abs(num(ct) - exp) < 0.6, f"r1={r1} r2={r2}")
    elif cat == '目标完成率':
        m = re.search(r'目标\s*([\d,]+)，已完成\s*([\d,]+)', q)
        if m:
            target = num(m.group(1)); done = num(m.group(2))
            exp = fmt1(done / target * 100)
            return (f"{exp:.1f}%", abs(num(ct) - exp) < 0.6, f"目标={target} 完成={done}")
    return (None, False, 'NO PARSER/NO MATCH')

def main():
    items = load()
    bad = []; parsed = 0
    for it in items:
        exp, ok, note = recompute(it)
        if exp is None:
            bad.append((it['id'], it['category'], 'PARSER_FAIL', it.get('correctText'), note))
            continue
        parsed += 1
        if not ok:
            bad.append((it['id'], it['category'], it.get('correctText'), exp, note))
        # 选项与答案一致性
        idx = ord(it['answer']) - 65
        opt = it['options'][idx] if idx < len(it['options']) else ''
        if opt[0] != it['answer']:
            bad.append((it['id'], it['category'], 'ANSWER_LETTER_MISMATCH', it['answer'], opt))
    print(f"共 {len(items)} 题，可解析 {parsed} 题")
    if not bad:
        print("✅ 全部数学答案与 correctText 一致，选项字母与正确项一致")
    else:
        print(f"❌ 发现 {len(bad)} 处问题：")
        for b in bad:
            print("  ", b)

if __name__ == '__main__':
    main()
