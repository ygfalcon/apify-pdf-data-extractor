import { eachDate } from '../lib/dates.js';
import { round2 } from '../lib/money.js';
import { applyRecurringMca, buildMcaPositions } from './mca.js';
import { parseStatement } from './parse.js';
import { reconcile } from './reconcile.js';
import { TRUE_REVENUE_DEFINITION, categorize, trueRevenueTreatment } from './taxonomy.js';

const DEBT_OUT = new Set(['mca_payment', 'loan_payment', 'sba_loan_payment', 'line_of_credit_payment']);
const DEBT_BACK = new Set(['mca_payment_reversal', 'loan_payment_reversal']);

function field(value, confidence, source) {
  if (value == null || value === '') return null;
  return { value, confidence: Math.round(confidence * 100) / 100, source };
}

function chronological(txns, opening) {
  if (txns.length < 2) return txns.slice();
  const first = txns[0].date;
  const last = txns[txns.length - 1].date;
  if (first > last) return txns.slice().reverse();
  if (first < last) return txns.slice();
  const endBal = txns[txns.length - 1].balance;
  if (opening != null && txns[0].balance != null && endBal != null) {
    if (Math.abs(endBal - opening) + 0.01 < Math.abs(txns[0].balance - opening)) return txns.slice().reverse();
  }
  return txns.slice();
}

