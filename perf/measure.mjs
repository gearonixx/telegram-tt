/*
 * Memory measurement harness for Telegram Web A.
 *
 * Drives the S0–S4 scenario from MEMORY_AUDIT.md in a Chromium instance and
 * records, at every checkpoint: GC'd JS heap, DOM node / listener counts,
 * live object-URL count and bytes, canvas backing-store bytes, RLottie frame
 * cache stats, GramJS worker localDb sizes, media-worker WASM heap sizes and
 * per-process RSS/PSS (Linux).
 *
 * Modes:
 *   --mode mocked   Runs against the mocked client (`npm run dev:mocked`,
 *                   scenario `perf`) — no account needed. Default.
 *   --mode real     Runs against a real build/deployment with a logged-in
 *                   profile dir (see --profile/--login and perf/README.md).
 *
 * Examples:
 *   node perf/measure.mjs --label baseline
 *   node perf/measure.mjs --mode real --url https://web.telegram.org/a/ \
 *     --profile ~/.tt-perf-profile --login        # first run: log in, then exit
 *   node perf/measure.mjs --mode real --url http://localhost:4173/ \
 *     --profile ~/.tt-perf-profile --chats "Chat One,Chat Two" --label after-fix
 *   node perf/measure.mjs --compare perf/out/baseline.json perf/out/after-fix.json
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from '@playwright/test';

import { ensurePerfPhoto } from './gen-photo.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.compare) {
  compareResults(args.compare[0], args.compare[1]);
  process.exit(0);
}

const MODE = args.mode || 'mocked';
const URL_BASE = args.url || 'http://localhost:1235/';
const URL = MODE === 'mocked' && !URL_BASE.includes('#') ? `${URL_BASE}#mockScenario=perf` : URL_BASE;
const LABEL = args.label || MODE;
const OUT_DIR = args['out-dir'] || 'perf/out';
const EXECUTABLE = args.executable || process.env.PERF_CHROME || detectChrome();
const HEADED = Boolean(args.headed || args.login);
const IDLE_S0_SEC = numArg('idle-s0', MODE === 'mocked' ? 20 : 60);
const IDLE_S4_SEC = numArg('idle-s4', MODE === 'mocked' ? 120 : 600);
const SCROLL_TARGET_MESSAGES = numArg('scroll-messages', 300);
const SCROLL_TARGET_MEDIA = numArg('scroll-media', 200);
const MEDIA_VIEWER_CYCLES = numArg('viewer-cycles', 10);
const CHATS = args.chats ? args.chats.split(',').map((s) => s.trim()) : undefined;
const SAMPLE_INTERVAL_SEC = numArg('sample-interval', 30);
// Default to a HiDPI viewport: decoded sticker frames and photos scale by dpr²,
// which is the regime where real-world tabs reach 500 MB+
const DPR = numArg('dpr', 2);

const results = {
  label: LABEL,
  mode: MODE,
  url: URL,
  dpr: DPR,
  startedAt: new Date().toISOString(),
  checkpoints: {},
  samples: [],
  notes: [],
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (MODE === 'mocked') {
    ensurePerfPhoto();
  }

  const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'];
  const viewport = { width: 1440, height: 900 };
  let browser;
  let context;
  if (args.profile) {
    context = await chromium.launchPersistentContext(args.profile, {
      executablePath: EXECUTABLE, headless: !HEADED, args: launchArgs, viewport, deviceScaleFactor: DPR,
    });
    browser = context.browser();
  } else {
    browser = await chromium.launch({ executablePath: EXECUTABLE, headless: !HEADED, args: launchArgs });
    context = await browser.newContext({ viewport, deviceScaleFactor: DPR });
  }

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(instrumentPage);
  page.on('pageerror', (err) => results.notes.push(`pageerror: ${String(err).slice(0, 200)}`));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  const browserPid = findBrowserPid();

  console.log(`[perf] mode=${MODE} url=${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  if (args.login) {
    console.log('[perf] Log in manually in the opened window. Waiting for the chat list (up to 5 min)...');
    await page.waitForSelector('#Main', { timeout: 300_000 });
    console.log('[perf] Logged in. Profile saved; re-run without --login to measure.');
    await context.close();
    return;
  }

  await page.waitForSelector('.chat-item-clickable', { timeout: 60_000 });

  // S0: cold load, idle
  console.log(`[perf] S0: idle ${IDLE_S0_SEC}s after cold load`);
  await sleep(IDLE_S0_SEC * 1000);
  await capture('S0', page, cdp, browserPid);

  // S1: open media-heavy chats sequentially
  const chatSequence = CHATS || (MODE === 'mocked'
    ? ['Perf Channel', 'Perf Media', 'SavedMessages', 'Perf Channel', 'Perf Media']
    : await firstChatTitles(page, 5));
  console.log(`[perf] S1: opening chats: ${chatSequence.join(' → ')}`);
  for (const title of chatSequence) {
    await openChatByTitle(page, title);
    await sleep(4000);
  }
  await capture('S1', page, cdp, browserPid);

  // S2: scroll back ~N messages in the large chat
  const bigChat = args['big-chat'] || chatSequence[0];
  console.log(`[perf] S2: scrolling back ~${SCROLL_TARGET_MESSAGES} messages in "${bigChat}"`);
  await openChatByTitle(page, bigChat);
  await sleep(2000);
  await scrollBack(page, SCROLL_TARGET_MESSAGES);
  await capture('S2', page, cdp, browserPid);

  // S2m: scroll through the photo-heavy chat (media accumulation)
  const mediaChat = args['media-chat'] || (MODE === 'mocked' ? 'Perf Media' : bigChat);
  if (MODE === 'mocked') {
    console.log(`[perf] S2m: scrolling back ~${SCROLL_TARGET_MEDIA} messages in "${mediaChat}"`);
    await openChatByTitle(page, mediaChat);
    await sleep(2000);
    await scrollBack(page, SCROLL_TARGET_MEDIA);
    await capture('S2m', page, cdp, browserPid);
  }

  // S3: media viewer open/close cycles
  console.log(`[perf] S3: media viewer x${MEDIA_VIEWER_CYCLES} in "${mediaChat}"`);
  await openChatByTitle(page, mediaChat);
  await sleep(2000);
  const viewerOk = await cycleMediaViewer(page, MEDIA_VIEWER_CYCLES);
  if (!viewerOk) results.notes.push('S3: no clickable media found, viewer cycles skipped');
  await capture('S3', page, cdp, browserPid);

  // S4: return to first chat, idle
  console.log(`[perf] S4: return to "${chatSequence[0]}", idle ${IDLE_S4_SEC}s`);
  await openChatByTitle(page, chatSequence[0]);
  const idleEnd = Date.now() + IDLE_S4_SEC * 1000;
  while (Date.now() < idleEnd) {
    await sleep(Math.min(SAMPLE_INTERVAL_SEC * 1000, idleEnd - Date.now()));
    const processes = browserPid ? readProcessTree(browserPid) : undefined;
    results.samples.push({
      at: new Date().toISOString(),
      heap: await quickHeap(cdp),
      tabPss: processes ? maxRendererRss(processes) : undefined,
      totalPss: processes ? totalTreePss(processes) : undefined,
    });
  }
  await capture('S4', page, cdp, browserPid);

  if (args.snapshots) {
    console.log('[perf] Taking heap snapshot (S4)...');
    const file = join(OUT_DIR, `${LABEL}-S4.heapsnapshot`);
    const detached = await takeHeapSnapshot(cdp, file);
    results.checkpoints.S4.detachedNodes = detached;
    console.log(`[perf] Snapshot saved to ${file}; detached-named nodes: ${detached}`);
  }

  const outFile = join(OUT_DIR, `${LABEL}.json`);
  writeFileSync(outFile, JSON.stringify(results, undefined, 2));
  console.log(`\n[perf] Results written to ${outFile}\n`);
  printTable(results);

  await Promise.race([context.close(), sleep(5000)]);
  process.exit(0);
}

// --- Checkpoint capture ---------------------------------------------------

async function capture(name, page, cdp, browserPid) {
  await collectGarbage(cdp);

  const { metrics } = await cdp.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.map((m) => [m.name, m.value]));

  const inPage = await page.evaluate(async () => {
    const uaMem = 'measureUserAgentSpecificMemory' in performance
      ? await performance.measureUserAgentSpecificMemory().catch(() => undefined)
      : undefined;
    const canvases = [...document.querySelectorAll('canvas')];

    let globalStats;
    try {
      const g = window.getGlobal?.();
      if (g) {
        let messages = 0;
        let listedIds = 0;
        Object.values(g.messages.byChatId).forEach((chat) => {
          messages += Object.keys(chat.byId || {}).length;
          Object.values(chat.threadsById || {}).forEach((thread) => {
            listedIds += (thread.localState?.listedIds || []).length;
          });
        });
        globalStats = {
          chats: Object.keys(g.chats.byId).length,
          users: Object.keys(g.users.byId).length,
          messagesInStore: messages,
          listedIds,
        };
      }
    } catch (err) { /* prod build; no debug global */ }

    return {
      blob: window.__blobStats?.(),
      rlottie: window.__rlottieStats?.(),
      mediaCache: window.__mediaCacheStats?.(),
      canvasCount: canvases.length,
      canvasBackingBytes: canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0),
      imgCount: document.images.length,
      domNodes: document.getElementsByTagName('*').length,
      messagesInDom: document.querySelectorAll('.Message').length,
      uaMemBytes: uaMem?.bytes,
      globalStats,
    };
  });

  const workers = await captureWorkers(page);
  const processes = browserPid ? readProcessTree(browserPid) : undefined;

  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => undefined);

  results.checkpoints[name] = {
    at: new Date().toISOString(),
    jsHeapUsed: byName.JSHeapUsedSize,
    jsHeapTotal: byName.JSHeapTotalSize,
    heapUsage: heap ? { used: heap.usedSize, total: heap.totalSize } : undefined,
    nodes: byName.Nodes,
    documents: byName.Documents,
    jsEventListeners: byName.JSEventListeners,
    ...inPage,
    workers,
    processes,
  };

  console.log(`[perf] ${name}: heap=${mb(byName.JSHeapUsedSize)} nodes=${byName.Nodes} `
    + `blobs=${inPage.blob ? `${inPage.blob.liveCount}/${mb(inPage.blob.liveBytes)}` : '-'} `
    + `rlottie=${inPage.rlottie ? `${inPage.rlottie.cachedFrames}f/${mb(inPage.rlottie.cachedFrameBytes)}` : '-'} `
    + `rss=${processes ? mb(maxRendererRss(processes)) : '-'}`);
}

