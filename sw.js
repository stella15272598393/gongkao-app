/* ========================================
   考公工作台 - Service Worker（v87 修复版）
   --------------------------------------------------------
   策略：
   - 静态资源（HTML/CSS/JS/图片）：Cache First（缓存优先）
     → 首次加载后全部缓存，之后秒开、不依赖网络
     → 后台静默更新缓存，下次访问自动用新版
   - 数据文件（content/*.json）：Network First（网络优先）
     → 每次尝试联网拿最新爬虫数据，断网时用缓存兜底
   - version.json：Network First（检测版本更新）
   
   版本管理：
   - CACHE_NAME 带版本号，每次发版自动建新缓存
   - activate 时清理旧版本缓存，不残留垃圾
   
   解决的问题：
   1. 境内 github.io 不稳定/ERR_CONNECTION_RESET → 缓存后可离线使用
   2. 旧 SW 死循环（一直喂旧 index.html）→ 版本化缓存 + 后台更新
   3. 每次打开都要联网加载 → 缓存优先策略秒开
   ======================================== */

const CACHE_PREFIX = 'gongkao-v';
const CACHE_VERSION = '87.2.6';        // ← 与 APP_VERSION 同步，发版时改这里
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// 需要预缓存的静态资源（安装时一次性缓存）
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

// ---------- 安装：预缓存核心资源 ----------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // 用 addAll 预缓存，失败的单项跳过（不影响其他）
            return Promise.allSettled(
                PRECACHE_URLS.map(url =>
                    cache.add(url).catch(err => {
                        console.log('[SW] 预缓存跳过:', url, err.message);
                    })
                )
            );
        })
    );
    self.skipWaiting(); // 安装完立即激活，不等旧页面关闭
});

// ---------- 激活：清理旧缓存 + 立即接管页面 ----------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 清理所有非当前版本的旧缓存
        const keys = await caches.keys();
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
    self.clients.claim(); // 立即控制所有已打开的页面
});

// ---------- 请求拦截：按资源类型走不同策略 ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;
    
    // 只处理 GET 请求
    if (req.method !== 'GET') return;
    
    // 只处理同源请求
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // ---- 策略选择 ----
    
    // 1. 数据文件（content/*.json）：Network First
    if (url.pathname.startsWith('/gongkao-app/content/') || url.pathname.includes('/content/')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // 2. version.json / sw.js：Network First（确保版本检测和SW更新）
    if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // 3. 页面导航：Cache First + 离线兜底（绝不返回空响应→白屏）
    if (req.mode === 'navigate') {
        event.respondWith(cacheFirstHTML(req));
        return;
    }

    // 4. 其他所有静态资源（HTML/CSS/JS/图片等）：Stale While Revalidate（安全版）
    event.respondWith(safeStaleWhileRevalidate(req));
});

// ---------- 策略实现 ----------

/**
 * 页面导航：Cache First + 离线兜底
 * 有缓存→立即返回并后台更新；无缓存→联网取；联网也失败→返回离线友好页（绝不白屏）
 */
async function cacheFirstHTML(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request) || await cache.match('./index.html') || await cache.match('./');
    if (cached) {
        fetch(request).then(r => { if (r && r.ok) cache.put(request, r.clone()); }).catch(() => {});
        return cached;
    }
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (err) {
        return offlinePage();
    }
}

/**
 * 安全的 Stale While Revalidate（缓存优先 + 后台更新）
 * 适用：静态资源（HTML/CSS/JS/图片）
 * 区别：无缓存且网络失败时回退缓存或抛出，绝不返回 undefined（否则整页白屏）
 */
async function safeStaleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
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
        throw err; // 子资源确实拿不到：交给浏览器处理（不让整页白屏）
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


/**
 * Network First（网络优先 + 缓存兜底）
 * 适用：数据文件(content/*.json)、version.json、sw.js
 * 行为：先尝试联网；成功则更新缓存并返回；失败则返回缓存（可能过期）
 */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone()); // 更新缓存
        }
        return networkResponse;
    } catch (err) {
        // 联网失败 → 尝试从缓存返回（可能是任意旧版本的缓存）
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        // 完全没有缓存 → 返回一个友好的离线响应（仅对 HTML 请求）
        if (request.headers.get('Accept').includes('text/html')) {
            return new Response(
                '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<meta name="theme-color" content="#FFB6C1">' +
                '<title>考公工作台 - 离线模式</title>' +
                '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#FFF5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#333;padding:20px;text-align:center}' +
                '.card{background:#fff;border-radius:16px;padding:40px 30px;max-width:380px;box-shadow:0 4px 20px rgba(255,182,193,.25)}' +
                '.icon{font-size:52px;margin-bottom:16px}h1{font-size:18px;color:#E91E63;margin-bottom:12px}' +
                'p{font-size:14px;color:#888;line-height:1.7;margin-bottom:24px}' +
                '.btn{display:inline-block;background:linear-gradient(135deg,#FFB6C1,#FF8FAB);color:#fff;padding:11px 32px;border-radius:22px;text-decoration:none;font-size:14px;font-weight:600;box-shadow:0 2px 10px rgba(255,107,129,.3)}' +
                '.tip{margin-top:20px;font-size:12px;color:#ccc}}</style></head>' +
                '<body><div class="card"><div class="icon">🌸</div><h1>当前网络不可用</h1>' +
                '<p>考公工作台正在使用<br><b>离线缓存</b>运行<br>部分内容可能不是最新</p>' +
                '<a class="btn" href="./">重新加载</a><p class="tip">Service Worker 缓存 · 网络恢复后自动更新</p></div></body></html>',
                { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
        }
        throw err; // 非 HTML 请求直接报错
    }
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