function hintSign(description) {
  const d = description.toLowerCase();
  if (/\b(debit|withdrawal|purchase|pos|payment|paid)\b/.test(d) && !/\bcredit\b/.test(d) && !/deposit/.test(d)) return -1;
  if (/\bcheck\s*#?\s*\d+/.test(d) && !/deposit/.test(d)) return -1;
  if (/\b(credit|deposit)\b/.test(d)) return 1;
  return 0;
}

function finalizeSigns(txns, opening) {
  let prev = opening;
  for (const t of txns) {
    if (t.signSource === 'unsigned' && prev != null && t.balance != null && t.amount != null) {
      const delta = round2(t.balance - prev);
      if (Math.abs(Math.abs(delta) - Math.abs(t.amount)) < 0.02) {
        t.amount = delta;
        t.signSource = 'running_balance';
      }
    }
    if (t.signSource === 'unsigned' && t.amount != null) {
      const hint = hintSign(t.description);
      if (hint) {
        t.amount = round2(hint * Math.abs(t.amount));
        t.signSource = 'description';
      }
    }
    if (t.balance != null) prev = t.balance;
    else if (prev != null && t.amount != null) prev = round2(prev + t.amount);
  }
}

function dedupe(txns) {
  const seen = new Set();
  const out = [];
  for (const t of txns) {
    const key = `${t.date}|${t.amount}|${t.balance}|${t.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function pdfDateMs(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function tamperFlags(meta, fonts, txns) {
  const flags = [];
  const producer = `${meta?.Producer || ''} ${meta?.Creator || ''}`.trim();
  if (/photoshop|illustrator|ilovepdf|smallpdf|sejda|pdfescape|canva|microsoft word|foxit phantom|nitro|pdf-xchange|inkscape|libreoffice/i.test(producer)) {
    flags.push(`editing_software_in_metadata: ${producer}`);
  }
  const created = pdfDateMs(meta?.CreationDate);
  const modified = pdfDateMs(meta?.ModDate);
  if (created != null && modified != null && Math.abs(modified - created) > 24 * 3600 * 1000) flags.push('modified_after_creation');
  if (fonts > 8) flags.push(`many_fonts: ${fonts}`);
  const deposits = txns.filter((t) => t.amount > 0);
  const round = deposits.filter((t) => t.amount >= 1000 && Math.abs(t.amount % 100) < 0.001);
  if (deposits.length > 5 && round.length / deposits.length > 0.5) flags.push('many_round_dollar_deposits');
  return flags;
}

function dailyBalances(txns, opening, start, end) {
  if (opening == null || !start || !end || end < start) return [];
  let bal = opening;
  for (const t of txns) if (t.date < start) bal = round2(bal + t.amount);
  const byDate = new Map();
  for (const t of txns) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  const days = [];
  for (const date of eachDate(start, end)) {
    for (const t of byDate.get(date) || []) bal = round2(bal + t.amount);
    days.push({ date, balance: bal });
  }
  return days;
}

function monthKeys(start, end, txns) {
  const fromPeriod = start && end ? [...new Set(eachDate(start, end).map((d) => d.slice(0, 7)))] : [];
  if (fromPeriod.length) return fromPeriod;
  return [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort();
}

function layoutOf(txns) {
  if (!txns.length) return null;
  if (txns.some((t) => t.signSource === 'column')) return 'split_debit_credit';
  if (txns.some((t) => t.signSource === 'section')) return 'sectioned';
  if (txns.every((t) => t.balance == null)) return 'amount_only';
  return 'combined_amount';
}

function publicTxn(t) {
  return {
    date: t.date,
    description: t.description,
    amount: t.amount,
    balance: t.balance,
    category: t.category,
    category_group: t.category_group,
    true_revenue: t.true_revenue,
    page: t.page,
    ...(t.check_number ? { check_number: t.check_number } : {}),
    ...(t.funder ? { funder: t.funder.name } : {}),
  };
}

export function analyzeStatement(layer, opts = {}) {
  const parsed = parseStatement(layer);
  let txns = dedupe(chronological(parsed.transactions, parsed.printed.opening));
  finalizeSigns(txns, parsed.printed.opening);
  for (const t of txns) {
    if (t.amount == null) continue;
    const cat = categorize(t.description, t.amount);
    t.category = cat.category;
    t.category_group = cat.category_group;
    t.funder = cat.funder;
  }
  txns = txns.filter((t) => t.amount != null && t.date);
  applyRecurringMca(txns);
  const positions = buildMcaPositions(txns);

  const revenue = { amount: 0, transaction_count: 0, excluded_internal_transfers: 0, excluded_loan_proceeds: 0, excluded_financing_reversals: 0 };
  const excludedKey = {
    internal_transfers: 'excluded_internal_transfers',
    loan_proceeds: 'excluded_loan_proceeds',
    financing_reversals: 'excluded_financing_reversals',
  };
  for (const t of txns) {
    const treatment = trueRevenueTreatment(t.category, t.amount);
    t.true_revenue = treatment.counts;
    if (treatment.counts) {
      revenue.amount = round2(revenue.amount + t.amount);
      revenue.transaction_count += 1;
    } else if (treatment.bucket) {
      const key = excludedKey[treatment.bucket];
      revenue[key] = round2(revenue[key] + t.amount);
    }
  }
  revenue.amount = round2(revenue.amount) ?? 0;
  revenue.definition = TRUE_REVENUE_DEFINITION;

  const opening = parsed.printed.opening;
  const ending = parsed.printed.ending;
  const reconciliation = reconcile({
    opening,
    ending,
    printedCredits: parsed.printed.credits,
    printedDebits: parsed.printed.debits,
    transactions: txns,
  });

  const start = parsed.period.start;
  const end = parsed.period.end;
  const days = dailyBalances(txns, opening, start, end);
  const average = days.length ? round2(days.reduce((s, d) => s + d.balance, 0) / days.length) : null;
  const lowest = days.length ? round2(Math.min(...days.map((d) => d.balance))) : null;
  const negative = days.filter((d) => d.balance < -0.001).length;
  const nsfRows = txns.filter((t) => ['nsf_fee', 'overdraft_fee', 'returned_item_fee'].includes(t.category));
  const nsfFees = round2(nsfRows.reduce((s, t) => s - t.amount, 0)) ?? 0;

  const months = monthKeys(start, end, txns);
  const monthly = {};
  for (const key of months) {
    monthly[key] = { deposits: 0, withdrawals: 0, true_revenue: 0, deposit_count: 0, internal_transfers: 0, loan_proceeds: 0 };
  }
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    if (!monthly[key]) monthly[key] = { deposits: 0, withdrawals: 0, true_revenue: 0, deposit_count: 0, internal_transfers: 0, loan_proceeds: 0 };
    const bucket = monthly[key];
    if (t.amount > 0) {
      bucket.deposits = round2(bucket.deposits + t.amount);
      bucket.deposit_count += 1;
      if (t.true_revenue) bucket.true_revenue = round2(bucket.true_revenue + t.amount);
      const treatment = trueRevenueTreatment(t.category, t.amount);
      if (treatment.bucket === 'internal_transfers') bucket.internal_transfers = round2(bucket.internal_transfers + t.amount);
      if (treatment.bucket === 'loan_proceeds') bucket.loan_proceeds = round2(bucket.loan_proceeds + t.amount);
    } else bucket.withdrawals = round2(bucket.withdrawals - t.amount);
  }
  const monthList = Object.keys(monthly).sort();
  const trueByMonth = monthList.map((k) => monthly[k].true_revenue);
  const trend = trueByMonth.length >= 2 && trueByMonth[0] ? round2((trueByMonth[trueByMonth.length - 1] - trueByMonth[0]) / Math.abs(trueByMonth[0])) : null;

  let debtNet = 0;
  for (const t of txns) {
    if (DEBT_OUT.has(t.category)) debtNet += -t.amount;
    if (DEBT_BACK.has(t.category)) debtNet -= t.amount;
  }
  debtNet = round2(debtNet) ?? 0;
  const monthCount = Math.max(1, monthList.length);
  const monthlyDebt = round2(debtNet / monthCount);
  const avgTrue = monthList.length ? round2(trueByMonth.reduce((s, n) => s + n, 0) / monthList.length) : 0;
  const holdback = avgTrue ? round2(monthlyDebt / avgTrue) : null;

  const tamper = tamperFlags(layer.meta, layer.fonts, txns);
  const integrity = [...tamper];
  if (reconciliation.summary_totals.status === 'fail') integrity.push('summary_totals_mismatch');
  if (reconciliation.running_balance.status === 'fail') integrity.push(`running_balance_breaks: ${reconciliation.running_balance.break_count}`);
  if (reconciliation.status === 'fail') integrity.push('reconciliation_failed');

  const credits = reconciliation.summary_totals.transaction_credits;
  const debits = reconciliation.summary_totals.transaction_debits;
  const layout = layoutOf(txns);
  const missed = positions.reduce((s, p) => s + p.missed_count, 0);
  const bounced = positions.reduce((s, p) => s + p.bounced_count, 0);
  const confidence = reconciliation.status === 'pass' ? 0.99 : reconciliation.status === 'fail' ? 0.7 : 0.85;

  const summary = {
    bank_name: parsed.identity.bank,
    account_holder: parsed.identity.holder,
    account_last4: parsed.account,
    period_start: start,
    period_end: end,
    statement_layout: layout,
    opening_balance: opening,
    closing_balance: ending,
    total_deposits: credits,
    total_withdrawals: debits,
    transaction_count: txns.length,
    true_revenue: revenue.amount,
    true_revenue_detail: revenue,
    average_daily_balance: average,
    lowest_daily_balance: lowest,
    negative_balance_days: days.length ? negative : null,
    nsf_count: nsfRows.length,
    nsf_fees: nsfFees,
    reconciliation_status: reconciliation.status,
    mca_position_count: positions.length,
    mca_missed_payments: missed,
    mca_bounced_payments: bounced,
    monthly_debt_service: monthlyDebt,
    mca_holdback: holdback,
    tamper_flags: tamper,
    integrity_flags: integrity,
  };

  if (!txns.length && opening == null && ending == null) {
    return {
      error: 'No bank statement transactions or balances found in the text layer. Not charged.',
      note: 'No bank statement transactions or balances found in the text layer. Not charged.',
    };
  }

  const body = {
    fields: {
      bank_name: field(parsed.identity.bank, 0.86, 'header'),
      account_holder: field(parsed.identity.holder, 0.8, 'header'),
      account_last4: field(parsed.account, 0.9, 'label'),
      period_start: field(start, 0.93, 'label'),
      period_end: field(end, 0.93, 'label'),
      opening_balance: field(opening, confidence, 'summary'),
      closing_balance: field(ending, confidence, 'summary'),
      total_deposits: field(credits, confidence, 'transactions'),
      total_withdrawals: field(debits, confidence, 'transactions'),
      transaction_count: field(txns.length, confidence, 'transactions'),
      nsf_count: field(nsfRows.length, confidence, 'transactions'),
      true_revenue: field(revenue.amount, confidence, 'transactions'),
      mca_lenders: field(positions.map((p) => p.funder), 0.9, 'lender_list'),
    },
    transactions: txns.map(publicTxn),
    reconciliation,
    reconciliation_status: reconciliation.status,
    true_revenue: revenue.amount,
    average_daily_balance: average,
    mca_positions: positions,
    summary,
    metrics: {
      average_daily_balance: average,
      lowest_daily_balance: lowest,
      negative_balance_days: days.length ? negative : null,
      nsf_overdraft_count: nsfRows.length,
      nsf_overdraft_fees: nsfFees,
      monthly,
      avg_monthly_true_revenue: avgTrue,
      avg_monthly_revenue_deposits: avgTrue,
      deposit_trend_first_to_last_month: trend,
      true_revenue: revenue,
      debt_positions: Object.fromEntries(positions.map((p) => [p.funder, {
        count: p.payment_count,
        total: p.total_paid,
        typical_payment: p.typical_payment,
        frequency: p.frequency,
        missed: p.missed_count,
        bounced: p.bounced_count,
        status: p.status,
        identified_by: p.identified_by,
      }])),
      mca_positions: positions,
      monthly_existing_debt_service: monthlyDebt,
      mca_holdback: holdback,
      dscr_inputs: {
        avg_monthly_true_revenue: avgTrue,
        avg_monthly_revenue_deposits: avgTrue,
        monthly_existing_debt_service: monthlyDebt,
        debt_service_to_revenue: holdback,
      },
      daily_balances: days,
      reconciled: reconciliation.status === 'pass',
      reconciliation_status: reconciliation.status,
      integrity_flags: integrity,
      tamper_flags: tamper,
      statement_layout: layout,
    },
  };

  if (opts.mode === 'preview') {
    const total = body.transactions.length;
    body.transactions = body.transactions.slice(0, 5);
    body.preview_note = `Page 1 only; showing ${body.transactions.length} of ${total} page-1 transactions. Full statement transactions, reconciliation, true revenue, MCA positions and underwriting metrics require the paid call.`;
    delete body.metrics;
    delete body.reconciliation;
    delete body.mca_positions;
    delete body.true_revenue;
    delete body.average_daily_balance;
    delete body.reconciliation_status;
    body.summary = { preview: true, transaction_count_on_page: total, note: body.preview_note };
  }
  return body;
}
