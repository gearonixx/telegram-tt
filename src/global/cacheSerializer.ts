import type {
  ApiAvailableReaction,
  ApiDocument,
  ApiMessage,
  ApiPhoto,
  ApiVideo,
} from '../api/types';
import type { MessageList, ThreadId, TopicsInfo } from '../types';
import type { GlobalState, SharedState } from './types';
import { ApiMessageEntityTypes, MAIN_THREAD_ID } from '../api/types';

import {
  ALL_FOLDER_ID,
  ARCHIVED_FOLDER_ID,
  GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT,
  GLOBAL_STATE_CACHE_CHAT_LIST_LIMIT,
  GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT,
  GLOBAL_STATE_CACHE_USER_LIST_LIMIT,
  SAVED_FOLDER_ID,
} from '../config';
import { isUserId } from '../util/entities/ids';
import {
  compact, pick, pickTruthy, unique,
} from '../util/iteratees';
import { selectThreadInfo } from './selectors/threads';
import { INITIAL_GLOBAL_STATE } from './initialState';
import {
  selectChatLastMessageId,
  selectChatMessages,
  selectCurrentMessageList,
  selectFullWebPageFromMessage,
  selectTopics,
  selectTopicsInfo,
  selectViewportIds,
  selectVisibleUsers,
} from './selectors';

import { getIsMobile } from '../hooks/useAppLayout';

// The folder manager joins on demand: it is only relevant once chat folders
// exist, and the cache write degrades gracefully to `Object.keys(byId)` before that
let getFolderOrderedIds: typeof import('../util/folderManager').getOrderedIds | undefined;

void import('../util/folderManager').then((folderManager) => {
  getFolderOrderedIds = folderManager.getOrderedIds;
});

export function serializeGlobal<T extends GlobalState>(global: T) {
  return JSON.stringify(reduceGlobal(global));
}

export function serializeShared(sharedState: SharedState) {
  return JSON.stringify(reduceSharedState(sharedState));
}

export function reduceGlobal<T extends GlobalState>(global: T) {
  const reducedGlobal: GlobalState = {
    ...INITIAL_GLOBAL_STATE,
    ...pick(global, [
      'cacheVersion',
      'appConfig',
      'config',
      'auth',
      'attachMenu',
      'currentUserId',
      'contactList',
      'topPeerCategories',
      'recentEmojis',
      'recentCustomEmojis',
      'push',
      'serviceNotifications',
      'attachmentSettings',
      'leftColumnWidth',
      'archiveSettings',
      'mediaViewer',
      'audioPlayer',
      'shouldShowContextMenuHint',
      'trustedBotIds',
      'recentlyFoundChatIds',
      'peerColors',
      'savedReactionTags',
      'timezones',
      'availableEffectById',
    ]),
    lastIsChatInfoShown: !getIsMobile() ? global.lastIsChatInfoShown : undefined,
    stickers: reduceStickers(global),
    customEmojis: reduceCustomEmojis(global),
    users: reduceUsers(global),
    chats: reduceChats(global),
    messages: reduceMessages(global),
    settings: reduceSettings(global),
    chatFolders: reduceChatFolders(global),
    groupCalls: reduceGroupCalls(global),
    reactions: {
      ...pick(global.reactions, [
        'defaultTags',
        'recentReactions',
        'topReactions',
        'effectReactions',
        'hash',
      ]),
      availableReactions: reduceAvailableReactions(global.reactions.availableReactions),
    },
    passcode: pick(global.passcode, [
      'isScreenLocked',
      'hasPasscode',
      'invalidAttemptsCount',
      'timeoutUntil',
    ]),
  };

  return reducedGlobal;
}

export function reduceSharedState(sharedState: SharedState): SharedState {
  return {
    ...sharedState,
    settings: {
      ...sharedState.settings,
      languages: undefined,
    },
    isInitial: undefined,
  };
}

function reduceStickers<T extends GlobalState>(global: T): GlobalState['stickers'] {
  const { diceSetIdByEmoji, setsById } = global.stickers;
  return {
    ...INITIAL_GLOBAL_STATE.stickers,
    diceSetIdByEmoji,
    setsById: pickTruthy(setsById, Object.values(diceSetIdByEmoji || {})),
  };
}

