/*
 * Attribution probe for renderer memory: answers *which allocator* holds the
 * bytes that PSS reports after the photo-heavy scroll (S2m) and after
 * returning to the first chat (S4), and how much of it Chromium can drop on
 * its own.
 *
 * For each checkpoint it records:
 *   - a CDP memory-infra dump (per-process allocator tree: malloc,
 *     partition_alloc, blink_gc, v8, cc, skia, discardable, web_cache, ...)
 *   - /proc/<pid>/smaps_rollup fields (Pss, Private_Dirty, LazyFree, Swap) —
 *     LazyFree exposes MADV_FREE'd pages that count toward PSS but are
 *     reclaimable by the kernel at any time
 * The last checkpoint fires `Memory.simulatePressureNotification(critical)`
 * in the renderer and the browser first: whatever survives it is the real
 * working set; whatever disappears was cache/lazy garbage.
 *
 * Usage: npm run dev:mocked, then `node perf/probe-memdump.mjs`.
 * Results: printed tables + perf/out/memdump.json.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from '@playwright/test';

import { ensurePerfPhoto } from './gen-photo.mjs';

const URL = process.argv.find((arg) => arg.startsWith('http')) || 'http://localhost:1235/#mockScenario=perf';
const IS_FULL = process.argv.includes('--full');
const SCROLL_TARGET_MESSAGES = 300;
const SCROLL_TARGET_MEDIA = 200;
const VIEWER_CYCLES = 10;
const MIN_REPORTED_BYTES = 2 * 1024 * 1024;
const OUT_FILE = 'perf/out/memdump.json';

const results = { url: URL, startedAt: new Date().toISOString(), checkpoints: {} };

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  mkdirSync('perf/out', { recursive: true });
  ensurePerfPhoto();

  const executable = process.env.PERF_CHROME || detectChrome();
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  const browserPid = findBrowserPid();

  console.log(`[memdump] url=${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-item-clickable', { timeout: 60_000 });
  await sleep(5000);

  await capture('S0', { page, cdp, browserCdp, browserPid });

  if (IS_FULL) {
    console.log('[memdump] scrolling the sticker channel');
    await openChatByTitle(page, 'Perf Channel');
    await scrollBack(page, SCROLL_TARGET_MESSAGES);
  }

  console.log('[memdump] scrolling the photo channel');
  await openChatByTitle(page, 'Perf Media');
  await scrollBack(page, SCROLL_TARGET_MEDIA);
  await sleep(3000);
  await capture('S2m', { page, cdp, browserCdp, browserPid });

  if (IS_FULL) {
    console.log('[memdump] media viewer cycles');
    await cycleMediaViewer(page, VIEWER_CYCLES);
    await capture('S3', { page, cdp, browserCdp, browserPid });
  }

  console.log('[memdump] back to the sticker channel, short idle');
  await openChatByTitle(page, 'Perf Channel');
  await sleep(30_000);
  await capture('S4lite', { page, cdp, browserCdp, browserPid });

  if (IS_FULL) {
    console.log('[memdump] long idle on the sticker channel');
    await sleep(90_000);
    await capture('S4long', { page, cdp, browserCdp, browserPid });
  }

  console.log('[memdump] simulating critical memory pressure');
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch((err) => {
    console.log(`[memdump]   page-level pressure failed: ${err.message}`);
  });
  await browserCdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch((err) => {
    console.log(`[memdump]   browser-level pressure failed: ${err.message}`);
  });
  await sleep(10_000);
  await capture('S4pressure', { page, cdp, browserCdp, browserPid });

  writeFileSync(OUT_FILE, JSON.stringify(results, undefined, 2));
  console.log(`\n[memdump] written to ${OUT_FILE}`);
  printComparison();

  await Promise.race([context.close(), sleep(5000)]);
  await Promise.race([browser.close(), sleep(5000)]);
  process.exit(0);
}

// --- Checkpoint capture -----------------------------------------------------

async function capture(name, { page, cdp, browserCdp, browserPid }) {
  const processes = browserPid ? readSmapsTree(browserPid) : [];
  const dump = await takeMemoryInfraDump(browserCdp);
  const inPage = await page.evaluate(() => ({
    imgCount: document.images.length,
    domNodes: document.getElementsByTagName('*').length,
    blobUrls: performance.getEntriesByType?.('resource')?.filter((e) => e.name.startsWith('blob:')).length,
  })).catch(() => undefined);

  results.checkpoints[name] = { at: new Date().toISOString(), processes, allocators: dump, inPage };

  console.log(`\n[memdump] === ${name} ===`);
  for (const proc of processes) {
    console.log(`  ${proc.type.padEnd(10)} pid=${proc.pid} pss=${mb(proc.pss)} privDirty=${mb(proc.privateDirty)} lazyFree=${mb(proc.lazyFree)} swap=${mb(proc.swap)}`);
  }
  const byPid = dump || {};
  for (const [pid, info] of Object.entries(byPid)) {
    const proc = processes.find((p) => p.pid === Number(pid));
    const top = Object.entries(info.nodes)
      .filter(([, bytes]) => bytes >= MIN_REPORTED_BYTES)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
    if (!top.length) continue;
    console.log(`  -- allocators for pid ${pid} (${proc?.type || info.label || '?'}):`);
    for (const [node, bytes] of top) {
      console.log(`     ${mb(bytes).padStart(9)}  ${node}`);
    }
  }
}

// --- memory-infra over CDP ---------------------------------------------------

async function takeMemoryInfraDump(browserCdp) {
  const events = [];
  const onData = (payload) => events.push(...payload.value);
  browserCdp.on('Tracing.dataCollected', onData);

  try {
    await browserCdp.send('Tracing.start', {
      traceConfig: {
        includedCategories: ['disabled-by-default-memory-infra'],
        excludedCategories: ['*'],
      },
      transferMode: 'ReportEvents',
    });
    const { success } = await browserCdp.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed' });
    if (!success) console.log('[memdump]   requestMemoryDump reported failure');
    const done = new Promise((resolve) => browserCdp.once('Tracing.tracingComplete', resolve));
    await browserCdp.send('Tracing.end');
    await done;
  } catch (err) {
    console.log(`[memdump]   tracing failed: ${err.message}`);
    browserCdp.off('Tracing.dataCollected', onData);
    return undefined;
  }
  browserCdp.off('Tracing.dataCollected', onData);

  const byPid = {};
  for (const event of events) {
    if (event.ph === 'M' && event.name === 'process_name') {
      byPid[event.pid] = byPid[event.pid] || { nodes: {} };
      byPid[event.pid].label = event.args?.name;
      continue;
    }
    if (event.ph !== 'v' || !event.args?.dumps?.allocators) continue;
    const target = byPid[event.pid] = byPid[event.pid] || { nodes: {} };
    for (const [node, info] of Object.entries(event.args.dumps.allocators)) {
      const attr = info.attrs?.effective_size || info.attrs?.size;
      if (!attr?.value) continue;
      const bytes = parseInt(attr.value, 16);
      if (Number.isNaN(bytes)) continue;
      // Keep roots and depth-2 nodes; deeper ones only when large
      const depth = node.split('/').length;
      if (depth <= 2 || bytes >= MIN_REPORTED_BYTES) {
        target.nodes[node] = bytes;
      }
    }
  }
  return byPid;
}

// --- /proc reading -----------------------------------------------------------

function findBrowserPid() {
  try {
    const candidates = [];
    for (const dir of readdirSync('/proc')) {
      if (!/^\d+$/.test(dir)) continue;
      try {
        const stat = readFileSync(`/proc/${dir}/stat`, 'utf8');
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        if (ppid !== process.pid) continue;
        const cmdline = readFileSync(`/proc/${dir}/cmdline`, 'utf8');
        if (/chrom|headless_shell/.test(cmdline) && !cmdline.includes('--type=')) candidates.push(Number(dir));
      } catch (err) { /* raced */ }
    }
    return candidates[0];
  } catch (err) {
    return undefined;
  }
}

