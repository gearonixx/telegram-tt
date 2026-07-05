/* Warm-load probe: primes the cache with one visit, then measures a reload in the same context. */
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:8099/';
const RUNS = Number(process.argv[3] || 3);
const AUTH_SELECTOR = '.Transition.is-auth, #Auth, .Auth, .auth-form, .qr-container, #auth-qr-form';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium' });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8, latency: 40,
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(AUTH_SELECTOR, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);

const times = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(AUTH_SELECTOR, { timeout: 45000 }).catch(() => times.push(-1));
  times.push(Date.now() - t0);
  await page.waitForTimeout(400);
}
console.log(`warm auth-screen times: ${JSON.stringify(times)} | median ${times.sort((a, b) => a - b)[Math.floor(times.length / 2)]}ms`);
await browser.close();
