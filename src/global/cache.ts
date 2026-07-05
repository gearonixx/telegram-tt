import { getIsHeavyAnimating, onFullyIdle } from '../lib/teact/teact';
import { addCallback, removeCallback } from '../lib/teact/teactn';

import type { ActionReturnType, GlobalState, SharedState } from './types';

import {
  ANIMATION_LEVEL_DEFAULT,
  DEBUG,
  FOLDERS_POSITION_DEFAULT,
  GLOBAL_STATE_CACHE_DISABLED,
  IS_SCREEN_LOCKED_CACHE_KEY,
  SHARED_STATE_CACHE_KEY,
} from '../config';
import { MAIN_IDB_STORE } from '../util/browser/idb';
import { GLOBAL_STATE_CACHE_KEY } from '../util/multiaccount';
import { encryptSession } from '../util/passcode';
import { onBeforeUnload, throttle } from '../util/schedulers';
import { hasStoredSession } from '../util/sessions';
import { clearGlobalForLockScreen, clearSharedStateForLockScreen } from './reducers/passcode';
import { addActionHandler, getGlobal } from './index';
import { INITIAL_PERFORMANCE_STATE_MED } from './initialState';

const UPDATE_THROTTLE = 5000;

const updateCacheThrottled = throttle(() => onFullyIdle(() => updateCache()), UPDATE_THROTTLE, false);
const updateCacheForced = () => updateCache(true);

let isCaching = false;
let isRemovingCache = false;
let cacheUpdateSuspensionTimestamp = 0;
let unsubscribeFromBeforeUnload: NoneToVoidFunction | undefined;

// Loaded on demand: serialization needs the message/chat selector tree, which
// is only relevant for cache writes (they require a session), while the cache
// write on unload must stay synchronous
let serializer: typeof import('./cacheSerializer') | undefined;

function ensureSerializer() {
  if (serializer) return;
  void import('./cacheSerializer').then((module) => {
    serializer = module;
  });
}

export function cacheGlobal(global: GlobalState) {
  return MAIN_IDB_STORE.set(GLOBAL_STATE_CACHE_KEY, global);
}

export function cacheSharedState(state: SharedState) {
  return MAIN_IDB_STORE.set(SHARED_STATE_CACHE_KEY, state);
}

export function loadCachedGlobal() {
  return MAIN_IDB_STORE.get<GlobalState>(GLOBAL_STATE_CACHE_KEY);
}

export function loadCachedSharedState() {
  return MAIN_IDB_STORE.get<SharedState>(SHARED_STATE_CACHE_KEY);
}

export function removeGlobalFromCache() {
  return MAIN_IDB_STORE.del(GLOBAL_STATE_CACHE_KEY);
}

export function removeSharedStateFromCache() {
  return MAIN_IDB_STORE.del(SHARED_STATE_CACHE_KEY);
}

function cacheIsScreenLocked(global: GlobalState) {
  if (global?.passcode?.isScreenLocked) localStorage.setItem(IS_SCREEN_LOCKED_CACHE_KEY, 'true');
}

export function initCache() {
  if (GLOBAL_STATE_CACHE_DISABLED) {
    return;
  }

  const resetCache = () => {
    isRemovingCache = true;
    removeGlobalFromCache().finally(() => {
      localStorage.removeItem(IS_SCREEN_LOCKED_CACHE_KEY);
      isRemovingCache = false;
      if (!isCaching) {
        return;
      }

      clearCaching();
    });
  };

  addActionHandler('saveSession', (): ActionReturnType => {
    if (isCaching) {
      return;
    }

    setupCaching();
    updateCacheForced();
  });

  addActionHandler('reset', resetCache);
}

export async function loadCache(initialState: GlobalState): Promise<GlobalState | undefined> {
  if (GLOBAL_STATE_CACHE_DISABLED) {
    return undefined;
  }

  const cache = await readCache(initialState);

  if (cache.passcode.hasPasscode || hasStoredSession()) {
    setupCaching();

    return cache;
  } else {
    clearCaching();

    return undefined;
  }
}

export function setupCaching() {
  isCaching = true;
  ensureSerializer();
  unsubscribeFromBeforeUnload = onBeforeUnload(updateCacheForced, true);
  window.addEventListener('blur', updateCacheForced);
  addCallback(updateCacheThrottled);
}

export function clearCaching() {
  isCaching = false;
  removeCallback(updateCacheThrottled);
  window.removeEventListener('blur', updateCacheForced);
  if (unsubscribeFromBeforeUnload) {
    unsubscribeFromBeforeUnload();
  }
}

