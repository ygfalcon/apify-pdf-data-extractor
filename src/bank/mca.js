import { addDays, businessSteps, daysBetween, isWeekend, missedBusinessDays } from '../lib/dates.js';
import { round2 } from '../lib/money.js';
import { categorize } from './taxonomy.js';

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function counterpartyKey(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/\b(ach|debit|credit|orig|co|name|id|trace|ppd|ccd|web|tel|payment|pymt|withdrawal)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
}

function titleCase(key) {
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const PATTERN_ELIGIBLE = new Set(['ach_debit', 'wire_out', 'other_debit']);

/**
 * Upgrade equal recurring debits that the name list missed into MCA payments.
 * Requires four or more debits of the same amount on a steady cadence.
 */
export function applyRecurringMca(transactions) {
  const groups = new Map();
  for (const txn of transactions) {
    if (txn.amount >= -50) continue;
    if (!PATTERN_ELIGIBLE.has(txn.category)) continue;
    const key = counterpartyKey(txn.description);
    if (key.length < 4) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(txn);
  }
  for (const [key, rows] of groups) {
    if (rows.length < 4) continue;
    const amounts = rows.map((r) => Math.abs(r.amount));
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    if (max - min > 0.05) continue;
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    if (dates.length < 4) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const med = median(gaps);
    const steady = med != null && med >= 1 && med <= 35 && gaps.every((g) => Math.abs(g - med) <= Math.max(2, med * 0.5));
    if (!steady) continue;
    const funder = { key, name: titleCase(key) };
    for (const txn of rows) {
      txn.category = 'mca_payment';
      txn.category_group = 'financing_out';
      txn.funder = funder;
      txn.mca_identified_by = 'recurring_pattern';
    }
  }
  return transactions;
}

function cadence(dates) {
  if (dates.length < 3) return { frequency: dates.length ? 'irregular' : null, missed: [] };
  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const med = median(gaps);
  const weekdayOnly = dates.every((d) => !isWeekend(d));
  const biz = [];
  if (weekdayOnly) {
    for (let i = 1; i < dates.length; i += 1) biz.push(businessSteps(dates[i - 1], dates[i]));
  }
  const medBiz = weekdayOnly ? median(biz) : null;
  const missed = [];
  const pushMiss = (date, expected) => missed.push({ date, expected_amount: expected });

  if (weekdayOnly && medBiz === 1 && med <= 3) {
    for (let i = 1; i < dates.length; i += 1) {
      for (const day of missedBusinessDays(dates[i - 1], dates[i])) pushMiss(day, null);
    }
    return { frequency: 'daily', missed };
  }
  if (med === 1) {
    for (let i = 1; i < dates.length; i += 1) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      for (let n = 1; n < gap; n += 1) pushMiss(addDays(dates[i - 1], n), null);
    }
    return { frequency: 'daily', missed };
  }
  let frequency = 'irregular';
  let step = null;
  if (med >= 6 && med <= 8) { frequency = 'weekly'; step = 7; }
  else if (med >= 13 && med <= 16) { frequency = 'biweekly'; step = 14; }
  else if (med >= 27 && med <= 33) { frequency = 'monthly'; step = Math.round(med); }
  if (step) {
    for (let i = 1; i < dates.length; i += 1) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      const skipped = Math.round(gap / step) - 1;
      if (skipped > 0 && gap >= step + Math.max(4, step * 0.4)) {
        for (let n = 1; n <= skipped; n += 1) pushMiss(addDays(dates[i - 1], step * n), null);
      }
    }
  }
  return { frequency, missed };
}

function linkReversals(transactions) {
  const payments = transactions.filter((t) => t.category === 'mca_payment' || t.category === 'loan_payment');
  for (const txn of transactions) {
    if (!(txn.amount > 0)) continue;
    const d = txn.description.toLowerCase();
    const returnish = /return|revers|reject|bounce|unpaid/.test(d);
    if (!returnish) continue;
    if (/\bfee\b/.test(d) && txn.amount <= 80) continue;
    if (txn.category === 'mca_payment_reversal' || txn.category === 'loan_payment_reversal') continue;
    const hit = payments
      .filter((p) => p.date <= txn.date && daysBetween(p.date, txn.date) <= 5 && Math.abs(Math.abs(p.amount) - txn.amount) < 0.02)
      .sort((a, b) => daysBetween(a.date, txn.date) - daysBetween(b.date, txn.date))[0];
    if (!hit) continue;
    const loan = hit.category === 'loan_payment';
    txn.category = loan ? 'loan_payment_reversal' : 'mca_payment_reversal';
    txn.category_group = 'financing_in';
    txn.funder = hit.funder ?? txn.funder;
    txn.reverses = hit.date;
  }
  return transactions;
}

