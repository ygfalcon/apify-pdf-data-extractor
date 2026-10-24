import assert from 'node:assert/strict';
import { readFileSync, readdirSync, readFileSync as read } from 'node:fs';
import { test } from 'node:test';
import { isBillable } from '../src/charge.js';
import { extractDocument } from '../src/extract.js';
import { extractIsolated } from '../src/isolate.js';

const pdf = (name) => readFileSync(new URL(`./heldout/pdfs/${name}`, import.meta.url));

test('held-out amount-only credit described as a payment stays positive and reconciles', async () => {
  const result = await extractDocument(pdf('payment-credit.pdf'), { type: 'bank_statement' });
  assert.equal(result.error, undefined);
  assert.equal(result.transactions.length, 2);
  const credit = result.transactions.find((t) => t.description === 'ACH PAYMENT FROM ACME');
  assert.equal(credit.amount, 250);
  assert.equal(credit.true_revenue, true);
  assert.equal(result.reconciliation.summary_totals.status, 'pass');
  assert.equal(result.summary.true_revenue, 250);
});

test('held-out duplicate same-day deposits are both kept', async () => {
  const result = await extractDocument(pdf('duplicate-deposits.pdf'), { type: 'bank_statement' });
  const stripes = result.transactions.filter((t) => t.description === 'STRIPE TRANSFER');
  assert.equal(stripes.length, 2);
  assert.equal(stripes.every((t) => t.amount === 80), true);
  assert.equal(result.reconciliation.summary_totals.status, 'pass');
  assert.equal(result.summary.total_deposits, 160);
});

test('held-out invoice keeps decimal quantity, parenthetical discount, tax rate, and due date', async () => {
  const result = await extractDocument(pdf('invoice-discount-qty.pdf'), { type: 'invoice' });
  assert.equal(result.line_items[0].description, 'Cedar plank');
  assert.equal(result.line_items[0].quantity, 2.5);
  assert.equal(result.line_items[0].unit_price, 10);
  assert.equal(result.line_items[0].amount, 25);
  assert.equal(result.fields.tax.value, 2.64);
  assert.equal(result.fields.total.value, 34.64);
  assert.equal(result.fields.due_date.value, '2026-04-01');
  assert.equal(result.checks.status, 'pass');
  assert.equal(result.summary.total_check, 'pass');
});

test('held-out PDF with no labeled fields is not charged', async () => {
  const result = await extractDocument(pdf('sparse.pdf'));
  assert.equal(isBillable(result), false);
  assert.match(`${result.error || ''} ${result.note || ''}`, /not charged/i);
});

test('a statement with balances and no activity is still a result', async () => {
  const result = await extractDocument(pdf('zero-activity.pdf'), { type: 'bank_statement' });
  assert.equal(result.summary.opening_balance, 250);
  assert.equal(result.summary.closing_balance, 250);
  assert.equal(isBillable(result), true);
});

test('encrypted PDF is refused without echoing the password', async () => {
  const result = await extractDocument(pdf('encrypted.pdf'));
  assert.equal(isBillable(result), false);
  assert.match(`${result.error} ${result.note}`, /encrypt/i);
  assert.match(`${result.error} ${result.note}`, /not charged/i);
  assert.equal(JSON.stringify(result).includes('s3cret'), false);
});

test('malformed PDF is not charged', async () => {
  const result = await extractDocument(pdf('malformed.pdf'));
  assert.equal(isBillable(result), false);
  assert.match(`${result.error} ${result.note}`, /malformed|invalid pdf/i);
  assert.match(`${result.error} ${result.note}`, /not charged/i);
});

test('a text-item bomb stays bounded', async () => {
  const started = Date.now();
  const result = await extractDocument(pdf('text-bomb.pdf'), { type: 'generic' });
  assert.ok(Date.now() - started < 8000, 'text bomb did not finish in time');
  const lines = (result.fields && Object.keys(result.fields).length) || 0;
  assert.equal(result.error === undefined || /not charged/i.test(result.error || ''), true);
  assert.ok((result.pages_processed ?? 1) >= 1);
  // The page has 6000 text rows. The reader must not return every one of them.
  const dumped = JSON.stringify(result);
  const rowHits = dumped.match(/Row \d+/g) ?? [];
  assert.ok(rowHits.length <= 4000, `returned ${rowHits.length} text rows`);
  assert.ok(lines >= 0);
});

test('worker errors do not leak gateway secrets', async () => {
  const result = await extractIsolated(Buffer.from('%PDF-'), {}, {
    timeoutMs: 5000,
    workerUrl: new URL('./helpers/leak-worker.js', import.meta.url),
  });
  assert.equal(isBillable(result), false);
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes('supersecretvalue'), false);
  assert.equal(dumped.includes('sk-testsecret'), false);
  assert.match(result.error, /not charged/i);
});

