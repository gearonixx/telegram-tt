import useForceUpdate from '../useForceUpdate';
import useLastCallback from '../useLastCallback';
import useBackgroundMode, { getIsInBackground } from '../window/useBackgroundMode';
import useInterval from './useInterval';

export default function useIntervalForceUpdate(interval?: number) {
  const forceUpdate = useForceUpdate();

  const handleTick = useLastCallback(() => {
    // Skip re-rendering while the tab is hidden, the result is not visible anyway
    if (getIsInBackground()) return;
    forceUpdate();
  });

  useInterval(handleTick, interval, true);
  // Catch up immediately once the tab is visible again, instead of waiting for the next tick
  useBackgroundMode(undefined, forceUpdate, interval === undefined);
}
