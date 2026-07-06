import type { GlobalState, TabArgs } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { selectTabState } from './tabs';

// Lives in its own leaf module (not `selectors/messages`) so the selectors that read it on the
// login critical path — `selectors/management` and `selectors/statistics`, both pulled in by
// `selectors/ui` — do not drag the message-store selector tree onto the entry chunk. Re-exported
// from `selectors/messages` for backward compatibility with existing importers.
export function selectCurrentMessageList<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageLists } = selectTabState(global, tabId);

  if (messageLists.length) {
    return messageLists[messageLists.length - 1];
  }

  return undefined;
}
