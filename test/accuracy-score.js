/**
 * Field-level accuracy on clean fixtures and messy synthetic PDFs.
 * Run: node test/accuracy-score.js
 */
import { readFileSync } from 'node:fs';
import { extractDocument } from '../src/extract.js';
import { AMOUNT_ONLY, DRCR, HARBOR, RIGHT_ALIGNED, SECTIONED, SPLIT } from './cases.js';
import { buildInvoice } from './pdf-builder.js';
import {
  SPLIT_ROWS,
  buildMessyInvoice,
  buildMonospace,
  buildStackedReceipt,
  buildWideSplit,
  buildWideW9,
  buildYearSpan,
  expectedAdb,
  round2,
} from './messy-fixtures.js';

function balances(opening, rows) {
  let balance = opening;
  return rows.map((row) => {
    balance = round2(balance + row.amount);
    return { ...row, balance };
  });
}

function creditsOf(rows) {
  return round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
}

function debitsOf(rows) {
  return round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
}

function scoreStatement(result, spec) {
  const misses = [];
  let points = 0;
  let total = 0;
  const hit = (ok, label) => {
    total += 1;
    if (ok) points += 1;
    else misses.push(label);
  };
  const rows = balances(spec.opening, spec.rows);
  const credits = creditsOf(rows);
  const debits = debitsOf(rows);
  const ending = round2(spec.opening + credits - debits);
  const trueRevenue = round2(rows.filter((r) => r.trueRevenue && r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const nsf = rows.filter((r) => ['nsf_fee', 'overdraft_fee', 'returned_item_fee'].includes(r.category)).length;
  const summary = result?.summary || {};
  hit(result?.document_type === 'bank_statement', `type ${result?.document_type}`);
  hit(summary.bank_name === spec.bank, `bank ${summary.bank_name}`);
  hit(summary.account_holder === spec.holder, `holder ${summary.account_holder}`);
  hit(summary.account_last4 === spec.account, `last4 ${summary.account_last4}`);
  hit(summary.period_start === spec.start, `start ${summary.period_start}`);
  hit(summary.period_end === spec.end, `end ${summary.period_end}`);
  hit(summary.opening_balance === spec.opening, `opening ${summary.opening_balance}`);
  hit(summary.closing_balance === ending, `ending ${summary.closing_balance} != ${ending}`);
  hit(summary.total_deposits === credits, `deposits ${summary.total_deposits} != ${credits}`);
  hit(summary.total_withdrawals === debits, `withdrawals ${summary.total_withdrawals} != ${debits}`);
  hit(summary.true_revenue === trueRevenue, `true_revenue ${summary.true_revenue} != ${trueRevenue}`);
  hit(summary.nsf_count === nsf, `nsf ${summary.nsf_count}`);
  hit(summary.reconciliation_status === spec.reconciliation, `recon ${summary.reconciliation_status}`);
  const adb = expectedAdb(spec.opening, rows, spec.start, spec.end);
  hit(summary.average_daily_balance === adb, `adb ${summary.average_daily_balance} != ${adb}`);
  const txns = result?.transactions || [];
  const used = new Set();
  for (const row of rows) {
    const idx = txns.findIndex((t, i) => !used.has(i) && t.date === row.date && t.amount === round2(row.amount) && t.description === row.description);
    const got = idx >= 0 ? txns[idx] : null;
    if (idx >= 0) used.add(idx);
    const label = row.description;
    hit(!!got, `missing ${label}`);
    if (spec.layout === 'amount_only') hit(got?.balance == null, `balance ${label} should be empty, got ${got?.balance}`);
    else hit(got?.balance === row.balance, `balance ${label} ${got?.balance} != ${row.balance}`);
    hit(got?.category === row.category, `category ${label} ${got?.category}`);
    hit(got?.true_revenue === Boolean(row.trueRevenue), `true ${label} ${got?.true_revenue}`);
  }
  for (let i = 0; i < txns.length; i += 1) {
    if (!used.has(i)) hit(false, `extra ${txns[i].date} ${txns[i].description} ${txns[i].amount}`);
  }
  return { points, total, misses };
}

function scoreDoc(result, expect) {
  const misses = [];
  let points = 0;
  let total = 0;
  const hit = (ok, label) => {
    total += 1;
    if (ok) points += 1;
    else misses.push(label);
  };
  const value = (key) => result?.fields?.[key]?.value;
  hit(result?.document_type === expect.type, `type ${result?.document_type}`);
  for (const [key, wanted] of Object.entries(expect.fields || {})) {
    hit(value(key) === wanted, `${key} ${JSON.stringify(value(key))} != ${JSON.stringify(wanted)}`);
  }
  if (expect.checks) hit(result?.checks?.status === expect.checks, `checks ${result?.checks?.status}`);
  const items = result?.line_items || [];
  hit(items.length === (expect.lines || []).length, `line count ${items.length}`);
  (expect.lines || []).forEach((line, i) => {
    const got = items[i];
    hit(got?.description === line.description, `line ${i} desc ${got?.description}`);
    hit(got?.quantity === line.quantity, `line ${i} qty ${got?.quantity}`);
    hit(got?.unit_price === line.unit_price, `line ${i} unit ${got?.unit_price}`);
    hit(got?.amount === line.amount, `line ${i} amount ${got?.amount}`);
  });
  return { points, total, misses };
}

const CLEAN = [
  ['harbor', HARBOR, '2026-01-01', '2026-01-31', 'pass'],
  ['split', SPLIT, '2026-02-01', '2026-02-28', 'pass'],
  ['drcr', DRCR, '2026-03-01', '2026-03-31', 'pass'],
  ['sectioned', SECTIONED, '2026-04-01', '2026-04-30', 'pass'],
  ['amount-only', AMOUNT_ONLY, '2026-05-01', '2026-05-31', 'pass'],
  ['right-aligned', RIGHT_ALIGNED, '2026-06-01', '2026-06-30', 'pass'],
];

function pct(points, total) {
  if (!total) return 'n/a';
  return `${((100 * points) / total).toFixed(1)}% (${points}/${total})`;
}

export async function scoreCorpus() {
  const groups = { clean: [], messy: [] };
  for (const [name, spec, start, end, reconciliation] of CLEAN) {
    const { buildStatement } = await import('./pdf-builder.js');
    const buffer = await buildStatement(spec);
    const started = performance.now();
    const result = await extractDocument(buffer, { type: 'bank_statement' });
    const ms = performance.now() - started;
    groups.clean.push({ name, ms, ...scoreStatement(result, { ...spec, start, end, reconciliation }) });
  }

  const messyStatements = [
    ['wide-split', await buildWideSplit(), {
      bank: 'Redwood Community Bank', holder: 'NORTHWIND SUPPLY LLC', account: '4582',
      start: '2026-02-01', end: '2026-02-28', opening: 4000, rows: SPLIT_ROWS, reconciliation: 'pass', layout: 'split',
    }],
    ['monospace', await buildMonospace(), {
      bank: 'Relay National Bank', holder: 'NORTH STAR LLC', account: '3331',
      start: '2026-05-01', end: '2026-05-05', opening: 200, reconciliation: 'pass', layout: 'combined',
      rows: [
        { date: '2026-05-04', description: 'STRIPE TRANSFER', amount: 100, category: 'card_batch_deposit', trueRevenue: true },
        { date: '2026-05-05', description: 'CHECK 9', amount: -40, category: 'check_paid', trueRevenue: false },
      ],
    }],
    ['year-span', await buildYearSpan(), {
      bank: 'Harbor National Bank', holder: 'NORTHWIND SUPPLY LLC', account: '4582',
      start: '2025-12-28', end: '2026-01-15', opening: 1000, reconciliation: 'pass', layout: 'combined',
      rows: [
        { date: '2025-12-29', description: 'CASH DEPOSIT', amount: 300, category: 'cash_deposit', trueRevenue: true },
        { date: '2026-01-05', description: 'CHECK 55', amount: -10, category: 'check_paid', trueRevenue: false },
      ],
    }],
  ];
  for (const [name, buffer, spec] of messyStatements) {
    const started = performance.now();
    const result = await extractDocument(buffer, { type: 'bank_statement' });
    const ms = performance.now() - started;
    groups.messy.push({ name, ms, ...scoreStatement(result, spec) });
  }

  const docs = [
    ['messy-invoice', await buildMessyInvoice(), {
      type: 'invoice',
      checks: 'pass',
      fields: {
        vendor_name: 'Harbor Goods LLC',
        invoice_number: 'INV-88421',
        invoice_date: '2026-03-04',
        due_date: '2026-04-03',
        subtotal: 40,
        tax: 3.04,
        total: 41.04,
      },
      lines: [
        { description: 'Widget assembly', quantity: 2, unit_price: 10, amount: 20 },
        { description: 'Gasket kit', quantity: 1000, unit_price: 0.02, amount: 20 },
      ],
    }],
    ['stacked-receipt', await buildStackedReceipt(), {
      type: 'receipt',
      checks: 'pass',
      fields: {
        merchant_name: 'Northwind Cafe',
        date: '2026-10-02',
        subtotal: 11,
        tax: 0.88,
        total: 11.88,
      },
      lines: [
        { description: 'Latte', quantity: 1, unit_price: 4.5, amount: 4.5 },
        { description: 'Muffin', quantity: 2, unit_price: 3.25, amount: 6.5 },
      ],
    }],
    ['wide-w9', await buildWideW9(), {
      type: 'w9',
      fields: {
        name: 'Avery Sample',
        business_name: 'Sample Goods LLC',
        tax_classification: 's_corporation',
        address: '500 Market Street',
        city_state_zip: 'Tampa, FL 33614',
        ein: '12-3456789',
      },
    }],
    ['clean-invoice', await buildInvoice(), {
      type: 'invoice',
      checks: 'pass',
      fields: {
        vendor_name: 'Northwind Supply',
        invoice_number: 'INV-1001',
        invoice_date: '2026-02-01',
        due_date: '2026-03-03',
        subtotal: 42,
        tax: 3.36,
        total: 45.36,
      },
      lines: [
        { description: 'Widget', quantity: 2, unit_price: 10, amount: 20 },
        { description: 'Gasket', quantity: 4, unit_price: 5.5, amount: 22 },
      ],
    }],
    ['clean-receipt', readFileSync(new URL('./fixtures/receipt.pdf', import.meta.url)), {
      type: 'receipt',
      checks: 'pass',
      fields: { merchant_name: 'Corner Coffee Roasters', date: '2026-10-02', subtotal: 12.75, tax: 1.05, total: 13.8 },
      lines: [
        { description: 'Latte', quantity: 2, unit_price: 4.5, amount: 9 },
        { description: 'Croissant', quantity: 1, unit_price: 3.75, amount: 3.75 },
      ],
    }],
    ['clean-po', readFileSync(new URL('./fixtures/po.pdf', import.meta.url)), {
      type: 'purchase_order',
      checks: 'pass',
      fields: { vendor_name: 'Steel Supply Co', po_number: 'PO-55120', po_date: '2026-09-15', subtotal: 1292.5, tax: 0, total: 1292.5 },
      lines: [
        { description: 'Steel plate 1/4in', quantity: 10, unit_price: 120, amount: 1200 },
        { description: 'Bolts M8 box', quantity: 5, unit_price: 18.5, amount: 92.5 },
      ],
    }],
    ['clean-w9', readFileSync(new URL('./fixtures/w9-flat.pdf', import.meta.url)), {
      type: 'w9',
      fields: {
        name: 'Maria Q Testperson',
        business_name: 'Testperson Plumbing LLC',
        tax_classification: 's_corporation',
        address: '123 Example Ave Suite 4',
        city_state_zip: 'Tampa, FL 33614',
        ein: '12-3456789',
      },
    }],
  ];

  for (const [name, buffer, expect] of docs) {
    const started = performance.now();
    const result = await extractDocument(buffer);
    const ms = performance.now() - started;
    const bucket = name.startsWith('clean-') ? groups.clean : groups.messy;
    bucket.push({ name, ms, ...scoreDoc(result, expect) });
  }
  return groups;
}

function summarize(rows) {
  const points = rows.reduce((s, r) => s + r.points, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const ms = rows.reduce((s, r) => s + r.ms, 0);
  return { points, total, ms };
}

const isMain = process.argv[1] && process.argv[1].endsWith('accuracy-score.js');
if (isMain) {
  const groups = await scoreCorpus();
  for (const [name, rows] of Object.entries(groups)) {
    const sum = summarize(rows);
    console.log(`\n${name}: ${pct(sum.points, sum.total)} in ${sum.ms.toFixed(0)}ms`);
    for (const row of rows) {
      console.log(`  ${row.name}: ${pct(row.points, row.total)} ${row.ms.toFixed(0)}ms`);
      for (const miss of row.misses) console.log(`    - ${miss}`);
    }
  }
  const all = [...groups.clean, ...groups.messy];
  const sum = summarize(all);
  console.log(`\nALL: ${pct(sum.points, sum.total)} in ${sum.ms.toFixed(0)}ms`);
}
