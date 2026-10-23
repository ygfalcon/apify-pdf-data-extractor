import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractDocument } from '../src/extract.js';
import { addDays } from '../src/lib/dates.js';
import { buildStatement, round2, totals, withBalances } from './pdf-builder.js';
import { AMOUNT_ONLY, DRCR, HARBOR, RIGHT_ALIGNED, SECTIONED, SPLIT } from './cases.js';

async function analyze(spec) {
  const pdf = await buildStatement(spec);
  return extractDocument(pdf, { mode: 'full', type: 'bank_statement' });
}

function assertLedger(result, spec) {
  assert.equal(result.document_type, 'bank_statement', JSON.stringify(result.error || result.note));
  const rows = withBalances(spec.opening, spec.rows);
  assert.equal(result.transactions.length, rows.length, JSON.stringify(result.transactions, null, 2));
  rows.forEach((row, i) => {
    const got = result.transactions[i];
    assert.equal(got.date, row.date, row.description);
    assert.equal(got.description, row.description, row.description);
    assert.equal(got.amount, round2(row.amount), row.description);
    if (spec.layout !== 'amount_only') assert.equal(got.balance, row.balance, row.description);
    assert.equal(got.category, row.category, `${row.description} -> ${got.category}`);
    assert.equal(got.true_revenue, Boolean(row.trueRevenue), row.description);
  });
  const { credits, debits } = totals(rows);
  const ending = round2(spec.opening + credits - debits);
  assert.equal(result.summary.opening_balance, spec.opening);
  assert.equal(result.summary.closing_balance, ending);
  assert.equal(result.summary.total_deposits, credits);
  assert.equal(result.summary.total_withdrawals, debits);
  assert.equal(result.fields.bank_name.value, spec.bank);
  assert.equal(result.fields.account_holder.value, spec.holder);
  assert.equal(result.fields.account_last4.value, spec.account);
}

test('combined layout reconciles, excludes non-revenue, and tracks MCA misses and bounces', async () => {
  const result = await analyze(HARBOR);
  assertLedger(result, HARBOR);
  assert.equal(result.reconciliation.status, 'pass');
  assert.equal(result.reconciliation.summary_totals.status, 'pass');
  assert.equal(result.reconciliation.running_balance.status, 'pass');
  assert.equal(result.summary.true_revenue, 1250);
  assert.equal(result.summary.true_revenue_detail.excluded_internal_transfers, 500);
  assert.equal(result.summary.true_revenue_detail.excluded_loan_proceeds, 8000);
  assert.equal(result.summary.true_revenue_detail.excluded_financing_reversals, 189);
  assert.equal(result.summary.nsf_count, 1);
  assert.equal(result.summary.nsf_fees, 35);
  assert.equal(result.pages >= 2, true);

  const forward = result.mca_positions.find((p) => p.funder === 'Forward Financing');
  const ondeck = result.mca_positions.find((p) => p.funder === 'OnDeck');
  assert.ok(forward, JSON.stringify(result.mca_positions, null, 2));
  assert.equal(forward.status, 'missed_and_bounced');
  assert.equal(forward.frequency, 'daily');
  assert.equal(forward.identified_by, 'lender_list');
  assert.deepEqual(forward.missed_payments.map((m) => m.date), ['2026-01-13']);
  assert.equal(forward.bounced_count, 1);
  assert.equal(forward.bounced_payments[0].linked_payment_date, '2026-01-14');
  assert.equal(forward.total_paid, 567);
  assert.equal(ondeck.status, 'proceeds_only');
  assert.equal(ondeck.proceeds_amount, 8000);
  assert.equal(result.summary.monthly_debt_service, 567);
  assert.equal(result.summary.mca_holdback, round2(567 / 1250));

  const byDate = Object.fromEntries(result.metrics.daily_balances.map((d) => [d.date, d.balance]));
  assert.equal(byDate['2026-01-01'], 4000);
  assert.equal(byDate['2026-01-02'], 5250);
  assert.equal(byDate['2026-01-04'], 5250);
  assert.equal(byDate['2026-01-06'], 13750);
  assert.equal(byDate['2026-01-16'], 10662.6);
  assert.equal(byDate['2026-01-31'], 10662.6);
  assert.equal(result.summary.negative_balance_days, 0);
  const mean = round2(result.metrics.daily_balances.reduce((s, d) => s + d.balance, 0) / 31);
  assert.equal(result.summary.average_daily_balance, mean);
  assert.equal(result.metrics.reconciled, true);
  assert.equal(result.summary.tamper_flags.length, 0);
});

test('split debit and credit columns', async () => {
  const result = await analyze(SPLIT);
  assertLedger(result, SPLIT);
  assert.equal(result.reconciliation.status, 'pass');
  assert.equal(result.summary.statement_layout, 'split_debit_credit');
  assert.equal(result.summary.true_revenue, 400);
});