async function readCache(initialState: GlobalState): Promise<GlobalState> {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.time('global-state-cache-read');
  }

  const json = localStorage.getItem(GLOBAL_STATE_CACHE_KEY);
  const cachedFromLocalStorage = json ? JSON.parse(json) as GlobalState : undefined;
  if (cachedFromLocalStorage) localStorage.removeItem(GLOBAL_STATE_CACHE_KEY);

  let cached = cachedFromLocalStorage || await loadCachedGlobal();
  const cachedSharedState = await loadCachedSharedState();
  const sharedState = cachedSharedState || initialState.sharedState;

  if (cached) {
    cached = {
      ...cached,
      sharedState,
    };
  }

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.timeEnd('global-state-cache-read');
  }

  if (cached) {
    migrateCache(cached, initialState);
  }

  const newState: GlobalState = {
    ...initialState,
    ...cached,
    sharedState: {
      ...sharedState,
      ...cached?.sharedState, // Allow migration to override shared state
    },
  };

  return newState;
}

export function migrateCache(cached: GlobalState, initialState: GlobalState) {
  try {
    unsafeMigrateCache(cached, initialState);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

function unsafeMigrateCache(cached: GlobalState, initialState: GlobalState) {
  const untypedCached = cached as any;
  // Pre-fill settings with defaults
  cached.settings.byKey = {
    ...initialState.settings.byKey,
    ...cached.settings.byKey,
  };

  cached.chatFolders = {
    ...initialState.chatFolders,
    ...cached.chatFolders,
  };

  if (!cached.chats.similarChannelsById) {
    cached.chats.similarChannelsById = initialState.chats.similarChannelsById;
  }

  if (!cached.chats.similarBotsById) {
    cached.chats.similarBotsById = initialState.chats.similarBotsById;
  }

  if (!cached.chats.lastMessageIds) {
    cached.chats.lastMessageIds = initialState.chats.lastMessageIds;
  }

  // Clear old color storage to optimize cache size
  if (untypedCached?.appConfig.peerColors) {
    untypedCached.appConfig.peerColors = undefined;
    untypedCached.appConfig.darkPeerColors = undefined;
  }

  if (!cached.fileUploads.byMessageKey) {
    cached.fileUploads.byMessageKey = {};
  }

  if (!cached.reactions) {
    cached.reactions = initialState.reactions;
  }

  if (!cached.quickReplies) {
    cached.quickReplies = initialState.quickReplies;
  }

  if (!cached.users.previewMediaByBotId) {
    cached.users.previewMediaByBotId = initialState.users.previewMediaByBotId;
  }
  if (!cached.chats.loadingParameters) {
    cached.chats.loadingParameters = initialState.chats.loadingParameters;
  }
  if (!cached.topPeerCategories) {
    cached.topPeerCategories = initialState.topPeerCategories;
  }

  if (!cached.reactions.defaultTags?.[0]?.type) {
    cached.reactions = initialState.reactions;
  }

  if (!cached.users.commonChatsById) {
    cached.users.commonChatsById = initialState.users.commonChatsById;
  }
  if (!cached.users.botAppPermissionsById) {
    cached.users.botAppPermissionsById = initialState.users.botAppPermissionsById;
  }
  if (!cached.chats.topicsInfoById) {
    cached.chats.topicsInfoById = initialState.chats.topicsInfoById;
  }

  if (!cached.messages.pollById) {
    cached.messages.pollById = initialState.messages.pollById;
  }
  if (!cached.settings.botVerificationShownPeerIds) {
    cached.settings.botVerificationShownPeerIds = initialState.settings.botVerificationShownPeerIds;
  }

  if (!cached.peers) {
    cached.peers = initialState.peers;
  }

  if (!cached.settings.accountDaysTtl) {
    cached.settings.accountDaysTtl = initialState.settings.accountDaysTtl;
  }

  if (!cached.cacheVersion) {
    cached.cacheVersion = initialState.cacheVersion;
    // Reset because of the new action message structure
    cached.messages = initialState.messages;
    cached.chats.listIds = initialState.chats.listIds;
  }

  if (!cached.messages.playbackByChatId) {
    cached.messages.playbackByChatId = initialState.messages.playbackByChatId;
  }

  if (cached.cacheVersion < 2) {
    if (untypedCached.settings.themes.dark) {
      untypedCached.settings.themes.dark.patternColor = (initialState as any).settings.themes.dark!.patternColor;
    }

    if (untypedCached.settings.themes.light) {
      untypedCached.settings.themes.light.patternColor = (initialState as any).settings.themes.light!.patternColor;
    }

    cached.cacheVersion = 2;
  }

  if (!cached.chats.notifyExceptionById) {
    cached.chats.notifyExceptionById = initialState.chats.notifyExceptionById;
  }

  if (!cached.sharedState) {
    cached.sharedState = initialState.sharedState;
    cached.sharedState.settings = {
      canDisplayChatInTitle: untypedCached.settings.byKey.canDisplayChatInTitle,
      animationLevel: untypedCached.settings.byKey.animationLevel,
      foldersPosition: FOLDERS_POSITION_DEFAULT,
      messageSendKeyCombo: untypedCached.settings.byKey.messageSendKeyCombo,
      messageTextSize: untypedCached.settings.byKey.messageTextSize,
      performance: untypedCached.settings.performance,
      theme: untypedCached.settings.byKey.theme,
      timeFormat: untypedCached.settings.byKey.timeFormat,
      wasTimeFormatSetManually: untypedCached.settings.byKey.wasTimeFormatSetManually,
      shouldUseSystemTheme: untypedCached.settings.byKey.shouldUseSystemTheme,
      isConnectionStatusMinimized: untypedCached.settings.byKey.isConnectionStatusMinimized,
      shouldForceHttpTransport: untypedCached.settings.byKey.shouldForceHttpTransport,
      language: untypedCached.settings.byKey.language,
      languages: untypedCached.settings.languages,
      shouldSkipWebAppCloseConfirmation: untypedCached.settings.byKey.shouldSkipWebAppCloseConfirmation,
      miniAppsCachedPosition: untypedCached.settings.miniAppsCachedPosition,
      miniAppsCachedSize: untypedCached.settings.miniAppsCachedSize,
      shouldAllowHttpTransport: untypedCached.settings.byKey.shouldAllowHttpTransport,
      shouldCollectDebugLogs: untypedCached.settings.byKey.shouldCollectDebugLogs,
      shouldDebugExportedSenders: untypedCached.settings.byKey.shouldDebugExportedSenders,
      shouldWarnAboutFiles: untypedCached.settings.byKey.shouldWarnAboutFiles,
    };
  }

  if (!cached.settings.themes) {
    cached.settings.themes = initialState.settings.themes;
  }

  if (!cached.messages.webPageById) {
    cached.messages.webPageById = initialState.messages.webPageById;
  }

  const cachedSharedSettings = cached.sharedState.settings;
  if (!cachedSharedSettings.wasAnimationLevelSetManually) {
    cachedSharedSettings.animationLevel = ANIMATION_LEVEL_DEFAULT;
    cachedSharedSettings.performance = INITIAL_PERFORMANCE_STATE_MED;
  }

  if (cachedSharedSettings.performance.messageBlur === undefined) {
    cachedSharedSettings.performance.messageBlur = false;
  }

  if (cachedSharedSettings.performance.textStreaming === undefined) {
    cachedSharedSettings.performance.textStreaming = true;
  }

  if (!cachedSharedSettings.foldersPosition) {
    cachedSharedSettings.foldersPosition = FOLDERS_POSITION_DEFAULT;
  }

  if (!cached.appConfig) {
    cached.appConfig = initialState.appConfig;
  }

  if (cached.appConfig.webAppAllowedProtocols === undefined) {
    cached.appConfig.webAppAllowedProtocols = initialState.appConfig.webAppAllowedProtocols;
  }

  if (cached.appConfig.isMessagePrimaryEditedDateEnabled === undefined) {
    cached.appConfig.isMessagePrimaryEditedDateEnabled = initialState.appConfig.isMessagePrimaryEditedDateEnabled;
  }

  if (untypedCached.sharedState?.settings?.shouldWarnAboutSvg) {
    cached.sharedState.settings.shouldWarnAboutFiles = true;
    untypedCached.sharedState.settings.shouldWarnAboutSvg = undefined;
  }

  if (cached.cacheVersion < 3) {
    cached.cacheVersion = 3;
    cached.messages = initialState.messages;
    cached.chats.listIds = initialState.chats.listIds;
  }

  if (!cached.auth) {
    cached.auth = initialState.auth;
    cached.auth.rememberMe = untypedCached.rememberMe;
  }

  if (cached.audioPlayer.volume === undefined) {
    cached.audioPlayer.volume = initialState.audioPlayer.volume;
  }
}

function updateCache(force?: boolean) {
  const global = getGlobal();
  if (isRemovingCache || !isCaching || global.auth.isLoggingOut || (!force && getIsHeavyAnimating())) {
    return;
  }

  forceUpdateCache();
}

export function temporarilySuspendCacheUpdate() {
  cacheUpdateSuspensionTimestamp = Date.now() + UPDATE_THROTTLE;
}

export function forceUpdateCache(noEncrypt = false) {
  if (Date.now() < cacheUpdateSuspensionTimestamp) {
    return;
  }

  if (!serializer) {
    // The write must stay synchronous, so skip until the on-demand serializer
    // settles; the next throttled update covers the missed write
    ensureSerializer();
    return;
  }

  const global = getGlobal();
  const { hasPasscode, isScreenLocked } = global.passcode;

  if (hasPasscode) {
    if (!isScreenLocked && !noEncrypt) {
      const serializedGlobal = serializer.serializeGlobal(global);
      void encryptSession(undefined, serializedGlobal, serializer.serializeShared(global.sharedState));
    }

    cacheIsScreenLocked(global);
    cacheGlobal(clearGlobalForLockScreen(global, false));
    cacheSharedState(clearSharedStateForLockScreen(global.sharedState));
    return;
  }

  cacheIsScreenLocked(global);
  cacheGlobal(serializer.reduceGlobal(global));
  cacheSharedState(serializer.reduceSharedState(global.sharedState));
}
