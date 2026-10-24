import { parentPort } from 'node:worker_threads';
import { readTextLayerDirect } from './text-layer.js';

parentPort.on('message', async (msg) => {
  try {
    const layer = await readTextLayerDirect(msg.buffer, msg.maxPages);
    parentPort.postMessage({ id: msg.id, layer });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