function reduceCustomEmojis<T extends GlobalState>(global: T): GlobalState['customEmojis'] {
  const { lastRendered, byId } = global.customEmojis;
  const folderEmojiIds = Object.values(global.chatFolders.byId)
    .flatMap((folder) => (
      folder.title.entities
        ?.filter((entity) => entity.type === ApiMessageEntityTypes.CustomEmoji)
        ?.map((entity) => entity.documentId) || []
    ));
  const idsToSave = unique([...folderEmojiIds, ...lastRendered]).slice(0, GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT);
  const byIdToSave = pick(byId, idsToSave);

  return {
    byId: byIdToSave,
    lastRendered: idsToSave,
    forEmoji: {},
    added: {},
    statusRecent: {},
  };
}

function reduceUsers<T extends GlobalState>(global: T): GlobalState['users'] {
  const {
    users: {
      byId, statusesById, fullInfoById, botAppPermissionsById,
    }, currentUserId,
  } = global;
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }) => selectCurrentMessageList(global, tabId)),
  ).map(({ chatId }) => chatId).filter((chatId) => isUserId(chatId));

  const visibleUserIds = unique(compact(Object.values(global.byTabId)
    .flatMap(({ id: tabId }) => selectVisibleUsers(global, tabId)?.map((u) => u.id) || [])));

  const chatStoriesUserIds = currentChatIds
    .flatMap((chatId) => Object.values(selectChatMessages(global, chatId) || {}))
    .map((message) => {
      const webPage = selectFullWebPageFromMessage(global, message);
      return message.content.storyData?.peerId || webPage?.story?.peerId;
    })
    .filter((id): id is string => Boolean(id) && isUserId(id));

  const attachBotIds = Object.keys(global.attachMenu?.bots || {});
  const topPeerIds = getTopPeerIds(global);

  const idsToSave = unique([
    ...currentUserId ? [currentUserId] : [],
    ...currentChatIds,
    ...chatStoriesUserIds,
    ...visibleUserIds || [],
    ...attachBotIds,
    ...topPeerIds.filter(isUserId),
    ...global.recentlyFoundChatIds?.filter(isUserId) || [],
    ...getFolderOrderedIds?.(ARCHIVED_FOLDER_ID)
      ?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT).filter(isUserId) || [],
    ...getFolderOrderedIds?.(ALL_FOLDER_ID)?.filter(isUserId) || [],
    ...global.contactList?.userIds || [],
    ...Object.keys(byId),
  ]).slice(0, GLOBAL_STATE_CACHE_USER_LIST_LIMIT);

  return {
    ...INITIAL_GLOBAL_STATE.users,
    byId: pickTruthy(byId, idsToSave),
    statusesById: pickTruthy(statusesById, idsToSave),
    fullInfoById: pickTruthy(fullInfoById, idsToSave),
    botAppPermissionsById,
  };
}

function reduceChats<T extends GlobalState>(global: T): GlobalState['chats'] {
  const { chats: { byId }, currentUserId } = global;
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }): MessageList | undefined => {
        return selectCurrentMessageList(global, tabId);
      }),
  ).map(({ chatId }) => chatId);

  const messagesChatIds = compact(Object.values(global.byTabId).flatMap(({ id: tabId }) => {
    const messageList = selectCurrentMessageList(global, tabId);
    if (!messageList) return undefined;

    const messages = selectChatMessages(global, messageList.chatId);
    const viewportIds = selectViewportIds(global, messageList.chatId, messageList.threadId, tabId);
    return viewportIds?.map((id) => {
      const message = messages[id];
      if (!message) return undefined;
      const content = message.content;
      const webPage = selectFullWebPageFromMessage(global, message);
      const replyPeer = message.replyInfo?.type === 'message' && message.replyInfo.replyToPeerId;
      return content.storyData?.peerId || webPage?.story?.peerId || replyPeer;
    });
  }));
  const topPeerIds = getTopPeerIds(global);

  const unlinkedIdsToSave = [
    ...currentUserId ? [currentUserId] : [],
    ...currentChatIds,
    ...messagesChatIds,
    ...topPeerIds,
    ...global.recentlyFoundChatIds || [],
    ...getFolderOrderedIds?.(ARCHIVED_FOLDER_ID)?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT) || [],
    ...getFolderOrderedIds?.(ALL_FOLDER_ID) || [],
    ...getFolderOrderedIds?.(SAVED_FOLDER_ID) || [],
    ...Object.keys(byId),
  ];

  let idsToSave: string[] = [];

  for (const id of unlinkedIdsToSave) {
    const chat = byId[id];
    if (!chat) continue;

    idsToSave.push(id);

    if (chat.linkedMonoforumId) {
      idsToSave.push(chat.linkedMonoforumId);
    }
  }

  idsToSave = unique(idsToSave).slice(0, GLOBAL_STATE_CACHE_CHAT_LIST_LIMIT);

  return {
    ...global.chats,
    similarChannelsById: {},
    similarBotsById: {},
    isFullyLoaded: {},
    notifyExceptionById: pickTruthy(global.chats.notifyExceptionById, idsToSave),
    loadingParameters: INITIAL_GLOBAL_STATE.chats.loadingParameters,
    byId: pickTruthy(global.chats.byId, idsToSave),
    fullInfoById: pickTruthy(global.chats.fullInfoById, idsToSave),
    lastMessageIds: {
      all: pickTruthy(global.chats.lastMessageIds.all || {}, idsToSave),
      saved: global.chats.lastMessageIds.saved,
    },
    topicsInfoById: reduceTopicsInfo(global.chats.topicsInfoById, currentChatIds),
  };
}

