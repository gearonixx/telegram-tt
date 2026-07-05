import type { ThemeKey } from '../types';

import { requestMutation } from '../lib/fasterdom/fasterdom';
import themeColors from '../styles/themes.json';
import { animate } from './animation';

let isInitialized = false;

const DURATION_MS = 200;
const ENABLE_ANIMATION_DELAY_MS = 500;
const RGB_VARIABLES = new Set([
  '--color-text',
  '--color-primary-shade',
  '--color-text-secondary',
  '--color-accent-own',
]);

const DISABLE_ANIMATION_CSS = `
.no-animations #root *,
.no-animations #root *::before,
.no-animations #root *::after {
  transition: none !important;
}`;

// [r, g, b] in 0-255 plus alpha in 0-1
type RgbaChannels = [number, number, number, number];

const HEX_ALPHA_MAX = 255;

// Theme colors are plain `#RGB[A]`/`#RRGGBB[AA]` literals from `themes.json`, so a local parser
// is enough and keeps the heavy `colorjs.io` dependency out of the boot-critical bundle
function parseHexColor(hex: string): RgbaChannels {
  const value = hex.slice(1);
  const isShort = value.length <= 4;
  const digitsPerChannel = isShort ? 1 : 2;
  const parseChannel = (index: number) => {
    const channel = value.slice(index * digitsPerChannel, (index + 1) * digitsPerChannel);
    return parseInt(isShort ? channel + channel : channel, 16);
  };
  const hasAlpha = value.length === 4 || value.length === 8;

  return [parseChannel(0), parseChannel(1), parseChannel(2), hasAlpha ? parseChannel(3) / HEX_ALPHA_MAX : 1];
}

const colors = (Object.keys(themeColors) as Array<keyof typeof themeColors>).map((property) => ({
  property,
  colors: [parseHexColor(themeColors[property][0]), parseHexColor(themeColors[property][1])],
}));

const injectCss = (css: string) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return () => {
    document.head.removeChild(style);
  };
};

const switchTheme = (theme: ThemeKey, withAnimation: boolean) => {
  const themeClassName = `theme-${theme}`;
  if (document.documentElement.classList.contains(themeClassName)) {
    return;
  }
  const isDarkTheme = theme === 'dark';
  const shouldAnimate = isInitialized && withAnimation;
  const startIndex = isDarkTheme ? 0 : 1;
  const endIndex = isDarkTheme ? 1 : 0;
  const startAt = Date.now();
  const themeColorTag = document.querySelector('meta[name="theme-color"]');

  requestMutation(() => {
    document.documentElement.classList.remove(`theme-${isDarkTheme ? 'light' : 'dark'}`);
    let uninjectCss: (() => void) | undefined;
    if (isInitialized) {
      uninjectCss = injectCss(DISABLE_ANIMATION_CSS);
      document.documentElement.classList.add('no-animations');
    }
    document.documentElement.classList.add(themeClassName);
    if (themeColorTag) {
      themeColorTag.setAttribute('content', isDarkTheme ? '#212121' : '#fff');
    }

    setTimeout(() => {
      requestMutation(() => {
        uninjectCss?.();
        document.documentElement.classList.remove('no-animations');
      });
    }, ENABLE_ANIMATION_DELAY_MS);

    isInitialized = true;

    if (shouldAnimate) {
      animate(() => {
        const t = Math.min((Date.now() - startAt) / DURATION_MS, 1);

        applyColorAnimationStep(startIndex, endIndex, transition(t));

        return t < 1;
      }, requestMutation);
    } else {
      applyColorAnimationStep(startIndex, endIndex);
    }
  });
};

function transition(t: number) {
  return 1 - ((1 - t) ** 3.5);
}

function applyColorAnimationStep(startIndex: number, endIndex: number, interpolationRatio: number = 1) {
  colors.forEach(({ property, colors: propertyColors }) => {
    const start = propertyColors[startIndex];
    const end = propertyColors[endIndex];
    const mixed = start.map((channel, i) => channel + (end[i] - channel) * interpolationRatio) as RgbaChannels;
    const [r, g, b] = [Math.round(mixed[0]), Math.round(mixed[1]), Math.round(mixed[2])];
    const a = mixed[3];

    document.documentElement.style.setProperty(
      property,
      a < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})` : `rgb(${r}, ${g}, ${b})`,
    );

    if (RGB_VARIABLES.has(property)) {
      document.documentElement.style.setProperty(`${property}-rgb`, `${r},${g},${b}`);
    }
  });
}

export default switchTheme;