async function captureWorkers(page) {
  const out = [];
  for (const worker of page.workers()) {
    try {
      const stats = await worker.evaluate(() => ({
        url: self.location?.href?.split('/').pop(),
        heapUsed: performance.memory?.usedJSHeapSize,
        wasm: globalThis.__rlottieWasmStats?.(),
        localDb: (() => {
          const db = globalThis.getLocalDb?.();
          if (!db) return undefined;
          return Object.fromEntries(Object.entries(db).map(([key, value]) => [key, Object.keys(value).length]));
        })(),
      }));
      out.push(stats);
    } catch (err) { /* worker gone */ }
  }
  return out;
}

async function quickHeap(cdp) {
  await collectGarbage(cdp);
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => m.name.startsWith('JSHeap')).map((m) => [m.name, m.value]));
}

async function collectGarbage(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(300);
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(300);
}

// --- Scenario driving -----------------------------------------------------

async function openChatByTitle(page, title) {
  const ok = await page.evaluate((chatTitle) => {
    const items = [...document.querySelectorAll('.chat-item-clickable')];
    const target = items.find((el) => el.textContent?.includes(chatTitle));
    if (!target) return false;
    (target.querySelector('a, .ListItem-button') || target)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }, title);
  if (!ok) results.notes.push(`Chat "${title}" not found in chat list`);
  await sleep(1500);
  return ok;
}

