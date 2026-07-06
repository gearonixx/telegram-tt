/*
 * Deterministic boot probe: wraps the Intl constructors before navigation and
 * records, for each construction that happens up to the auth screen, its cost.
 * Noise-free proof of which formatters are on the boot critical path.
 *
 * Usage: node perf/probe-intl.mjs <url>
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:6302/';
const AUTH_SELECTOR = '.Transition.is-auth, #Auth, .Auth, .auth-form, .qr-container, #auth-qr-form';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium' });
const context = await browser.newContext();
await context.addInitScript(() => {
  const log = [];
  window.__intlLog = log;
  for (const name of ['DisplayNames', 'PluralRules', 'NumberFormat', 'ListFormat', 'Collator', 'DateTimeFormat']) {
    const Orig = Intl[name];
    if (!Orig) continue;
    Intl[name] = function (...args) {
      const t = performance.now();
      const inst = new Orig(...args);
      log.push({ name, opts: JSON.stringify(args[1] || {}), ms: performance.now() - t });
      return inst;
    };
    Intl[name].prototype = Orig.prototype;
    Object.setPrototypeOf(Intl[name], Orig);
  }
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(AUTH_SELECTOR, { timeout: 45000 });
const log = await page.evaluate(() => window.__intlLog);
await browser.close();

let total = 0;
const byKey = new Map();
for (const { name, opts, ms } of log) {
  const key = `${name} ${opts}`;
  byKey.set(key, (byKey.get(key) || 0) + ms);
  total += ms;
}
console.log(`Intl constructions until auth: ${log.length}, total ${total.toFixed(1)}ms`);
for (const [key, ms] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${ms.toFixed(2).padStart(8)} ms  ${key}`);
}
