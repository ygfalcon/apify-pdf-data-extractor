import { parentPort } from 'node:worker_threads';

// Fill the V8 heap. A Uint8Array lives outside the worker heap cap, so the runtime would not stop it.
const junk = [];
for (let i = 0; i < 8_000_000; i += 1) junk.push('x'.repeat(80));
parentPort.postMessage({
  ok: true,
  result: { allocated: junk.length, document_type: 'generic', fields: { total: { value: 1 } } },
});
