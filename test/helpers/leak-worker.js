import { parentPort } from 'node:worker_threads';

parentPort.postMessage({
  ok: false,
  error: 'boom AI_GATEWAY_API_KEY=supersecretvalue Bearer sk-testsecret',
});
