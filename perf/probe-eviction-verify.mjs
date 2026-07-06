// Verifies the message-store eviction and measures worker localDb growth in a
// single boot. Grows two channels by deep-scrolling, switches away so both are
// closed, forces the sweep, confirms the runtime store shrinks, reopens an
// evicted channel and confirms it re-renders/scrolls with a clean console.
// Fresh browser per attempt to tolerate a memory-starved shared host.
import { chromium } from '@playwright/test';

const URL = process.argv[2] || 'http://localhost:8474/#mockScenario=perf';
const CHROME = process.env.PERF_CHROME || '/usr/bin/chromium';
const DPR = Number(process.env.PERF_DPR || 1);
const ATTEMPTS = Number(process.env.PERF_ATTEMPTS || 8);

function sleep(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

async function localDbCounts(page) {
  for (const worker of page.workers()) {
    try {
      const db = await worker.evaluate(() => {
        const d = globalThis.getLocalDb?.();
        if (!d) return undefined;
        return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Object.keys(v).length]));
      });
      if (db) return db;
    } catch { /* worker gone */ }
  }
  return undefined;
}

async function openChat(page, title) {
  await page.evaluate((t) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(t));
    (target?.querySelector('a, .ListItem-button') || target)
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, title);
  await page.waitForSelector('.MessageList .message-list-item', { timeout: 15000 }).catch(() => {});
  await sleep(1800);
}

async function deepScroll(page, rounds) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(async () => {
      const list = document.querySelector('.MessageList');
      if (!list) return;
      for (let top = list.scrollTop || list.scrollHeight; top > 0; top -= 500) {
        list.scrollTop = Math.max(0, top - 500);
        await new Promise((r) => { setTimeout(r, 60); });
      }
      list.scrollTop = 0;
    });
    await sleep(700);
  }
}

async function runOnce() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    page.on('pageerror', (err) => { pageErrors.push(err.message); });
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    let loaded = false;
    for (let i = 0; i < 16; i++) {
      await sleep(1500);
      if (await page.evaluate(() => document.querySelectorAll('.chat-item-clickable').length) > 0) { loaded = true; break; }
    }
    if (!loaded) { await browser.close(); return undefined; }

    const localDbBoot = await localDbCounts(page);

    await openChat(page, 'Perf Channel');
    await deepScroll(page, 6);
    await openChat(page, 'Perf Media');
    await deepScroll(page, 6);

    const beforeStats = await page.evaluate(() => window.__messageStoreStats?.());
    const localDbAfterScroll = await localDbCounts(page);

    await openChat(page, 'Saved');
    await sleep(3200);
    await page.evaluate(() => window.__trimMessageStore?.());
    await sleep(400);
    await page.evaluate(() => window.__trimMessageStore?.());
    await sleep(400);
    const afterStats = await page.evaluate(() => window.__messageStoreStats?.());
    const localDbAfterEvict = await localDbCounts(page);

    await openChat(page, 'Perf Channel');
    const reopen = await page.evaluate(async () => {
      const list = document.querySelector('.MessageList');
      const initialCount = document.querySelectorAll('.MessageList .message-list-item').length;
      for (let i = 0; i < 6; i++) { list.scrollTop = 0; await new Promise((r) => { setTimeout(r, 500); }); }
      const afterScrollCount = document.querySelectorAll('.MessageList .message-list-item').length;
      list.scrollTop = list.scrollHeight;
      await new Promise((r) => { setTimeout(r, 800); });
      const lastItem = [...list.querySelectorAll('.message-list-item')].at(-1);
      const listRect = list.getBoundingClientRect();
      const gapBelow = lastItem ? Math.round(listRect.bottom - lastItem.getBoundingClientRect().bottom) : undefined;
      return {
        initialCount, afterScrollCount,
        restingBelowMax: Math.round((list.scrollHeight - list.clientHeight) - list.scrollTop),
        gapBelow,
      };
    });
    const afterReopenStats = await page.evaluate(() => window.__messageStoreStats?.());

    await browser.close();
    return {
      beforeStats, afterStats, afterReopenStats, reopen,
      localDb: { boot: localDbBoot, afterScroll: localDbAfterScroll, afterEvict: localDbAfterEvict },
      consoleErrors, pageErrors,
    };
  } catch (err) {
    await browser.close();
    return { crashed: err.message, pageErrors };
  }
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const result = await runOnce();
  if (result && !result.crashed) { console.log(JSON.stringify(result, undefined, 1)); process.exit(0); }
  console.log(`[attempt ${attempt}] ${result?.crashed ? `crash: ${result.crashed}` : 'no load'}`);
}
console.log(JSON.stringify({ error: 'never loaded after all attempts' }));
process.exit(1);
