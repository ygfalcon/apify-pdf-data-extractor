import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractDocument } from '../src/extract.js';
import { buildInvoice } from './pdf-builder.js';

test('invoice line items pass against subtotal and total', async () => {
  const result = await extractDocument(await buildInvoice(), { type: 'invoice' });
  assert.equal(result.document_type, 'invoice');
  assert.equal(result.line_items.length, 2);
  assert.equal(result.line_items[0].description, 'Widget');
  assert.equal(result.line_items[0].quantity, 2);
  assert.equal(result.line_items[0].amount, 20);
  assert.equal(result.line_items[1].amount, 22);
  assert.equal(result.fields.invoice_number.value, 'INV-1001');
  assert.equal(result.fields.invoice_date.value, '2026-02-01');
  assert.equal(result.fields.due_date.value, '2026-03-03');
  assert.equal(result.fields.subtotal.value, 42);
  assert.equal(result.fields.tax.value, 3.36);
  assert.equal(result.fields.total.value, 45.36);
  assert.equal(result.checks.status, 'pass');
  assert.equal(result.summary.line_item_check, 'pass');
  assert.equal(result.summary.total_check, 'pass');
});

test('committed invoice sample passes the line-item check', async () => {
  const result = await extractDocument(readFileSync(new URL('./fixtures/invoice.pdf', import.meta.url)), { type: 'invoice' });
  assert.equal(result.checks.status, 'pass');
  assert.equal(result.fields.total.value, 45.36);
});

test('invoice whose total does not match subtotal plus tax fails the check', async () => {
  const result = await extractDocument(await buildInvoice({ total: 50 }), { type: 'invoice' });
  assert.equal(result.checks.status, 'fail');
  assert.equal(result.summary.line_item_check, 'pass');
  assert.equal(result.summary.total_check, 'fail');
  assert.equal(result.error, undefined);
});
