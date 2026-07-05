import type {
  ApiOnProgress,
  ApiParsedMedia,
  ApiPreparedMedia,
} from '../api/types';
import {
  ApiMediaFormat,
} from '../api/types';

import {
  DEBUG, MEDIA_CACHE_DISABLED, MEDIA_CACHE_NAME,
  MEDIA_CACHE_NAME_AVATARS, MEDIA_MEMORY_CACHE_MAX_BYTES,
} from '../config';
import { callApi, cancelApiProgress } from '../api/gramjs';
import {
  IS_OPUS_SUPPORTED, IS_PROGRESSIVE_SUPPORTED,
} from './browser/windowEnvironment';
import * as cacheApi from './cacheApi';
import { fetchBlob } from './files';
import { ACCOUNT_SLOT } from './multiaccount';
import { oggToWav } from './oggToWav';

const asCacheApiType = {
  [ApiMediaFormat.BlobUrl]: cacheApi.Type.Blob,
  [ApiMediaFormat.Text]: cacheApi.Type.Text,
  [ApiMediaFormat.DownloadUrl]: undefined,
  [ApiMediaFormat.Progressive]: undefined,
};

const PROGRESSIVE_URL_PREFIX = './progressive/';
const DOWNLOAD_URL_PREFIX = './download/';
const MAX_MEDIA_RETRIES = 5;

// Iteration order doubles as LRU order: reads re-insert the entry at the end
const memoryCache = new Map<string, ApiPreparedMedia>();
const memoryCacheEntryBytes = new Map<string, number>();
let memoryCacheBytes = 0;

const fetchPromises = new Map<string, Promise<ApiPreparedMedia | undefined>>();
const progressCallbacks = new Map<string, Map<string, ApiOnProgress>>();
const cancellableCallbacks = new Map<string, ApiOnProgress>();

if (DEBUG && typeof window !== 'undefined') {
  (window as any).__mediaCacheStats = () => {
    let textBytes = 0;
    let objectUrls = 0;
    memoryCache.forEach((media) => {
      if (typeof media !== 'string') return;
      if (media.startsWith('blob:')) {
        objectUrls++;
      } else {
        textBytes += media.length * 2;
      }
    });

    return { entries: memoryCache.size, objectUrls, textBytes };
  };
}

export function fetch<T extends ApiMediaFormat>(
  url: string,
  mediaFormat: T,
  isHtmlAllowed = false,
  onProgress?: ApiOnProgress,
  callbackUniqueId?: string,
): Promise<ApiPreparedMedia> {
  if (mediaFormat === ApiMediaFormat.Progressive) {
    return (
      IS_PROGRESSIVE_SUPPORTED
        ? Promise.resolve(getProgressiveUrl(url))
        : fetch(url, ApiMediaFormat.BlobUrl, isHtmlAllowed, onProgress, callbackUniqueId)
    );
  }

  if (mediaFormat === ApiMediaFormat.DownloadUrl) {
    return (
      IS_PROGRESSIVE_SUPPORTED
        ? Promise.resolve(getDownloadUrl(url))
        : fetch(url, ApiMediaFormat.BlobUrl, isHtmlAllowed, onProgress, callbackUniqueId)
    );
  }

  if (!fetchPromises.has(url)) {
    const promise = fetchFromCacheOrRemote(url, mediaFormat, isHtmlAllowed)
      .catch((err) => {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(err);
        }

        return undefined;
      })
      .finally(() => {
        fetchPromises.delete(url);
        progressCallbacks.delete(url);
        cancellableCallbacks.delete(url);
      });

    fetchPromises.set(url, promise);
  }

  if (onProgress && callbackUniqueId) {
    let activeCallbacks = progressCallbacks.get(url);
    if (!activeCallbacks) {
      activeCallbacks = new Map<string, ApiOnProgress>();
      progressCallbacks.set(url, activeCallbacks);
    }
    activeCallbacks.set(callbackUniqueId, onProgress);
  }

  return fetchPromises.get(url) as Promise<ApiPreparedMedia>;
}

export function getFromMemory(url: string) {
  const media = memoryCache.get(url);

  // Refresh LRU position
  if (media !== undefined) {
    memoryCache.delete(url);
    memoryCache.set(url, media);
  }

  return media as ApiPreparedMedia;
}

function putInMemory(url: string, media: ApiPreparedMedia, bytes: number) {
  deleteFromMemory(url);

  memoryCache.set(url, media);
  memoryCacheEntryBytes.set(url, bytes);
  memoryCacheBytes += bytes;

  if (!MEDIA_MEMORY_CACHE_MAX_BYTES) {
    return;
  }

  while (memoryCacheBytes > MEDIA_MEMORY_CACHE_MAX_BYTES && memoryCache.size > 1) {
    deleteFromMemory(memoryCache.keys().next().value!);
  }
}

function deleteFromMemory(url: string) {
  const media = memoryCache.get(url);
  if (media === undefined) {
    return;
  }

  if (typeof media === 'string' && media.startsWith('blob:')) {
    URL.revokeObjectURL(media);
  }

  memoryCacheBytes -= memoryCacheEntryBytes.get(url) || 0;
  memoryCacheEntryBytes.delete(url);
  memoryCache.delete(url);
}

function calcMediaBytes(media: ApiParsedMedia) {
  if (media instanceof Blob) {
    return media.size;
  }

  if (typeof media === 'string') {
    return media.length * 2;
  }

  return media.byteLength;
}

