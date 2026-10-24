import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isBillable } from '../src/charge.js';
import { extractDocument } from '../src/extract.js';
import { parseDate } from '../src/lib/dates.js';
import { findMoney, parseMoneyToken } from '../src/lib/money.js';

const qa = new URL('./fixtures/qa/', import.meta.url);
const load = (name) => readFileSync(new URL(name, qa));
const gt = JSON.parse(readFileSync(new URL('gt.json', qa), 'utf8'));

function val(result, key) {
  return result?.fields?.[key]?.value ?? null;
}

function moneyClose(got, expected) {
  if (got == null || expected == null) return got == null && expected == null;
  return Math.abs(Number(got) - Number(expected)) < 0.015;
}

function normNum(value) {
  return String(value ?? '').replace(/[#\s]/g, '').toUpperCase();
}

function nameMatch(got, expected) {
  const a = String(got ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const b = String(expected ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

function same(got, expected, cmp) {
  if (cmp === 'money') return moneyClose(got, expected);
  if (cmp === 'num') return normNum(got) === normNum(expected);
  if (cmp === 'name') return nameMatch(got, expected);
  if (cmp === 'bool') return Boolean(got) === Boolean(expected);
  return got === expected;
}

/**
 * gt.json nsf counts the letters "NSF" inside "TRANSFER" (Python `'NSF' in desc`).
 * The fee-row count is the real NSF / returned-item total.
 */
const NSF_FEES = { 'chase.pdf': 2, 'wells.pdf': 4, 'bofa.pdf': 4 };
const PERIODS = {
  'chase.pdf': ['2026-03-01', '2026-03-31'],
  'wells.pdf': ['2026-04-01', '2026-04-30'],
  'bofa.pdf': ['2026-05-01', '2026-05-31'],
};

test('date and money tokens from the QA pack parse', () => {
  assert.equal(parseDate('August 3 , 2014'), '2014-08-03');
  assert.equal(parseDate('Oct 2, 2026'), '2026-10-02');
  assert.equal(parseDate('31/12/2017'), '2017-12-31');
  assert.equal(parseDate('10/18/26'), '2026-10-18');
  assert.equal(parseDate('7. Mai 2014'), '2014-05-07');
  assert.equal(parseDate('19 april 2014'), '2014-04-19');
  assert.equal(parseDate('02 Juillet 2015'), '2015-07-02');
  assert.equal(parseDate('8-9-2022', null, 'dmy'), '2022-09-08');
  assert.equal(parseDate('03/20/2023'), '2023-03-20');

  assert.equal(parseMoneyToken('$- 20,980.27').value, -20980.27);
  assert.equal(parseMoneyToken('46,68 €').value, 46.68);
  assert.equal(parseMoneyToken('€ 2.321,00').value, 2321);
  assert.equal(parseMoneyToken('Rs 1939').value, 1939);
  assert.equal(parseMoneyToken('$12,450.18').value, 12450.18);
  assert.equal(parseMoneyToken('-15,766.50').value, -15766.5);
  const wells = findMoney('Withdrawals/Debits $- 20,980.27');
  assert.equal(wells.length, 1);
  assert.equal(wells[0].value, -20980.27);
  const due = findMoney('TOTAL DUE 1,224.45');
  assert.equal(due.at(-1).value, 1224.45);
  const bal = findMoney('**** BALANCE 17.64');
  assert.equal(bal.at(-1).value, 17.64);
  const grand = findMoney('Grand Total Rs 1939');
  assert.equal(grand.at(-1).value, 1939);
});

test('QA statements and invoices match ground truth', async () => {
  const rows = [];
  const expectField = (id, got, expected, cmp = 'eq') => {
    rows.push({ id, ok: same(got, expected, cmp), got, expected });
  };

  const chase = await extractDocument(load('chase.pdf'), { type: 'bank_statement' });
  const wells = await extractDocument(load('wells.pdf'), { type: 'bank_statement' });
  const bofa = await extractDocument(load('bofa.pdf'), { type: 'bank_statement' });
  const banks = { 'chase.pdf': chase, 'wells.pdf': wells, 'bofa.pdf': bofa };

  for (const [file, result] of Object.entries(banks)) {
    const spec = gt[file];
    const [start, end] = PERIODS[file];
    expectField(`${file}.opening`, result.summary?.opening_balance, spec.open, 'money');
    expectField(`${file}.closing`, result.summary?.closing_balance, spec.close, 'money');
    expectField(`${file}.deposits`, result.summary?.total_deposits, spec.dep, 'money');
    expectField(`${file}.withdrawals`, result.summary?.total_withdrawals, spec.wd, 'money');
    expectField(`${file}.count`, result.summary?.transaction_count, spec.n);
    expectField(`${file}.holder`, result.summary?.account_holder, spec.holder);
    expectField(`${file}.last4`, result.summary?.account_last4, spec.last4);
    expectField(`${file}.nsf`, result.summary?.nsf_count, NSF_FEES[file]);
    expectField(`${file}.period_start`, result.summary?.period_start, start);
    expectField(`${file}.period_end`, result.summary?.period_end, end);
    expectField(`${file}.reconciliation`, result.reconciliation?.status, 'pass');
    expectField(`${file}.billable`, isBillable(result), true, 'bool');
  }

  const fora = (chase.transactions || []).filter((t) => /fora financial/i.test(t.description));
  expectField('chase.fora_rows', fora.length >= 1, true, 'bool');
  expectField('chase.fora_payments', fora.length > 0 && fora.every((t) => t.amount < 0 && t.category === 'mca_payment'), true, 'bool');
  expectField('chase.no_banner', !(chase.transactions || []).some((t) => /through march|account number|electronic withdrawals/i.test(t.description)), true, 'bool');
  expectField('chase.withdrawals_negative', (chase.transactions || []).filter((t) => /payroll|home depot|comcast|fora|kapitus|amex|check \d|\bnsf\b/i.test(t.description)).every((t) => t.amount < 0), true, 'bool');
  expectField('wells.no_header_txn', !(wells.transactions || []).some((t) => /page 1 of|credits debits balance/i.test(t.description)), true, 'bool');
  expectField('bofa.holder_has_no_pipe', !String(bofa.summary?.account_holder || '').includes('|'), true, 'bool');

  const receipt = await extractDocument(load('receipt.pdf'));
  const messy = await extractDocument(load('invoice_messy.pdf'));
  expectField('receipt.type', receipt.document_type, 'receipt');
  expectField('receipt.vendor', val(receipt, 'vendor_name') || val(receipt, 'merchant_name'), gt['receipt.pdf'].vendor, 'name');
  expectField('receipt.date', val(receipt, 'date'), gt['receipt.pdf'].date);
  expectField('receipt.subtotal', val(receipt, 'subtotal'), gt['receipt.pdf'].subtotal, 'money');
  expectField('receipt.tax', val(receipt, 'tax'), gt['receipt.pdf'].tax, 'money');
  expectField('receipt.total', val(receipt, 'total'), gt['receipt.pdf'].total, 'money');
  expectField('receipt.items', receipt.line_items?.length, gt['receipt.pdf'].items);
  const receiptNames = (receipt.line_items || []).map((it) => it.description).join(' | ');
  for (const word of ['BANANAS', 'AVOCADO', 'MILK', 'BREAD']) {
    expectField(`receipt.has_${word}`, receiptNames.toUpperCase().includes(word), true, 'bool');
  }

  expectField('messy.vendor', val(messy, 'vendor_name'), gt['invoice_messy.pdf'].vendor, 'name');
  expectField('messy.number', val(messy, 'invoice_number'), gt['invoice_messy.pdf'].number, 'num');
  expectField('messy.date', val(messy, 'invoice_date'), gt['invoice_messy.pdf'].date);
  expectField('messy.due', val(messy, 'due_date'), gt['invoice_messy.pdf'].due);
  expectField('messy.subtotal', val(messy, 'subtotal'), gt['invoice_messy.pdf'].subtotal, 'money');
  expectField('messy.tax', val(messy, 'tax'), gt['invoice_messy.pdf'].tax, 'money');
  expectField('messy.total', val(messy, 'total'), gt['invoice_messy.pdf'].total, 'money');
  expectField('messy.items', messy.line_items?.length, gt['invoice_messy.pdf'].items);
  expectField('messy.sealant', (messy.line_items || []).some((it) => /thread sealant/i.test(it.description)), true, 'bool');
  expectField('messy.math', messy.checks?.status, 'pass');
  expectField('messy.not_customer', !/riverbend/i.test(val(messy, 'vendor_name') || ''), true, 'bool');

  const docs = [
    ['AmazonWebServices.pdf', {
      vendor: 'Amazon Web Services', number: '42183017', date: '2014-08-03',
      subtotal: 4.11, tax: 0, total: 4.11, currency: 'USD',
      lines: [/data transfer/i, /elastic compute/i, /glacier/i, /simple storage/i],
    }],
    ['AzureInterior.pdf', {
      vendor: 'Azure Interior', number: 'INV/2023/03/0008', date: '2023-03-20', due: '2023-04-04',
      subtotal: 262.9, tax: 16.94, total: 279.84, currency: 'USD',
      lines: [/beeswax/i, /office chair/i, /olive oil/i, /truffles/i],
      notVendor: /global wholesaler|mitchell|yourcompany/i,
    }],
    ['FlipkartInvoice.pdf', {
      vendor: 'Flipkart', number: '#BLR_WFLD20151000982590', date: '2015-10-20',
      total: 319, currency: 'INR',
      notVendor: /retail invoice|anushrut/i,
    }],
    ['NetpresseInvoice.pdf', {
      vendor: 'NETPRESSE', number: '2022089083', date: '2022-11-28',
      subtotal: 46.68, total: 56.02, currency: 'EUR',
      notVendor: /alexinux|de lattre/i,
    }],
    ['QualityHosting.pdf', {
      vendor: 'QualityHosting AG', number: '30064443', date: '2014-05-07',
      subtotal: 34.73, total: 34.73, currency: 'EUR', lineCount: 7,
      lines: [/strukan/i, /standardExchange/i],
    }],
    ['SammyMaystoneLinesTest.pdf', {
      vendor: 'Sammy Maystone', number: 'invoice_number_1', date: '2022-01-01', due: '2022-01-31',
      subtotal: 127.5, tax: 0, total: 127.5, currency: 'USD', lineCount: 2,
      notVendor: /taylor/i,
    }],
    ['coolblue1.pdf', {
      vendor: 'Coolblue B.V.', number: '993548900', date: '2014-04-19',
      subtotal: 593.36, tax: 124.61, total: 717.97, currency: 'EUR',
      lines: [/ipad air/i, /nintendo 3ds/i],
    }],
    ['coolblue2.pdf', {
      vendor: 'Coolblue B.V.', number: '992288600', date: '2014-03-29',
      subtotal: 4053.67, total: 4904.94, currency: 'EUR',
      lines: [/macbook/i, /ghost pro/i],
    }],
    ['free_fiber.pdf', {
      vendor: 'Free', number: '562044387', date: '2015-07-02', due: '2015-07-05',
      subtotal: 24.99, total: 29.99, currency: 'EUR',
      notVendor: /de lattre|abonné/i,
    }],
    ['oyo.pdf', {
      vendor: 'OYO', number: 'IBZY2087', date: '2017-12-31',
      total: 1939, currency: 'INR',
      notVendor: /payment receipt|sanjay/i,
    }],
    ['saeco.pdf', {
      number: 'VF1005193039', date: '2022-09-08', due: '2022-09-22',
      subtotal: 41.31, tax: 8.68, total: 49.99, currency: 'EUR', lineCount: 2,
      lines: [/onderhoudsset/i, /flyer/i],
      notVendor: /factuuradres|strategic/i,
      vendorOptional: true,
    }],
  ];

  for (const [file, spec] of docs) {
    const result = await extractDocument(load(file));
    const id = file.replace(/\.pdf$/, '');
    expectField(`${id}.type`, result.document_type, 'invoice');
    if (spec.vendor) expectField(`${id}.vendor`, val(result, 'vendor_name'), spec.vendor, 'name');
    if (spec.notVendor) {
      expectField(`${id}.vendor_not_label`, !spec.notVendor.test(val(result, 'vendor_name') || ''), true, 'bool');
    }
    if (spec.number) expectField(`${id}.number`, val(result, 'invoice_number'), spec.number, 'num');
    if (spec.date) expectField(`${id}.date`, val(result, 'invoice_date'), spec.date);
    if (spec.due) expectField(`${id}.due`, val(result, 'due_date'), spec.due);
    if (spec.subtotal != null) expectField(`${id}.subtotal`, val(result, 'subtotal'), spec.subtotal, 'money');
    if (spec.tax != null) expectField(`${id}.tax`, val(result, 'tax'), spec.tax, 'money');
    if (spec.total != null) expectField(`${id}.total`, val(result, 'total'), spec.total, 'money');
    if (spec.currency) expectField(`${id}.currency`, val(result, 'currency'), spec.currency);
    if (spec.lineCount != null) expectField(`${id}.line_count`, result.line_items?.length, spec.lineCount);
    const blob = (result.line_items || []).map((it) => it.description).join('\n');
    for (const re of spec.lines || []) {
      expectField(`${id}.line_${re}`, re.test(blob), true, 'bool');
    }
    expectField(`${id}.billable`, isBillable(result), true, 'bool');
  }

  const sammy = await extractDocument(load('SammyMaystoneLinesTest.pdf'));
  const sammyAmounts = (sammy.line_items || []).map((it) => it.amount).sort((a, b) => a - b);
  expectField('sammy.amounts', JSON.stringify(sammyAmounts), JSON.stringify([7.5, 120]));
  const kit = (messy.line_items || []).find((it) => /flex lines/i.test(it.description));
  expectField('messy.kit_qty', kit?.quantity, 2);
  expectField('messy.kit_amount', kit?.amount, 77, 'money');

  const scanned = await extractDocument(load('impact.pdf'));
  expectField('impact.not_billable', isBillable(scanned), false, 'bool');
  expectField('impact.not_charged', scanned.charged === false || scanned.scanned === true, true, 'bool');

  const hit = rows.filter((r) => r.ok).length;
  const pct = ((hit / rows.length) * 100).toFixed(1);
  const misses = rows.filter((r) => !r.ok).map((r) => `${r.id}: got ${JSON.stringify(r.got)} expected ${JSON.stringify(r.expected)}`);
  console.log(`QA field accuracy ${pct}% (${hit}/${rows.length})`);
  if (misses.length) console.log(misses.join('\n'));
  assert.equal(misses.length, 0, `QA field accuracy ${pct}% (${hit}/${rows.length})\n${misses.join('\n')}`);
});
