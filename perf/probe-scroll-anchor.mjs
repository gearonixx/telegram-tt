// Probes bottom-of-chat scroll correctness: drift without input, jumps while
// wheeling near the tail, and phantom space below the last message
import { chromium } from '@playwright/test';

const URL_BASE = process.argv[2] || 'http://localhost:1236/#mockScenario=perf';
const CHAT_TITLE = process.argv[3] || 'Perf Channel';
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
await sleep(2000);

await page.evaluate((chatTitle) => {
  const items = [...document.querySelectorAll('.chat-item-clickable')];
  const target = items.find((el) => el.textContent?.includes(chatTitle));
  (target?.querySelector('a, .ListItem-button') || target)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}, CHAT_TITLE);
await page.waitForSelector('.MessageList .message-list-item', { timeout: 15000 });
await sleep(2500);

// Phase 1: jump to bottom, then observe 4s with no input
const phase1 = await page.evaluate(async () => {
  const list = document.querySelector('.MessageList');
  list.scrollTop = list.scrollHeight;
  await new Promise((resolve) => { setTimeout(resolve, 600); });

  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push({
      t: i * 100,
      top: Math.round(list.scrollTop),
      max: Math.round(list.scrollHeight - list.clientHeight),
    });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }

  const lastItem = [...list.querySelectorAll('.message-list-item')].at(-1);
  const listRect = list.getBoundingClientRect();
  const lastRect = lastItem?.getBoundingClientRect();
  return {
    samples,
    gapBelowLastMessage: lastRect ? Math.round(listRect.bottom - lastRect.bottom) : undefined,
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
  };
});

// Phase 2: wheel up, then wheel down past the bottom, sampling scrollTop
await page.mouse.move(720, 450);
const wheelSeries = [];
for (let step = 0; step < 8; step++) {
  await page.mouse.wheel(0, -300);
  await sleep(120);
  wheelSeries.push({ phase: 'up', top: await page.evaluate(() => Math.round(document.querySelector('.MessageList').scrollTop)) });
}
for (let step = 0; step < 16; step++) {
  await page.mouse.wheel(0, 300);
  await sleep(120);
  wheelSeries.push({ phase: 'down', top: await page.evaluate(() => Math.round(document.querySelector('.MessageList').scrollTop)) });
}
await sleep(1000);
const finalState = await page.evaluate(() => {
  const list = document.querySelector('.MessageList');
  return { top: Math.round(list.scrollTop), max: Math.round(list.scrollHeight - list.clientHeight) };
});

const idleJumps = [];
for (let i = 1; i < phase1.samples.length; i++) {
  const delta = phase1.samples[i].top - phase1.samples[i - 1].top;
  if (Math.abs(delta) > 2) idleJumps.push({ atMs: phase1.samples[i].t, delta });
}
const downTops = wheelSeries.filter((s) => s.phase === 'down').map((s) => s.top);
const reversals = downTops.filter((top, i) => i > 0 && top < downTops[i - 1] - 2).length;

console.log(JSON.stringify({
  idleJumps,
  gapBelowLastMessage: phase1.gapBelowLastMessage,
  restingBelowMax: finalState.max - finalState.top,
  reversalsWhileWheelingDown: reversals,
  wheelSeries: wheelSeries.map((s) => s.top).join(','),
  idleSeries: phase1.samples.map((s) => s.top).join(','),
}, undefined, 1));

await browser.close();
