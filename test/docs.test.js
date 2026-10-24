import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractDocument } from '../src/extract.js';
import { isBillable } from '../src/charge.js';
const load = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));

for (const f of ['w9-fillable.pdf', 'w9-flat.pdf']) {
  test(`W-9 ${f}`, async () => {
    const r = await extractDocument(load(f), { mode: 'full' });
    assert.equal(r.document_type, 'w9');
    assert.equal(r.fields.name.value, 'Maria Q Testperson');
    assert.equal(r.fields.business_name.value, 'Testperson Plumbing LLC');
    assert.equal(r.fields.tax_classification.value, 's_corporation');
    assert.equal(r.fields.city_state_zip.value, 'Tampa, FL 33614');
    assert.equal(r.fields.ein.value, '12-3456789');
    assert.ok(isBillable(r));
  });
}
test('blank W-9 is not billable', async () => {
  const r = await extractDocument(load('w9-blank.pdf'), { mode: 'full' });
  assert.equal(r.document_type, 'w9');
  assert.equal(isBillable(r), false);
});
test('invoice with description above the numbers row', async () => {
  const r = await extractDocument(load('invoice-two-line-rows.pdf'), { mode: 'full' });
  assert.equal(r.fields.vendor_name.value, 'DEMO - Sliced Invoices');
  assert.deepEqual(r.line_items, [{ description: 'Web Design', quantity: 1, unit_price: 85, amount: 85 }]);
  assert.equal(r.checks.status, 'pass');
});
test('receipt and purchase order', async () => {
  const rc = await extractDocument(load('receipt.pdf'), { mode: 'full' });
  assert.equal(rc.document_type, 'receipt');
  assert.equal(rc.fields.date.value, '2026-10-02');
  assert.equal(rc.checks.status, 'pass');
  const po = await extractDocument(load('po.pdf'), { mode: 'full' });
  assert.equal(po.document_type, 'purchase_order');
  assert.equal(po.fields.po_number.value, 'PO-55120');
  assert.equal(po.checks.status, 'pass');
});

test('invoice buyer from "To:" block; PO buyer from header, vendor from label', async () => {
  const { extractDocument } = await import('../src/extract.js');
  const { readFileSync } = await import('node:fs');
  const inv = await extractDocument(readFileSync(new URL('./fixtures/invoice-two-line-rows.pdf', import.meta.url)));
  assert.equal(inv.fields.buyer_name.value, 'Test Business');
  const po = await extractDocument(readFileSync(new URL('./fixtures/po.pdf', import.meta.url)));
  assert.equal(po.summary.vendor, 'Steel Supply Co');
  assert.equal(po.summary.buyer, 'Acme Fabrication Inc');
});
