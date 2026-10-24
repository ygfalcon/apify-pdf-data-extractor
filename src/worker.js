import { parentPort, workerData } from 'node:worker_threads';
import { extractDocument } from './extract.js';

try {
  const result = await extractDocument(Buffer.from(workerData.bytes), workerData.opts);
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
