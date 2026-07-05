// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: ServiceWorkerGlobalScope & WorkerGlobalScope & SharedWorkerGlobalScope & Window;

export const IS_MULTIACCOUNT_SUPPORTED = 'SharedWorker' in globalThis;
export const IS_INTL_LIST_FORMAT_SUPPORTED = 'ListFormat' in Intl;
export const IS_BAD_URL_PARSER = new URL('tg://host').host !== 'host';

// Inlined `isTauri()` from `@tauri-apps/api/core` to keep the library out of the boot-critical bundle
export const IS_TAURI = Boolean((globalThis as { isTauri?: boolean }).isTauri);
// @ts-expect-error no types for electron
export const IS_ELECTRON = Boolean(globalThis.electron);
