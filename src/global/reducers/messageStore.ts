import type { ApiTranscription } from '../../api/types';
import type { GlobalState } from '../types';

import { TRANSCRIPTIONS_CACHE_LIMIT } from '../../config';

export type MessageStoreSections = GlobalState['messages']['byChatId'][string];

// Upserts a transcript and bounds the session-lifetime cache to the newest
// `TRANSCRIPTIONS_CACHE_LIMIT` entries (insertion order = recency). Evicting an
// old transcript is safe: its message re-transcribes on demand when reopened
export function addTranscription<T extends GlobalState>(
  global: T, transcription: ApiTranscription,
): T {
  const { transcriptionId } = transcription;
  const current = global.transcriptions;

  // Re-insert to move the entry to the newest position (insertion order = recency)
  const { [transcriptionId]: previous, ...rest } = current;
  let transcriptions: GlobalState['transcriptions'] = { ...rest, [transcriptionId]: transcription };

  const keys = Object.keys(transcriptions);
  if (TRANSCRIPTIONS_CACHE_LIMIT && keys.length > TRANSCRIPTIONS_CACHE_LIMIT) {
    const kept: GlobalState['transcriptions'] = {};
    keys.slice(keys.length - TRANSCRIPTIONS_CACHE_LIMIT).forEach((key) => {
      kept[key] = transcriptions[key];
    });
    transcriptions = kept;
  }

  return { ...global, transcriptions };
}

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