function reduceTopicsInfo(
  topicsInfoById: Record<string, TopicsInfo>, chatIds: string[],
): GlobalState['chats']['topicsInfoById'] {
  const topicsInfoToSave = pickTruthy(topicsInfoById, chatIds);

  return Object.entries(topicsInfoToSave).reduce((acc, [chatId, topicsInfo]) => {
    acc[chatId] = {
      ...topicsInfo,
      isCache: true,
    };

    return acc;
  }, {} as GlobalState['chats']['topicsInfoById']);
}

function getTopPeerIds<T extends GlobalState>(global: T) {
  return unique(Object.values(global.topPeerCategories).flatMap((category) => category?.peerIds || []));
}

function reduceMessages<T extends GlobalState>(global: T): GlobalState['messages'] {
  const { currentUserId } = global;
  const byChatId: GlobalState['messages']['byChatId'] = {};
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }) => selectCurrentMessageList(global, tabId)),
  ).map(({ chatId }) => chatId);
  const forumPanelChatIds = compact(
    Object.values(global.byTabId)
      .map(({ forumPanelChatId }) => forumPanelChatId),
  );
  const chatIdsToSave = unique([
    ...currentChatIds,
    ...currentUserId ? [currentUserId] : [],
    ...forumPanelChatIds,
    ...getFolderOrderedIds?.(ALL_FOLDER_ID) || [],
    ...getFolderOrderedIds?.(ARCHIVED_FOLDER_ID)?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT) || [],
  ]);

  const openedChatThreadIds = Object.values(global.byTabId).reduce((acc, { id: tabId }) => {
    const { chatId: tabChatId, threadId } = selectCurrentMessageList(global, tabId) || {};
    if (!tabChatId || !threadId || threadId === MAIN_THREAD_ID) {
      return acc;
    }
    const current = acc[tabChatId] || new Set();
    current.add(threadId);
    acc[tabChatId] = current;

    return acc;
  }, {} as Record<string, Set<ThreadId>>);

  const pollIdsToSave: string[] = [];
  const webPageIdsToSave: string[] = [];

  chatIdsToSave.forEach((chatId) => {
    const current = global.messages.byChatId[chatId];
    if (!current) {
      return;
    }

    const chatLastMessageId = selectChatLastMessageId(global, chatId);

    const topicsInfo = selectTopicsInfo(global, chatId);
    const openedThreadIds = Array.from(openedChatThreadIds[chatId] || []);
    const commentThreadIds = Object.values(global.messages.byChatId[chatId].threadsById || {})
      .map(({ threadInfo }) => (threadInfo?.isCommentsInfo ? threadInfo?.originMessageId : undefined))
      .filter(Boolean);
    const threadIds = unique(openedThreadIds.concat(commentThreadIds, topicsInfo?.listedTopicIds || []));

    const topics = selectTopics(global, chatId);
    const threadsToSave = pickTruthy(current.threadsById, [MAIN_THREAD_ID, ...threadIds]);

    const viewportIdsToSave = unique(Object.values(threadsToSave)
      .flatMap((thread) => thread.localState?.lastViewportIds || []));
    const topicLastMessageIds = topics && forumPanelChatIds.includes(chatId)
      ? Object.values(topics).map(({ id }) => selectThreadInfo(global, chatId, id)?.lastMessageId).filter(Boolean) : [];
    const savedLastMessageIds = chatId === currentUserId && global.chats.lastMessageIds.saved
      ? Object.values(global.chats.lastMessageIds.saved) : [];
    const lastMessageIdsToSave = [chatLastMessageId].concat(topicLastMessageIds).concat(savedLastMessageIds)
      .filter(Boolean);
    const byId = pick(current.byId, viewportIdsToSave.concat(lastMessageIdsToSave));
    const threadsById = Object.keys(threadsToSave).reduce((acc, key) => {
      const thread = threadsToSave[Number(key)];
      acc[Number(key)] = {
        ...thread,
        localState: {
          ...thread.localState,
          listedIds: thread.localState?.lastViewportIds,
          typingStatusByPeerId: undefined,
        },
      };
      return acc;
    }, {} as GlobalState['messages']['byChatId'][string]['threadsById']);

    const cleanedById = Object.values(byId).reduce((acc, message) => {
      if (!message || message.isTypingDraft) return acc;

      let cleanedMessage = omitLocalMedia(message);
      cleanedMessage = omitLocalPaidReactions(cleanedMessage);
      acc[message.id] = cleanedMessage;

      if (message.content.pollId) {
        pollIdsToSave.push(message.content.pollId);
      }

      if (message.content.webPage) {
        webPageIdsToSave.push(message.content.webPage.id);
      }

      return acc;
    }, {} as Record<number, ApiMessage>);

    byChatId[chatId] = {
      byId: cleanedById,
      threadsById,
      summaryById: {},
    };
  });

  return {
    byChatId,
    pollById: pickTruthy(global.messages.pollById, pollIdsToSave),
    webPageById: pickTruthy(global.messages.webPageById, webPageIdsToSave),
    sponsoredByChatId: {},
    playbackByChatId: {},
  };
}

