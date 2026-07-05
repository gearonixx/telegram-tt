// Verifies the service worker precaches the manifest's boot assets on install
import { chromium } from '@playwright/test';

const URL_BASE = process.argv[2] || 'http://localhost:8123/';
const CHROME = process.env.PERF_CHROME || '/usr/lib/chromium/chromium';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext()).newPage();
page.on('console', (msg) => {
  if (msg.text().includes('SW')) console.log('[page]', msg.text());
});

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  const manifest = await (await fetch('sw-asset-manifest.json')).json();
  const bootUrls = manifest.boot.map((p) => new URL(p, location.href).href);

  for (let i = 0; i < 40; i++) {
    const cache = await caches.open('tt-assets');
    const keys = (await cache.keys()).map((r) => r.url);
    const missing = bootUrls.filter((u) => !keys.includes(u));
    if (!missing.length) {
      return {
        ok: true, bootCount: bootUrls.length, totalCached: keys.length, swState: registration.active?.state,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const cache = await caches.open('tt-assets');
  const keys = (await cache.keys()).map((r) => r.url);
  return { ok: false, missing: bootUrls.filter((u) => !keys.includes(u)), cached: keys };
});

console.log(JSON.stringify(result, undefined, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
