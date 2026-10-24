import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { analyzeStatement } from '../src/bank/analyze.js';
import { isBillable } from '../src/charge.js';
import { extractDocument } from '../src/extract.js';
import { businessSteps, eachDate, missedBusinessDays } from '../src/lib/dates.js';
import { readTextLayer } from '../src/lib/text-layer.js';
import { buildInvoice, buildStatement } from './pdf-builder.js';

test('bad input is rejected before a parse and is not charged', async () => {
  for (const input of [null, Buffer.alloc(0), Buffer.from('not a pdf'), Buffer.from('<html>invoice</html>')]) {
    const result = await extractDocument(input);
    assert.equal(result.error, 'Not a PDF file');
    assert.equal(result.charged, false);
    assert.equal(isBillable(result), false);
  }
  const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
  oversized.write('%PDF-');
  const huge = await extractDocument(oversized);
  assert.equal(huge.error, 'File larger than 16 MB');
  assert.equal(huge.charged, false);
});

test('a truncated PDF fails closed and is not charged', async () => {
  const result = await extractDocument(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'));
  assert.equal(result.charged, false);
  assert.equal(isBillable(result), false);
  assert.match(result.error, /PDF|parse|Invalid|format/i);
});

test('a parse that exceeds the deadline is abandoned and the next file still extracts', async () => {
  const previous = process.env.PDF_PARSE_TIMEOUT_MS;
  process.env.PDF_PARSE_TIMEOUT_MS = '1';
  try {
    const stalled = await extractDocument(await buildInvoice(), { type: 'invoice' });
    assert.equal(stalled.charged, false);
    assert.match(stalled.error, /timed out|PDF parse failed/);
  } finally {
    if (previous == null) delete process.env.PDF_PARSE_TIMEOUT_MS;
    else process.env.PDF_PARSE_TIMEOUT_MS = previous;
  }
  const again = await extractDocument(await buildInvoice(), { type: 'invoice' });
  assert.equal(again.fields.invoice_number.value, 'INV-1001');
  assert.equal(again.checks.status, 'pass');
  assert.equal(isBillable(again), true);
});

test('a century-long statement period does not walk every day', async () => {
  const started = performance.now();
  assert.deepEqual(eachDate('1000-01-01', '9000-01-01'), []);
  assert.deepEqual(missedBusinessDays('1000-01-01', '9000-01-01'), []);
  assert.ok(businessSteps('1000-01-01', '9000-01-01') > 400);
  assert.ok(performance.now() - started < 50);

  const pdf = await buildStatement({
    bank: 'Harbor National Bank',
    holder: 'NORTHWIND SUPPLY LLC',
    account: '4582',
    periodLabel: 'January 1, 1000 through January 1, 9000',
    opening: 1000,
    layout: 'combined',
    rows: [
      { date: '1000-01-02', pdfDate: '01/02', description: 'CASH DEPOSIT', amount: 25, category: 'cash_deposit', trueRevenue: true },
    ],
  });
  const parsedAt = performance.now();
  const result = await extractDocument(pdf, { type: 'bank_statement' });
  assert.ok(performance.now() - parsedAt < 1000, `span extract took ${performance.now() - parsedAt}ms`);
  assert.equal(result.summary.period_start, '1000-01-01');
  assert.equal(result.summary.period_end, '9000-01-01');
  assert.equal(result.summary.average_daily_balance, null);
  assert.equal(result.metrics.daily_balances.length, 0);
  assert.ok(Object.keys(result.metrics.monthly).length < 5);
  assert.equal(isBillable(result), true);
});

test('a page with more text items than the cap is refused', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 2000]);
  for (let i = 0; i < 8001; i += 1) {
    page.drawText('A', { x: (i % 100) * 5, y: 1980 - Math.floor(i / 100) * 8, size: 4, font });
  }
  const pdf = Buffer.from(await doc.save());
  await assert.rejects(readTextLayer(pdf), /too dense/);
  const result = await extractDocument(pdf);
  assert.equal(result.charged, false);
  assert.match(result.error, /too dense/);
  assert.equal(isBillable(result), false);
});

test('analyzeStatement stays bounded when the text layer already has an impossible period', () => {
  const started = performance.now();
  const lines = [
    { page: 1, y: 700, text: 'Harbor National Bank' },
    { page: 1, y: 680, text: 'NORTHWIND SUPPLY LLC' },
    { page: 1, y: 660, text: 'Account Number: ****4582' },
    { page: 1, y: 640, text: 'Statement Period: January 1, 1000 through January 1, 9000' },
    { page: 1, y: 620, text: 'Beginning Balance 1,000.00' },
    { page: 1, y: 600, text: 'Date Description Amount Balance' },
    { page: 1, y: 580, text: '01/02 CASH DEPOSIT 25.00 1,025.00' },
  ].map((line) => ({ ...line, items: [] }));
  const result = analyzeStatement({
    pageCount: 1,
    fonts: 1,
    meta: {},
    text: lines.map((line) => line.text).join('\n'),
    lines,
  });
  assert.ok(performance.now() - started < 200);
  assert.equal(result.summary.average_daily_balance, null);
  assert.equal(result.metrics.daily_balances.length, 0);
});
