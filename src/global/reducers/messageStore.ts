import type { GlobalState } from '../types';

export type MessageStoreSections = GlobalState['messages']['byChatId'][string];

// Kept separate from `reducers/messages` so the boot path can update the
// message store without pulling the full message reducer tree into its chunk
export function updateMessageStore<T extends GlobalState>(
  global: T, chatId: string, update: Partial<MessageStoreSections>,
): T {
  const current = global.messages.byChatId[chatId]
    || { byId: {}, threadsById: {}, summaryById: {} };

  return {
    ...global,
    messages: {
      ...global.messages,
      byChatId: {
        ...global.messages.byChatId,
        [chatId]: {
          ...current,
          ...update,
        },
      },
    },
  };
}
