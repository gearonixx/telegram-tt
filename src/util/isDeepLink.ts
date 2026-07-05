import { RE_TG_LINK, RE_TME_LINK } from '../config';

// Kept separate from `deepLinkParser` so boot-path modules can check links
// without pulling the full parser into the bundle
export function isDeepLink(link: string): boolean {
  return Boolean(link.match(RE_TME_LINK) || link.match(RE_TG_LINK));
}
