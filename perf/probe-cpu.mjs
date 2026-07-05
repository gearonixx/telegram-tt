/*
 * Boot CPU profile probe: samples the main thread from navigation start until
 * the auth screen renders, then attributes self-time to original source files
 * via the served sourcemaps.
 *
 * Usage: node perf/probe-cpu.mjs <url> [--throttle] [--top N]
 */
import { chromium } from '@playwright/test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const url = process.argv[2] || 'http://localhost:8099/';
const shouldThrottle = process.argv.includes('--throttle');
const topArg = process.argv.indexOf('--top');
const TOP = topArg !== -1 ? Number(process.argv[topArg + 1]) : 40;

const THROTTLE = {
  offline: false,
  downloadThroughput: (10 * 1024 * 1024) / 8,
  uploadThroughput: (5 * 1024 * 1024) / 8,
  latency: 40,
};

const AUTH_SELECTOR = '.Transition.is-auth, #Auth, .Auth, .auth-form, .qr-container, #auth-qr-form';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium' });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
if (shouldThrottle) await cdp.send('Network.emulateNetworkConditions', THROTTLE);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(AUTH_SELECTOR, { timeout: 45000 });
const authAt = Date.now() - t0;
const { profile } = await cdp.send('Profiler.stop');
await browser.close();

// Self time per node
const selfTime = new Map();
const { samples = [], timeDeltas = [] } = profile;
for (let i = 0; i < samples.length; i++) {
  selfTime.set(samples[i], (selfTime.get(samples[i]) || 0) + (timeDeltas[i] || 0));
}

const mapCache = new Map();
async function loadMap(scriptUrl) {
  if (mapCache.has(scriptUrl)) return mapCache.get(scriptUrl);
  let traced;
  try {
    const res = await fetch(`${scriptUrl}.map`);
    if (res.ok) traced = new TraceMap(await res.json());
  } catch { /* no map */ }
  mapCache.set(scriptUrl, traced);
  return traced;
}

const byOriginal = new Map();
const byCategory = new Map();
let totalUs = 0;

for (const node of profile.nodes) {
  const us = selfTime.get(node.id) || 0;
  if (!us) continue;
  const { functionName, url: frameUrl, lineNumber, columnNumber } = node.callFrame;
  let key;
  if (['(garbage collector)', '(program)', '(idle)', '(root)'].includes(functionName)) {
    key = functionName;
  } else if (!frameUrl) {
    key = '(anonymous/eval)';
  } else {
    const traced = await loadMap(frameUrl);
    if (traced) {
      const pos = originalPositionFor(traced, { line: lineNumber + 1, column: columnNumber });
      const src = pos.source ? pos.source.replace(/^(\.\.\/)+/, '') : frameUrl.replace(/^https?:\/\/[^/]*/, '');
      key = `${src} :: ${pos.name || functionName || '(anon)'}`;
    } else {
      key = `${frameUrl.replace(/^https?:\/\/[^/]*/, '')} :: ${functionName || '(anon)'}`;
    }
  }
  if (functionName !== '(idle)') totalUs += us;
  byOriginal.set(key, (byOriginal.get(key) || 0) + us);

  const src = key.split(' :: ')[0];
  const category = src.startsWith('node_modules') ? src.split('/').slice(0, 2).join('/')
    : src.startsWith('src/') ? src.split('/').slice(0, 3).join('/')
      : src;
  byCategory.set(category, (byCategory.get(category) || 0) + us);
}

console.log(`auth at ${authAt}ms | samples ${samples.length} | busy ${(totalUs / 1000).toFixed(1)}ms\n`);
console.log(`--- top ${TOP} functions by self time ---`);
for (const [key, us] of [...byOriginal.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
  if (key === '(idle)') continue;
  console.log(`${(us / 1000).toFixed(1).padStart(8)} ms  ${key.slice(0, 110)}`);
}
console.log(`\n--- by source area ---`);
for (const [key, us] of [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  if (key === '(idle)') continue;
  console.log(`${(us / 1000).toFixed(1).padStart(8)} ms  ${key}`);
}
