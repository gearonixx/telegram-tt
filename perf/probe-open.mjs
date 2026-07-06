/*
 * Chat-open latency probe: what happens on the main thread between the
 * `mousedown` on a chat list item and the new chat's messages being painted.
 *
 * Per open it records:
 *   - syncMs   — duration of the click task itself (synchronous work blocking
 *                the next paint);
 *   - openMs   — click → first rAF frame with the new chat's messages in the
 *                DOM (existing `.MessageList` elements are tagged before the
 *                click; `MessageList` is keyed by chat id, so every open
 *                mounts a fresh element);
 *   - paintMs  — click → the rAF after that frame, i.e. the first frame with
 *                messages has been submitted for paint;
 *   - settleMs — click → last change of the list's item count within 1.2 s
 *                (catches the deferred second-slice render);
 *   - CDP script/layout deltas and long tasks bounded to the open window.
 *
 * Cold opens happen once per run (fresh context); warm re-opens alternate
 * between the two mock chats. CPU throttling (default 4×) makes main-thread
 * costs visible above frame noise on fast machines.
 *
 * Usage: npm run dev:mocked -- --port 4650, then
 *   node perf/probe-open.mjs http://localhost:4650/ [--runs N] [--label X] [--throttle N]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { chromium } from '@playwright/test';

const urlBase = process.argv[2] || 'http://localhost:4650/';
const url = urlBase.includes('#') ? urlBase : `${urlBase}#mockScenario=perf`;
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg !== -1 ? Number(process.argv[runsArg + 1]) : 5;
const labelArg = process.argv.indexOf('--label');
const LABEL = labelArg !== -1 ? process.argv[labelArg + 1] : 'open';
const throttleArg = process.argv.indexOf('--throttle');
const CPU_THROTTLE = throttleArg !== -1 ? Number(process.argv[throttleArg + 1]) : 4;
const CHROME = process.env.PERF_CHROME || '/usr/lib/chromium/chromium';

const STICKER_CHAT = 'Perf Channel';
const PHOTO_CHAT = 'Perf Media';
const WARM_CYCLES = 4;
const SETTLE_WINDOW_MS = 1200;
const BETWEEN_OPENS_MS = 1000;
const OPEN_TIMEOUT_MS = 20000;

const CDP_METRICS = ['ScriptDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration'];

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

async function getMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => CDP_METRICS.includes(m.name)).map((m) => [m.name, m.value]));
}

async function measureOpen(page, cdp, title) {
  const before = await getMetrics(cdp);
  const rec = await page.evaluate(async ({ chatTitle, timeoutMs, settleWindowMs }) => {
    document.querySelectorAll('.MessageList').forEach((el) => { el.dataset.probeSeen = '1'; });
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(chatTitle));
    if (!target) return { error: `chat "${chatTitle}" not found` };

    const longtasks = [];
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longtasks.push(e.duration);
    });
    po.observe({ type: 'longtask', buffered: false });

    const findNewList = () => document.querySelector('.MessageList:not([data-probe-seen])');

    const t0 = performance.now();
    (target.querySelector('a, .ListItem-button') || target)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const syncMs = performance.now() - t0;

    const result = await new Promise((resolve) => {
      let openMs;
      let paintMs;
      let settleMs = 0;
      let lastCount = 0;
      let firstSeenAt;
      function check() {
        const now = performance.now();
        const newList = findNewList();
        const count = newList ? newList.querySelectorAll('.message-list-item').length : 0;
        if (openMs === undefined && count > 0) {
          openMs = now - t0;
          firstSeenAt = now;
        } else if (openMs !== undefined && paintMs === undefined) {
          // The frame that contained the messages has been submitted by now
          paintMs = now - t0;
        }
        if (count !== lastCount) {
          lastCount = count;
          settleMs = now - t0;
        }
        if (openMs !== undefined && now - firstSeenAt > settleWindowMs) {
          resolve({ openMs, paintMs, settleMs, itemCount: lastCount });
          return;
        }
        if (openMs === undefined && now - t0 > timeoutMs) {
          resolve(undefined);
          return;
        }
        requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    });
    po.disconnect();
    if (!result) return { error: 'timed out waiting for messages' };
    return {
      syncMs,
      ...result,
      longtaskMs: longtasks.reduce((a, b) => a + b, 0),
      longtaskCount: longtasks.length,
    };
  }, { chatTitle: title, timeoutMs: OPEN_TIMEOUT_MS, settleWindowMs: SETTLE_WINDOW_MS });

  if (rec.error) throw new Error(rec.error);
  const after = await getMetrics(cdp);
  await sleep(BETWEEN_OPENS_MS);
  return {
    ...rec,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    layoutCount: after.LayoutCount - before.LayoutCount,
    styleCount: after.RecalcStyleCount - before.RecalcStyleCount,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const runs = [];

for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-item-clickable', { timeout: 60000 });
  await sleep(2500);
  if (CPU_THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  const result = { coldSticker: undefined, coldPhoto: undefined, warmSticker: [], warmPhoto: [] };

  result.coldSticker = await measureOpen(page, cdp, STICKER_CHAT);
  result.coldPhoto = await measureOpen(page, cdp, PHOTO_CHAT);

  for (let i = 0; i < WARM_CYCLES; i++) {
    result.warmSticker.push(await measureOpen(page, cdp, STICKER_CHAT));
    result.warmPhoto.push(await measureOpen(page, cdp, PHOTO_CHAT));
  }

  runs.push(result);
  console.log(`run ${run + 1}/${RUNS}: cold sticker sync ${result.coldSticker.syncMs.toFixed(0)} / paint ${result.coldSticker.paintMs.toFixed(0)} ms, `
    + `cold photo ${result.coldPhoto.syncMs.toFixed(0)} / ${result.coldPhoto.paintMs.toFixed(0)} ms, `
    + `warm sticker ~${median(result.warmSticker.map((r) => r.paintMs)).toFixed(0)} ms, `
    + `warm photo ~${median(result.warmPhoto.map((r) => r.paintMs)).toFixed(0)} ms`);

  await context.close();
}

await browser.close();

const KEYS = [
  'syncMs', 'openMs', 'paintMs', 'settleMs', 'itemCount',
  'scriptMs', 'layoutMs', 'layoutCount', 'styleCount', 'longtaskMs', 'longtaskCount',
];

function summarize(samplesPerRun) {
  const flat = samplesPerRun.flat();
  return Object.fromEntries(KEYS.map((key) => [key, median(flat.map((s) => s[key]))]));
}

const report = {
  coldSticker: summarize(runs.map((r) => [r.coldSticker])),
  coldPhoto: summarize(runs.map((r) => [r.coldPhoto])),
  warmSticker: summarize(runs.map((r) => r.warmSticker)),
  warmPhoto: summarize(runs.map((r) => r.warmPhoto)),
};

console.log(`\n=== ${LABEL} (medians of ${RUNS} runs, ${WARM_CYCLES} warm cycles, cpu ${CPU_THROTTLE}x) ===`);
for (const [scenario, metrics] of Object.entries(report)) {
  console.log(`\n${scenario}:`);
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`  ${key.padEnd(14)} ${value.toFixed(key.includes('Count') || key === 'itemCount' ? 0 : 1)}`);
  }
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./out/${LABEL}.json`, import.meta.url), JSON.stringify({ cpuThrottle: CPU_THROTTLE, runs, report }, undefined, 2));
