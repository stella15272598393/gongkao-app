const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8077;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Strip query string (?t= cache-busting)
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  // Resolve junction (C:\Users\UserX -> C:\Users\彭冠莲) so the check is consistent
  const rootRes = path.resolve(ROOT);
  const resolved = path.resolve(filePath);
  if (resolved !== rootRes && !resolved.startsWith(rootRes + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('READY on ' + PORT));
