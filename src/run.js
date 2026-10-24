import { createHash } from 'node:crypto';
import { redactSecrets } from './billing.js';
import { chargeEvent, isBillable } from './charge.js';

const SECRET_QUERY = /^(token|key|secret|password|sig|signature|auth)$/i;

export function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.set(key, 'redacted');
    }
    return url.toString();
  } catch {
    return 'invalid-url';
  }
}

function sourceKey(url) {
  return createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
}

function idempotencyKey(eventName, url) {
  return `${eventName}:${sourceKey(url)}`;
}

function safeError(err) {
  let message = err instanceof Error ? err.message : String(err);
  message = redactSecrets(message)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/AI_GATEWAY_API_KEY=\S+/gi, '[secret]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [secret]')
    .replace(/\bsk-[A-Za-z0-9]+\b/g, '[secret]');
  if (!/not charged/i.test(message)) message = `${message} Not charged.`;
  return message.slice(0, 300);
}

async function remember(ledger, persist) {
  if (persist) await persist(ledger);
}

/**
 * Push the dataset row before charging. A failed push does not charge.
 * The ledger is pending, then pushed, then charged, so a retry does not write or charge twice.
 */
export async function runBatch({
  sources,
  mode,
  documentType,
  ledger,
  fetchPdf,
  extract,
  pushData,
  charge,
  persist,
}) {
  const stats = { mode, requested: sources.length, succeeded: 0, failed: 0, charged: 0, stoppedByBudget: false };
  for (const url of sources) {
    if (stats.stoppedByBudget) break;
    const key = sourceKey(url);
    const prior = ledger.get(key);
    if (prior?.status === 'charged' || prior?.status === 'failed') continue;

    const publicUrl = redactUrl(url);
    if (prior?.status === 'pushed' && prior.eventName) {
      const billed = await charge({ eventName: prior.eventName, count: 1, idempotencyKey: prior.idempotencyKey });
      stats.charged += billed?.chargedCount ?? 0;
      if (billed?.eventChargeLimitReached && !(billed?.chargedCount > 0)) {
        stats.stoppedByBudget = true;
        break;
      }
      ledger.set(key, { status: 'charged', eventName: prior.eventName, idempotencyKey: prior.idempotencyKey });
      await remember(ledger, persist);
      if (billed?.eventChargeLimitReached) stats.stoppedByBudget = true;
      stats.succeeded += 1;
      continue;
    }

    const type = mode === 'bank_statement' || documentType === 'auto' ? undefined : documentType;
    let result;
    try {
      const buf = await fetchPdf(url);
      result = await extract(buf, { mode: mode === 'preview' ? 'preview' : 'full', type });
    } catch (err) {
      await pushData({ sourceUrl: publicUrl, error: safeError(err), charged: false });
      ledger.set(key, { status: 'failed' });
      await remember(ledger, persist);
      stats.failed += 1;
      continue;
    }

    const preview = mode === 'preview' || result?.mode === 'preview' || result?.summary?.preview === true;
    if (!preview && !isBillable(result)) {
      const error = result?.note || result?.error || 'Extraction failed. Not charged.';
      await pushData(redactSecrets({ sourceUrl: publicUrl, ...result, error, charged: false }));
      ledger.set(key, { status: 'failed' });
      await remember(ledger, persist);
      stats.failed += 1;
      continue;
    }

    const eventName = preview ? null : chargeEvent(mode, result.document_type);
    const item = redactSecrets({ sourceUrl: publicUrl, ...result, charged: Boolean(eventName) });
    await pushData(item);
    if (!eventName) {
      ledger.set(key, { status: 'charged', eventName: null });
      await remember(ledger, persist);
      stats.succeeded += 1;
      continue;
    }

    const chargeKey = idempotencyKey(eventName, url);
    ledger.set(key, { status: 'pushed', eventName, idempotencyKey: chargeKey });
    await remember(ledger, persist);
    const billed = await charge({ eventName, count: 1, idempotencyKey: chargeKey });
    stats.charged += billed?.chargedCount ?? 0;
    if (billed?.eventChargeLimitReached && !(billed?.chargedCount > 0)) {
      stats.stoppedByBudget = true;
      break;
    }
    ledger.set(key, { status: 'charged', eventName, idempotencyKey: chargeKey });
    await remember(ledger, persist);
    stats.succeeded += 1;
    if (billed?.eventChargeLimitReached) stats.stoppedByBudget = true;
  }
  return stats;
}