test('DR/CR amount column', async () => {
  const result = await analyze(DRCR);
  assertLedger(result, DRCR);
  assert.equal(result.reconciliation.status, 'pass');
  assert.equal(result.summary.true_revenue, 640);
});

test('sectioned deposits and withdrawals', async () => {
  const result = await analyze(SECTIONED);
  assertLedger(result, SECTIONED);
  assert.equal(result.reconciliation.status, 'pass');
  assert.equal(result.summary.statement_layout, 'sectioned');
  assert.equal(result.summary.true_revenue, 450);
});

test('right-aligned amount and balance columns', async () => {
  const result = await analyze(RIGHT_ALIGNED);
  assertLedger(result, RIGHT_ALIGNED);
  assert.equal(result.reconciliation.status, 'pass');
});

test('amount-only statement passes the summary and leaves running balance incomplete', async () => {
  const result = await analyze(AMOUNT_ONLY);
  assertLedger(result, AMOUNT_ONLY);
  assert.equal(result.reconciliation.summary_totals.status, 'pass');
  assert.equal(result.reconciliation.running_balance.status, 'incomplete');
  assert.equal(result.reconciliation.status, 'incomplete');
  assert.equal(result.summary.true_revenue, 100);
});

test('a broken running balance fails reconciliation', async () => {
  const result = await analyze({ ...HARBOR, corrupt: 'running', pageBreakAfter: 0 });
  assert.equal(result.reconciliation.running_balance.status, 'fail');
  assert.equal(result.reconciliation.summary_totals.status, 'pass');
  assert.equal(result.reconciliation.status, 'fail');
  assert.equal(result.metrics.reconciled, false);
  assert.ok(result.reconciliation.running_balance.breaks.some((b) => b.date === '2026-01-07'));
  assert.ok(result.summary.integrity_flags.some((f) => f.startsWith('running_balance_breaks')));
});

test('a summary ending that does not foot fails reconciliation', async () => {
  const result = await analyze({ ...HARBOR, corrupt: 'ending', pageBreakAfter: 0 });
  assert.equal(result.reconciliation.running_balance.status, 'pass');
  assert.equal(result.reconciliation.summary_totals.status, 'fail');
  assert.equal(result.reconciliation.status, 'fail');
  assert.ok(result.summary.integrity_flags.includes('summary_totals_mismatch'));
  const { credits, debits } = totals(withBalances(HARBOR.opening, HARBOR.rows));
  assert.equal(result.summary.closing_balance, round2(HARBOR.opening + credits - debits + 50));
});

test('preview stays on page 1 and does not return underwriting metrics', async () => {
  const pdf = await buildStatement(HARBOR);
  const result = await extractDocument(pdf, { mode: 'preview' });
  assert.equal(result.document_type, 'bank_statement');
  assert.ok(result.transactions.length <= 5);
  assert.ok(result.transactions.length >= 1);
  assert.equal(result.metrics, undefined);
  assert.equal(result.reconciliation, undefined);
  assert.equal(result.summary.preview, true);
  assert.match(result.preview_note, /Page 1 only/);
});

test('committed sample PDFs match the reconciliation contract', async () => {
  const harbor = await extractDocument(readFileSync(new URL('./fixtures/harbor-combined.pdf', import.meta.url)), { type: 'bank_statement' });
  assert.equal(harbor.reconciliation.status, 'pass');
  assert.equal(harbor.summary.true_revenue, 1250);
  assert.equal(harbor.mca_positions.find((p) => p.funder === 'Forward Financing').status, 'missed_and_bounced');

  const broken = await extractDocument(readFileSync(new URL('./fixtures/harbor-running-balance-break.pdf', import.meta.url)), { type: 'bank_statement' });
  assert.equal(broken.reconciliation.status, 'fail');
  assert.equal(broken.reconciliation.running_balance.status, 'fail');

  const summary = await extractDocument(readFileSync(new URL('./fixtures/harbor-summary-mismatch.pdf', import.meta.url)), { type: 'bank_statement' });
  assert.equal(summary.reconciliation.summary_totals.status, 'fail');

  const scanned = await extractDocument(readFileSync(new URL('./fixtures/scanned.pdf', import.meta.url)));
  assert.equal(scanned.scanned, true);
});

test('period covers every January day used for average balance', async () => {
  const result = await analyze({ ...HARBOR, pageBreakAfter: 0 });
  let cursor = '2026-01-01';
  for (const day of result.metrics.daily_balances) {
    assert.equal(day.date, cursor);
    cursor = addDays(cursor, 1);
  }
  assert.equal(result.metrics.daily_balances.length, 31);
});
