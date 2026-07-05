// Probes scroll behavior around message sending: pinned-to-bottom sends must
// keep the list at max scroll without jumps; scrolled-up sends must not yank
import { chromium } from '@playwright/test';

const URL_BASE = process.argv[2] || 'http://localhost:1237/';
const CHAT_TITLE = process.argv[3] || 'aass';
const CHROME = process.env.PERF_CHROME || '/usr/lib/chromium/chromium';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-item-clickable', { timeout: 45000 });
await sleep(1500);

await page.evaluate((chatTitle) => {
  const items = [...document.querySelectorAll('.chat-item-clickable')];
  const target = items.find((el) => el.textContent?.includes(chatTitle));
  (target?.querySelector('a, .ListItem-button') || target)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}, CHAT_TITLE);
await page.waitForSelector('#editable-message-text', { timeout: 15000 });
await sleep(1500);

function startSampler() {
  return page.evaluate(() => {
    const list = document.querySelector('.MessageList');
    window.__scrollSamples = [];
    window.__scrollTimer = setInterval(() => {
      window.__scrollSamples.push({
        top: Math.round(list.scrollTop),
        max: Math.round(list.scrollHeight - list.clientHeight),
      });
    }, 50);
  });
}

function stopSampler() {
  return page.evaluate(() => {
    clearInterval(window.__scrollTimer);
    const samples = window.__scrollSamples;
    delete window.__scrollSamples;
    return samples;
  });
}

async function sendMessage(text) {
  await page.click('#editable-message-text');
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');
}

function analyze(samples, { expectPinned }) {
  const offMax = samples.map((s) => s.max - s.top);
  const jumps = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].top - samples[i - 1].top;
    const maxDelta = samples[i].max - samples[i - 1].max;
    // A pinned list may grow scrollTop together with max; anything else is a jump
    if (Math.abs(delta) > 2 && Math.abs(delta - maxDelta) > 2) jumps.push({ i, delta, maxDelta });
  }
  return {
    jumps,
    endedOffMaxBy: offMax.at(-1),
    worstOffMax: expectPinned ? Math.max(...offMax) : undefined,
    topSeries: samples.map((s) => s.top).join(','),
    maxSeries: samples.map((s) => s.max).join(','),
  };
}

const report = {};

// Pre-fill until the list actually scrolls, so pinning is observable
const countBefore = await page.evaluate(() => document.querySelectorAll('.Message').length);
for (let i = 0; i < 40; i++) {
  await sendMessage(`filler ${i}`);
  await sleep(120);
  if (i % 10 === 9) {
    const isScrollable = await page.evaluate(() => {
      const list = document.querySelector('.MessageList');
      return list.scrollHeight > list.clientHeight + 400;
    });
    if (isScrollable) break;
  }
}
const countAfter = await page.evaluate(() => document.querySelectorAll('.Message').length);
console.log(`[fill] messages ${countBefore} -> ${countAfter}`);
if (countAfter === countBefore) {
  console.log('[fill] sends do not append in this mock — aborting');
  await browser.close();
  process.exit(2);
}
await sleep(1000);

// Scenario A: pinned to bottom, send twice
await page.evaluate(() => {
  const list = document.querySelector('.MessageList');
  list.scrollTop = list.scrollHeight;
});
await sleep(800);
await startSampler();
await sendMessage('probe pinned send 1');
await sleep(1200);
await sendMessage('probe pinned send 2');
await sleep(1500);
report.pinnedSends = analyze(await stopSampler(), { expectPinned: true });

// Scenario B: scrolled up 500px, send once — the view must not move
await page.evaluate(() => {
  const list = document.querySelector('.MessageList');
  list.scrollTop = list.scrollHeight - list.clientHeight - 500;
});
await sleep(800);
await startSampler();
await sendMessage('probe scrolled-up send');
await sleep(1800);
report.scrolledUpSend = analyze(await stopSampler(), { expectPinned: false });

console.log(JSON.stringify(report, undefined, 1));
await browser.close();
