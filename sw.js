/* ========================================
   考公工作台 - Service Worker（v87.6 稳定缓存版）
   --------------------------------------------------------
   目标：恢复到 87.2 用户满意的状态（Cache First 离线缓存，github.io 抖动时
   仍能秒开、不白屏），但修掉导致白屏的唯一 bug。

   策略：
   - 页面 / 静态资源(index.html, css, js, 图片)：Cache First（缓存优先，秒开）
     → 后台静默更新缓存，下次访问自动用新版
     → 关键修复：缓存缺失且网络也失败时，HTML 返回"离线模式"友好页（绝不返回空→白屏）
       子资源则返回缓存或交给浏览器（绝不返回 undefined）
   - 数据文件(content/*.json) / version.json / sw.js：Network First（保证新鲜）
   - 版本化缓存名 gongkao-v{N}，activate 时清理旧缓存

   说明：HTML 与静态资源都用 Cache First，保证同一版本的资源一起被缓存，
   不会出现"新 index.html + 旧 app.js"错配导致卡死。
   ======================================== */

const CACHE_PREFIX = 'gongkao-v';
const CACHE_VERSION = '87.6';          // ← 与 APP_VERSION 同步
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

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

// ---------- 安装：预缓存核心资源（失败单项跳过）----------
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(
            PRECACHE_URLS.map(url =>
                cache.add(url).catch(err => {
                    console.log('[SW] 预缓存跳过:', url, err && err.message);
                })
            )
        );
    })());
    self.skipWaiting();
});

// ---------- 激活：清理旧缓存 + 立即接管页面 ----------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        );
    })());
    self.clients.claim();
});

// ---------- 请求拦截 ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // 页面导航：Cache First + 离线兜底
    if (req.mode === 'navigate') {
        event.respondWith(cacheFirstHTML(req));
        return;
    }
    // 数据 / 版本 / SW：Network First
    if (url.pathname.includes('/content/') ||
        url.pathname.endsWith('/version.json') ||
        url.pathname.endsWith('/sw.js')) {
        event.respondWith(networkFirst(req));
        return;
    }
    // 静态资源：Cache First（安全版）
    event.respondWith(safeCacheFirst(req));
});

// ---------- 策略实现 ----------

async function cacheFirstHTML(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request) || await cache.match('./index.html') || await cache.match('./');
    if (cached) {
        // 后台更新缓存（不阻塞）
        fetch(request).then(r => { if (r && r.ok) cache.put(request, r.clone()); }).catch(() => {});
        return cached;
    }
    // 无缓存：尝试网络
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (err) {
        // 网络也失败 → 返回离线友好页（绝不白屏）
        return offlinePage();
    }
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

async function safeCacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
        fetch(request).then(r => { if (r && r.ok) cache.put(request, r.clone()); }).catch(() => {});
        return cached;
    }
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (err) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw err; // 子资源确实拿不到：交给浏览器（不让整页白屏）
    }
}

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
        '<a class="btn" href="./">重新加载</a><p class="tip">网络恢复后点"重新加载"即可刷新</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

// ---------- 消息处理 ----------
self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'SKIP_WAITING') self.skipWaiting();
    if (data.type === 'SKIP_WAITING_AND_RELOAD') {
        self.skipWaiting();
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
                return Promise.allSettled(
                    PRECACHE_URLS.map(url =>
                        fetch(url).then(resp => { if (resp.ok) cache.put(url, resp); }).catch(() => {})
                    )
                );
            })
        );
    }
});
