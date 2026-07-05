import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import { selectTabState } from '../../global/selectors/tabs';
import { Bundles } from '../../util/moduleLoader';

import useModuleLoader from '../../hooks/useModuleLoader';

type StateProps = {
  hasNotifications: boolean;
};

// Keeps the notification UI (and its text-rendering subtree) out of the boot
// bundle: the module is only fetched once the first notification appears
const NotificationsAsync = ({ hasNotifications }: StateProps) => {
  const Notifications = useModuleLoader(Bundles.Main, 'Notifications', !hasNotifications);

  return Notifications ? <Notifications /> : undefined;
};

export default memo(withGlobal(
  (global): Complete<StateProps> => ({
    hasNotifications: Boolean(selectTabState(global).notifications.length),
  }),
)(NotificationsAsync));