function omitLocalPaidReactions(message: ApiMessage): ApiMessage {
  if (!message.reactions?.results.length) return message;
  return {
    ...message,
    reactions: {
      ...message.reactions,
      results: message.reactions.results.map((reaction) => {
        if (reaction.localAmount) {
          return {
            ...reaction,
            localAmount: undefined,
          };
        }
        return reaction;
      }),
    },
  };
}

function omitLocalMedia(message: ApiMessage): ApiMessage {
  const {
    photo, video, document,
  } = message.content;

  return {
    ...message,
    content: {
      ...message.content,
      photo: photo && omitLocalPhoto(photo),
      video: video && omitLocalVideo(video),
      document: document && omitLocalDocument(document),
    },
    previousLocalId: undefined,
  };
}

function omitLocalPhoto(photo: ApiPhoto): ApiPhoto {
  return {
    ...photo,
    blobUrl: undefined,
  };
}

function omitLocalVideo(video: ApiVideo): ApiVideo {
  return {
    ...video,
    blobUrl: undefined,
    previewBlobUrl: undefined,
  };
}

function omitLocalDocument(document: ApiDocument): ApiDocument {
  return {
    ...document,
    previewBlobUrl: undefined,
  };
}

function reduceSettings<T extends GlobalState>(global: T): GlobalState['settings'] {
  const {
    byKey, botVerificationShownPeerIds, notifyDefaults, lastPremiumBandwithNotificationDate, themes, accountDaysTtl,
  } = global.settings;

  return {
    byKey,
    privacy: {},
    botVerificationShownPeerIds,
    lastPremiumBandwithNotificationDate,
    notifyDefaults,
    themes,
    accountDaysTtl,
  };
}

function reduceChatFolders<T extends GlobalState>(global: T): GlobalState['chatFolders'] {
  return {
    ...global.chatFolders,
  };
}

function reduceGroupCalls<T extends GlobalState>(global: T): GlobalState['groupCalls'] {
  return {
    ...global.groupCalls,
    byId: {},
    activeGroupCallId: undefined,
  };
}

function reduceAvailableReactions(availableReactions?: ApiAvailableReaction[]): ApiAvailableReaction[] | undefined {
  return availableReactions
    ?.map((r) => ({ ...pick(r, ['reaction', 'staticIcon', 'title', 'isInactive']), isLocalCache: true }));
}
