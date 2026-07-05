import type { TabThread, ThreadId, ThreadLocalState, ThreadReadState } from '../../types';
import type { GlobalState, TabArgs } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { omit } from '../../util/iteratees';
import { selectTabState } from '../selectors/tabs';
import { selectThread } from '../selectors/threads';
import { updateMessageStore } from './messageStore';
import { updateTabState } from './tabs';

// Kept separate from `reducers/threads` so the boot path (`init` restoring
// per-thread viewport state) does not pull the message reducer tree into its chunk

export function replaceTabThreadParam<T extends GlobalState, K extends keyof TabThread>(
  global: T, chatId: string, threadId: ThreadId, paramName: K, newValue: TabThread[K] | undefined,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  if (paramName === 'viewportIds') {
    global = replaceThreadLocalStateParam(
      global, chatId, threadId, 'lastViewportIds', newValue as number[] | undefined,
    );
  }
  return updateTabThread(global, chatId, threadId, { [paramName]: newValue }, tabId);
}

export function replaceThreadLocalStateParam<T extends GlobalState, K extends keyof ThreadLocalState>(
  global: T, chatId: string, threadId: ThreadId, paramName: K, newValue: ThreadLocalState[K] | undefined,
) {
  return updateThreadLocalState(global, chatId, threadId, { [paramName]: newValue });
}

export function replaceThreadReadStateParam<T extends GlobalState, K extends keyof ThreadReadState>(
  global: T, chatId: string, threadId: ThreadId, paramName: K, newValue: ThreadReadState[K] | undefined,
) {
  return updateThreadReadState(global, chatId, threadId, { [paramName]: newValue });
}

export function updateTabThread<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, threadUpdate: Partial<TabThread>,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const tabState = selectTabState(global, tabId);
  const current = tabState.tabThreads[chatId]?.[threadId] || {};

  return updateTabState(global, {
    tabThreads: {
      ...tabState.tabThreads,
      [chatId]: {
        ...tabState.tabThreads[chatId],
        [threadId]: {
          ...current,
          ...threadUpdate,
        },
      },
    },
  }, tabId);
}

export function updateThreadLocalState<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, threadUpdate: Partial<ThreadLocalState> | undefined,
): T {
  const currentThread = selectThread(global, chatId, threadId);
  if (!currentThread) return global;

  if (!threadUpdate && !currentThread.threadInfo) {
    return updateMessageStore(global, chatId, {
      threadsById: omit(global.messages.byChatId[chatId]?.threadsById, [threadId]),
    });
  }

  const updated: ThreadLocalState = threadUpdate ? {
    ...currentThread.localState,
    ...threadUpdate,
  } : {};

  return updateMessageStore(global, chatId, {
    threadsById: {
      ...global.messages.byChatId[chatId]?.threadsById,
      [threadId]: {
        ...currentThread,
        localState: updated,
      },
    },
  });
}

export function updateThreadReadState<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, threadUpdate: Partial<ThreadReadState>,
): T {
  const currentThread = selectThread(global, chatId, threadId);
  if (!currentThread) return global;

  const updated: ThreadReadState = {
    ...currentThread.readState,
    ...threadUpdate,
  };

  return updateMessageStore(global, chatId, {
    threadsById: {
      ...global.messages.byChatId[chatId]?.threadsById,
      [threadId]: {
        ...currentThread,
        readState: updated,
      },
    },
  });
}