test('a worker that allocates a huge buffer is stopped and not charged', async () => {
  const result = await extractIsolated(Buffer.from('%PDF-'), {}, {
    timeoutMs: 15000,
    workerUrl: new URL('./helpers/blow-worker.js', import.meta.url),
  });
  assert.equal(result.allocated, undefined);
  assert.equal(isBillable(result), false);
  assert.match(result.error, /not charged/i);
});

test('dataset write happens before charge, and a failed write does not charge', async () => {
  const { runBatch } = await import('../src/run.js');
  const order = [];
  const invoice = pdf('invoice-discount-qty.pdf');
  await assert.rejects(() => runBatch({
    sources: ['https://cdn.example.com/inv.pdf'],
    mode: 'extract',
    documentType: 'invoice',
    ledger: new Map(),
    fetchPdf: async () => invoice,
    extract: extractDocument,
    pushData: async () => {
      order.push('push');
      throw new Error('dataset down');
    },
    charge: async () => {
      order.push('charge');
      return { chargedCount: 1, eventChargeLimitReached: false };
    },
  }));
  assert.deepEqual(order, ['push']);
});

test('a retry of the same source charges once and writes once', async () => {
  const { runBatch } = await import('../src/run.js');
  const invoice = pdf('invoice-discount-qty.pdf');
  const ledger = new Map();
  const pushes = [];
  const charges = [];
  const deps = {
    sources: ['https://user:supersecretpass@cdn.example.com/inv.pdf?token=supersecrettoken'],
    mode: 'extract',
    documentType: 'invoice',
    ledger,
    fetchPdf: async () => invoice,
    extract: extractDocument,
    pushData: async (item) => pushes.push(item),
    charge: async (opts) => {
      charges.push(opts);
      return { chargedCount: 1, eventChargeLimitReached: false };
    },
  };
  await runBatch(deps);
  await runBatch(deps);
  assert.equal(charges.length, 1);
  assert.equal(pushes.length, 1);
  assert.equal(charges[0].count, 1);
  assert.equal(typeof charges[0].idempotencyKey, 'string');
  assert.equal(charges[0].idempotencyKey.includes('supersecret'), false);
  assert.equal(JSON.stringify(pushes[0]).includes('supersecretpass'), false);
  assert.equal(JSON.stringify(pushes[0]).includes('supersecrettoken'), false);
  assert.equal(pushes[0].charged, true);
  assert.deepEqual(
    charges.map(() => null),
    [null],
  );
  const orderProbe = [];
  const ledger2 = new Map();
  await runBatch({
    ...deps,
    sources: ['https://cdn.example.com/other.pdf'],
    ledger: ledger2,
    pushData: async (item) => orderProbe.push(['push', item.sourceUrl]),
    charge: async (opts) => {
      orderProbe.push(['charge', opts.eventName]);
      return { chargedCount: 1, eventChargeLimitReached: false };
    },
  });
  assert.deepEqual(orderProbe.map((row) => row[0]), ['push', 'charge']);
});

test('empty output and preview are not charged', async () => {
  const { runBatch } = await import('../src/run.js');
  const charges = [];
  const pushes = [];
  await runBatch({
    sources: ['https://cdn.example.com/notes.pdf'],
    mode: 'extract',
    documentType: 'auto',
    ledger: new Map(),
    fetchPdf: async () => pdf('sparse.pdf'),
    extract: extractDocument,
    pushData: async (item) => pushes.push(item),
    charge: async (opts) => {
      charges.push(opts);
      return { chargedCount: 1, eventChargeLimitReached: false };
    },
  });
  assert.equal(charges.length, 0);
  assert.equal(pushes[0].charged, false);
  assert.match(pushes[0].error, /not charged/i);

  const previewCharges = [];
  await runBatch({
    sources: ['https://cdn.example.com/stmt.pdf'],
    mode: 'preview',
    documentType: 'auto',
    ledger: new Map(),
    fetchPdf: async () => pdf('payment-credit.pdf'),
    extract: extractDocument,
    pushData: async () => {},
    charge: async (opts) => {
      previewCharges.push(opts);
      return { chargedCount: 1, eventChargeLimitReached: false };
    },
  });
  assert.equal(previewCharges.length, 0);
});

