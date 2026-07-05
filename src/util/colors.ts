const LUMA_THRESHOLD = 128;
const RGB_CHANNEL_MAX = 255;
const LINEAR_CHANNEL_THRESHOLD = 0.04045;

export function convertSrgbChannel(channel: number | null) {
  return Math.round((channel || 0) * RGB_CHANNEL_MAX);
}

export function int2cssRgba(color: number): string {
  const alpha = (color >> 24) & 0xff;
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  const alphaFloat = alpha / 255;

  return `rgba(${red}, ${green}, ${blue}, ${alphaFloat})`;
}

export function int2hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function getTextColor(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  // WCAG relative luminance of an sRGB color, matching `Color#luminance` from `colorjs.io`
  // without pulling that dependency into the boot-critical bundle
  const luma = (
    0.2126 * getLinearChannel(r) + 0.7152 * getLinearChannel(g) + 0.0722 * getLinearChannel(b)
  ) * RGB_CHANNEL_MAX;
  return luma > LUMA_THRESHOLD ? 'black' : 'white';
}

function getLinearChannel(channel: number) {
  const c = channel / RGB_CHANNEL_MAX;
  return c <= LINEAR_CHANNEL_THRESHOLD ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
