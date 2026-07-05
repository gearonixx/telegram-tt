/*
 * CPU profiler for the mocked scenario: samples the main thread and every
 * worker (GramJS + 4 media workers) with the V8 sampling profiler while the
 * sticker channel animates and while history scrolls, then aggregates
 * self-time per function across threads.
 *
 * Usage: npm run dev:mocked, then
 *   node perf/profile.mjs [--seconds 12] [--out perf/out/profile.json]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const URL_APP = 'http://localhost:1235/#mockScenario=perf';
const EXECUTABLE = process.env.PERF_CHROME || '/usr/bin/chromium';
const SECONDS = Number(process.argv[process.argv.indexOf('--seconds') + 1]) || 12;
const OUT = join(DIR, 'out', 'profile.json');

const { chromium } = await import('@playwright/test');

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

async function openChatByTitle(page, title) {
  await page.evaluate((chatTitle) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(chatTitle));
    if (!target) return;
    (target.querySelector('a, .ListItem-button') || target)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, title);
  await sleep(1500);
}

function aggregate(profile, threadLabel, buckets) {
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selfMicros = new Map();
  for (let i = 0; i < samples.length; i++) {
    const delta = timeDeltas[i] || 0;
    selfMicros.set(samples[i], (selfMicros.get(samples[i]) || 0) + delta);
  }
  for (const [id, micros] of selfMicros) {
    const node = byId.get(id);
    if (!node) continue;
    const cf = node.callFrame;
    const url = (cf.url || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
    const name = cf.functionName || '(anonymous)';
    const key = `${name} @ ${url || '(v8)'}${cf.url ? `:${cf.lineNumber + 1}` : ''}`;
    const entry = buckets.get(key) || { micros: 0, threads: new Set() };
    entry.micros += micros;
    entry.threads.add(threadLabel);
    buckets.set(key, entry);
  }
  const total = [...selfMicros.values()].reduce((a, b) => a + b, 0);
  return total;
}

const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

// Attach profilers to every worker as it appears
const workerSessions = [];
context.on('weberror', () => {});
page.on('worker', async (worker) => {
  try {
    const session = await context.newCDPSession(worker);
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    workerSessions.push({ worker, session, url: worker.url().replace(/^.*\//, '') });
  } catch { /* worker may be gone */ }
});

const main = await context.newCDPSession(page);
await main.send('Profiler.enable');
await main.send('Profiler.setSamplingInterval', { interval: 200 });

console.log('[profile] loading app...');
await page.goto(URL_APP);
await page.waitForSelector('.chat-item-clickable', { timeout: 120_000 });
await sleep(3000);

console.log('[profile] opening sticker channel...');
await openChatByTitle(page, 'Perf Channel');
await sleep(2000);

console.log(`[profile] profiling ${SECONDS}s of steady animation + scroll...`);
await main.send('Profiler.start');
await Promise.all(workerSessions.map(({ session }) => session.send('Profiler.start').catch(() => {})));

// Half steady animation, half scroll load
await sleep(SECONDS * 500);
await page.evaluate(async () => {
  const list = document.querySelector('.MessageList');
  if (!list) return;
  for (let round = 0; round < 6; round++) {
    for (let top = list.scrollTop; top > 0; top -= 400) {
      list.scrollTop = Math.max(0, top);
      await new Promise((resolve) => { setTimeout(resolve, 60); });
    }
    list.scrollTop = 800;
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
});
await sleep(SECONDS * 500 - 3000 > 0 ? SECONDS * 500 - 3000 : 1000);

const buckets = new Map();
const threadTotals = {};
const { profile: mainProfile } = await main.send('Profiler.stop');
threadTotals.main = aggregate(mainProfile, 'main', buckets);

for (const { session, url } of workerSessions) {
  try {
    const { profile } = await session.send('Profiler.stop');
    threadTotals[url] = (threadTotals[url] || 0) + aggregate(profile, url, buckets);
  } catch { /* worker died */ }
}

await browser.close();

const rows = [...buckets.entries()]
  .map(([key, { micros, threads }]) => ({ key, ms: +(micros / 1000).toFixed(1), threads: [...threads].join(',') }))
  .sort((a, b) => b.ms - a.ms);

const totalMs = Object.values(threadTotals).reduce((a, b) => a + b, 0) / 1000;
console.log(`\nThread totals (ms): ${Object.entries(threadTotals).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}`).join('  ')}`);
console.log(`\nTop 40 functions by self time (of ${totalMs.toFixed(0)} ms sampled):`);
for (const row of rows.slice(0, 40)) {
  console.log(`${String(row.ms).padStart(9)} ms  ${row.key}  [${row.threads}]`);
}

mkdirSync(join(DIR, 'out'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ startedAt: new Date().toISOString(), seconds: SECONDS, threadTotals, top: rows.slice(0, 300) }, undefined, 2));
console.log(`\nSaved to ${OUT}`);
