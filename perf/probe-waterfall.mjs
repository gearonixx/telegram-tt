/*
 * Boot waterfall probe: loads a Telegram Web A build in a fresh profile and
 * records every network request until the auth screen renders, plus main
 * milestones. Optionally applies CDP network throttling so localhost builds
 * can be compared fairly against deployed origins.
 *
 * Usage: node perf/probe-waterfall.mjs <url> [--throttle] [--runs N]
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:8099/';
const shouldThrottle = process.argv.includes('--throttle');
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg !== -1 ? Number(process.argv[runsArg + 1]) : 1;

// Defaults to ~10 Mbps down, 40 ms RTT (mid-range broadband); override with --mbps N --rtt N
const mbpsArg = process.argv.indexOf('--mbps');
const rttArg = process.argv.indexOf('--rtt');
const MBPS = mbpsArg !== -1 ? Number(process.argv[mbpsArg + 1]) : 10;
const RTT = rttArg !== -1 ? Number(process.argv[rttArg + 1]) : 40;
const THROTTLE = {
  offline: false,
  downloadThroughput: (MBPS * 1024 * 1024) / 8,
  uploadThroughput: (MBPS * 512 * 1024) / 8,
  latency: RTT,
};

const AUTH_SELECTOR = '.Transition.is-auth, #Auth, .Auth, .auth-form, .qr-container, #auth-qr-form';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium' });

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const authTimes = [];

for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (shouldThrottle) await cdp.send('Network.emulateNetworkConditions', THROTTLE);

  const requests = new Map();
  cdp.on('Network.responseReceived', (e) => {
    requests.set(e.requestId, {
      url: e.response.url,
      type: e.type,
      start: e.response.timing?.requestTime,
      bytes: 0,
    });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId);
    if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; }
  });

  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ entryTypes: ['longtask'] });
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const dcl = Date.now() - t0;
  let authAt;
  try {
    await page.waitForSelector(AUTH_SELECTOR, { timeout: 45000 });
    authAt = Date.now() - t0;
  } catch {
    authAt = -1;
  }
  authTimes.push(authAt);

  if (run === 0) {
    await page.waitForTimeout(2500);
    const longTasks = await page.evaluate(() => window.__longTasks);
    const reqs = [...requests.values()].filter((r) => r.bytes > 0);
    const total = reqs.reduce((s, r) => s + r.bytes, 0);
    const jsTotal = reqs.filter((r) => r.type === 'Script').reduce((s, r) => s + r.bytes, 0);

    console.log(`\n=== ${url} ${shouldThrottle ? `(throttled ${MBPS}Mbps/${RTT}ms)` : '(unthrottled)'} ===`);
    console.log(`DCL: ${dcl}ms | auth screen: ${authAt}ms`);
    console.log(`requests: ${reqs.length} | total: ${(total / 1024).toFixed(0)} KB | JS: ${(jsTotal / 1024).toFixed(0)} KB`);
    console.log('--- top 18 by bytes ---');
    for (const r of reqs.sort((a, b) => b.bytes - a.bytes).slice(0, 18)) {
      console.log(`${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${r.type.padEnd(10)} ${r.url.replace(/^https?:\/\/[^/]*/, '').slice(0, 90)}`);
    }
    console.log('--- long tasks (main thread) ---');
    console.log((longTasks || []).map((t) => `${t.start}+${t.dur}ms`).join('  ') || 'none');
  }
  await context.close();
}

if (RUNS > 1) console.log(`\nauth-screen times: ${JSON.stringify(authTimes)} | median ${median(authTimes)}ms`);
await browser.close();
