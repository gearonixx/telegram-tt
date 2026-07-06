// Pure media-dimension constants split out of `mediaDimensions.ts` so modules on the login
// critical path (e.g. `ui/Checkbox`) can read `REM` without pulling `mediaDimensions` — and with
// it `global/helpers/messageMedia` and the message-store tree — onto the entry chunk.
// `mediaDimensions.ts` re-exports all of these for backward compatibility.

export const MEDIA_VIEWER_MEDIA_QUERY = '(max-height: 640px)';
export const REM = parseInt(getComputedStyle(document.documentElement).fontSize, 10);
export const ROUND_VIDEO_DIMENSIONS_PX = 240;
export const GIF_MIN_WIDTH = 300;
export const AVATAR_FULL_DIMENSIONS = { width: 640, height: 640 };
export const VIDEO_AVATAR_FULL_DIMENSIONS = { width: 800, height: 800 };
export const LIKE_STICKER_ID = '4986041492570112461';
