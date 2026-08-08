/* ========================================
   个人专属工作台 - Service Worker（v82 已停用）
   --------------------------------------------------------
   本文件不再提供任何缓存 / 离线能力。
   唯一目的：在用户已注册旧 SW 的设备上，让新版本 SW 安装后
   立即「注销自己」，从而彻底打破"旧 SW 一直用缓存的旧 index.html
   响应访问"的死循环（表现为：永远在加载、点不动、导入备份卡死）。

   注销后浏览器不再有 SW 控制页面，此后所有请求都走普通 HTTP，
   每次都能拿到服务端最新文件（配合 index.html 的 ?v= 缓存破坏参数）。
   ======================================== */

// 安装即跳过等待，尽快进入 activate
self.addEventListener('install', () => {
    self.skipWaiting();
});

// 激活阶段：清空所有残留缓存，并注销自身
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) { /* ignore */ }
        try {
            await self.registration.unregister();
        } catch (e) { /* ignore */ }
    })());
});

// 拦截请求：纯网络，绝不走缓存。保证页面与脚本永远取服务端最新版。
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(fetch(event.request));
    }
});

// 不再处理任何消息
self.addEventListener('message', () => {});
