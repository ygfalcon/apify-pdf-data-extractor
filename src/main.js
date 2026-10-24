import { Actor, log } from 'apify';
import { normalizeInput } from './input.js';
import { fetchPdf } from './lib/fetch-pdf.js';
import { extractIsolated } from './isolate.js';
import { redactUrl, runBatch } from './run.js';

await Actor.init();

let input;
try {
  input = normalizeInput((await Actor.getInput()) ?? {});
} catch (err) {
  await Actor.fail(err instanceof Error ? err.message : String(err));
  return;
}

const dataset = await Actor.openDataset();
const stored = (await Actor.getValue('CHARGE_LEDGER')) ?? {};
const ledger = new Map(Object.entries(stored));

async function persist() {
  await Actor.setValue('CHARGE_LEDGER', Object.fromEntries(ledger));
}

async function charge(opts) {
  const env = Actor.getEnv();
  if (Actor.isAtHome() && env.actorRunId) {
    await Actor.newClient().run(env.actorRunId).charge({
      eventName: opts.eventName,
      count: opts.count,
      idempotencyKey: opts.idempotencyKey,
    });
    return { chargedCount: opts.count ?? 1, eventChargeLimitReached: false };
  }
  return Actor.charge({ eventName: opts.eventName, count: opts.count });
}

const stats = await runBatch({
  sources: input.sources,
  mode: input.mode,
  documentType: input.documentType,
  ledger,
  fetchPdf,
  extract: extractIsolated,
  pushData: (item) => dataset.pushData(item),
  charge,
  persist,
});

await Actor.setValue('SUMMARY', stats);
log.info(`Done: ${JSON.stringify(stats)}`);
for (const url of input.sources) log.info(`Source ${redactUrl(url)}`);
await Actor.exit();
