// Module-level (outside `GlobalState`) tracker of when a chat's message list was last open in
// any tab. Kept out of the store on purpose: it only needs to be a reasonable local heuristic for
// the message-store eviction sweep (`intervals.ts`), not authoritative state, so it avoids a cache
// migration and multi-tab serialization entirely.
const lastActiveAtByChatId = new Map<string, number>();

export function markChatMessagesActive(chatId: string) {
  lastActiveAtByChatId.set(chatId, Date.now());
}

export function getChatMessagesLastActiveAt(chatId: string) {
  return lastActiveAtByChatId.get(chatId);
}

export function forgetChatMessagesActivity(chatId: string) {
  lastActiveAtByChatId.delete(chatId);
}