export function cancelProgress(progressCallback: ApiOnProgress) {
  progressCallbacks.forEach((map, url) => {
    map.forEach((callback) => {
      if (callback === progressCallback) {
        const parentCallback = cancellableCallbacks.get(url);
        if (!parentCallback) return;

        cancelApiProgress(parentCallback);
        cancellableCallbacks.delete(url);
        progressCallbacks.delete(url);
        return;
      }
    });
  });
}

export function removeCallback(url: string, callbackUniqueId: string) {
  const callbacks = progressCallbacks.get(url);
  if (!callbacks) return;
  callbacks.delete(callbackUniqueId);
}

export function getProgressiveUrl(url: string) {
  const base = new URL(`${PROGRESSIVE_URL_PREFIX}${url}`, window.location.href);
  if (ACCOUNT_SLOT) base.searchParams.set('account', ACCOUNT_SLOT.toString());
  return base.href;
}

function getDownloadUrl(url: string) {
  const base = new URL(`${DOWNLOAD_URL_PREFIX}${url}`, window.location.href);
  if (ACCOUNT_SLOT) base.searchParams.set('account', ACCOUNT_SLOT.toString());
  return base.href;
}

async function fetchFromCacheOrRemote(
  url: string, mediaFormat: ApiMediaFormat, isHtmlAllowed: boolean, retryNumber = 0,
): Promise<string> {
  if (!MEDIA_CACHE_DISABLED) {
    const cacheName = url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME;
    const cached = await cacheApi.fetch(cacheName, url, asCacheApiType[mediaFormat]!, isHtmlAllowed);

    if (cached) {
      let media = cached;

      if (cached.type === 'audio/ogg' && !IS_OPUS_SUPPORTED) {
        media = await oggToWav(media);
      }

      const prepared = prepareMedia(media);

      putInMemory(url, prepared, calcMediaBytes(media));

      return prepared;
    }
  }

  const onProgress = makeOnProgress(url);
  cancellableCallbacks.set(url, onProgress);

  const remote = await callApi('downloadMedia', { url, mediaFormat, isHtmlAllowed }, onProgress);
  if (!remote) {
    if (retryNumber >= MAX_MEDIA_RETRIES) {
      throw new Error(`Failed to fetch media ${url}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, getRetryTimeout(retryNumber));
    });
    // eslint-disable-next-line no-console
    if (DEBUG) console.debug(`Retrying to fetch media ${url}`);
    return fetchFromCacheOrRemote(url, mediaFormat, isHtmlAllowed, retryNumber + 1);
  }

  const { mimeType } = remote;
  let parsed: ApiParsedMedia = remote.dataBlob;
  let prepared = prepareMedia(parsed);

  if (mimeType === 'audio/ogg' && !IS_OPUS_SUPPORTED) {
    const blob = await fetchBlob(prepared);
    URL.revokeObjectURL(prepared);
    parsed = await oggToWav(blob);
    prepared = prepareMedia(parsed);
  }

  putInMemory(url, prepared, calcMediaBytes(parsed));

  return prepared;
}

export async function unload(url: string) {
  deleteFromMemory(url);
  if (!MEDIA_CACHE_DISABLED) {
    const cacheName = url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME;
    await cacheApi.remove(cacheName, url);
  }
}

function makeOnProgress(url: string) {
  const onProgress: ApiOnProgress = (progress: number) => {
    progressCallbacks.get(url)?.forEach((callback) => {
      callback(progress);
      if (callback.isCanceled) {
        onProgress.isCanceled = true;
        deleteFromMemory(url);
      }
    });
  };

  return onProgress;
}

function prepareMedia(mediaData: Exclude<ApiParsedMedia, ArrayBuffer>): ApiPreparedMedia {
  if (mediaData instanceof Blob) {
    return URL.createObjectURL(mediaData);
  }

  return mediaData;
}

if (IS_PROGRESSIVE_SUPPORTED) {
  navigator.serviceWorker.addEventListener('message', async (e) => {
    const { type, messageId, params } = e.data as {
      type: string;
      messageId: string;
      params: { url: string; start: number; end: number };
    };

    if (type !== 'requestPart') {
      return;
    }

    async function downloadWithRetry(retryNumber = 0) {
      const result = await callApi('downloadMedia', { mediaFormat: ApiMediaFormat.Progressive, ...params });
      if (!result) {
        if (retryNumber >= MAX_MEDIA_RETRIES) {
          if (DEBUG) {
            // eslint-disable-next-line no-console
            console.warn(`Failed to download media part after ${MAX_MEDIA_RETRIES} retries:`, params.url);
          }
          return undefined;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, getRetryTimeout(retryNumber));
        });
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.debug(`Retrying to download media part ${params.url}, attempt ${retryNumber + 1}`);
        }
        return downloadWithRetry(retryNumber + 1);
      }
      return result;
    }

    const result = await downloadWithRetry();
    if (!result) {
      return;
    }

    const { arrayBuffer, mimeType, fullSize } = result;

    navigator.serviceWorker.controller!.postMessage({
      type: 'partResponse',
      messageId,
      result: {
        arrayBuffer,
        mimeType,
        fullSize,
      },
    }, [arrayBuffer!]);
  });
}

function getRetryTimeout(retryNumber: number) {
  // 250ms, 500ms, 1s, 2s, 4s
  return 250 * 2 ** retryNumber;
}
