/* ========================================
   考公工作台 - Service Worker（v87.3 网络优先版）
   --------------------------------------------------------
   策略（v87.3 重构）：
   - 页面主体（HTML/CSS/JS/图片）：Network First（网络优先）
     → 每次启动优先从网络拉取最新版本，确保用户看到最新内容
     → 网络失败时回退到离线缓存兜底（不会白屏）
   - 数据文件（content/*.json）：Network First（网络优先）
     → 每次尝试联网拿最新爬虫数据，断网时用缓存兜底
   - version.json / sw.js：Network First（检测版本更新）
   
   版本管理：
   - CACHE_NAME 带版本号，每次发版自动建新缓存
   - activate 时清理旧版本缓存，不残留垃圾
   
   解决的问题：
   1. 境内 github.io 不稳定/ERR_CONNECTION_RESET → 缓存后可离线使用
   2. 旧 SW 死循环（一直喂旧 index.html）→ 版本化缓存 + 后台更新
   3. 用户要求：不要离线优先，每次启动走网络获取最新版本
   ======================================== */

const CACHE_PREFIX = 'gongkao-v';
const CACHE_VERSION = '87.3.0';        // ← 与 APP_VERSION 同步，发版时改这里
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// 需要预缓存的资源（安装时一次性缓存，作为离线兜底）
const PRECACHE_URLS = [
    './',
    './index.html',
    './css/style.css',
    './js/data.js',
    './js/data-modules.js',
    './js/app.js',
    './js/loader.js',
    './version.json'
];

// ---------- 安装：预缓存核心资源（作为离线兜底） ----------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.allSettled(
                PRECACHE_URLS.map(url =>
                    cache.add(url).catch(err => {
                        console.log('[SW] 预缓存跳过:', url, err.message);
                    })
                )
            );
        })
    );
    self.skipWaiting();
});

// ---------- 激活：清理旧缓存 + 立即接管页面 ----------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        // 清理所有非当前版本的旧缓存
        await Promise.all(
            keys
                .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                .map(key => caches.delete(key))
        );
        // 也清理 v82 及之前无前缀的遗留缓存
        await Promise.all(
            keys
                .filter(key => !key.startsWith(CACHE_PREFIX))
                .map(key => caches.delete(key))
        );
    })());
    self.clients.claim();
});

// ---------- 请求拦截：统一 Network First ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // 只处理 GET 请求
    if (req.method !== 'GET') return;

    // 只处理同源请求
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // ★ v87.3: 所有同源 GET 请求统一走 Network First
    //   - 先尝试联网获取最新版本
    //   - 联网失败时回退到缓存（如果有）
    //   - 完全无缓存且是 HTML 请求 → 返回友好离线页
    event.respondWith(networkFirst(req));
});

// ---------- 核心策略：Network First（网络优先 + 缓存兜底） ----------

/**
 * Network First — 所有资源的统一策略
 * 行为：
 *   1. 尝试从网络获取最新资源
 *   2. 成功 → 更新缓存并返回最新版
 *   3. 失败 → 回退到缓存中的任意版本（可能是旧的但可用）
 *   4. 无缓存且是 HTML → 返回友好离线页（绝不白屏）
 *   5. 无缓存且是非 HTML 子资源 → 抛出错误（浏览器正常处理）
 */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);

    try {
        // ★ 优先走网络：确保每次启动获取最新版本
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            // 网络成功：更新缓存 + 返回最新版
            cache.put(request, networkResponse.clone());
            return networkResponse;
        }
        // 网络返回了非 ok 状态（如 404/500），尝试缓存兜底
        console.log('[SW] 网络', request.url, '状态异常，尝试缓存兜底');
    } catch (err) {
        // 网络完全失败（断网/DNS 解析失败等）
        console.log('[SW] 网络请求失败:', request.url, err.message);
    }

    // ★ 兜底：从缓存读取（可能是旧版本，但至少可用）
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        console.log('[SW] 使用缓存兜底:', request.url);
        return cachedResponse;
    }

    // ★ 终极兜底：仅对 HTML 导航请求返回友好离线页
    if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
        return offlinePage();
    }

    // 非 HTML 子资源且无缓存：抛出错误让浏览器处理
    throw new Error('[SW] ' + request.url + ': 网络不可用且无缓存');
}

/**
 * 友好离线页面（仅在网络完全不可用且无任何缓存时返回）
 */
function offlinePage() {
    return new Response(
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="theme-color" content="#FFB6C1">' +
        '<title>考公工作台 - 离线模式</title>' +
        '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#FFF5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#333;padding:20px;text-align:center}' +
        '.card{background:#fff;border-radius:16px;padding:40px 30px;max-width:380px;box-shadow:0 4px 20px rgba(255,182,193,.25)}' +
        '.icon{font-size:52px;margin-bottom:16px}h1{font-size:18px;color:#E91E63;margin-bottom:12px}' +
        'p{font-size:14px;color:#888;line-height:1.7;margin-bottom:24px}' +
        '.btn{display:inline-block;background:linear-gradient(135deg,#FFB6C1,#FF8FAB);color:#fff;padding:11px 32px;border-radius:22px;text-decoration:none;font-size:14px;font-weight:600;box-shadow:0 2px 10px rgba(255,107,129,.3)}' +
        '.tip{margin-top:20px;font-size:12px;color:#ccc}</style></head>' +
        '<body><div class="card"><div class="icon">🌸</div><h1>当前网络不可用</h1>' +
        '<p>考公工作台正在使用<br><b>离线缓存</b>运行<br>部分内容可能不是最新</p>' +
        '<a class="btn" href="./">重新加载</a><p class="tip">网络恢复后点"重新加载"即可刷新</p></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}


// ---------- 消息处理 ----------
self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    // 主页要求跳过等待
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // 主页要求清空缓存并重新预缓存
    if (data.type === 'SKIP_WAITING_AND_RELOAD') {
        self.skipWaiting();
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
                return Promise.allSettled(
                    PRECACHE_URLS.map(url =>
                        fetch(url).then(resp => {
                            if (resp.ok) cache.put(url, resp);
                        }).catch(() => {})
                    )
                );
            })
        );
    }
});
