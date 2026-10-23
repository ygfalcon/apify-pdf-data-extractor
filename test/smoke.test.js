import { test } from 'node:test'; import assert from 'node:assert'; import { readFileSync } from 'node:fs';
import { extractDocument } from '../src/engine.js';
test('bank statement', async () => { const r = await extractDocument(readFileSync(new URL('../../falcon-docs/testset/holdout/bank_statement_03.pdf', import.meta.url)), { mode: 'full' }); assert.equal(r.document_type, 'bank_statement'); assert.ok(r.metrics.average_daily_balance !== undefined); });
