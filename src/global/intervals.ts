import { addCallback } from '../lib/teact/teactn';

import type { GlobalState } from './types';

import { MESSAGE_STORE_EVICT_AFTER_MS, MESSAGE_STORE_EVICT_SWEEP_INTERVAL_MS } from '../config';
import { getServerTime } from '../util/serverTime';
import { canEvictChatMessages, evictChatMessages } from './reducers/messages';
import { removePeerStory } from './reducers/stories';
import { selectTabState } from './selectors/tabs';
import { getChatMessagesLastActiveAt, markChatMessagesActive } from './chatMessagesActivity';
import { resetOpenedChannelShortpollState, syncOpenedShortpollChannelIds } from './openedChannelShortpoll';
import { getGlobal, setGlobal } from '.';

const STORY_EXPIRATION_INTERVAL = 2 * 60 * 1000; // 2 min

let intervals: number[] = [];

let prevGlobal: GlobalState | undefined;

addCallback((global: GlobalState) => {
  const previousGlobal = prevGlobal;
  prevGlobal = global;

  const isCurrentMaster = selectTabState(global)?.isMasterTab;
  const isPreviousMaster = previousGlobal && selectTabState(previousGlobal)?.isMasterTab;
  if (isCurrentMaster === isPreviousMaster) return;

  if (isCurrentMaster && !isPreviousMaster) {
    startIntervals(global);
  } else {
    stopIntervals();
  }
});

addCallback((global: GlobalState) => {
  if (!selectTabState(global)?.isMasterTab) {
    return;
  }

  syncOpenedShortpollChannelIds(global);
});

function startIntervals(global: GlobalState) {
  if (intervals.length) return;

  resetOpenedChannelShortpollState();
  intervals.push(window.setInterval(checkStoryExpiration, STORY_EXPIRATION_INTERVAL));
  if (MESSAGE_STORE_EVICT_AFTER_MS > 0) {
    intervals.push(window.setInterval(sweepInactiveChatMessages, MESSAGE_STORE_EVICT_SWEEP_INTERVAL_MS));
  }
  syncOpenedShortpollChannelIds(global);
}

function stopIntervals() {
  resetOpenedChannelShortpollState();
  intervals.forEach((interval) => clearInterval(interval));
  intervals = [];
}

function checkStoryExpiration() {
  let global = getGlobal();
  if (!global.isInited) return;

  const serverTime = getServerTime();

  Object.values(global.stories.byPeerId).forEach((peerStories) => {
    const stories = Object.values(peerStories.byId);
    stories.forEach((story) => {
      if (story['@type'] !== 'story') return;
      if (story.expireDate > serverTime) return;
      if (story.isInProfile) return;

      global = removePeerStory(global, story.peerId, story.id);
    });
  });

  setGlobal(global);
}

// Evicts `messages.byChatId` slices for chats that have been closed in every tab for longer than
// `MESSAGE_STORE_EVICT_AFTER_MS`. Chats currently open anywhere are refreshed in the activity
// tracker on every tick, which also covers chats never routed through `updateCurrentMessageList`
// (e.g. a forum panel or a focused-message jump)
function sweepInactiveChatMessages() {
  let global = getGlobal();
  if (!global.isInited) return;

  const openChatIds = collectOpenChatIds(global);
  const now = Date.now();

  Object.keys(global.messages.byChatId).forEach((chatId) => {
    if (openChatIds.has(chatId)) {
      markChatMessagesActive(chatId);
      return;
    }

    const lastActiveAt = getChatMessagesLastActiveAt(chatId);
    if (lastActiveAt === undefined) {
      // First time this chat's slice is observed inactive: start its countdown now instead of
      // evicting immediately (it may have been loaded for a preview, not an actual visit)
      markChatMessagesActive(chatId);
      return;
    }

    if (now - lastActiveAt < MESSAGE_STORE_EVICT_AFTER_MS) return;
    if (!canEvictChatMessages(global, chatId)) return;

    global = evictChatMessages(global, chatId);
  });

  setGlobal(global);
}

function collectOpenChatIds(global: GlobalState) {
  const chatIds = new Set<string>();

  Object.values(global.byTabId).forEach((tabState) => {
    tabState.messageLists.forEach(({ chatId }) => chatIds.add(chatId));
    if (tabState.forumPanelChatId) chatIds.add(tabState.forumPanelChatId);
    if (tabState.focusedMessage?.chatId) chatIds.add(tabState.focusedMessage.chatId);
  });

  if (global.currentUserId) chatIds.add(global.currentUserId);

  return chatIds;
}