async function firstChatTitles(page, count) {
  return page.evaluate((max) => (
    [...document.querySelectorAll('.chat-item-clickable h3')].slice(0, max).map((el) => el.textContent || '')
  ), count);
}

async function scrollBack(page, targetMessages) {
  let lastSeen = 0;
  let stagnantRounds = 0;
  for (let i = 0; i < 50; i++) {
    const seen = await page.evaluate(async (target) => {
      const list = document.querySelector('.MessageList');
      if (!list) return -1;

      // Gradual upward scroll so infinite-scroll thresholds are crossed.
      // If we are already pinned to the top, nudge down first so scroll events fire again.
      if (list.scrollTop < 400) {
        list.scrollTop = 800;
        await new Promise((resolve) => { setTimeout(resolve, 120); });
      }
      for (let top = list.scrollTop; top > 0; top -= 400) {
        list.scrollTop = Math.max(0, top);
        await new Promise((resolve) => { setTimeout(resolve, 50); });
      }
      list.scrollTop = 0;

      let seenCount = document.querySelectorAll('.Message').length;
      try {
        const g = window.getGlobal?.();
        if (g) {
          seenCount = 0;
          Object.values(g.messages.byChatId).forEach((chat) => {
            seenCount += Object.keys(chat.byId || {}).length;
          });
        }
      } catch (err) { /* ignore */ }
      void target;

      return seenCount;
    }, targetMessages);

    if (seen >= targetMessages || seen === -1) {
      console.log(`[perf]   loaded ~${seen} messages`);
      return;
    }
    stagnantRounds = seen === lastSeen ? stagnantRounds + 1 : 0;
    if (stagnantRounds >= 6) {
      console.log(`[perf]   history stopped growing at ~${seen} messages`);
      return;
    }
    lastSeen = seen;
    await sleep(700);
  }
  console.log(`[perf]   scroll loop ended at ~${lastSeen} messages`);
}