export function buildMcaPositions(transactions) {
  linkReversals(transactions);
  const byFunder = new Map();
  const ensure = (funder, identified) => {
    const key = funder?.name || 'Unknown funder';
    if (!byFunder.has(key)) {
      byFunder.set(key, {
        funder: key,
        identified_by: identified || 'lender_list',
        payments: [],
        proceeds: [],
        reversals: [],
      });
    }
    const row = byFunder.get(key);
    if (identified === 'recurring_pattern') row.identified_by = 'recurring_pattern';
    return row;
  };

  for (const txn of transactions) {
    if (!['mca_payment', 'mca_proceeds', 'mca_payment_reversal'].includes(txn.category)) continue;
    const bucket = ensure(txn.funder || { name: counterpartyKey(txn.description) }, txn.mca_identified_by || 'lender_list');
    if (txn.category === 'mca_payment') bucket.payments.push(txn);
    else if (txn.category === 'mca_proceeds') bucket.proceeds.push(txn);
    else bucket.reversals.push(txn);
  }

  const positions = [];
  for (const bucket of byFunder.values()) {
    const payments = [...bucket.payments].sort((a, b) => a.date.localeCompare(b.date) || a.page - b.page);
    const reversals = [...bucket.reversals].sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set();
    const bounced = [];
    for (const rev of reversals) {
      let idx = -1;
      let bestGap = Infinity;
      payments.forEach((p, i) => {
        if (used.has(i) || p.date > rev.date) return;
        const gap = daysBetween(p.date, rev.date);
        if (gap > 5 || Math.abs(Math.abs(p.amount) - rev.amount) >= 0.02) return;
        if (gap < bestGap) {
          bestGap = gap;
          idx = i;
        }
      });
      if (idx >= 0) used.add(idx);
      bounced.push({
        date: rev.date,
        amount: rev.amount,
        linked_payment_date: idx >= 0 ? payments[idx].date : rev.reverses ?? null,
        description: rev.description,
      });
    }
    const paymentRows = payments.map((p, i) => ({
      date: p.date,
      amount: round2(Math.abs(p.amount)),
      status: used.has(i) ? 'bounced' : 'paid',
    }));
    const dates = [...new Set(payments.map((p) => p.date))].sort();
    const { frequency, missed } = cadence(dates);
    const typical = paymentRows.length
      ? round2(paymentRows.reduce((s, p) => s + p.amount, 0) / paymentRows.length)
      : null;
    for (const m of missed) m.expected_amount = typical;
    const attempted = round2(paymentRows.reduce((s, p) => s + p.amount, 0)) ?? 0;
    const reversed = round2(bounced.reduce((s, p) => s + p.amount, 0)) ?? 0;
    const proceeds = bucket.proceeds;
    let status = 'current';
    if (!paymentRows.length && proceeds.length) status = 'proceeds_only';
    else if (bounced.length && missed.length) status = 'missed_and_bounced';
    else if (bounced.length) status = 'bounced';
    else if (missed.length) status = 'missed';
    positions.push({
      funder: bucket.funder,
      identified_by: bucket.identified_by,
      frequency: paymentRows.length >= 2 ? frequency : null,
      typical_payment: typical,
      payment_count: paymentRows.length,
      paid_count: paymentRows.filter((p) => p.status === 'paid').length,
      bounced_count: bounced.length,
      missed_count: missed.length,
      total_attempted: attempted,
      total_paid: round2(attempted - reversed),
      proceeds_amount: proceeds.length ? round2(proceeds.reduce((s, p) => s + p.amount, 0)) : null,
      proceeds_date: proceeds[0]?.date ?? null,
      status,
      payments: paymentRows,
      missed_payments: missed,
      bounced_payments: bounced,
    });
  }
  positions.sort((a, b) => a.funder.localeCompare(b.funder));
  return positions;
}

export function refreshCategory(txn) {
  const cat = categorize(txn.description, txn.amount);
  txn.category = cat.category;
  txn.category_group = cat.category_group;
  txn.funder = cat.funder;
  return txn;
}
