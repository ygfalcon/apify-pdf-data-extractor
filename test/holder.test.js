import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { accountHolder } from '../src/bank/holder.js';
import { extractDocument } from '../src/extract.js';
import { buildStatement } from './pdf-builder.js';

function line(text, page = 1) {
  return { page, text };
}

const SQUARE = '02/02/2026 SQUARE INC DEPOSIT 2,873.36 20,873.65';

test('header name is kept and a later INC transaction is not the holder', () => {
  const holder = accountHolder([
    line('Lakeshore Community Bank'),
    line('Statement Period: 02/01/2026 - 02/28/2026 Account Number: XXXXXX4413'),
    line('GOODWIN-JIMENEZ Page 1'),
    line('Account Summary'),
    line('Beginning Balance 18,000.29'),
    line('Total Deposits and Credits 52,591.42'),
    line('Date Description Amount Balance'),
    line(SQUARE),
  ], 'Lakeshore Community Bank');
  assert.equal(holder, 'GOODWIN-JIMENEZ');
});

test('holder is null when the header has no name', () => {
  const holder = accountHolder([
    line('Lakeshore Community Bank'),
    line('Statement Period: 02/01/2026 - 02/28/2026 Account Number: XXXXXX4413'),
    line('Account Summary'),
    line('Beginning Balance 18,000.29'),
    line('Date Description Amount Balance'),
    line(SQUARE),
  ], 'Lakeshore Community Bank');
  assert.equal(holder, null);
});

test('holder is null when the header has two unlabeled names', () => {
  const holder = accountHolder([
    line('Harbor National Bank'),
    line('JANE DOE'),
    line('JOHN SMITH'),
    line('Date Description Amount Balance'),
    line(SQUARE),
  ], 'Harbor National Bank');
  assert.equal(holder, null);
});

test('an explicit account-holder label wins over another header name', () => {
  const holder = accountHolder([
    line('Harbor National Bank'),
    line('Account Holder: NORTHWIND SUPPLY LLC'),
    line('JANE DOE'),
    line('Date Description Amount Balance'),
  ]);
  assert.equal(holder, 'NORTHWIND SUPPLY LLC');
});

test('a deposit line containing INC is not the account holder', async () => {
  const pdf = await buildStatement({
    bank: 'Lakeshore Community Bank',
    holder: 'GOODWIN-JIMENEZ',
    account: '4413',
    periodLabel: 'February 1, 2026 through February 28, 2026',
    opening: 18000.29,
    rows: [
      { date: '2026-02-02', pdfDate: '02/02/2026', cell: 'SQUARE INC DEPOSIT', description: 'SQUARE INC DEPOSIT', amount: 2873.36, category: 'card_batch_deposit', trueRevenue: true },
    ],
  });
  const result = await extractDocument(pdf, { type: 'bank_statement' });
  assert.equal(result.summary.account_holder, 'GOODWIN-JIMENEZ');
  assert.equal(result.fields.account_holder.value, 'GOODWIN-JIMENEZ');
});

test('sample statement true revenue equals deposits and has no MCA funding credits', async () => {
  const pdf = readFileSync(new URL('./fixtures/bank-statement.pdf', import.meta.url));
  const result = await extractDocument(pdf, { type: 'bank_statement' });
  assert.equal(result.summary.account_holder, 'GOODWIN-JIMENEZ');
  assert.equal(result.summary.account_holder.includes('SQUARE'), false);
  assert.equal(result.summary.true_revenue, 52591.42);
  assert.equal(result.summary.total_deposits, 52591.42);
  assert.equal(result.summary.true_revenue_detail.excluded_loan_proceeds, 0);
  assert.equal(result.summary.true_revenue_detail.excluded_internal_transfers, 0);
  assert.equal(result.summary.true_revenue_detail.excluded_financing_reversals, 0);
  assert.equal(result.mca_positions.length, 2);
  for (const position of result.mca_positions) {
    assert.equal(position.proceeds_amount, null, position.funder);
    assert.ok(position.payment_count > 0, position.funder);
  }
  assert.equal(result.transactions.some((t) => t.category === 'mca_proceeds' || t.category === 'loan_proceeds'), false);
});
