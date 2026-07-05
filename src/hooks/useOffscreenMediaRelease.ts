import { useEffect } from '../lib/teact/teact';

import useFlag from './useFlag';

// Decoded pixels of an `<img>` are retained by the browser while the element
// references its full-size source. Swapping the source out once the element
// has stayed outside the loading margins for a while lets the browser drop
// the decoded bitmap (measured: hundreds of MB across a photo-heavy scroll),
// while the blob stays in the media cache, so restoring is a fast re-decode.
const RELEASE_DELAY = 2000;

export default function useOffscreenMediaRelease(isIntersecting: boolean, canRelease: boolean) {
  const [isReleased, markReleased, unmarkReleased] = useFlag(false);

  useEffect(() => {
    if (!canRelease || isIntersecting) {
      if (isReleased) unmarkReleased();
      return undefined;
    }

    if (isReleased) return undefined;

    const timeout = window.setTimeout(markReleased, RELEASE_DELAY);
    return () => window.clearTimeout(timeout);
  }, [isIntersecting, canRelease, isReleased, markReleased, unmarkReleased]);

  // `isIntersecting` is checked directly so the media is restored in the same
  // render that brings the element back toward the viewport
  return isReleased && !isIntersecting;
}
