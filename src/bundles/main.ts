import { DEBUG } from '../config';

export { default as Main } from '../components/main/Main';
export { default as LockScreen } from '../components/main/LockScreen';
export { default as Notifications } from '../components/common/Notifications';

if (DEBUG) {
  // eslint-disable-next-line no-console
  console.log('>>> FINISH LOAD MAIN BUNDLE');
}
