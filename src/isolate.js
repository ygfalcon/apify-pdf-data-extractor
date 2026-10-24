import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./worker.js', import.meta.url);

function publicWorkerError(message) {
  const text = String(message || '');
  if (/memory|heap|allocation/i.test(text)) return 'This PDF used too much memory. Not charged.';
  if (/timed out|too dense|PDF parse failed/i.test(text)) return text;
  return 'Could not read this PDF. Not charged.';
}

// Runs extraction in a worker thread that is terminated after a hard deadline, so a catastrophic regex or a
// malformed PDF can never freeze the run. A timed-out file returns an error and is never charged.
export function extractIsolated(buffer, opts = {}, { timeoutMs = 90_000, workerUrl = WORKER_URL } = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl, {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      workerData: { bytes: new Uint8Array(buffer), opts },
    });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      error: `Extraction timed out after ${Math.round(timeoutMs / 1000)}s; this file was not charged.`,
      timed_out: true,
      charged: false,
    }), timeoutMs);
    worker.once('message', (msg) => finish(msg.ok
      ? msg.result
      : { error: publicWorkerError(msg.error), charged: false }));
    worker.once('error', (err) => finish({ error: publicWorkerError(err?.message || String(err)), charged: false }));
    worker.once('exit', (code) => {
      if (done) return;
      finish({ error: publicWorkerError(`Extraction worker exited (${code})`), charged: false });
    });
  });
}
