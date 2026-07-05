/*
 * Attributes a built chunk's bytes to original source files using its
 * sourcemap (source-map-explorer style, decoded-mappings column spans).
 *
 * Usage: node perf/chunk-sources.mjs dist/assets/index-*.js [--depth N] [--top N] [--filter substr]
 */
import { readFileSync } from 'fs';
import { TraceMap, decodedMappings } from '@jridgewell/trace-mapping';

const file = process.argv[2];
const depthArg = process.argv.indexOf('--depth');
const DEPTH = depthArg !== -1 ? Number(process.argv[depthArg + 1]) : 3;
const topArg = process.argv.indexOf('--top');
const TOP = topArg !== -1 ? Number(process.argv[topArg + 1]) : 50;
const filterArg = process.argv.indexOf('--filter');
const FILTER = filterArg !== -1 ? process.argv[filterArg + 1] : undefined;

const code = readFileSync(file, 'utf8');
const map = new TraceMap(JSON.parse(readFileSync(`${file}.map`, 'utf8')));
const lines = code.split('\n');
const decoded = decodedMappings(map);

const bySource = new Map();
let attributed = 0;

for (let li = 0; li < decoded.length; li++) {
  const segs = decoded[li];
  const lineLen = (lines[li] || '').length + 1;
  for (let si = 0; si < segs.length; si++) {
    const [genCol, srcIdx] = segs[si];
    const end = si + 1 < segs.length ? segs[si + 1][0] : lineLen;
    const bytes = Math.max(0, end - genCol);
    const src = srcIdx === undefined ? '(unmapped)' : (map.sources[srcIdx] || '(unknown)').replace(/^(\.\.\/)+/, '');
    bySource.set(src, (bySource.get(src) || 0) + bytes);
    attributed += bytes;
  }
}

console.log(`${file}: ${(code.length / 1024).toFixed(0)} KB total, ${(attributed / 1024).toFixed(0)} KB attributed\n`);

if (FILTER) {
  console.log(`--- files matching "${FILTER}" ---`);
  for (const [src, bytes] of [...bySource.entries()].filter(([s]) => s.includes(FILTER)).sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${src}`);
  }
}

const byGroup = new Map();
for (const [src, bytes] of bySource) {
  const parts = src.split('/');
  const group = src.startsWith('node_modules')
    ? parts.slice(0, parts[1]?.startsWith('@') ? 3 : 2).join('/')
    : parts.slice(0, DEPTH).join('/');
  byGroup.set(group, (byGroup.get(group) || 0) + bytes);
}

console.log(`--- by group (depth ${DEPTH}) ---`);
for (const [group, bytes] of [...byGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${group}`);
}
