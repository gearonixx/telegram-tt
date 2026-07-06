// Store-size attribution probe: drives the mocked scenario (open sticker +
// photo channels, scroll both), then dumps `window.__globalStoreStats()` to
// rank the biggest NON-media retained top-level GlobalState structures.
// Usage: node perf/serve-dist.mjs dist 8473 & node perf/probe-store.mjs
import { chromium } from '@playwright/test';

import { ensurePerfPhoto } from './gen-photo.mjs';

const URL = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8473/#mockScenario=perf';
const CHROME = process.env.PERF_CHROME || '/usr/bin/chromium';
const SCROLL_ROUNDS = 12;

function sleep(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

async function openChat(page, title) {
  await page.evaluate((t) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(t));
    (target?.querySelector('a, .ListItem-button') || target)
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, title);
  await page.waitForSelector('.MessageList .message-list-item', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
}

async function scrollUp(page, rounds) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => {
      const list = document.querySelector('.MessageList');
      if (list) list.scrollTop = 0;
    });
    await sleep(700);
  }
}

async function main() {
  ensurePerfPhoto();
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-item-clickable', { timeout: 45000 });
  await sleep(2000);

  await openChat(page, 'Perf Channel');
  await scrollUp(page, SCROLL_ROUNDS);
  const c1 = await page.evaluate(() => document.querySelectorAll('.MessageList .message-list-item').length);
  await openChat(page, 'Perf Media');
  await scrollUp(page, SCROLL_ROUNDS);
  const c2 = await page.evaluate(() => document.querySelectorAll('.MessageList .message-list-item').length);
  console.log('dom message items after scroll:', c1, c2);
  const msgCounts = await page.evaluate(() => {
    const g = window.__globalStoreStats?.();
    return g;
  });
  await openChat(page, 'Perf Channel');
  await sleep(1000);
  void msgCounts;

  const stats = await page.evaluate(() => (window.__globalStoreStats ? window.__globalStoreStats() : undefined));
  if (!stats) { console.log('no __globalStoreStats'); await browser.close(); return; }

  const rows = Object.entries(stats.rows)
    .map(([k, v]) => ({ key: k, kb: +(v.bytes / 1024).toFixed(1), count: v.count }))
    .sort((a, b) => b.kb - a.kb);
  console.log('total store KB:', (stats.total / 1024).toFixed(1));
  console.table(rows.slice(0, 25));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
