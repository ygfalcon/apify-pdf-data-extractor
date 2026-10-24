import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractIsolated } from '../src/isolate.js';
import { isBillable } from '../src/extract.js';

test('worker extraction matches in-process result (PO vendor + buyer)', async () => {
  const r = await extractIsolated(readFileSync(new URL('./fixtures/po.pdf', import.meta.url)), { mode: 'full' });
  assert.equal(r.document_type, 'purchase_order');
  assert.equal(r.fields.vendor_name.value, 'Steel Supply Co');
  assert.equal(r.fields.buyer_name.value, 'Acme Fabrication Inc');
  assert.equal(r.fields.ship_to.value, 'Acme Plant 2');
});

test('a hung extraction is killed at the deadline and not billable', async () => {
  const t0 = Date.now();
  const r = await extractIsolated(Buffer.from('%PDF-'), {}, { timeoutMs: 300, workerUrl: new URL('./helpers/hang-worker.js', import.meta.url) });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.timed_out, true);
  assert.equal(isBillable(r), false);
});
