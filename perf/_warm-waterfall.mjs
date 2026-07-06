/* Warm reload waterfall: primes cache, then reloads and records each request's cache source. */
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:8472/';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8, latency: 40 });

// Prime
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// Record warm reload
const reqs = new Map();
cdp.on('Network.requestWillBeSent', (p) => { reqs.set(p.requestId, { url: p.request.url, t: p.timestamp }); });
cdp.on('Network.responseReceived', (p) => {
  const r = reqs.get(p.requestId); if (!r) return;
  r.fromSW = p.response.fromServiceWorker;
  r.fromDisk = p.response.fromDiskCache;
  r.status = p.response.status;
  r.mime = p.response.mimeType;
});
cdp.on('Network.loadingFinished', (p) => { const r = reqs.get(p.requestId); if (r) r.enc = p.encodedDataLength; });

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.Transition.is-auth, #Auth, .Auth, .auth-form, .qr-container, #auth-qr-form', { timeout: 30000 }).catch(() => {});
const dt = Date.now() - t0;
await page.waitForTimeout(500);

const rows = [...reqs.values()].map((r) => {
  let src = 'NET';
  if (r.fromSW) src = 'SW';
  else if (r.fromDisk) src = 'DISK';
  const name = r.url.replace(url, '').replace(/^https?:\/\/[^/]+\//, '').slice(0, 55);
  return { src, name, enc: r.enc || 0, status: r.status };
});
const bySrc = {};
for (const r of rows) bySrc[r.src] = (bySrc[r.src] || 0) + 1;
console.log(`warm auth in ${dt}ms | ${rows.length} reqs | by source:`, JSON.stringify(bySrc));
console.log('NON-SW requests (network or disk):');
for (const r of rows.filter((x) => x.src !== 'SW')) console.log(`  [${r.src}] ${r.status} ${r.enc}b  ${r.name}`);
console.log('SW-served:');
for (const r of rows.filter((x) => x.src === 'SW')) console.log(`  [SW] ${r.name}`);
await browser.close();
