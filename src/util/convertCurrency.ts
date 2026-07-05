import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../config';

export function convertCurrencyFromBaseUnit(amount: number, currency: string) {
  return amount / 10 ** getCurrencyExp(currency);
}

export function convertCurrencyToBaseUnit(amount: number, currency: string) {
  return amount * 10 ** getCurrencyExp(currency);
}

export function convertTonFromNanos(nanos: number): number {
  return convertCurrencyFromBaseUnit(nanos, TON_CURRENCY_CODE);
}

export function convertTonToNanos(ton: number): number {
  return convertCurrencyToBaseUnit(ton, TON_CURRENCY_CODE);
}

export function convertTonToUsd(amount: number, usdRate: number, isInNanos: boolean = false): number {
  const tonInRegularUnits = isInNanos ? convertTonFromNanos(amount) : amount;
  return tonInRegularUnits * usdRate * 100;
}

function getCurrencyExp(currency: string) {
  if (currency === TON_CURRENCY_CODE) {
    return 9;
  }
  if (currency === 'CLF') {
    return 4;
  }
  if (['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(currency)) {
    return 3;
  }
  if ([
    'BIF', 'BYR', 'CLP', 'CVE', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'UYI',
    'VND', 'VUV', 'XAF', 'XOF', 'XPF', STARS_CURRENCY_CODE,
  ].includes(currency)) {
    return 0;
  }
  if (currency === 'MRO') {
    return 1;
  }
  return 2;
}
