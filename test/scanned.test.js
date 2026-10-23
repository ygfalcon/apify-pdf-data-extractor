import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBillable } from '../src/charge.js';
import { extractDocument } from '../src/extract.js';
import { buildScanned } from './pdf-builder.js';

test('scanned PDFs are unsupported and not billable', async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = 'should-not-be-used';
  try {
    const result = await extractDocument(await buildScanned(), { mode: 'full' });
    assert.equal(result.scanned, true);
    assert.equal(result.method, 'unsupported_scan');
    assert.match(result.error, /not charged/i);
    assert.equal(isBillable(result), false);
    assert.equal(result.transactions, undefined);
  } finally {
    if (previous == null) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
});
