/*
 * Minimal static server with in-memory brotli, mirroring how the production
 * deployment (and `web.telegram.org/a`) serves the app. Use it instead of
 * `python -m http.server` when measuring load speed: uncompressed serving
 * inflates the wire size ~2.5× and skews any comparison.
 *
 * Usage: node perf/serve-dist.mjs [dir] [port]
 */
import { createServer } from 'http';
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { brotliCompressSync, constants } from 'zlib';

const DIR = process.argv[2] || 'dist';
const PORT = Number(process.argv[3] || 8099);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm', '.tgs': 'application/octet-stream', '.ico': 'image/x-icon',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.txt', '.webmanifest', '.map']);

const cache = new Map();

function loadFile(path) {
  if (cache.has(path)) return cache.get(path);
  const raw = readFileSync(path);
  const ext = extname(path);
  const entry = { raw, ext, br: undefined };
  if (COMPRESSIBLE.has(ext)) {
    entry.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
  }
  // Hashed assets are immutable, but `index.html` changes on every rebuild
  if (ext !== '.html') cache.set(path, entry);
  return entry;
}

createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = join(DIR, pathname);
  let entry;
  try {
    if (!statSync(filePath).isFile()) throw new Error('not a file');
    entry = loadFile(filePath);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  const headers = { 'Content-Type': MIME[entry.ext] || 'application/octet-stream' };
  const acceptsBr = (req.headers['accept-encoding'] || '').includes('br');
  if (entry.br && acceptsBr) {
    headers['Content-Encoding'] = 'br';
    res.writeHead(200, headers).end(entry.br);
  } else {
    res.writeHead(200, headers).end(entry.raw);
  }
}).listen(PORT, () => {
  const files = readdirSync(DIR).length;
  console.log(`serving ${DIR} (${files} top-level entries) on http://localhost:${PORT}/ with brotli`);
});
