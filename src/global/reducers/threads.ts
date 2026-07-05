import type { ApiMessage, ApiThreadInfo } from '../../api/types';
import type { Thread, ThreadId, ThreadReadState } from '../../types';
import type { GlobalState } from '../types';
import { MAIN_THREAD_ID } from '../../api/types';

import { omit, pick } from '../../util/iteratees';
import { selectChatMessage } from '../selectors/messages';
import { selectThread, selectThreadIdFromMessage, selectThreadInfo, selectThreadReadState } from '../selectors/threads';
import { updateMessageStore } from './messageStore';
import { replaceThreadReadStateParam, updateThreadReadState } from './threadParams';

export {
  replaceTabThreadParam,
  replaceThreadLocalStateParam,
  replaceThreadReadStateParam,
  updateTabThread,
  updateThreadLocalState,
  updateThreadReadState,
} from './threadParams';

export function updateThreadInfo<T extends GlobalState>(
  global: T, update: Partial<ApiThreadInfo> | undefined, doNotUpdateLinked?: boolean,
): T {
  const chatId = update?.isCommentsInfo ? update.originChannelId : update?.chatId;
  const threadId = update?.isCommentsInfo ? update.originMessageId : update?.threadId;

  if (!chatId || !threadId) {
    return global;
  }

  const currentThread = selectThread(global, chatId, threadId);
  const newThreadInfo = {
    ...currentThread?.threadInfo,
    ...update,
  } as ApiThreadInfo;

  if (!doNotUpdateLinked) {
    global = updateLinkedThreadInfo(global, newThreadInfo);
  }

  return updateThreadInfoInStore(global, chatId, threadId, newThreadInfo);
}

export function updateLinkedThreadInfo<T extends GlobalState>(
  global: T, update: ApiThreadInfo,
): T {
  if (update.isCommentsInfo || !update.fromChannelId || !update.fromMessageId) {
    return global;
  }

  const threadInfo = selectThreadInfo(global, update.fromChannelId, update.fromMessageId);
  if (!threadInfo) {
    return global;
  }

  const valuesToUpdate = pick(update, ['messagesCount', 'lastMessageId']);
  const newThreadInfo: ApiThreadInfo = {
    ...threadInfo,
    ...valuesToUpdate,
  };
  return updateThreadInfoInStore(global, update.fromChannelId, update.fromMessageId, newThreadInfo);
}

export function updateThreadInfoInStore<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, update: ApiThreadInfo,
): T {
  const thread = selectThread(global, chatId, threadId);

  const newThread: Thread = {
    localState: thread?.localState || {},
    readState: thread?.readState || {},
    threadInfo: update,
  };

  return updateMessageStore(global, chatId, {
    threadsById: {
      ...global.messages.byChatId[chatId]?.threadsById,
      [threadId]: newThread,
    },
  });
}

export function updateThreadInfoMessagesCount<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, newCount: number,
): T {
  const threadInfo = selectThreadInfo(global, chatId, threadId);
  if (!threadInfo) return global;

  const newThreadInfo: ApiThreadInfo = {
    ...threadInfo,
    messagesCount: newCount,
  };
  return updateThreadInfo(global, newThreadInfo);
}

export function updateThreadInfoLastMessageId<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, newLastMessageId: number | undefined,
): T {
  const threadInfo = selectThreadInfo(global, chatId, threadId);
  if (!threadInfo) return global;

  const newThreadInfo: ApiThreadInfo = {
    ...threadInfo,
    lastMessageId: newLastMessageId,
  };
  return updateThreadInfo(global, newThreadInfo);
}

export function addUnreadMessageToCounter<T extends GlobalState>(
  global: T, chatId: string, message: ApiMessage,
): T {
  const threadId = selectThreadIdFromMessage(global, message);
  const currentReadState = selectThreadReadState(global, chatId, threadId);
  const newUnreadCount = (currentReadState?.unreadCount || 0) + 1;
  return replaceThreadReadStateParam(global, chatId, threadId, 'unreadCount', newUnreadCount);
}

export function decrementUnreadCount<T extends GlobalState>(
  global: T, chatId: string, messageId: number, amount: number,
): T {
  const message = selectChatMessage(global, chatId, messageId);
  if (!message) return global;

  const threadId = selectThreadIdFromMessage(global, message);
  const currentReadState = selectThreadReadState(global, chatId, threadId);
  const newUnreadCount = Math.max(0, (currentReadState?.unreadCount || 0) - amount);
  return replaceThreadReadStateParam(global, chatId, threadId, 'unreadCount', newUnreadCount);
}

export function updateMainThreadReadStates<T extends GlobalState>(
  global: T, threadReadStates: Record<string, ThreadReadState>,
): T {
  Object.entries(threadReadStates).forEach(([chatId, readState]) => {
    global = updateThreadReadState(global, chatId, MAIN_THREAD_ID, readState);
  });
  return global;
}

export function updateThreadReadStates<T extends GlobalState>(
  global: T, chatId: string, threadReadStates: Record<ThreadId, ThreadReadState>,
): T {
  Object.entries(threadReadStates).forEach(([threadId, readState]) => {
    global = updateThreadReadState(global, chatId, threadId, readState);
  });
  return global;
}

export function deleteThread<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
): T {
  return updateMessageStore(global, chatId, {
    threadsById: omit(global.messages.byChatId[chatId]?.threadsById, [threadId]),
  });
}
