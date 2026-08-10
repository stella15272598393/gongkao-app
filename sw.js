/* ========================================
   考公工作台 - Service Worker（v87.5 关闭离线缓存版）
   --------------------------------------------------------
   为什么要这样写：
   之前几版的 SW 离线缓存逻辑（Cache First / Network First 的各种写法）
   在 github.io 网络抖动时，会返回空响应或直接把「旧 index.html + 旧 app.js」
   错配，导致手机端白屏 / 打开后点不了 / 卡死。多次回滚仍不稳定。

   本版彻底关闭 SW 的拦截与缓存：
   - install：立即激活
   - activate：清空【所有】缓存（干掉历史遗留的损坏缓存），然后 claim 接管
   - fetch：完全不拦截，所有请求交给浏览器正常处理（= 没有 SW 一样）
   效果：页面直接由 GitHub Pages 提供，不再有白屏/错配/卡死。
   这会【自动修复】用户手机上卡住的旧 SW（下次打开自动清掉坏缓存）。
   ======================================== */

const CACHE_PREFIX = 'gongkao-v';
const CACHE_VERSION = '87.5';

self.addEventListener('install', (event) => {
    self.skipWaiting(); // 立即激活，不等旧页面关闭
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 清空所有缓存（不管新旧前缀），移除任何可能损坏的缓存内容
        const keys = await caches.keys();
        await Promise.all(
            keys.map(key => caches.delete(key).catch(() => {}))
        );
        self.clients.claim(); // 接管页面（但本版不拦截任何请求）
    })());
});

// 关键：不对任何请求调用 event.respondWith → 浏览器按默认方式处理（直连 GitHub Pages）
// 等于"没有 Service Worker"一样稳定，绝不会再白屏
self.addEventListener('fetch', (event) => {
    /* no-op：不拦截 */
});

// 兼容页面发来的消息（不缓存，仅跳过等待）
self.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