async function cycleMediaViewer(page, cycles) {
  const hasMedia = await page.evaluate(() => Boolean(
    document.querySelector('.Message .media-inner canvas.full-media, .Message .media-inner img, .Message img.full-media, .Message .Photo img'),
  ));
  if (!hasMedia) return false;

  for (let i = 0; i < cycles; i++) {
    // Cycle over different photos so every one is decoded at full size
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
  return true;
}

// --- Page instrumentation (init script) ------------------------------------

function instrumentPage() {
  const live = new Map();
  let created = 0;
  let revoked = 0;
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    const url = origCreate(obj);
    created++;
    live.set(url, (obj && obj.size) || 0);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked++;
    live.delete(url);
    return origRevoke(url);
  };
  window.__blobStats = () => {
    let liveBytes = 0;
    live.forEach((size) => { liveBytes += size; });
    return {
      created, revoked, liveCount: live.size, liveBytes,
    };
  };
}

// --- Process memory (Linux) -------------------------------------------------

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

function readProcessTree(rootPid) {
  try {
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
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const rss = Number(status.match(/VmRSS:\s+(\d+) kB/)?.[1] || 0) * 1024;
        let pss;
        try {
          const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
          pss = Number(rollup.match(/Pss:\s+(\d+) kB/)?.[1] || 0) * 1024;
        } catch (err) { /* needs same-user access */ }
        return {
          pid, type, rss, pss,
        };
      } catch (err) {
        return undefined;
      }
    }).filter(Boolean);
  } catch (err) {
    return undefined;
  }
}

function maxRendererRss(processes) {
  return Math.max(0, ...processes.filter((p) => p.type === 'renderer').map((p) => p.pss || p.rss));
}

function browserPss(processes) {
  const browser = processes.find((p) => p.type === 'browser');
  return browser ? (browser.pss || browser.rss) : 0;
}

function gpuPss(processes) {
  const gpu = processes.find((p) => p.type === 'gpu-process');
  return gpu ? (gpu.pss || gpu.rss) : 0;
}

function totalTreePss(processes) {
  return processes.reduce((sum, p) => sum + (p.pss || p.rss || 0), 0);
}

// --- Heap snapshot ----------------------------------------------------------

