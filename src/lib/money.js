/** Currency helpers. Comparisons tolerate a single cent. */

export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function moneyEq(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.015;
}

// Optional USD/$, accounting parens, a trailing minus (with or without a space),
// a statement asterisk, and a DR/CR marker. Still requires cents, so check
// numbers and dates are not amounts.
const MONEY_BODY = String.raw`(?:USD\s*)?\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?\s*-?\*?(?:\s*(?:DR|CR))?`;
const MONEY_EXACT = new RegExp(`^${MONEY_BODY}$`, 'i');

export function isMoneyToken(raw) {
  return MONEY_EXACT.test(String(raw ?? '').trim());
}

export function stripMoney(text) {
  return String(text ?? '').replace(new RegExp(MONEY_BODY, 'gi'), ' ');
}

/**
 * Parse a single money token.
 * explicit is true when the sign is printed (minus, parentheses, trailing minus, DR/CR).
 */
export function parseMoneyToken(raw) {
  let t = String(raw ?? '').trim();
  if (!t || !MONEY_EXACT.test(t)) return null;
  t = t.replace(/^USD\s*/i, '').replace(/\*$/, '').trim();
  const suffix = t.match(/\s*(DR|CR)$/i);
  if (suffix) t = t.slice(0, -suffix[0].length).trim();
  const paren = /^\(.*\)$/.test(t);
  const trailingMinus = /-\s*$/.test(t);
  const leadingMinus = /^-/.test(t);
  const dr = suffix && suffix[1].toUpperCase() === 'DR';
  const cr = suffix && suffix[1].toUpperCase() === 'CR';
  const neg = paren || trailingMinus || leadingMinus || dr;
  const n = Number(t.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return { value: neg ? -Math.abs(round2(n)) : Math.abs(round2(n)), explicit: neg || cr };
}

/** Money tokens embedded in a longer line, such as "Beginning Balance 4,000.00". */
export function findMoney(text) {
  const re = new RegExp(MONEY_BODY, 'gi');
  const out = [];
  for (const match of String(text ?? '').matchAll(re)) {
    const parsed = parseMoneyToken(match[0]);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function sumAmounts(rows, pred = () => true) {
  return round2(rows.filter(pred).reduce((s, r) => s + r.amount, 0));
}