function readSmapsTree(rootPid) {
  const children = new Map();
  for (const dir of readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue;
    try {
      const stat = readFileSync(`/proc/${dir}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(dir));
    } catch (err) { /* raced */ }
  }

  const pids = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    pids.push(pid);
    queue.push(...(children.get(pid) || []));
  }

  return pids.map((pid) => {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      const typeMatch = cmdline.match(/--type=([a-z-]+)/);
      const type = pid === rootPid ? 'browser' : (typeMatch ? typeMatch[1] : 'other');
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const field = (label) => Number(rollup.match(new RegExp(`${label}:\\s+(\\d+) kB`))?.[1] || 0) * 1024;
      return {
        pid,
        type,
        pss: field('Pss'),
        privateDirty: field('Private_Dirty'),
        lazyFree: field('LazyFree'),
        anonymous: field('Anonymous'),
        shmem: field('Shmem'),
        swap: field('Swap'),
      };
    } catch (err) {
      return undefined;
    }
  }).filter(Boolean);
}

// --- Scenario driving (compact copies of measure.mjs helpers) ----------------

async function openChatByTitle(page, title) {
  await page.evaluate((chatTitle) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(chatTitle));
    if (!target) return;
    (target.querySelector('a, .ListItem-button') || target)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, title);
  await sleep(2000);
}

async function cycleMediaViewer(page, cycles) {
  for (let i = 0; i < cycles; i++) {
    await page.evaluate((index) => {
      const medias = [...document.querySelectorAll('.Message .media-inner canvas.full-media, .Message .media-inner img, .Message img.full-media, .Message .Photo img')];
      const media = medias[index % medias.length];
      media?.closest('.media-inner, .Photo')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, i);
    await page.waitForSelector('.MediaViewer', { timeout: 5000 }).catch(() => undefined);
    await sleep(700);
    await page.keyboard.press('Escape');
    await sleep(500);
  }
}

async function scrollBack(page, targetMessages) {
  let lastSeen = 0;
  let stagnantRounds = 0;
  for (let i = 0; i < 50; i++) {
    const seen = await page.evaluate(async () => {
      const list = document.querySelector('.MessageList');
      if (!list) return -1;
      if (list.scrollTop < 400) {
        list.scrollTop = 800;
        await new Promise((resolve) => { setTimeout(resolve, 120); });
      }
      for (let top = list.scrollTop; top > 0; top -= 400) {
        list.scrollTop = Math.max(0, top);
        await new Promise((resolve) => { setTimeout(resolve, 50); });
      }
      list.scrollTop = 0;
      try {
        const g = window.getGlobal?.();
        if (g) {
          let count = 0;
          Object.values(g.messages.byChatId).forEach((chat) => {
            count += Object.keys(chat.byId || {}).length;
          });
          return count;
        }
      } catch (err) { /* ignore */ }
      return document.querySelectorAll('.Message').length;
    });

    if (seen >= targetMessages || seen === -1) {
      console.log(`[memdump]   loaded ~${seen} messages`);
      return;
    }
    stagnantRounds = seen === lastSeen ? stagnantRounds + 1 : 0;
    if (stagnantRounds >= 6) {
      console.log(`[memdump]   history stopped growing at ~${seen} messages`);
      return;
    }
    lastSeen = seen;
    await sleep(700);
  }
}

// --- Reporting ----------------------------------------------------------------

function printComparison() {
  const names = Object.keys(results.checkpoints);
  console.log('\n[memdump] Renderer PSS / LazyFree across checkpoints:');
  for (const name of names) {
    const renderers = results.checkpoints[name].processes.filter((p) => p.type === 'renderer');
    const main = renderers.sort((a, b) => b.pss - a.pss)[0];
    if (!main) continue;
    console.log(`  ${name.padEnd(11)} pss=${mb(main.pss)} privDirty=${mb(main.privateDirty)} lazyFree=${mb(main.lazyFree)}`);
  }
}

function detectChrome() {
  for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch (err) { /* keep looking */ }
  }
  return undefined;
}

function mb(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
