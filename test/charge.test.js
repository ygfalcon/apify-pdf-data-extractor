import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chargeEvent, isBillable } from '../src/charge.js';

test('pay-per-event prices and event names stay unchanged', () => {
  const pricing = JSON.parse(readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
  const byName = Object.fromEntries(pricing.events.map((e) => [e.eventName, e.priceUsd]));
  assert.equal(pricing.pricingModel, 'PAY_PER_EVENT');
  assert.equal(byName.document, 0.029);
  assert.equal(byName['bank-statement'], 0.24);
  assert.equal(chargeEvent('extract', 'invoice'), 'document');
  assert.equal(chargeEvent('extract', 'bank_statement'), 'bank-statement');
  assert.equal(chargeEvent('bank_statement', 'bank_statement'), 'bank-statement');
  assert.equal(chargeEvent('bank_statement', 'invoice'), 'document');
  assert.equal(chargeEvent('preview', 'bank_statement'), null);
  assert.equal(isBillable({ document_type: 'bank_statement' }), false);
  assert.equal(isBillable({
    document_type: 'bank_statement',
    reconciliation_status: 'pass',
    reconciliation: {
      status: 'pass',
      summary_totals: { checks: [{ name: 'opening_plus_transactions_equals_ending', status: 'pass' }] },
    },
    transactions: [{ amount: 1 }],
  }), true);
  assert.equal(isBillable({ error: 'nope', scanned: true }), false);
});

test('actor schemas stay store-shaped', () => {
  const actor = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8'));
  const input = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
  const output = JSON.parse(readFileSync(new URL('../.actor/output_schema.json', import.meta.url), 'utf8'));
  const dataset = JSON.parse(readFileSync(new URL('../.actor/dataset_schema.json', import.meta.url), 'utf8'));
  assert.equal(actor.actorSpecification, 1);
  assert.equal(input.schemaVersion, 1);
  assert.equal(output.actorOutputSchemaVersion, 1);
  assert.equal(dataset.actorSpecification, 1);
  assert.equal(dataset.fields.additionalProperties, true);
  assert.ok(dataset.views.overview);
  assert.ok(dataset.views.statements);
  for (const name of dataset.views.statements.transformation.fields) {
    assert.ok(dataset.fields.properties[name], name);
  }
});
