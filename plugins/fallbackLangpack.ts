import { readFileSync } from 'fs';
import { normalizePath, type Plugin } from 'vite';

import { buildFallbackStrings } from '../src/util/data/readStrings';

const MODULE_ID = 'virtual:fallback-langpack';
const RESOLVED_MODULE_ID = `\0${MODULE_ID}`;

// Parses the 172 KB `fallback.strings` file at build time and ships the
// pre-structured langpack as a plain module, so the client no longer runs the
// character-by-character parser on every cold boot (~35 ms of main-thread work)
export default function buildFallbackLangpackPlugin({
  stringsPath, isDevelopmentMode,
}: {
  stringsPath: string;
  isDevelopmentMode: boolean;
}): Plugin {
  return {
    name: 'telegram:fallback-langpack',
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_MODULE_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) return undefined;

      this.addWatchFile(stringsPath);
      const fileData = readFileSync(stringsPath, 'utf-8');
      const langData = buildFallbackStrings(fileData);

      // `JSON.parse` of a string literal is a specialized V8 fast path, parsed
      // far quicker than an equivalent object literal for a payload this large
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(langData))});`;
    },
    handleHotUpdate({ file, server }) {
      if (isDevelopmentMode && normalizePath(file) === normalizePath(stringsPath)) {
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
