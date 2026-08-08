/* ========================================
   个人专属工作台 - Service Worker
   支持离线缓存和PWA安装
   ======================================== */

const CACHE_NAME = 'gongzuotai-v19';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/data.js',
    './js/data-modules.js',
    './js/app.js',
    './js/loader.js',
    './manifest.json'
];

// 内容数据文件：不预缓存！
// 原因：content/*.json 由 loader.js 用 Network-First + IndexedDB 自行管理，
//       SW 若缓存旧版本会在网络抖动时返回过时数据，导致"刷新就变离线"。
// const CONTENT_TO_CACHE 已移除，install 不再缓存任何 content 文件。

// 安装事件 - 缓存核心资源（不含 content/*.json，由 loader.js 自行管理）
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async cache => {
                console.log('PWA: 缓存核心资源');
                await cache.addAll(ASSETS_TO_CACHE);
                // content 文件不再在此预缓存，避免旧数据污染
            })
            .then(() => self.skipWaiting())
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 监听主线程消息：跳过等待，立即激活新 SW（配合 registerSW 的 SKIP_WAITING 消息）
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    // 收到版本检查 → 通知所有页面强制刷新，确保拿到最新资源（解决"手机端卡在旧版本"）
    if (event.data && event.data.type === 'CHECK_VERSION') {
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            clients.forEach(client => client.postMessage({ type: 'FORCE_RELOAD' }));
        });
    }
});

// 判断是否为核心代码资源（需保证拿到最新版本）
function isCoreAsset(url) {
    return /\.(js|css|html)$/i.test(new URL(url).pathname);
}

// 判断是否为内容数据文件（由 loader.js 自行管理，SW 不插手）
function isContentData(url) {
    return /\/content\/.+\.json$/i.test(new URL(url).pathname);
}

// 拦截网络请求
self.addEventListener('fetch', event => {
    // 只处理GET请求
    if (event.request.method !== 'GET') return;
    // 跳过跨域请求
    if (!event.request.url.startsWith(self.location.origin)) return;

    // ★ 内容数据文件：Network Only —— 不缓存、不 fallback
    //    让 loader.js 自己决定用网络数据还是 IndexedDB 缓存，
    //    避免 SW 返回旧缓存导致"刷新就变离线"
    if (isContentData(event.request.url)) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({items:[]}), {
                status: 503,
                headers: {'Content-Type': 'application/json'}
            }))
        );
        return;
    }

    // ★ 版本号文件(version.json)与 SW 脚本(sw.js)：Network Only —— 绝不被缓存，
    //   必须始终返回服务端最新值，否则手机端会一直读到旧版本号、永远检测不到更新。
    const _u = new URL(event.request.url);
    if (_u.pathname.endsWith('version.json') || _u.pathname.endsWith('sw.js')) {
        event.respondWith(fetch(event.request).catch(() =>
            caches.match(event.request).then(c => c || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
        ));
        return;
    }

    const isCore = event.request.mode === 'navigate' || isCoreAsset(event.request.url);

    if (isCore) {
        // ★ v77: 核心代码【纯网络】——绝不使用缓存，彻底杜绝"旧坏版本卡死用户"。
        //   网络不可达时直接失败（返回真实错误），而不是回退到可能已损坏的旧缓存。
        event.respondWith(fetch(event.request));
        return;
    }

    // 其他静态资源（图标等）：Cache First
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    fetchAndCache(event.request).catch(() => {});
                    return cachedResponse;
                }
                return fetchAndCache(event.request);
            })
            .catch(() => undefined)
    );
});

async function fetchAndCache(request) {
    try {
        const response = await fetch(request);
        // 只缓存成功的响应
        if (response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        throw error;
    }
}
