import { chargeEvent, isBillable } from './charge.js';

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

/** Replace env secrets so dataset rows and logs cannot echo API keys or tokens. */
export function redactSecrets(value, env = process.env) {
  const secrets = Object.entries(env)
    .filter(([name, secret]) => SECRET_NAME.test(name) && typeof secret === 'string' && secret.length >= 8)
    .map(([, secret]) => secret)
    .sort((a, b) => b.length - a.length);
  const scrub = (text) => {
    let out = text;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join('[redacted]');
    }
    return out;
  };
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, env));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = redactSecrets(entry, env);
    return out;
  }
  return value;
}

/**
 * Persist the dataset row before charging. A failed write never bills, and a
 * statement that does not foot is stored with charged: false.
 */
export async function settleDocument({ result, sourceUrl, mode, pushData, charge }) {
  const preview = mode === 'preview' || result?.mode === 'preview' || result?.summary?.preview === true;
  const eventName = preview ? null : chargeEvent(mode, result?.document_type);
  const billable = !preview && !!eventName && isBillable(result);
  const item = redactSecrets({
    sourceUrl,
    ...result,
    charged: billable,
  });
  await pushData(item);
  if (!billable) return { chargedCount: 0, billable: false, eventName: null, stored: true };
  try {
    const c = await charge({ eventName, count: 1 });
    return {
      chargedCount: c?.chargedCount ?? 0,
      billable: (c?.chargedCount ?? 0) > 0,
      eventName,
      eventChargeLimitReached: !!c?.eventChargeLimitReached,
      stored: true,
    };
  } catch (err) {
    return {
      chargedCount: 0,
      billable: false,
      eventName,
      stored: true,
      chargeError: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}
