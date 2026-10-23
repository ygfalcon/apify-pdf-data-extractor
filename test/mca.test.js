import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRecurringMca, buildMcaPositions } from '../src/bank/mca.js';
import { categorize } from '../src/bank/taxonomy.js';

function txn(date, description, amount) {
  const cat = categorize(description, amount);
  return {
    date,
    description,
    amount,
    page: 1,
    category: cat.category,
    category_group: cat.category_group,
    funder: cat.funder,
  };
}

test('weekday MCA cadence does not treat the weekend as missed', () => {
  const txns = [
    txn('2026-01-08', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-09', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-12', 'FORWARD FINANCING ACH', -189),
  ];
  const [position] = buildMcaPositions(txns);
  assert.equal(position.frequency, 'daily');
  assert.equal(position.missed_count, 0);
  assert.equal(position.status, 'current');
});

test('a skipped weekday is a missed MCA payment and a returned debit is bounced', () => {
  const txns = [
    txn('2026-01-08', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-09', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-12', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-14', 'FORWARD FINANCING ACH', -189),
    txn('2026-01-15', 'RETURNED ACH FORWARD FINANCING', 189),
  ];
  const [position] = buildMcaPositions(txns);
  assert.deepEqual(position.missed_payments.map((m) => m.date), ['2026-01-13']);
  assert.equal(position.bounced_payments[0].linked_payment_date, '2026-01-14');
  assert.equal(position.status, 'missed_and_bounced');
  assert.equal(position.total_paid, 567);
});

test('weekly gap records a missed payment', () => {
  const txns = [
    txn('2026-01-02', 'KAPITUS ACH', -250),
    txn('2026-01-09', 'KAPITUS ACH', -250),
    txn('2026-01-16', 'KAPITUS ACH', -250),
    txn('2026-01-30', 'KAPITUS ACH', -250),
  ];
  const [position] = buildMcaPositions(txns);
  assert.equal(position.frequency, 'weekly');
  assert.equal(position.missed_count, 1);
  assert.equal(position.missed_payments[0].date, '2026-01-23');
});

test('equal recurring debits from an unknown funder become an MCA position', () => {
  const dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
  const txns = dates.map((date) => txn(date, 'ACH DEBIT BLUE RIBBON FUNDING', -125));
  applyRecurringMca(txns);
  assert.equal(txns.every((t) => t.category === 'mca_payment'), true);
  const [position] = buildMcaPositions(txns);
  assert.equal(position.identified_by, 'recurring_pattern');
  assert.equal(position.frequency, 'daily');
  assert.equal(position.missed_count, 0);
  assert.equal(position.typical_payment, 125);
});
