import { ASSET_CACHE_NAME } from '../config';
import { pause } from '../util/schedulers';

declare const self: ServiceWorkerGlobalScope;

// An attempt to fix freezing UI on iOS
const TIMEOUT = 3000;

// Emitted at build time by `createSwAssetManifestPlugin` in `vite.config.ts`
const ASSET_MANIFEST_PATH = 'sw-asset-manifest.json';

// Small unhashed root files referenced directly from `index.html` (a render-blocking
// script, a compat check and the favicon). They never get a content hash, so they are
// precached explicitly instead of through the hashed-asset manifest.
const STATIC_ROOT_ASSETS = ['redirect.js', 'compatTest.js', 'favicon.ico'];

type AssetManifest = {
  version: string;
  boot: string[];
  all: string[];
};

export async function respondWithCacheNetworkFirst(e: FetchEvent) {
  const remote = await withTimeout(() => fetch(e.request), TIMEOUT);
  if (!remote?.ok) {
    return respondWithCache(e);
  }

  const toCache = remote.clone();
  self.caches.open(ASSET_CACHE_NAME).then((cache) => {
    return cache?.put(e.request, toCache);
  });

  return remote;
}

// Serves a cached response immediately when available and refreshes the cache in the
// background, so a warm reload never waits on the network for these but a new deploy
// still lands within a visit or two
export async function respondWithStaleWhileRevalidate(e: FetchEvent) {
  const cache = await self.caches.open(ASSET_CACHE_NAME);
  const cached = await cache.match(e.request);

  const revalidate = fetch(e.request).then((remote) => {
    if (remote.ok) cache.put(e.request, remote.clone());
    return remote;
  }).catch(() => undefined);

  if (cached?.ok) {
    e.waitUntil(revalidate);
    return cached;
  }

  const remote = await revalidate;
  return remote || cached || Response.error();
}

export async function respondWithCache(e: FetchEvent) {
  const cacheResult = await withTimeout(async () => {
    const cache = await self.caches.open(ASSET_CACHE_NAME);
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
  const paths = [...(manifest?.boot || []), ...STATIC_ROOT_ASSETS];
  if (!paths.length) return;

  const cache = await self.caches.open(ASSET_CACHE_NAME);
  const urls = paths.map((path) => new URL(path, self.registration.scope).href);
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
  const cache = await self.caches.open(ASSET_CACHE_NAME);
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
