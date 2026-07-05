import type { ElementRef } from '../lib/teact/teact';
import { useEffect } from '../lib/teact/teact';

import { requestMutation } from '../lib/fasterdom/fasterdom';
import useLastCallback from './useLastCallback';

// Renders a photo into a `bitmaprenderer` canvas instead of an `<img>`.
// The image is decoded straight to its display size (not its intrinsic size)
// and the decoded pixels are owned by the canvas alone, so they bypass the
// browser's image-decode cache — measured to retain every photo of a scroll
// session indefinitely (6.9 MB each) because cache reduction never runs while
// animations keep the compositor busy. Bitmaps are released deterministically:
// on replace, on unmount and when the message scrolls far offscreen.
//
// Decoding is capped below the device pixel ratio: on a 2x screen this shows
// photos slightly softer in exchange for ~2x fewer decoded bytes.
const MAX_DECODE_DPR = 1.5;

export type MediaBitmapSource = {
  url?: string;
  thumbUri?: string;
  width: number;
  height: number;
  mediaWidth?: number;
  mediaHeight?: number;
  isReleased?: boolean;
};

export default function useMediaBitmapCanvas(ref: ElementRef<HTMLCanvasElement>, {
  url, thumbUri, width, height, mediaWidth, mediaHeight, isReleased,
}: MediaBitmapSource) {
  const drawBitmap = useLastCallback(async (canvas: HTMLCanvasElement, isCancelledRef: { current: boolean }) => {
    const targetUrl = isReleased ? (thumbUri || url) : url;
    if (!targetUrl) return;

    try {
      const blob = await (await fetch(targetUrl)).blob();
      const bitmap = await decodeToDisplaySize(
        blob, isReleased ? undefined : { width, height, mediaWidth, mediaHeight },
      );
      if (isCancelledRef.current) {
        bitmap.close();
        return;
      }

      const ctx = canvas.getContext('bitmaprenderer');
      if (!ctx) {
        bitmap.close();
        return;
      }

      requestMutation(() => {
        if (isCancelledRef.current) {
          bitmap.close();
          return;
        }

        // The transferred bitmap does not update the element's intrinsic size,
        // which `object-fit` needs to be correct
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }

        // Transferring consumes the bitmap; the previous one is released by the context
        ctx.transferFromImageBitmap(bitmap);
      });
    } catch (err) {
      // Broken or revoked media; the canvas stays on its previous content
    }
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || (!url && !thumbUri)) return undefined;

    const isCancelledRef = { current: false };
    void drawBitmap(canvas, isCancelledRef);

    return () => {
      isCancelledRef.current = true;
    };
  }, [ref, url, thumbUri, width, height, isReleased, drawBitmap]);
}

async function decodeToDisplaySize(
  blob: Blob,
  box?: { width: number; height: number; mediaWidth?: number; mediaHeight?: number },
) {
  if (!box) {
    return createImageBitmap(blob);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DECODE_DPR);
  const targetWidth = Math.round(box.width * dpr);
  const targetHeight = Math.round(box.height * dpr);

  // Emulate `object-fit: cover`: constrain the dimension that overflows the
  // box, so the browser scales the other one preserving the aspect ratio
  const mediaAspect = box.mediaWidth && box.mediaHeight ? box.mediaWidth / box.mediaHeight : undefined;
  const boxAspect = box.width / box.height;
  const shouldConstrainHeight = mediaAspect !== undefined && mediaAspect >= boxAspect;

  // Never upscale beyond the source resolution
  const resizeWidth = box.mediaWidth ? Math.min(targetWidth, box.mediaWidth) : targetWidth;
  const resizeHeight = box.mediaHeight ? Math.min(targetHeight, box.mediaHeight) : targetHeight;

  const options: ImageBitmapOptions = { resizeQuality: 'high' };
  if (shouldConstrainHeight) {
    options.resizeHeight = resizeHeight;
  } else {
    options.resizeWidth = resizeWidth;
  }

  try {
    return await createImageBitmap(blob, options);
  } catch (err) {
    // Resize options are not supported: decode at the intrinsic size
    return createImageBitmap(blob);
  }
}
