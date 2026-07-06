import type { OldLangFn } from '../../hooks/useOldLang';
import type { LangFn } from '../localization';

import withCache from '../withCache';

// @optimization `toLocaleTimeString` is avoided because of bad performance
export function formatTime(lang: OldLangFn, datetime: number | Date) {
  const date = typeof datetime === 'number' ? new Date(datetime) : datetime;
  const timeFormat = lang.timeFormat || '24h';

  let hours = date.getHours();
  let marker = '';
  if (timeFormat === '12h') {
    marker = hours >= 12 ? '\xa0PM' : '\xa0AM'; // NBSP
    hours = hours > 12 ? hours % 12 : hours;
  }

  return `${String(hours).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}${marker}`;
}

export function formatFullDate(lang: OldLangFn | LangFn, datetime: number | Date) {
  return formatDateToString(datetime, lang.code, false, 'numeric');
}

export function formatDateToString(
  datetime: Date | number,
  locale = 'en-US',
  noYear = false,
  monthFormat: 'short' | 'long' | 'numeric' = 'short',
  noDay = false,
) {
  const date = typeof datetime === 'number' ? new Date(datetime) : datetime;
  const dayStartAt = getDayStartAt(date);

  return formatDayToStringWithCache(dayStartAt, locale, noYear, monthFormat, noDay);
}

export function getDayStart(datetime: number | Date) {
  const date = new Date(datetime);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getDayStartAt(datetime: number | Date) {
  return getDayStart(datetime).getTime();
}

const formatDayToStringWithCache = withCache((
  dayStartAt: number,
  locale: string,
  noYear?: boolean,
  monthFormat: 'short' | 'long' | 'numeric' = 'short',
  noDay?: boolean,
) => {
  return new Date(dayStartAt).toLocaleString(
    locale,
    {
      year: noYear ? undefined : 'numeric',
      month: monthFormat,
      day: noDay ? undefined : 'numeric',
    },
  );
});
