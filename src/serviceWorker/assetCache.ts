import { ASSET_CACHE_NAME } from '../config';
import { pause } from '../util/schedulers';

declare const self: ServiceWorkerGlobalScope;

// An attempt to fix freezing UI on iOS
const TIMEOUT = 3000;

// Emitted at build time by `createSwAssetManifestPlugin` in `vite.config.ts`
const ASSET_MANIFEST_PATH = 'sw-asset-manifest.json';

type AssetManifest = {
  version: string;
  boot: string[];
  all: string[];
};

// A single cache handle reused across fetch events, so the hot path skips a
// `caches.open` round-trip on every request
let assetCachePromise: Promise<Cache> | undefined;
function getAssetCache() {
  assetCachePromise ??= self.caches.open(ASSET_CACHE_NAME);
  return assetCachePromise;
}

// Serves the cached copy immediately and refreshes it from the network in the
// background, so a repeat visit renders the app shell without a blocking round
// trip while a new deployment is still picked up on the following load
export async function respondWithCacheStaleFirst(e: FetchEvent) {
  const cache = await getAssetCache();
  const cached = await cache.match(e.request);

  const networkPromise = fetch(e.request).then((remote) => {
    if (remote.ok) cache.put(e.request, remote.clone());
    return remote;
  });

  if (cached?.ok) {
    // Refresh in the background; ignore network errors (e.g. offline)
    e.waitUntil(networkPromise.catch(() => undefined));
    return cached;
  }

  return networkPromise;
}

export async function respondWithCacheNetworkFirst(e: FetchEvent) {
  const remote = await withTimeout(() => fetch(e.request), TIMEOUT);
  if (!remote?.ok) {
    return respondWithCache(e);
  }

  const toCache = remote.clone();
  getAssetCache().then((cache) => {
    return cache?.put(e.request, toCache);
  });

  return remote;
}

export async function respondWithCache(e: FetchEvent) {
  const cacheResult = await withTimeout(async () => {
    const cache = await getAssetCache();
    const cached = await cache.match(e.request);

    return { cache, cached };
  }, TIMEOUT);

  const { cache, cached } = cacheResult || {};

  if (cache && cached) {
    if (cached.ok) {
      return cached;
    } else {
      await cache.delete(e.request);
    }
  }

  const remote = await fetch(e.request);

  if (remote.ok && cache) {
    cache.put(e.request, remote.clone());
  }

  return remote;
}

async function withTimeout<T>(cb: () => Promise<T>, timeout: number) {
  let isResolved = false;

  try {
    return await Promise.race([
      pause(timeout).then(() => (isResolved ? undefined : Promise.reject(new Error('TIMEOUT')))),
      cb(),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return undefined;
  } finally {
    isResolved = true;
  }
}

// Fetches the boot-critical assets into the cache ahead of the first request,
// so a repeat visit renders the auth/main screen without touching the network
export async function precacheBootAssets() {
  const manifest = await fetchAssetManifest();
  if (!manifest?.boot.length) return;

  const cache = await getAssetCache();
  const urls = manifest.boot.map((path) => new URL(path, self.registration.scope).href);
  const missing = (await Promise.all(
    urls.map(async (url) => ((await cache.match(url)) ? undefined : url)),
  )).filter(Boolean);

  await Promise.all(missing.map(async (url) => {
    try {
      const remote = await fetch(url);
      if (remote.ok) await cache.put(url, remote);
    } catch (err) {
      // Best-effort: the fetch handler fills the cache lazily anyway
    }
  }));
}

// Drops only the entries absent from the current build, so still-valid assets
// survive a deployment; `reHashedAssets` guards entries the manifest never
// lists (the app shell HTML cached by the network-first path)
export async function pruneAssetCache(reHashedAssets: RegExp) {
  const manifest = await fetchAssetManifest();
  if (!manifest) {
    // No manifest (older build): previous behavior
    return self.caches.delete(ASSET_CACHE_NAME);
  }

  const validUrls = new Set(manifest.all.map((path) => new URL(path, self.registration.scope).href));
  const cache = await getAssetCache();
  const requests = await cache.keys();
  const staleRequests = requests.filter((request) => {
    const { pathname } = new URL(request.url);
    return !validUrls.has(request.url) && Boolean(pathname.match(reHashedAssets));
  });

  await Promise.all(staleRequests.map((request) => cache.delete(request)));

  return undefined;
}

async function fetchAssetManifest(): Promise<AssetManifest | undefined> {
  try {
    const remote = await fetch(new URL(ASSET_MANIFEST_PATH, self.registration.scope).href, { cache: 'no-cache' });
    if (!remote.ok) return undefined;
    return await remote.json() as AssetManifest;
  } catch (err) {
    // Dev server or offline: behave as if there is no manifest
    return undefined;
  }
}
