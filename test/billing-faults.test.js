import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleDocument } from '../src/billing.js';
import { isBillable } from '../src/charge.js';
import { reconcile } from '../src/bank/reconcile.js';

const cleanStatement = {
  document_type: 'bank_statement',
  reconciliation_status: 'pass',
  reconciliation: {
    status: 'pass',
    summary_totals: {
      checks: [{ name: 'opening_plus_transactions_equals_ending', status: 'pass' }],
    },
  },
  transactions: [{ date: '2026-05-03', description: 'DEPOSIT', amount: 25 }],
  summary: { opening_balance: 100, closing_balance: 125, transaction_count: 1 },
};

test('opening + credits - debits must foot to closing before a statement can pass', () => {
  const unmatched = reconcile({
    opening: null,
    ending: null,
    printedCredits: 100,
    printedDebits: 40,
    transactions: [
      { date: '2026-01-02', description: 'Deposit', amount: 100, balance: null },
      { date: '2026-01-03', description: 'Check', amount: -40, balance: null },
    ],
  });
  assert.equal(unmatched.status, 'incomplete');
  assert.equal(unmatched.summary_totals.checks.some((c) => c.name === 'opening_plus_transactions_equals_ending' && c.status === 'pass'), false);

  const broken = reconcile({
    opening: 1000,
    ending: 500,
    printedCredits: 100,
    printedDebits: 40,
    transactions: [
      { date: '2026-01-02', description: 'Deposit', amount: 100, balance: 1100 },
      { date: '2026-01-03', description: 'Check', amount: -40, balance: 1060 },
    ],
  });
  assert.equal(broken.status, 'fail');
  const equation = broken.summary_totals.checks.find((c) => c.name === 'opening_plus_transactions_equals_ending');
  assert.equal(equation.status, 'fail');
  assert.equal(equation.expected, 500);
  assert.notEqual(equation.actual, 500);
});

test('failed, empty, and unreconciled parses are not billable', () => {
  assert.equal(isBillable({
    document_type: 'bank_statement',
    reconciliation_status: 'fail',
    reconciliation: { status: 'fail' },
    transactions: [{ amount: 10 }],
    summary: { opening_balance: 100, closing_balance: 50 },
  }), false);
  assert.equal(isBillable({
    document_type: 'bank_statement',
    reconciliation_status: 'incomplete',
    transactions: [],
    summary: {},
  }), false);
  assert.equal(isBillable({
    document_type: 'invoice',
    fields: { vendor_name: null, total: null },
    line_items: [],
  }), false);
  assert.equal(isBillable({
    document_type: 'invoice',
    fields: { total: { value: 93.5 } },
    line_items: [{ amount: 93.5 }],
  }), true);
  assert.equal(isBillable(cleanStatement), true);
});

test('a dataset write failure does not charge the $0.24 statement event', async () => {
  let charges = 0;
  await assert.rejects(() => settleDocument({
    result: cleanStatement,
    sourceUrl: 'https://example.com/statement.pdf',
    mode: 'bank_statement',
    pushData: async () => { throw new Error('dataset unavailable'); },
    charge: async () => { charges += 1; return { chargedCount: 1 }; },
  }), /dataset unavailable/);
  assert.equal(charges, 0);
});

test('a statement that does not foot is stored flagged and is not charged', async () => {
  const stored = [];
  let charges = 0;
  const outcome = await settleDocument({
    result: {
      document_type: 'bank_statement',
      reconciliation_status: 'fail',
      reconciliation: { status: 'fail' },
      transactions: [{ amount: 10, description: 'DEPOSIT' }],
      summary: { opening_balance: 100, closing_balance: 50, total_deposits: 10, total_withdrawals: 0 },
    },
    sourceUrl: 'https://example.com/mismatch.pdf',
    mode: 'bank_statement',
    pushData: async (item) => stored.push(item),
    charge: async () => { charges += 1; return { chargedCount: 1 }; },
  });
  assert.equal(charges, 0);
  assert.equal(outcome.chargedCount, 0);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].charged, false);
  assert.equal(stored[0].reconciliation_status, 'fail');
  assert.equal(stored[0].summary.closing_balance, 50);
});

test('an empty bank parse is not charged', async () => {
  let charges = 0;
  const stored = [];
  await settleDocument({
    result: {
      document_type: 'bank_statement',
      error: 'No bank statement transactions or balances found in the text layer. Not charged.',
      transactions: [],
    },
    sourceUrl: 'https://example.com/empty.pdf',
    mode: 'bank_statement',
    pushData: async (item) => stored.push(item),
    charge: async () => { charges += 1; return { chargedCount: 1 }; },
  });
  assert.equal(charges, 0);
  assert.equal(stored[0].charged, false);
});

test('dataset rows and errors do not leak API keys or tokens', async () => {
  const previous = {
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    APIFY_TOKEN: process.env.APIFY_TOKEN,
  };
  process.env.AI_GATEWAY_API_KEY = 'gw_live_secret_key_0123456789';
  process.env.APIFY_TOKEN = 'apify_api_secret_token_0123456789';
  const leaked = 'Gateway rejected key gw_live_secret_key_0123456789 bearer apify_api_secret_token_0123456789';
  try {
    const stored = [];
    await settleDocument({
      result: {
        scanned: true,
        error: leaked,
        vision_error: leaked,
        vision_unavailable: true,
        note: leaked,
        charged: false,
      },
      sourceUrl: `https://files.example/doc.pdf?token=${process.env.APIFY_TOKEN}`,
      mode: 'extract',
      pushData: async (item) => stored.push(item),
      charge: async () => { throw new Error(`charge failed ${process.env.AI_GATEWAY_API_KEY}`); },
    });
    const blob = JSON.stringify(stored);
    assert.equal(blob.includes('gw_live_secret_key_0123456789'), false);
    assert.equal(blob.includes('apify_api_secret_token_0123456789'), false);
    assert.match(blob, /redacted/i);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('preview is stored and not charged', async () => {
  const stored = [];
  let charges = 0;
  await settleDocument({
    result: {
      document_type: 'bank_statement',
      mode: 'preview',
      summary: { preview: true },
      transactions: [{ amount: 10, description: 'DEPOSIT' }],
    },
    sourceUrl: 'https://example.com/preview.pdf',
    mode: 'preview',
    pushData: async (item) => stored.push(item),
    charge: async () => { charges += 1; return { chargedCount: 1 }; },
  });
  assert.equal(charges, 0);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].charged, false);
  assert.equal(stored[0].summary.preview, true);
});
