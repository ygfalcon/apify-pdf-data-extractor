import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAXONOMY, categorize, trueRevenueTreatment } from '../src/bank/taxonomy.js';

test('taxonomy has the 102 advertised categories', () => {
  assert.equal(TAXONOMY.length, 102);
  const ids = TAXONOMY.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of TAXONOMY) assert.match(row.id, /^[a-z0-9_]+$/);
});

test('categorize only returns known categories', () => {
  const known = new Set(TAXONOMY.map((t) => t.id));
  const samples = [
    ['STRIPE TRANSFER', 100],
    ['ADP PAYROLL', -100],
    ['NSF FEE', -35],
    ['OVERDRAFT FEE', -35],
    ['TRANSFER FROM SAVINGS', 50],
    ['ONLINE TRANSFER TO CHECKING', -50],
    ['WIRE IN ONDECK CAPITAL FUNDING', 8000],
    ['FORWARD FINANCING ACH', -189],
    ['RETURNED ACH FORWARD FINANCING', 189],
    ['CHECK 1042', -20],
    ['RENT PAYMENT', -900],
    ['IRS USATAXPYMT', -400],
    ['MYSTERY VENDOR', -12],
    ['OWNER CONTRIBUTION', 1000],
  ];
  for (const [description, amount] of samples) {
    const got = categorize(description, amount);
    assert.ok(known.has(got.category), `${description} -> ${got.category}`);
  }
  assert.equal(categorize('STRIPE TRANSFER', 100).category, 'card_batch_deposit');
  assert.equal(categorize('NSF FEE', -35).category, 'nsf_fee');
  assert.equal(categorize('MONTHLY SERVICE FEE', -12).category, 'monthly_maintenance_fee');
  assert.equal(categorize('FORWARD FINANCING ACH', -189).category, 'mca_payment');
  assert.equal(categorize('WIRE IN ONDECK CAPITAL FUNDING', 8000).category, 'mca_proceeds');
  assert.equal(trueRevenueTreatment('card_batch_deposit', 100).counts, true);
  assert.equal(trueRevenueTreatment('internal_transfer_in', 100).counts, false);
  assert.equal(trueRevenueTreatment('mca_proceeds', 100).bucket, 'loan_proceeds');
  assert.equal(trueRevenueTreatment('mca_payment', -100).counts, false);
});