test('input rejects private hosts, bad types, credential URLs, and a string of URLs is one URL', async () => {
  const { normalizeInput } = await import('../src/input.js');
  assert.throws(() => normalizeInput({ pdfUrls: ['http://169.254.169.254/latest/meta-data/'] }), /not allowed|private|host/i);
  assert.throws(() => normalizeInput({ pdfUrls: ['http://127.0.0.1/secret.pdf'] }), /not allowed|private|host/i);
  assert.throws(() => normalizeInput({ pdfUrls: ['https://user:pass@cdn.example.com/a.pdf'] }), /credential|userinfo|password/i);
  assert.throws(() => normalizeInput({ pdfUrls: ['https://cdn.example.com/a.pdf'], documentType: 'drop-table' }), /document type/i);
  assert.throws(() => normalizeInput({ pdfUrls: ['file:///etc/passwd'] }), /http/i);
  const one = normalizeInput({ pdfUrls: 'https://cdn.example.com/a.pdf', mode: 'extract' });
  assert.deepEqual(one.sources, ['https://cdn.example.com/a.pdf']);
  assert.equal(one.mode, 'extract');
});

test('downloads stop at the size cap and on a stalled body', async () => {
  const { readLimitedBody } = await import('../src/pdf-fetch.js');
  const big = new Uint8Array(1000);
  const res = new Response(big, { headers: { 'content-length': '1000' } });
  await assert.rejects(() => readLimitedBody(res, { maxBytes: 100 }), /16 MB|larger|limit/i);

  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 5) return;
      controller.enqueue(new Uint8Array(50));
    },
  });
  const slow = new Response(stream);
  await assert.rejects(() => readLimitedBody(slow, { maxBytes: 10_000, timeoutMs: 200 }), /timed out|timeout/i);
});

test('fetch refuses a redirect onto a link-local address and a lying content-length', async () => {
  const { fetchPdf } = await import('../src/pdf-fetch.js');
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('cdn.example.com')) {
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-length': '3' } });
  };
  await assert.rejects(
    () => fetchPdf('https://cdn.example.com/a.pdf', { fetchImpl, lookup: async () => ({ address: '169.254.169.254' }) }),
    /not allowed|private|host/i,
  );
  assert.equal(calls.some((url) => url.includes('169.254.169.254')), false);

  const fat = new Response(new Uint8Array(32), { status: 200, headers: { 'content-length': String(32 * 1024 * 1024) } });
  await assert.rejects(
    () => fetchPdf('https://cdn.example.com/big.pdf', {
      fetchImpl: async () => fat,
      lookup: async () => ({ address: '93.184.216.34' }),
      maxBytes: 1024,
    }),
    /larger|16 MB|limit/i,
  );
});

test('published prices stay 0.24 and 0.029, and no copy says $0.25', () => {
  const pricing = JSON.parse(readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
  const byName = Object.fromEntries(pricing.events.map((e) => [e.eventName, e.priceUsd]));
  assert.equal(byName['bank-statement'], 0.24);
  assert.equal(byName.document, 0.029);
  const files = [
    ['README.md', readFileSync(new URL('../README.md', import.meta.url), 'utf8')],
    ['.actor/actor.json', readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')],
    ['.actor/input_schema.json', readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')],
    ['.actor/pricing.json', readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8')],
  ];
  for (const [name, text] of files) {
    assert.equal(text.includes('$0.25'), false, `${name} shows $0.25`);
    assert.equal(/\$0\.25/.test(text), false, name);
  }
  const readme = files[0][1];
  const hundred = readme.match(/100 bank statements cost \$(\d+(?:\.\d+)?)/i);
  assert.ok(hundred, 'README should state the price of 100 statements');
  assert.equal(Number(hundred[1]), 24);
  const thousand = readme.match(/1,000 invoices cost \$(\d+(?:\.\d+)?)/i);
  assert.ok(thousand, 'README should state the price of 1,000 invoices');
  assert.equal(Number(thousand[1]), 29);
});

test('local extraction does not call the vision gateway', async () => {
  const source = readFileSync(new URL('../src/extract.js', import.meta.url), 'utf8');
  assert.equal(source.includes("engine.js"), false);
  assert.equal(source.includes('gemini'), false);
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network disabled');
  };
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = 'should-not-be-used';
  try {
    const scanned = await extractDocument(pdf('sparse.pdf'));
    assert.equal(JSON.stringify(scanned).includes('should-not-be-used'), false);
    assert.equal(scanned.method === 'vision', false);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
  assert.equal(calls.length, 0);
});

test('held-out directory is a separate set from the tuned fixtures', () => {
  const held = readdirSync(new URL('./heldout/pdfs/', import.meta.url)).filter((name) => name.endsWith('.pdf')).sort();
  const tuned = readdirSync(new URL('./fixtures/', import.meta.url)).filter((name) => name.endsWith('.pdf'));
  assert.ok(held.length >= 6);
  for (const name of held) assert.equal(tuned.includes(name), false, name);
});
