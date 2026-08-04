/**
 * 内容加载器 - 远程优先 + 离线缓存 + 内置兜底
 * ------------------------------------------------------------
 * 加载顺序：
 *   1. 立即用 data.js 内置数据渲染（保证秒开，离线首次可用）
 *   2. 读 IndexedDB 缓存（上次抓取的内容，离线也是新的）
 *   3. 拉远程 content/*.json（联网时拿最新）
 *   任一步成功都会覆盖上一步并重新渲染。
 *
 * 原文完整性：paragraphs / fullText 原样透传，不做任何截断或改写。
 */

(function () {
    'use strict';

    const DB_NAME = 'gongzuotai_content';
    const DB_VERSION = 3;
    const STORE = 'datasets';

    /* ---------------- IndexedDB 封装 ---------------- */
    function openDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('no indexedDB'));
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbGet(key) {
        try {
            const db = await openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const r = tx.objectStore(STORE).get(key);
                r.onsuccess = () => resolve(r.result || null);
                r.onerror = () => reject(r.error);
            });
        } catch (e) { return null; }
    }

    async function idbSet(key, val) {
        try {
            const db = await openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(val, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { return false; }
    }

    /* ---------------- 格式适配 ---------------- */

    /** 抓取格式 → 时政模块格式（原文字段原样保留） */
    function toShizheng(items) {
        return items.map((it, idx) => {
            // 摘要取原文首段，不做 AI 改写
            const firstPara = (it.paragraphs && it.paragraphs[0]) || '';
            const summary = firstPara.length > 160 ? firstPara.slice(0, 160) + '…' : firstPara;

            // 要点提炼：全部为原文原句摘取，不生成新表述
            const a = it.analysis || {};
            // 净化：剥离 crawler 误抓的 JS 代码（showPlayer 等）
            const cleanThesis = (typeof sanitizeAnalysis === 'function')
                ? sanitizeAnalysis(a.thesis || '') : (a.thesis || '');
            const lines = [];
            if (cleanThesis) lines.push('【核心观点·原文摘取】' + cleanThesis);
            if (a.goldenSentences && a.goldenSentences.length)
                lines.push('【申论金句·原文摘取】\n' + a.goldenSentences.map(s => '· ' + s).join('\n'));
            if (a.policyExpressions && a.policyExpressions.length)
                lines.push('【规范表述·原文摘取】\n' + a.policyExpressions.slice(0, 6).map(s => '· ' + s).join('\n'));
            if (a.measures && a.measures.length)
                lines.push('【对策模板·原文摘取】\n' + a.measures.slice(0, 6).map((s, i) => (i + 1) + '. ' + s).join('\n'));
            const dim = it.direction === '湖北' ? '湖北省情' : '国考考点';
            lines.push('【分类维度】' + dim + '　【标签】' + (it.tags || []).join('、'));

            return {
                id: 10000 + idx,
                title: it.title,
                summary,
                fullText: it.fullText,          // 完整原文，未截断
                paragraphs: it.paragraphs || [], // 原始段落
                source: it.source,
                sourceType: it.direction === '湖北' ? 'hubei' : 'guokao',
                date: normalizeDate(it.date),
                url: it.url,
                keywords: [...(it.keywordsGuokao || []), ...(it.keywordsHubei || [])].slice(0, 6),
                aiInsight: lines.join('\n\n'),
                liked: false,
                favorited: false,
                likes: 0,
                _remote: true
            };
        });
    }

    /** 抓取格式 → 求是网模块格式 */
    function toQiushi(items) {
        return items.map((it, idx) => {
            const a = it.analysis || {};
            return {
                id: 20000 + idx,
                title: it.title,
                tags: mapTags(it.tags || []),
                url: it.url,
                date: normalizeDate(it.date),
                source: it.source,
                analysis: {
                    mainPoint: a.thesis || '（本文未提取到明确总论点，请查看完整原文）',
                    subPoints: (a.subPoints && a.subPoints.length) ? a.subPoints : deriveSubPoints(it.paragraphs),
                    policyExpressions: a.policyExpressions || [],
                    advancedPhrases: a.rhetoric || [],
                    background: `本文发表于${it.source}，发布时间 ${normalizeDate(it.date)}，全文 ${it.wordCount} 字。标签：${(it.tags || []).join('、')}`,
                    countermeasures: a.measures || [],
                    goldenSentences: a.goldenSentences || []
                },
                originalText: it.fullText,       // 完整原文，未截断
                paragraphs: it.paragraphs || [],
                wordCount: it.wordCount,
                _remote: true
            };
        });
    }

    /** 抓取格式 → 人物素材模块格式（原文字段原样保留） */
    function toRenwu(items) {
        return items.map(it => ({
            id: it.id,
            name: it.name,
            category: it.category,
            categoryName: it.categoryName,
            story: it.story || '',
            themes: Array.isArray(it.themes) ? it.themes : [],
            paragraph: it.paragraph || '',
            goldenSentence: it.goldenSentence || (it.goldenSentences && it.goldenSentences[0]) || '',
            goldenSentences: Array.isArray(it.goldenSentences) ? it.goldenSentences : [],
            source: it.source || '共产党员网',
            date: it.date || '',
            hasOriginalLink: it.hasOriginalLink !== false,
            originalUrl: (it.originalUrl && it.originalUrl !== '#') ? it.originalUrl : '',
            searchUrl: it.searchUrl || (it.name
                ? 'https://search.12371.cn/search.php?t=newsmerge&client=no&q=' + encodeURIComponent(it.name)
                : ''),
            articleTitle: it.articleTitle || it.name,
            paragraphs: Array.isArray(it.paragraphs) ? it.paragraphs : [],
            fullText: it.fullText || (Array.isArray(it.paragraphs) ? it.paragraphs.join('\n') : ''),
            wordCount: it.wordCount || (it.fullText ? it.fullText.length : 0),
            crawledAt: it.crawledAt,
            _remote: true
        }));
    }

    /** 无显式分论点时，取较长段落的首句作为结构线索 */
    function deriveSubPoints(paras) {
        if (!paras) return [];
        return paras.filter(p => p.length > 60)
            .slice(0, 6)
            .map(p => (p.split(/[。！？]/)[0] || p).slice(0, 60));
    }

    /** 标签对齐 UI 既有分类 */
    function mapTags(tags) {
        const map = { '区域发展': '区域发展(湖北中部崛起)' };
        return tags.map(t => map[t] || t);
    }

    function normalizeDate(d) {
        if (!d) return new Date().toISOString().slice(0, 10);
        const m = String(d).match(/(20\d\d)[-年](\d{1,2})[-月](\d{1,2})/);
        if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        return String(d).slice(0, 10);
    }

    /* ---------------- 应用数据 ---------------- */
    function applyData(payload, origin) {
        let changed = false;

        if (payload.shizheng && payload.shizheng.length) {
            const mapped = toShizheng(payload.shizheng);
            if (typeof SHIZHENG_NEWS !== 'undefined') {
                SHIZHENG_NEWS.length = 0;
                mapped.forEach(x => SHIZHENG_NEWS.push(x));
                changed = true;
            }
        }
        if (payload.qiushi && payload.qiushi.length) {
            const mapped = toQiushi(payload.qiushi);
            if (typeof QIUSHI_ARTICLES !== 'undefined') {
                QIUSHI_ARTICLES.length = 0;
                mapped.forEach(x => QIUSHI_ARTICLES.push(x));
                changed = true;
            }
        }
        if (payload.renwu && payload.renwu.length) {
            const mapped = toRenwu(payload.renwu);
            if (typeof RENWU_DATABASE !== 'undefined') {
                RENWU_DATABASE.length = 0;
                mapped.forEach(x => RENWU_DATABASE.push(x));
                changed = true;
            }
        }
        if (payload.essays && payload.essays.length) {
            // 申论范文：直接复用语政模块格式（content 字段即全文）
            if (typeof ESSAYS_DB !== 'undefined') {
                ESSAYS_DB.length = 0;
                payload.essays.forEach(x => ESSAYS_DB.push(x));
                changed = true;
            }
        }
        if (payload.quotes && payload.quotes.length) {
            // 金句库：兼容 QUOTES_DB 结构
            if (typeof QUOTES_DB !== 'undefined') {
                QUOTES_DB.length = 0;
                payload.quotes.forEach(x => QUOTES_DB.push(x));
                changed = true;
            }
        }
        if (payload.morning && payload.morning.length) {
            // 今日晨读：直接复用格式
            if (typeof MORNING_DB !== 'undefined') {
                MORNING_DB.length = 0;
                payload.morning.forEach(x => MORNING_DB.push(x));
                changed = true;
            }
        }
        if (payload.idioms && payload.idioms.length) {
            if (typeof IDIOMS_DB !== 'undefined') {
                IDIOMS_DB.length = 0;
                payload.idioms.forEach(x => IDIOMS_DB.push(x));
                changed = true;
            }
        }
        if (payload.idiomPairs && payload.idiomPairs.length) {
            if (typeof IDIOM_PAIRS_DB !== 'undefined') {
                IDIOM_PAIRS_DB.length = 0;
                payload.idiomPairs.forEach(x => IDIOM_PAIRS_DB.push(x));
                changed = true;
            }
        }
        if (payload.logic && payload.logic.length) {
            if (typeof LOGIC_DB !== 'undefined') {
                LOGIC_DB.length = 0;
                payload.logic.forEach(x => LOGIC_DB.push(x));
                changed = true;
            }
        }
        if (payload.interview && payload.interview.length) {
            if (typeof INTERVIEW_DB !== 'undefined') {
                INTERVIEW_DB.length = 0;
                payload.interview.forEach(x => INTERVIEW_DB.push(x));
                changed = true;
            }
        }
        if (payload.transitions && payload.transitions.length) {
            if (typeof TRANSITION_DB !== 'undefined') {
                TRANSITION_DB.length = 0;
                payload.transitions.forEach(x => TRANSITION_DB.push(x));
                changed = true;
            }
        }
        // 速算远程题（每日自动生成）：不覆盖内置 DB，仅暴露给 app.js 优先加载
        if (payload.susuan && payload.susuan.length) {
            window.__SUSUAN_REMOTE__ = payload.susuan;
        }

        if (changed) {
            window.__contentOrigin = origin;
            window.__contentMeta = payload.meta || null;
            rerender();
            showBadge(origin, payload.meta);
            try { if (typeof showUpdateNotice === 'function' && payload.meta) showUpdateNotice(payload.meta); } catch (e) { }
        }
        return changed;
    }

    /** 合并远程与缓存：某模块远程抓取失败(为空)但缓存有数据 → 保留缓存，避免部分抓取把模块清空并污染 IndexedDB */
    function mergePayload(fresh, cached) {
        const keys = ['shizheng', 'qiushi', 'renwu', 'essays', 'quotes', 'morning', 'idioms', 'idiomPairs', 'logic', 'interview', 'transitions', 'susuan'];
        const out = {};
        for (const k of keys) {
            const f = fresh && fresh[k];
            const c = cached && cached[k];
            if (Array.isArray(f) && f.length) out[k] = f;
            else if (Array.isArray(c) && c.length) out[k] = c;
            else out[k] = (f !== undefined ? f : c);
        }
        if (fresh && fresh.meta) out.meta = fresh.meta;
        else if (cached && cached.meta) out.meta = cached.meta;
        return out;
    }

    /** 触发相关模块重新渲染 */
    function rerender() {
        // 远程数据覆盖后重置时政过滤状态，避免残留的旧过滤条件
        // （旧来源/方向值在新数据中可能不存在，导致空白页）
        if (typeof currentShizhengSource !== 'undefined') currentShizhengSource = 'all';
        if (typeof currentShizhengFilter !== 'undefined') currentShizhengFilter = 'all';
        try { if (typeof renderShizhengList === 'function') renderShizhengList(); } catch (e) { }
        try { if (typeof renderShizhengSources === 'function') renderShizhengSources(); } catch (e) { }
        try { if (typeof updateShizhengUpdateInfo === 'function') updateShizhengUpdateInfo(); } catch (e) { }
        try {
            if (typeof renderQiushiArticles === 'function') {
                const tag = (typeof currentQiushiTag !== 'undefined' && currentQiushiTag) ? currentQiushiTag : 'all';
                const q = (document.getElementById('qiushiSearchInput') || {}).value || '';
                renderQiushiArticles(tag, q);
            }
        } catch (e) { }
        try { if (typeof renderRenwuList === 'function') renderRenwuList(); } catch (e) { }
        try { if (typeof showRenwuDaily === 'function') showRenwuDaily(); } catch (e) { }
        try { if (typeof renderEssayList === 'function') renderEssayList(); } catch (e) { }
        try { if (typeof showRandomQuote === 'function') showRandomQuote((document.getElementById('quoteThemeFilter') || {}).value || 'all'); } catch (e) { }
        try { if (typeof renderMorningList === 'function') renderMorningList(); } catch (e) { }
        try { if (typeof renderIdioms === 'function') renderIdioms(); } catch (e) { }
        try { if (typeof renderIdiomPairs === 'function') renderIdiomPairs(); } catch (e) { }
        try { if (typeof renderLogic === 'function') renderLogic(); } catch (e) { }
        try { if (typeof renderInterview === 'function') renderInterview(); } catch (e) { }
        try { if (typeof renderSpeedMultiList === 'function') renderSpeedMultiList(); } catch (e) { }
    }

    /** 顶部提示内容来源与更新时间 */
    function showBadge(origin, meta) {
        let el = document.getElementById('contentOriginBadge');
        if (!el) {
            el = document.createElement('div');
            el.id = 'contentOriginBadge';
            el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#FFB6C1;color:#fff;' +
                'padding:8px 14px;border-radius:8px;font-size:12px;box-shadow:0 2px 10px rgba(255,182,193,.5);' +
                'cursor:pointer;transition:opacity .4s;line-height:1.6;';
            el.onclick = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); };
            document.body.appendChild(el);
        }
        const t = meta && meta.updatedAtLocal ? meta.updatedAtLocal : '未知时间';
        const tips = {
            remote: `🎀 已同步最新内容<br>更新于 ${t}`,
            cache: `🎀 离线内容已载入<br>更新于 ${t}`,
            builtin: `🎀 使用内置示例内容`
        };
        el.innerHTML = tips[origin] || '';
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4200);
    }

    /* ---------------- 远程拉取 ---------------- */
    async function fetchJSON(url) {
        const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    async function loadRemote() {
    const [sz, qs, meta, rw, es, qz, mr, idm, idp, lg, iv, tr, su] = await Promise.all([
        fetchJSON('content/shizheng.json').catch(() => null),
        fetchJSON('content/qiushi.json').catch(() => null),
        fetchJSON('content/meta.json').catch(() => null),
        fetchJSON('content/renwu.json').catch(() => null),
        fetchJSON('content/essays.json').catch(() => null),
        fetchJSON('content/quotes.json').catch(() => null),
        fetchJSON('content/morning.json').catch(() => null),
        fetchJSON('content/idioms.json').catch(() => null),
        fetchJSON('content/idiom-pairs.json').catch(() => null),
        fetchJSON('content/logic.json').catch(() => null),
        fetchJSON('content/interview.json').catch(() => null),
        fetchJSON('content/transitions.json').catch(() => null),
        fetchJSON('content/susuan.json').catch(() => null)
    ]);
        if (!sz && !qs && !rw && !es && !qz && !mr && !idm && !idp && !lg && !iv) throw new Error('all remote failed');
        return {
            shizheng: (sz && sz.items) || [],
            qiushi: (qs && qs.items) || [],
            renwu: (rw && rw.items) || [],
            essays: (es && es.items) || [],
            quotes: (qz && qz.items) || [],
            morning: (mr && mr.items) || [],
            idioms: (idm && idm.items) || [],
            idiomPairs: (idp && idp.items) || [],
            logic: (lg && lg.items) || [],
            interview: (iv && iv.items) || [],
            transitions: (tr && tr.items) || [],
            susuan: (su && su.items) || [],
            meta: meta || null
        };
    }

    /** 检测缓存是否明显偏少（被旧版污染的标志） */
    function isStaleCache(payload) {
        if (!payload) return false;
        const sz = payload.shizheng || [];
        const qz = payload.quotes || [];
        // 正常数据：时政≥70条 或 金句≥200条；低于此阈值大概率是污染后的残留
        return (sz.length > 0 && sz.length < 20) || (qz.length > 0 && qz.length < 50);
    }

    /* ---------------- 主流程 ---------------- */
    async function boot() {
        // ★ 版本升级自动清理：检测到 APP_VERSION 变化时清除旧的脏缓存
        //    解决"刷新就变离线"——旧版缓存被污染后，新版必须重拉
        const CUR_VERSION = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '';
        const LAST_VERSION = await idbGet('lastPayloadVersion');
        if (CUR_VERSION && LAST_VERSION && CUR_VERSION !== LAST_VERSION) {
            if (window.__DEBUG__) console.log('[loader] 版本升级', LAST_VERSION, '→', CUR_VERSION, '，清理旧缓存');
            await idbSet('payload', null);
            await idbSet('lastPayloadVersion', CUR_VERSION);
        } else if (CUR_VERSION && !LAST_VERSION) {
            await idbSet('lastPayloadVersion', CUR_VERSION);
        }

        // 第 2 层：IndexedDB 缓存（联网失败时的安全兜底，非离线模式）
        let cached = await idbGet('payload');

        // ★ 脏数据检测：缓存条目明显偏少 → 判定为污染残留，强制清理
        if (cached && isStaleCache(cached)) {
            if (window.__DEBUG__) console.log('[loader] 检测到脏缓存(时政', (cached.shizheng||[]).length, '条/金句', (cached.quotes||[]).length, '条)，清理');
            await idbSet('payload', null);
            cached = null;
        }

        if (cached && ((cached.shizheng || []).length || (cached.qiushi || []).length || (cached.renwu || []).length || (cached.essays || []).length || (cached.quotes || []).length || (cached.morning || []).length)) {
            applyData(cached, 'cache');
        }

        // 第 3 层：远程最新（联网优先，自动维护更新）
        try {
            const fresh = await loadRemote();
            if (fresh.shizheng.length || fresh.qiushi.length || fresh.renwu.length || fresh.morning.length) {
                const merged = mergePayload(fresh, cached);
                applyData(merged, 'remote');
                await idbSet('payload', merged);
                // 记录成功拉取的版本，防止下次误清
                if (CUR_VERSION) await idbSet('lastPayloadVersion', CUR_VERSION);
            }
        } catch (e) {
            if (!cached) {
                // 远程和缓存都没有 → 保持内置数据
                window.__contentOrigin = 'builtin';
            }
        }
    }

    // 等待 app.js 初始化完成后再接管数据
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(boot, 300);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 300));
    }

    // 暴露手动刷新
    window.refreshContent = async function () {
        try {
            const fresh = await loadRemote();
            const merged = mergePayload(fresh, await idbGet('payload'));
            applyData(merged, 'remote');
            await idbSet('payload', merged);
            return true;
        } catch (e) {
            showBadge('cache', window.__contentMeta);
            return false;
        }
    };
})();
