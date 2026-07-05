import { type TeactNode } from '../lib/teact/teact';

import type { LangFn } from './localization';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../config';
import { formatStarsAsIcon, formatTonAsIcon } from './localization/format';
import { convertCurrencyFromBaseUnit } from './convertCurrency';

const FALLBACK_LANG_CODE = 'en';

// Re-exported so existing importers keep a single currency-utils entry point;
// the pure converters live in a JSX-free module to stay off the boot-critical path
export {
  convertCurrencyFromBaseUnit, convertCurrencyToBaseUnit, convertTonFromNanos, convertTonToNanos, convertTonToUsd,
} from './convertCurrency';

export function formatCurrency(
  lang: LangFn,
  totalPrice: number,
  currency: string,
  options?: {
    shouldOmitFractions?: boolean;
    iconClassName?: string;
    asFontIcon?: boolean;
  },
): TeactNode {
  const price = convertCurrencyFromBaseUnit(totalPrice, currency);

  if (currency === STARS_CURRENCY_CODE) {
    return formatStarsAsIcon(lang, price, { asFont: options?.asFontIcon, className: options?.iconClassName });
  }

  if (currency === TON_CURRENCY_CODE) {
    return formatTonAsIcon(lang, price, { className: options?.iconClassName, isMono: options?.asFontIcon });
  }

  return formatCurrencyAsString(totalPrice, currency, lang.code, options);
}

export function formatCurrencyAsString(
  totalPrice: number,
  currency: string,
  locale: string = FALLBACK_LANG_CODE,
  options?: {
    shouldOmitFractions?: boolean;
  },
) {
  const price = convertCurrencyFromBaseUnit(totalPrice, currency);

  if ((options?.shouldOmitFractions || currency === STARS_CURRENCY_CODE) && Number.isInteger(price)) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  }

  if (currency === TON_CURRENCY_CODE) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 10,
    }).format(price);
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(price);
}
