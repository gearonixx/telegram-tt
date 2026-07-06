/*
 * Logged-in boot timeline probe (mocked mode). Loads the app with an
 * authorized mock session and records the runtime boot milestones emitted as
 * DEBUG `performance.mark`s (`boot:*`) plus paint timings and the moment the
 * chat list first renders rows. Runs a cold pass (fresh storage) and a warm
 * pass (reload in the same context, so the IndexedDB global cache is primed).
 *
 * Usage: node perf/probe-coldstart.mjs [url] [--runs N] [--throttle]
 *   url defaults to http://localhost:4652/#mockScenario=perf
 */
import { chromium } from '@playwright/test';

const rawUrl = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : 'http://localhost:4652/';
const URL = rawUrl.includes('#') ? rawUrl : `${rawUrl}#mockScenario=perf`;
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg !== -1 ? Number(process.argv[runsArg + 1]) : 5;
const shouldThrottle = process.argv.includes('--throttle');
const THROTTLE = {
  offline: false,
  downloadThroughput: (10 * 1024 * 1024) / 8,
  uploadThroughput: (10 * 512 * 1024) / 8,
  latency: 40,
};

const CHAT_ROW = '.chat-list .ListItem';
const EXECUTABLE = process.env.PERF_CHROME || '/usr/lib/chromium/chromium';

const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Milestones printed in order; `null` end anchors compute from navigationStart
const SEGMENTS = [
  ['navigation → init()', undefined, 'boot:init'],
  ['init → cache-read start', 'boot:init', 'boot:cache-read-start'],
  ['cache read (idb+parse)', 'boot:cache-read-start', 'boot:cache-read-end'],
  ['migrateCache', 'boot:cache-read-end', 'boot:cache-migrated'],
  ['hydrate (setGlobal)', 'boot:cache-read-end', 'boot:global-hydrated'],
  ['init action', 'boot:global-hydrated', 'boot:init-action'],
  ['init-action → render', 'boot:init-action', 'boot:render-start'],
  ['TeactDOM.render', 'boot:render-start', 'boot:render-end'],
  ['render → chat rows paint', 'boot:render-end', 'chatRows'],
  ['TOTAL nav → chat rows', undefined, 'chatRows'],
];

async function capture(page) {
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(CHAT_ROW, { timeout: 30000 });
  const chatRowsAt = Date.now() - t0;

  const data = await page.evaluate(() => {
    const marks = {};
    for (const m of performance.getEntriesByType('mark')) {
      if (m.name.startsWith('boot:')) marks[m.name] = m.startTime;
    }
    const paints = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
    return { marks, paints };
  });
  // Anchor chat-row paint on the page clock (approx via a fresh mark)
  const chatRows = await page.evaluate(() => {
    performance.mark('probe:chat-rows');
    return performance.getEntriesByName('probe:chat-rows')[0].startTime;
  });
  data.marks.chatRows = chatRows;
  data.wallChatRows = chatRowsAt;
  return data;
}

function seg(marks, from, to) {
  const end = marks[to];
  if (end === undefined) return undefined;
  const start = from === undefined ? 0 : marks[from];
  if (start === undefined) return undefined;
  return end - start;
}

async function runPass(label, makeContext, warm) {
  const rows = [];
  let fcp = [];
  let lastMarks;
  for (let i = 0; i < RUNS; i++) {
    const context = await makeContext();
    const page = await context.newPage();
    if (shouldThrottle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', THROTTLE);
    }
    let cold = await capture(page);
    if (warm) {
      // Idle so the throttled cache write (UPDATE_THROTTLE 5s) flushes to IDB
      await page.waitForTimeout(6500);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector(CHAT_ROW, { timeout: 30000 });
      cold = await capture(page);
    }
    lastMarks = cold.marks;
    rows.push(cold.marks);
    if (cold.paints['first-contentful-paint']) fcp.push(cold.paints['first-contentful-paint']);
    await context.close();
  }

  console.log(`\n=== ${label} (${RUNS} runs${shouldThrottle ? ', throttled 10/40' : ''}) ===`);
  console.log(`marks present: ${Object.keys(lastMarks).filter((k) => k !== 'chatRows').join(', ') || '(none)'}`);
  console.log('segment'.padEnd(28), 'median ms');
  for (const [name, from, to] of SEGMENTS) {
    const vals = rows.map((m) => seg(m, from, to)).filter((v) => v !== undefined);
    if (!vals.length) continue;
    console.log(name.padEnd(28), median(vals).toFixed(1).padStart(8));
  }
  if (fcp.length) console.log('FCP'.padEnd(28), median(fcp).toFixed(1).padStart(8));
}

await runPass('COLD (fresh storage)', () => browser.newContext(), false);
await runPass('WARM (primed idb cache)', () => browser.newContext(), true);

await browser.close();
