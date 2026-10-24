const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function toIso(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(iso, n) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function isWeekend(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

export function nextBusinessDay(iso) {
  let d = addDays(iso, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Business-day steps from a to b. Friday to Monday is 1. */
export function businessSteps(a, b) {
  if (!a || !b || b <= a) return 0;
  if (daysBetween(a, b) > 400) return daysBetween(a, b);
  let n = 0;
  let d = a;
  while (d < b && n < 400) {
    d = nextBusinessDay(d);
    if (d > b) break;
    n += 1;
    if (d === b) break;
  }
  return n;
}

export function missedBusinessDays(prev, next) {
  const missed = [];
  if (!prev || !next || next <= prev) return missed;
  // A real statement cannot hide years of missed pulls. Stop rather than build
  // a gigantic list from a bad date.
  if (daysBetween(prev, next) > 400) return missed;
  let d = nextBusinessDay(prev);
  while (d < next && missed.length < 400) {
    missed.push(d);
    d = nextBusinessDay(d);
  }
  return missed;
}

function monthIndex(name) {
  return MONTHS[String(name || '').slice(0, 3).toLowerCase()] ?? null;
}

function withinPeriod(iso, period) {
  if (!iso || !period?.start || !period?.end) return false;
  const from = addDays(period.start, -3);
  const to = addDays(period.end, 3);
  return iso >= from && iso <= to;
}

function inferYear(month, day, period) {
  const years = [];
  if (period?.end) years.push(Number(period.end.slice(0, 4)));
  if (period?.start) years.push(Number(period.start.slice(0, 4)));
  if (!years.length) years.push(new Date().getUTCFullYear());
  const candidates = [...new Set(years.flatMap((y) => [y, y - 1, y + 1]))];
  for (const year of candidates) {
    const iso = toIso(year, month, day);
    if (iso && withinPeriod(iso, period)) return iso;
  }
  return toIso(candidates[0], month, day);
}

export function parseDate(input, period = null) {
  const t = String(input ?? '').trim().replace(/\./g, '');
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) return toIso(+m[3], monthIndex(m[1]), +m[2]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);
  if (m) return toIso(+m[3], monthIndex(m[2]), +m[1]);
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (m) return inferYear(monthIndex(m[1]), +m[2], period);
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    let month = +m[1];
    let day = +m[2];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return toIso(year, month, day);
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    let month = +m[1];
    let day = +m[2];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return inferYear(month, day, period);
  }
  return null;
}

const DATE_TOKEN = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+[A-Za-z]{3,9}\.?,?(?:\s+\d{4})?)$/;
const MONTH_WORD = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;

export function isDateToken(raw) {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/\./g, '');
  if (!DATE_TOKEN.test(t)) return false;
  const leadingMonth = t.match(/^([A-Za-z]+)\s+\d/);
  if (leadingMonth && !MONTH_WORD.test(leadingMonth[1])) return false;
  const trailingMonth = t.match(/^\d{1,2}\s+([A-Za-z]+)/);
  if (trailingMonth && !MONTH_WORD.test(trailingMonth[1])) return false;
  return true;
}

const DATED = String.raw`(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}|\d{1,2}[/. -]\d{1,2})`;
const MAX_SPAN_DAYS = 400;

export function parsePeriod(lines) {
  const text = lines.filter((l) => !l.page || l.page === 1).slice(0, 40).map((l) => l.text).join(' ');
  const re = new RegExp(`(${DATED})\\s*(?:-|–|—|\\bto\\b|\\bthrough\\b|\\bthru\\b)\\s*(${DATED})`, 'i');
  const m = text.match(re);
  if (!m) return { start: null, end: null };
  const end = parseDate(m[2].replace(/\s+/g, ' '));
  let start = parseDate(m[1].replace(/\s+/g, ' '), end ? { start: addDays(end, -370), end } : null);
  if (start && end && start > end) {
    const year = Number(end.slice(0, 4)) - 1;
    const shifted = toIso(year, Number(start.slice(5, 7)), Number(start.slice(8, 10)));
    if (shifted && shifted <= end) start = shifted;
  }
  return { start, end };
}

export function eachDate(start, end) {
  const out = [];
  if (!start || !end || end < start) return out;
  if (daysBetween(start, end) > MAX_SPAN_DAYS) return out;
  for (let d = start, guard = 0; d <= end && guard <= MAX_SPAN_DAYS; d = addDays(d, 1), guard += 1) out.push(d);
  return out;
}
