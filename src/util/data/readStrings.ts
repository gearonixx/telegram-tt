import type {
  ApiLanguage, CachedLangData, LangPack, LangPackStringValuePlural,
} from '../../api/types';

const IS_DEBUG = import.meta.env?.TG_APP_ENV !== 'production';

const FALLBACK_LANG_CODE = 'en';
const FALLBACK_VERSION = 0;
const FALLBACK_TRANSLATE_URL = `https://translations.telegram.org/${FALLBACK_LANG_CODE}/weba`;

// Build-time only: parses the raw `.strings` file into the structured langpack.
// Invoked by `plugins/fallbackLangpack.ts`, never bundled into the client
export function buildFallbackStrings(fileData: string): CachedLangData {
  const rawStrings = readStrings(fileData);

  const strings: LangPack['strings'] = {};

  Object.entries(rawStrings).forEach(([key, value]) => {
    const [clearKey, pluralSuffix] = key.split('_');

    if (!pluralSuffix) {
      strings[clearKey] = value;
      return;
    }

    const knownValue = (strings[clearKey] || {}) as LangPackStringValuePlural;
    knownValue[pluralSuffix as keyof LangPackStringValuePlural] = value;
    strings[clearKey] = knownValue;
  });

  const langPack: LangPack = {
    langCode: FALLBACK_LANG_CODE,
    version: FALLBACK_VERSION,
    strings,
  };

  const stringsCount = Object.keys(strings).length;

  const language: ApiLanguage = {
    langCode: FALLBACK_LANG_CODE,
    name: 'English',
    nativeName: 'English',
    pluralCode: FALLBACK_LANG_CODE,
    stringsCount,
    translatedCount: stringsCount,
    translationsUrl: FALLBACK_TRANSLATE_URL,
  };

  return {
    langPack,
    language,
  };
}

export default function readStrings(data: string): Record<string, string> {
  const lines = data.split(/;\r?\n?/);
  const result: Record<string, string> = {};
  for (const line of lines) {
    if (!line.startsWith('"')) continue;
    const [key, value] = parseLine(line) || [];
    if (!key || !value) {
      // eslint-disable-next-line no-console
      console.warn('Bad formatting in line:', line);
      continue;
    }
    if (result[key]) {
      // eslint-disable-next-line no-console
      console.warn('Duplicate key:', key);
    }
    result[key] = value;
  }
  return result;
}

function parseLine(line: string) {
  let isEscaped = false;
  let isInsideString = false;

  let separatorIndex;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      isEscaped = !isEscaped;
      continue;
    }

    if (char === '"' && !isEscaped) {
      isInsideString = !isInsideString;
      continue;
    }

    if (char === '=' && !isInsideString) {
      separatorIndex = i;
      break;
    }

    isEscaped = false;
  }

  if (separatorIndex === undefined || separatorIndex === line.length - 1) return undefined;

  try {
    const key = JSON.parse(line.slice(0, separatorIndex));
    const value = JSON.parse(line.slice(separatorIndex + 1));

    return [key, value];
  } catch (e) {
    if (IS_DEBUG) {
      // eslint-disable-next-line no-console
      console.error('Error parsing line:', line, e);
    }
  }

  return undefined;
}
