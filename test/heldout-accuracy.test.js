/**
 * Held-out public samples. These files are not the QA pack in test/fixtures/qa.
 * Field labels were read from each PDF's text layer, not copied from parser output.
 *
 * Sources:
 * - Sensible docs samples (v0): southstate checking, Wells Fargo checking/savings,
 *   Ally combined, Bank of America, First Best Bank checking/savings, Anyco invoice
 *   https://github.com/sensible-hq/sensible-docs/tree/v0/assets/pdfs
 * - Synthetic Globex statement: fashionmascherine-svg/document-to-json-mcp examples/sample-bank-statement.pdf
 * - Sliced Invoices demo: https://slicedinvoices.com/pdf/wordpress-pdf-invoice-plugin-sample.pdf
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isBillable } from '../src/charge.js';
import { extractDocument } from '../src/extract.js';

const dir = new URL('./fixtures/heldout/', import.meta.url);

function norm(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function moneyClose(got, expected) {
  if (got == null || expected == null) return got == null && expected == null;
  return Math.abs(Number(got) - Number(expected)) < 0.015;
}

function same(got, expected, cmp) {
  if (cmp === 'money') return moneyClose(got, expected);
  if (cmp === 'contains') return norm(got).includes(norm(expected));
  return got === expected;
}

const bank = (file, fields) => ({ file, type: 'bank_statement', fields });
const invoice = (file, fields) => ({ file, type: 'invoice', fields });

const CASES = [
  bank('globex-eur-statement.pdf', {
    holder: ['Globex', 'contains'],
    bank: ['Example Bank', 'contains'],
    open: [5000, 'money'],
    close: [8655.28, 'money'],
    dep: [5389.78, 'money'],
    wd: [1734.5, 'money'],
    n: [7],
    start: ['2026-05-01'],
    end: ['2026-05-31'],
    last4: ['3456'],
  }),
  bank('wells-savings.pdf', {
    holder: ['CHRISTIANO GAJORONDO', 'contains'],
    bank: ['Wells Fargo', 'contains'],
    open: [15078.81, 'money'],
    close: [15601.94, 'money'],
    dep: [1523.13, 'money'],
    wd: [1000, 'money'],
    start: ['2022-01-01'],
    end: ['2022-01-31'],
  }),
  bank('wells-checking.pdf', {
    holder: ['DOMINIC BOGDAN', 'contains'],
    bank: ['Wells Fargo', 'contains'],
    open: [3082.8, 'money'],
    close: [688.82, 'money'],
    dep: [24163.03, 'money'],
    wd: [26557.01, 'money'],
  }),
  bank('southstate-checking.pdf', {
    holder: ['JOHN SMITH', 'contains'],
    bank: ['SouthState', 'contains'],
    open: [159.63, 'money'],
    close: [23346.82, 'money'],
    dep: [354396.39, 'money'],
    wd: [331209.2, 'money'],
    start: ['2023-06-01'],
    end: ['2023-06-30'],
  }),
  bank('boa-sample.pdf', {
    bank: ['Bank of America', 'contains'],
    open: [2825.37, 'money'],
    close: [2736.04, 'money'],
    dep: [7667.5, 'money'],
    wd: [7755.02, 'money'],
    start: ['2021-06-10'],
    end: ['2021-07-09'],
  }),
  bank('ally-combined.pdf', {
    holder: ['DOMINIC BOGDON', 'contains'],
    open: [5823.37, 'money'],
    close: [6826.05, 'money'],
    dep: [1000, 'money'],
    wd: [0, 'money'],
  }),
  bank('sensible-bank-2.pdf', {
    holder: ['Janelle Jones', 'contains'],
    bank: ['First Best Bank', 'contains'],
    start: ['2023-03-01'],
    end: ['2023-03-31'],
  }),
  bank('sensible-bank-3.pdf', {
    holder: ['Lucricia Lopez', 'contains'],
    bank: ['First Best Bank', 'contains'],
    start: ['2023-01-01'],
    end: ['2023-01-31'],
  }),
  invoice('sliced-invoice.pdf', {
    vendor: ['DEMO - Sliced Invoices', 'contains'],
    buyer: ['Test Business', 'contains'],
    number: ['INV-3337'],
    date: ['2016-01-25'],
    due: ['2016-01-31'],
    subtotal: [85, 'money'],
    tax: [8.5, 'money'],
    total: [93.5, 'money'],
  }),
  invoice('sensible-invoice.pdf', {
    vendor: ['Anyco', 'contains'],
    buyer: ['Cash sales', 'contains'],
    number: ['19288685'],
    date: ['2021-06-21'],
    total: [7061.48, 'money'],
    lines: [3],
    qty: [1],
  }),
];

function pick(result, spec, key) {
  if (spec.type === 'bank_statement') {
    const summary = result.summary || {};
    return {
      holder: summary.account_holder,
      bank: summary.bank_name,
      open: summary.opening_balance,
      close: summary.closing_balance,
      dep: summary.total_deposits,
      wd: summary.total_withdrawals,
      n: summary.transaction_count,
      start: summary.period_start,
      end: summary.period_end,
      last4: summary.account_last4,
    }[key];
  }
  const value = (name) => result.fields?.[name]?.value ?? null;
  if (key === 'vendor') return value('vendor_name');
  if (key === 'buyer') return value('buyer_name');
  if (key === 'number') return value('invoice_number');
  if (key === 'date') return value('invoice_date');
  if (key === 'due') return value('due_date');
  if (key === 'subtotal') return value('subtotal');
  if (key === 'tax') return value('tax');
  if (key === 'total') return value('total');
  if (key === 'lines') return result.line_items?.length ?? 0;
  if (key === 'qty') return result.line_items?.[0]?.quantity ?? null;
  return undefined;
}

test('held-out public statements and invoices keep field accuracy and are not billed when they do not foot', async () => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.pdf'));
  assert.ok(files.length >= 10, `expected at least 10 held-out PDFs, found ${files.length}`);
  assert.equal(files.length, CASES.length);

  const rows = [];
  let legacyOverbills = 0;
  let billedClean = 0;
  for (const spec of CASES) {
    const result = await extractDocument(readFileSync(new URL(spec.file, dir)));
    rows.push({ id: `${spec.file}.type`, ok: result.document_type === spec.type, got: result.document_type, expected: spec.type });
    for (const [key, [expected, cmp = 'eq']] of Object.entries(spec.fields)) {
      const got = pick(result, spec, key);
      rows.push({ id: `${spec.file}.${key}`, ok: same(got, expected, cmp), got, expected });
    }
    if (result.document_type !== 'bank_statement') continue;
    const status = result.reconciliation_status || result.reconciliation?.status || 'incomplete';
    const legacy = Boolean(result && !result.scanned && !result.error && !result.vision_error && !result.vision_unavailable);
    if (status !== 'pass' && legacy) legacyOverbills += 1;
    if (status !== 'pass') assert.equal(isBillable(result), false, `${spec.file} recon ${status} must not be billed at $0.24`);
    else {
      assert.equal(isBillable(result), true, `${spec.file} foots and should stay billable`);
      billedClean += 1;
    }
  }

  const hit = rows.filter((row) => row.ok).length;
  const pct = ((hit / rows.length) * 100).toFixed(1);
  const misses = rows.filter((row) => !row.ok).map((row) => `${row.id}: got ${JSON.stringify(row.got)} expected ${JSON.stringify(row.expected)}`);
  console.log(`Held-out field accuracy ${pct}% (${hit}/${rows.length}). Billing fix does not retune extraction, so this is the before-and-after field score.`);
  console.log(`Legacy $0.24 charges on unreconciled held-out statements: ${legacyOverbills}. After this change those are not billable. Clean billable statements: ${billedClean}.`);
  if (misses.length) console.log(misses.join('\n'));
  assert.ok(legacyOverbills > 0, 'held-out set should include statements the old rule would have charged');
  assert.ok(billedClean > 0, 'a statement that foots should still be billable');
  assert.equal(hit, 46, `held-out field accuracy drifted from 46/${rows.length} (${pct}%)\n${misses.join('\n')}`);
});
