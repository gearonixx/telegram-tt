import LimitedMap from './primitives/LimitedMap';

// Caps each memoized function at a fixed number of distinct argument
// combinations, so long sessions (many chats/dates/titles seen) don't grow
// these caches without bound.
const CACHE_ENTRIES_LIMIT = 300;

const cache = new WeakMap<AnyFunction, LimitedMap<string, any>>();

export default function withCache<T extends AnyFunction>(fn: T) {
  return (...args: Parameters<T>): ReturnType<T> => {
    let fnCache = cache.get(fn);
    const cacheKey = args.map(String).join('_');

    if (fnCache) {
      const cached = fnCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } else {
      fnCache = new LimitedMap(CACHE_ENTRIES_LIMIT);
      cache.set(fn, fnCache);
    }

    const newValue = fn(...args);

    fnCache.set(cacheKey, newValue);

    return newValue;
  };
}
