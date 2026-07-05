import type { CachedLangData } from '../../api/types';

// The langpack is parsed at build time (`plugins/fallbackLangpack.ts`) and
// shipped pre-structured; the dynamic import keeps it in its own boot chunk
export default async function readFallbackStrings(): Promise<CachedLangData> {
  const { default: langData } = await import('virtual:fallback-langpack');
  return langData;
}