async function takeHeapSnapshot(cdp, file) {
  const chunks = [];
  const onChunk = (event) => chunks.push(event.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const json = chunks.join('');
  writeFileSync(file, json);

  try {
    const snapshot = JSON.parse(json);
    const { strings, nodes, snapshot: meta } = snapshot;
    const nodeFields = meta.meta.node_fields;
    const nameOffset = nodeFields.indexOf('name');
    const stride = nodeFields.length;
    let detached = 0;
    for (let i = nameOffset; i < nodes.length; i += stride) {
      const name = strings[nodes[i]];
      if (name && name.startsWith('Detached ')) detached++;
    }
    return detached;
  } catch (err) {
    return undefined;
  }
}

// --- Reporting ---------------------------------------------------------------

function printTable(res) {
  const names = Object.keys(res.checkpoints);
  const rows = [
    ['metric', ...names],
    ['JS heap used', ...names.map((n) => mb(res.checkpoints[n].jsHeapUsed))],
    ['DOM nodes', ...names.map((n) => res.checkpoints[n].nodes)],
    ['JS listeners', ...names.map((n) => res.checkpoints[n].jsEventListeners)],
    ['Messages in DOM', ...names.map((n) => res.checkpoints[n].messagesInDom)],
    ['Live object URLs', ...names.map((n) => res.checkpoints[n].blob?.liveCount ?? '-')],
    ['Object URL bytes', ...names.map((n) => mb(res.checkpoints[n].blob?.liveBytes))],
    ['RLottie frames', ...names.map((n) => res.checkpoints[n].rlottie?.cachedFrames ?? '-')],
    ['RLottie frame MB', ...names.map((n) => mb(res.checkpoints[n].rlottie?.cachedFrameBytes))],
    ['Canvas backing MB', ...names.map((n) => mb(res.checkpoints[n].canvasBackingBytes))],
    ['Store messages', ...names.map((n) => res.checkpoints[n].globalStats?.messagesInStore ?? '-')],
    ['Media cache MB', ...names.map((n) => mb(res.checkpoints[n].mediaCache?.totalBytes))],
    ['Renderer PSS/RSS', ...names.map((n) => (res.checkpoints[n].processes ? mb(maxRendererRss(res.checkpoints[n].processes)) : '-'))],
    ['Browser PSS', ...names.map((n) => (res.checkpoints[n].processes ? mb(browserPss(res.checkpoints[n].processes)) : '-'))],
    ['GPU PSS', ...names.map((n) => (res.checkpoints[n].processes ? mb(gpuPss(res.checkpoints[n].processes)) : '-'))],
    ['Total tree PSS', ...names.map((n) => (res.checkpoints[n].processes ? mb(totalTreePss(res.checkpoints[n].processes)) : '-'))],
    ['Worker WASM MB', ...names.map((n) => {
      const wasm = (res.checkpoints[n].workers || []).map((w) => w.wasm?.wasmHeapBytes || 0).reduce((a, b) => a + b, 0);
      return wasm ? mb(wasm) : '-';
    })],
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col] ?? '').length)));
  rows.forEach((row, i) => {
    console.log(`| ${row.map((cell, col) => String(cell ?? '').padEnd(widths[col])).join(' | ')} |`);
    if (i === 0) console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  });
}

function compareResults(fileA, fileB) {
  const a = JSON.parse(readFileSync(fileA, 'utf8'));
  const b = JSON.parse(readFileSync(fileB, 'utf8'));
  console.log(`Comparing ${a.label} → ${b.label}\n`);
  for (const name of Object.keys(a.checkpoints)) {
    const ca = a.checkpoints[name];
    const cb = b.checkpoints[name];
    if (!cb) continue;
    const heapDelta = (cb.jsHeapUsed - ca.jsHeapUsed) / ca.jsHeapUsed * 100;
    const rssA = ca.processes ? maxRendererRss(ca.processes) : undefined;
    const rssB = cb.processes ? maxRendererRss(cb.processes) : undefined;
    const totalA = ca.processes ? totalTreePss(ca.processes) : undefined;
    const totalB = cb.processes ? totalTreePss(cb.processes) : undefined;
    console.log(`${name}: heap ${mb(ca.jsHeapUsed)} → ${mb(cb.jsHeapUsed)} (${heapDelta.toFixed(1)}%)`
      + (rssA && rssB ? `, renderer ${mb(rssA)} → ${mb(rssB)} (${((rssB - rssA) / rssA * 100).toFixed(1)}%)` : '')
      + (totalA && totalB ? `, total ${mb(totalA)} → ${mb(totalB)} (${((totalB - totalA) / totalA * 100).toFixed(1)}%)` : '')
      + `, rlottie ${mb(ca.rlottie?.cachedFrameBytes)} → ${mb(cb.rlottie?.cachedFrameBytes)}`
      + `, blobs ${mb(ca.blob?.liveBytes)} → ${mb(cb.blob?.liveBytes)}`);
  }
}

// --- Utils -------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'compare') {
      out.compare = [argv[i + 1], argv[i + 2]];
      i += 2;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[key] = argv[i + 1];
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function detectChrome() {
  for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch (err) {
      try {
        readdirSync(candidate.slice(0, candidate.lastIndexOf('/')));
        if (readdirSync(candidate.slice(0, candidate.lastIndexOf('/'))).includes(candidate.split('/').pop())) return candidate;
      } catch (err2) { /* keep looking */ }
    }
  }
  return undefined; // Playwright-managed Chromium
}

function numArg(name, fallback) {
  return args[name] !== undefined ? Number(args[name]) : fallback;
}

function mb(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
