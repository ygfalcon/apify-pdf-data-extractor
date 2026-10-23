import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcile } from '../src/bank/reconcile.js';

const txns = [
  { date: '2026-01-02', description: 'Deposit', amount: 100, balance: 200 },
  { date: '2026-01-03', description: 'Check', amount: -40, balance: 160 },
];

test('summary totals and running balance pass together', () => {
  const result = reconcile({ opening: 100, ending: 160, printedCredits: 100, printedDebits: 40, transactions: txns });
  assert.equal(result.status, 'pass');
  assert.equal(result.summary_totals.status, 'pass');
  assert.equal(result.running_balance.status, 'pass');
});

test('running balance failure does not rewrite a passing summary', () => {
  const broken = [{ ...txns[0], balance: 210 }, txns[1]];
  const result = reconcile({ opening: 100, ending: 160, printedCredits: 100, printedDebits: 40, transactions: broken });
  assert.equal(result.running_balance.status, 'fail');
  assert.equal(result.summary_totals.status, 'pass');
  assert.equal(result.status, 'fail');
  assert.equal(result.running_balance.breaks[0].date, '2026-01-02');
});

test('missing running balances cannot pass', () => {
  const noBalance = txns.map((t) => ({ ...t, balance: null }));
  const result = reconcile({ opening: 100, ending: 160, printedCredits: 100, printedDebits: 40, transactions: noBalance });
  assert.equal(result.summary_totals.status, 'pass');
  assert.equal(result.running_balance.status, 'incomplete');
  assert.equal(result.status, 'incomplete');
});
