import type { ActionReturnType } from '../../types';

import {
  DEBUG,
  MESSAGE_STORE_EVICTION_ENABLED,
  MESSAGE_STORE_EVICTION_INTERVAL,
  MESSAGE_STORE_EVICTION_MIN_IDLE,
} from '../../../config';
import { addActionHandler, getActions, getGlobal } from '../../index';
import { trimChatMessages } from '../../reducers/messages';
import { selectCurrentMessageList } from '../../selectors/messages';
import { selectTabState } from '../../selectors/tabs';

// Tracks, per session, when each chat was last open in any tab, so a chat is
// only trimmed after it has stayed closed for `MESSAGE_STORE_EVICTION_MIN_IDLE`
const lastOpenTsByChatId = new Map<string, number>();

addActionHandler('trimMessageStore', (global): ActionReturnType => {
  if (!MESSAGE_STORE_EVICTION_ENABLED || global.auth.state !== 'authorizationStateReady') {
    return undefined;
  }

  const now = Date.now();
  const openChatIds = new Set<string>();
  for (const { id: tabId } of Object.values(global.byTabId)) {
    const messageList = selectCurrentMessageList(global, tabId);
    if (messageList?.chatId) openChatIds.add(messageList.chatId);
    const { forumPanelChatId } = selectTabState(global, tabId);
    if (forumPanelChatId) openChatIds.add(forumPanelChatId);
  }
  // Saved Messages shares the current user's chat id and is cheap to keep whole
  if (global.currentUserId) openChatIds.add(global.currentUserId);

  for (const chatId of openChatIds) {
    lastOpenTsByChatId.set(chatId, now);
  }

  const eligibleChatIds: string[] = [];
  for (const chatId of Object.keys(global.messages.byChatId)) {
    if (openChatIds.has(chatId)) continue;
    if (now - (lastOpenTsByChatId.get(chatId) ?? 0) < MESSAGE_STORE_EVICTION_MIN_IDLE) continue;
    eligibleChatIds.push(chatId);
  }

  // Forget timestamps for chats that have already left the store
  for (const chatId of lastOpenTsByChatId.keys()) {
    if (!global.messages.byChatId[chatId]) lastOpenTsByChatId.delete(chatId);
  }

  if (!eligibleChatIds.length) return undefined;

  return trimChatMessages(global, eligibleChatIds);
});

if (MESSAGE_STORE_EVICTION_ENABLED) {
  setInterval(() => {
    getActions().trimMessageStore();
  }, MESSAGE_STORE_EVICTION_INTERVAL);
}

// Harness hooks: report the runtime message-store footprint and force a sweep
if (DEBUG && typeof window !== 'undefined') {
  (window as any).__messageStoreStats = () => {
    const global = getGlobal();
    const { byChatId } = global.messages;
    const chatIds = Object.keys(byChatId);
    let totalMessages = 0;
    for (const chatId of chatIds) {
      totalMessages += Object.keys(byChatId[chatId].byId).length;
    }
    return { chats: chatIds.length, totalMessages };
  };
  (window as any).__trimMessageStore = () => {
    getActions().trimMessageStore();
  };
}
