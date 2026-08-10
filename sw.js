/* ========================================
   考公工作台 - Service Worker（v87.4 稳定版）
   --------------------------------------------------------
   设计原则：永远不死（绝不返回 undefined → 绝不白屏）

   策略：
   - 页面导航(HTML)：Network First（网络优先）
     → 在线时永远拿到最新 index.html，绝不与旧 app.js 错配导致"卡死/点不了"
     → 网络失败 → 用缓存的 index.html 兜底
     → 连缓存也没有 → 返回"离线模式"友好页（不是白屏）
   - 数据文件(content/*.json) / version.json / sw.js：Network First + 缓存兜底
   - 静态资源(CSS/JS/图片)：Stale While Revalidate（缓存优先+后台更新）
     → 命中缓存立即返回；无缓存且网络失败 → 回退到缓存或交给浏览器，绝不返回 undefined

   版本管理：
   - CACHE_NAME 带版本号，每次发版自动建新缓存，activate 时清理旧缓存
   ======================================== */

const CACHE_PREFIX = 'gongkao-v';
const CACHE_VERSION = '87.4';          // ← 与 APP_VERSION 同步，发版时改这里
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// 需要预缓存的静态资源（安装时一次性缓存，作为离线兜底）
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

// ---------- 安装：预缓存核心资源（失败单项跳过，不影响其他）----------
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
    self.skipWaiting(); // 安装完立即激活，不等旧页面关闭
});

// ---------- 激活：清理旧缓存 + 立即接管页面 ----------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        );
    })());
    self.clients.claim(); // 立即控制所有已打开的页面
});

// ---------- 请求拦截 ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // 只处理 GET 请求
    if (req.method !== 'GET') return;

    // 只处理同源请求
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // 1. 页面导航（最重要）：Network First + 离线兜底，绝不让白屏出现
    if (req.mode === 'navigate') {
        event.respondWith(networkFirstHTML(req));
        return;
    }

    // 2. 数据文件 / version.json / sw.js：Network First（确保拿到最新）
    if (url.pathname.includes('/content/') ||
        url.pathname.endsWith('/version.json') ||
        url.pathname.endsWith('/sw.js')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // 3. 其余静态资源：Stale While Revalidate（安全版，无 undefined 风险）
    event.respondWith(safeStaleWhileRevalidate(req));
});

// ---------- 策略实现 ----------

/**
 * 页面导航：Network First + 缓存兜底 + 离线页兜底
 * 在线 → 最新 HTML（避免与 app.js 错配）；离线 → 缓存；都没有 → 离线友好页
 */
async function networkFirstHTML(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        // 网络失败：优先返回缓存的 index.html
        const cached = await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        // 连缓存都没有：返回离线模式友好页（不是白屏）
        return offlinePage();
    }
}

/**
 * Network First：网络优先，失败回退缓存；都失败则抛出（交给浏览器处理）
 */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err; // 数据/子资源确实拿不到，交给浏览器（会让该资源失败，但页面其他部分不受影响）
    }
}

/**
 * 安全的 Stale While Revalidate：
 * 命中缓存 → 立即返回 + 后台更新；
 * 无缓存 → 联网取；联网失败 → 回退缓存；都没有 → 抛出（绝不返回 undefined）
 */
async function safeStaleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        // 后台静默更新缓存，不阻塞当前响应
        fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
        }).catch(() => {});
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw err; // 绝不返回 undefined（那样会导致白屏）
    }
}

// ---------- 离线友好页（仅在 navigation 且完全无网络/无缓存时返回）----------
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
