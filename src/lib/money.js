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

const CUR = String.raw`(?:US\$|[$€£₹]|Rs\.?)`;
const NUM_DEC = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}`;
const NUM_INT = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d+)`;
const SIGN_WRAP = String.raw`[-(]?\s*${CUR}?\s*-?\s*`;
const TAIL = String.raw`\s*${CUR}?\s*\)?-?(?:\s*(?:DR|CR))?`;
const DEC_BODY = String.raw`${SIGN_WRAP}${NUM_DEC}${TAIL}`;
const INT_BODY = String.raw`(?:${CUR}\s*-?\s*${NUM_INT}|-?\s*${NUM_INT}\s*${CUR})`;
const DEC_RE = new RegExp(String.raw`(?<![\w])(${DEC_BODY})(?!\s*%)`, 'gi');
const INT_RE = new RegExp(String.raw`(?<![\w])(${INT_BODY})(?!\s*[.,]\d)(?!\s*%)`, 'gi');
const TOKEN_RE = new RegExp(String.raw`^(?:${DEC_BODY}|${INT_BODY})$`, 'i');

export function isMoneyToken(raw) {
  const t = String(raw ?? '').trim();
  if (!t || /%/.test(t)) return false;
  return TOKEN_RE.test(t);
}

function localizedNumber(token) {
  const m = String(token).match(/(\d{1,3}(?:[.,]\d{3})+|\d+)([.,]\d{2})?/);
  if (!m) return null;
  if (!m[2]) return Number(m[1].replace(/[.,]/g, ''));
  if (m[2][0] === ',') return Number(m[1].replace(/\./g, '') + '.' + m[2].slice(1));
  return Number(m[1].replace(/,/g, '') + m[2]);
}

/**
 * Parse a single money token.
 * explicit is true when the sign is printed (minus, parentheses, trailing minus, DR/CR).
 * European comma decimals and currency-marked integers (Rs 1939, 46,68 €) are accepted.
 * A bare integer or a percentage is not money.
 */
export function parseMoneyToken(raw) {
  let t = String(raw ?? '').trim();
  if (!t || /%/.test(t) || !TOKEN_RE.test(t)) return null;
  const suffix = t.match(/\s*(DR|CR)$/i);
  if (suffix) t = t.slice(0, -suffix[0].length).trim();
  const paren = /^\(.*\)$/.test(t);
  const dr = suffix && suffix[1].toUpperCase() === 'DR';
  const cr = suffix && suffix[1].toUpperCase() === 'CR';
  const leadingMinus = /(?:^|[$€£₹]|Rs\.?)\s*-/i.test(t);
  const trailingMinus = /-$/.test(t) && !leadingMinus;
  const neg = paren || trailingMinus || leadingMinus || dr;
  const n = localizedNumber(t);
  if (!Number.isFinite(n)) return null;
  return { value: neg ? -Math.abs(round2(n)) : Math.abs(round2(n)), explicit: neg || cr };
}

/** Money tokens embedded in a longer line, such as "Beginning Balance 4,000.00". */
export function findMoney(text) {
  const src = String(text ?? '');
  const found = [];
  for (const re of [DEC_RE, INT_RE]) {
    re.lastIndex = 0;
    for (const match of src.matchAll(re)) {
      const parsed = parseMoneyToken(match[0]);
      if (!parsed) continue;
      found.push({ ...parsed, index: match.index, length: match[0].length });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const out = [];
  let end = -1;
  for (const match of found) {
    if (match.index < end) continue;
    end = match.index + match.length;
    out.push({ value: match.value, explicit: match.explicit });
  }
  return out;
}

export function sumAmounts(rows, pred = () => true) {
  return round2(rows.filter(pred).reduce((s, r) => s + r.amount, 0));
}
