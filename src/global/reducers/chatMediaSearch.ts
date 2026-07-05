import type {
  ChatMediaSearchParams, ChatMediaSearchSegment, LoadingState, ThreadId,
} from '../../types';
import type { GlobalState, TabArgs } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { buildChatThreadKey } from '../helpers/middleSearch';
import { selectTabState } from '../selectors/tabs';
import { updateTabState } from './tabs';

// Kept separate from `reducers/middleSearch` so the boot path (`init` seeding
// media search state) does not pull the media helpers into its chunk

export function initializeChatMediaSearchResults<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const loadingState: LoadingState = {
    areAllItemsLoadedForwards: false,
    areAllItemsLoadedBackwards: false,
  };
  const currentSegment: ChatMediaSearchSegment = {
    foundIds: [],
    loadingState,
  };
  const segments: ChatMediaSearchSegment[] = [];

  const isLoading = false;

  return replaceChatMediaSearch(global, chatId, threadId, {
    currentSegment,
    segments,
    isLoading,
  }, tabId);
}

export function replaceChatMediaSearch<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  searchParams: ChatMediaSearchParams,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const chatThreadKey = buildChatThreadKey(chatId, threadId);

  return updateTabState(global, {
    chatMediaSearch: {
      byChatThreadKey: {
        ...selectTabState(global, tabId).chatMediaSearch.byChatThreadKey,
        [chatThreadKey]: searchParams,
      },
    },
  }, tabId);
}
