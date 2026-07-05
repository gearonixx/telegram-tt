/*
 * Update-pass probe: drives a mocked build through a scripted message-list
 * scrollback, chat-switch churn and a forward scroll, recording main-thread
 * frame deltas, long tasks, CDP script/layout durations and JS-heap
 * allocation volume. Fixed work per run, so two builds compare directly.
 *
 * Usage: node perf/probe-scroll.mjs <url> [--runs N] [--label X]
 */
import { writeFileSync } from 'fs';
import { chromium } from '@playwright/test';

const urlBase = process.argv[2] || 'http://localhost:8099/';
const url = urlBase.includes('#') ? urlBase : `${urlBase}#mockScenario=perf`;
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg !== -1 ? Number(process.argv[runsArg + 1]) : 3;
const labelArg = process.argv.indexOf('--label');
const LABEL = labelArg !== -1 ? process.argv[labelArg + 1] : 'scroll';

const SWEEP_ROUNDS = 10;
const CHURN_ROUNDS = 6;

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/lib/chromium/chromium',
  args: ['--enable-precise-memory-info'],
});

const RECORDER_SNIPPET = `(() => {
  const frames = [];
  const longtasks = [];
  let last;
  let raf;
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longtasks.push(e.duration);
  });
  po.observe({ type: 'longtask', buffered: false });
  const heapSamples = [];
  const heapTimer = setInterval(() => {
    if (performance.memory) heapSamples.push(performance.memory.usedJSHeapSize);
  }, 100);
  function loop(t) {
    if (last !== undefined) frames.push(t - last);
    last = t;
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  window.__probeRec = {
    stop() {
      cancelAnimationFrame(raf);
      po.disconnect();
      clearInterval(heapTimer);
      let alloc = 0;
      let gcDrops = 0;
      for (let i = 1; i < heapSamples.length; i++) {
        const d = heapSamples[i] - heapSamples[i - 1];
        if (d > 0) alloc += d;
        else if (d < -1e6) gcDrops++;
      }
      delete window.__probeRec;
      return { frames, longtasks, alloc, gcDrops };
    },
  };
})()`;

const CDP_METRICS = ['ScriptDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration'];

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function median(values) {
  return quantile(values.slice().sort((a, b) => a - b), 0.5);
}

async function getMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => CDP_METRICS.includes(m.name)).map((m) => [m.name, m.value]));
}

async function startPhase(page, cdp) {
  const before = await getMetrics(cdp);
  await page.evaluate(RECORDER_SNIPPET);
  return before;
}

async function stopPhase(page, cdp, before) {
  const rec = await page.evaluate('window.__probeRec.stop()');
  const after = await getMetrics(cdp);
  const frames = rec.frames.slice().sort((a, b) => a - b);
  return {
    frameCount: rec.frames.length,
    frameP50: quantile(frames, 0.5),
    frameP95: quantile(frames, 0.95),
    frameMax: frames[frames.length - 1] || 0,
    framesOver17: rec.frames.filter((f) => f > 17).length,
    framesOver34: rec.frames.filter((f) => f > 34).length,
    longtaskMs: rec.longtasks.reduce((a, b) => a + b, 0),
    longtaskCount: rec.longtasks.length,
    allocMb: rec.alloc / (1024 * 1024),
    gcDrops: rec.gcDrops,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    layoutCount: after.LayoutCount - before.LayoutCount,
    styleCount: after.RecalcStyleCount - before.RecalcStyleCount,
  };
}

async function openChatByTitle(page, title) {
  const ok = await page.evaluate((chatTitle) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(chatTitle));
    if (!target) return false;
    (target.querySelector('a, .ListItem-button') || target)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }, title);
  if (!ok) throw new Error(`Chat "${title}" not found`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function sweepUp(page, rounds) {
  for (let r = 0; r < rounds; r++) {
    await page.evaluate(async () => {
      const list = document.querySelector('.MessageList');
      if (!list) return;
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
    await sleep(600);
  }
}

async function scrollDown(page) {
  await page.evaluate(async () => {
    const list = document.querySelector('.MessageList');
    if (!list) return;
    for (let top = list.scrollTop; top < list.scrollHeight; top += 500) {
      list.scrollTop = top;
      await new Promise((resolve) => { setTimeout(resolve, 40); });
    }
    list.scrollTop = list.scrollHeight;
  });
}

const runs = [];

for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-item-clickable', { timeout: 45000 });
  await sleep(2500);

  await openChatByTitle(page, 'Perf Channel');
  await page.waitForSelector('.MessageList', { timeout: 15000 });
  await sleep(2500);

  const result = { messages: 0 };

  const beforeScroll = await startPhase(page, cdp);
  await sweepUp(page, SWEEP_ROUNDS);
  result.scrollback = await stopPhase(page, cdp, beforeScroll);

  const beforeChurn = await startPhase(page, cdp);
  for (let i = 0; i < CHURN_ROUNDS; i++) {
    await openChatByTitle(page, i % 2 === 0 ? 'Perf Media' : 'Perf Channel');
    await sleep(1200);
  }
  result.churn = await stopPhase(page, cdp, beforeChurn);

  await openChatByTitle(page, 'Perf Channel');
  await sleep(1500);
  const beforeDown = await startPhase(page, cdp);
  await scrollDown(page);
  await sleep(500);
  result.forward = await stopPhase(page, cdp, beforeDown);

  result.messages = await page.evaluate(() => document.querySelectorAll('.Message').length);

  runs.push(result);
  console.log(`run ${run + 1}/${RUNS}: ${result.messages} messages in DOM, `
    + `scrollback p95 ${result.scrollback.frameP95.toFixed(1)} ms, alloc ${result.scrollback.allocMb.toFixed(0)} MB`);

  await context.close();
}

await browser.close();

const report = {};
for (const phase of ['scrollback', 'churn', 'forward']) {
  report[phase] = {};
  const keys = Object.keys(runs[0][phase]);
  for (const key of keys) {
    report[phase][key] = median(runs.map((r) => r[phase][key]));
  }
}

console.log(`\n=== ${LABEL} (medians of ${RUNS} runs) ===`);
for (const [phase, metrics] of Object.entries(report)) {
  console.log(`\n${phase}:`);
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`  ${key.padEnd(14)} ${value.toFixed(key.includes('Count') || key.includes('Drops') || key.includes('Over') ? 0 : 1)}`);
  }
}

writeFileSync(new URL(`./out/${LABEL}.json`, import.meta.url), JSON.stringify({ runs, report }, undefined, 2));
