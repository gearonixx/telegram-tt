/*
 * BFS over static imports from an entry file; prints the shortest import
 * chain to each target. Dynamic imports and type-only imports are ignored,
 * mirroring what the bundler keeps in the entry chunk.
 *
 * Usage: node perf/trace-imports.mjs src/index.tsx <targetSubstr> [more...]
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';

const entry = process.argv[2];
const targets = process.argv.slice(3);

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?!type[\s{])(?:[^'"]*?\sfrom\s+)?|export\s+(?!type[\s{])[^'"]*?\sfrom\s+)['"]([^'"]+)['"]/g;

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return undefined; // Externals and aliases are not boot-graph edges we care to walk
  const base = resolve(dirname(fromFile), spec);
  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

const queue = [resolve(entry)];
const parent = new Map([[resolve(entry), undefined]]);

while (queue.length) {
  const file = queue.shift();
  let code;
  try { code = readFileSync(file, 'utf8'); } catch { continue; }
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
  for (const match of code.matchAll(IMPORT_RE)) {
    const dep = resolveImport(file, match[1]);
    if (dep && !parent.has(dep)) {
      parent.set(dep, file);
      queue.push(dep);
    }
  }
}

const root = process.cwd();
const rel = (f) => f.replace(`${root}/`, '');

for (const target of targets) {
  const hits = [...parent.keys()].filter((f) => rel(f).includes(target));
  if (!hits.length) {
    console.log(`\n### ${target}: NOT in static graph`);
    continue;
  }
  for (const hit of hits.slice(0, 3)) {
    const chain = [];
    for (let f = hit; f; f = parent.get(f)) chain.unshift(rel(f));
    console.log(`\n### ${target} (${rel(hit)}):`);
    console.log(chain.map((c, i) => `${'  '.repeat(i)}${c}`).join('\n'));
  }
}
console.log(`\ntotal modules in static graph: ${parent.size}`);
