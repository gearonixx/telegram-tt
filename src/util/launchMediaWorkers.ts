import type { MediaWorkerApi } from '../lib/mediaWorker/index.worker';
import type { Connector } from './PostMessageConnector';

import { IS_TEST } from '../config';

import { createConnector } from './PostMessageConnector';

export const MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 4);

type MediaWorkerInstance = {
  worker: Worker;
  connector: Connector<MediaWorkerApi>;
};

// Workers are spawned individually on first use: launching the whole fleet at once would
// pay 4 worker boots (each instantiating its own WASM heap) for the first tiny animation
const instances: (MediaWorkerInstance | undefined)[] = new Array(MAX_WORKERS);

function launchMediaWorker(index: number) {
  // Unit tests run without `Worker`; browser-based test runs (mocked client) need real media workers
  if (IS_TEST && typeof Worker === 'undefined') return undefined!;

  let instance = instances[index];
  if (!instance) {
    const worker = new Worker(new URL('../lib/mediaWorker/index.worker.ts', import.meta.url), { type: 'module' });
    const connector = createConnector<MediaWorkerApi>(worker, undefined, 'media');
    instance = { worker, connector };
    instances[index] = instance;
  }

  return instance;
}

export function requestMediaWorker(payload: Parameters<Connector<MediaWorkerApi>['request']>[0], index: number) {
  return launchMediaWorker(index).connector.request(payload);
}
