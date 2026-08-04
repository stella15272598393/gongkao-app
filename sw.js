/* ========================================
   个人专属工作台 - Service Worker
   支持离线缓存和PWA安装
   ======================================== */

const CACHE_NAME = 'gongzuotai-v5';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/data.js',
    './js/app.js',
    './js/loader.js',
    './manifest.json'
];

// 内容数据：单独缓存，失败不影响安装（离线时仍有内置数据兜底）
const CONTENT_TO_CACHE = [
    './content/shizheng.json',
    './content/qiushi.json',
    './content/renwu.json',
    './content/meta.json'
];

// 安装事件 - 缓存核心资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async cache => {
                console.log('PWA: 缓存核心资源');
                await cache.addAll(ASSETS_TO_CACHE);
                // 内容文件容错缓存
                await Promise.all(CONTENT_TO_CACHE.map(u =>
                    cache.add(u).catch(() => console.warn('PWA: 内容文件暂不可用', u))
                ));
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

// 判断是否为核心代码资源（需保证拿到最新版本）
function isCoreAsset(url) {
    return /\.(js|css|html|json)$/i.test(new URL(url).pathname);
}

// 拦截网络请求
self.addEventListener('fetch', event => {
    // 只处理GET请求
    if (event.request.method !== 'GET') return;
    // 跳过跨域请求
    if (!event.request.url.startsWith(self.location.origin)) return;

    const isCore = event.request.mode === 'navigate' || isCoreAsset(event.request.url);

    if (isCore) {
        // 核心代码：Network First —— 保证代码永远是最新的，离线才回落缓存
        event.respondWith(
            fetchAndCache(event.request).catch(() =>
                caches.match(event.request).then(
                    cached => cached || caches.match('./index.html')
                )
            )
        );
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
