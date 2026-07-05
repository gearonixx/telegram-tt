// Probes the forward infinite-scroll path: scroll deep into history, then
// descend back to the bottom across slice boundaries, watching for upward
// teleports or landing away from the real bottom
import { chromium } from '@playwright/test';

const URL_BASE = process.argv[2] || 'http://localhost:1236/#mockScenario=perf';
const CHAT_TITLE = process.argv[3] || 'Perf Channel';
const CHROME = process.env.PERF_CHROME || '/usr/lib/chromium/chromium';
const SWEEP_ROUNDS = 6;

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

// Phase 1: deep scrollback (several viewport slices)
for (let round = 0; round < SWEEP_ROUNDS; round++) {
  await page.evaluate(async () => {
    const list = document.querySelector('.MessageList');
    if (list.scrollTop < 400) {
      list.scrollTop = 800;
      await new Promise((resolve) => { setTimeout(resolve, 120); });
    }
    for (let top = list.scrollTop; top > 0; top -= 400) {
      list.scrollTop = Math.max(0, top);
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    list.scrollTop = 0;
  });
  await sleep(700);
}
const afterSweep = await page.evaluate(() => {
  const list = document.querySelector('.MessageList');
  return { messages: document.querySelectorAll('.Message').length, scrollHeight: list.scrollHeight };
});
console.log(`[deepscroll] after sweep-up: ${afterSweep.messages} messages, scrollHeight ${afterSweep.scrollHeight}`);

// Phase 2: descend to the bottom in wheel-sized steps, sampling positions
const descent = await page.evaluate(async () => {
  const list = document.querySelector('.MessageList');
  const samples = [];
  let previousTop = list.scrollTop;
  for (let step = 0; step < 400; step++) {
    list.scrollTop += 500;
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    const top = Math.round(list.scrollTop);
    const max = Math.round(list.scrollHeight - list.clientHeight);
    samples.push({ step, top, max, jumpedBack: top < previousTop - 100 });
    // Reached the resting bottom: three settles at max
    if (top >= max - 1 && samples.length > 3
      && samples.at(-2).top >= samples.at(-2).max - 1
      && samples.at(-3).top >= samples.at(-3).max - 1) break;
    previousTop = top;
  }
  await new Promise((resolve) => { setTimeout(resolve, 1500); });
  const finalTop = Math.round(list.scrollTop);
  const finalMax = Math.round(list.scrollHeight - list.clientHeight);
  const lastItem = [...list.querySelectorAll('.message-list-item')].at(-1);
  return {
    steps: samples.length,
    backwardJumps: samples.filter((s) => s.jumpedBack).map((s) => ({ step: s.step, top: s.top })),
    finalOffMaxBy: finalMax - finalTop,
    settledSeries: samples.slice(-12).map((s) => `${s.top}/${s.max}`).join(' '),
    lastMessageVisible: lastItem ? lastItem.getBoundingClientRect().top < list.getBoundingClientRect().bottom : false,
  };
});

console.log(JSON.stringify(descent, undefined, 1));
await browser.close();
