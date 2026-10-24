import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fetchPdf } from '../src/lib/fetch-pdf.js';
import { buildInvoice } from './pdf-builder.js';

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function origin(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('fetchPdf rejects non-http URLs and over-long URLs', async () => {
  await assert.rejects(fetchPdf('file:///tmp/invoice.pdf'), /http\(s\)/);
  await assert.rejects(fetchPdf('ftp://example.com/invoice.pdf'), /http\(s\)/);
  await assert.rejects(fetchPdf(`http://example.com/${'a'.repeat(2100)}`), /too long/);
});

test('fetchPdf stops on status, type, declared size, and a body that overruns the cap', async () => {
  const pdf = await buildInvoice();
  const server = await listen((req, res) => {
    if (req.url === '/missing') {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>not a pdf</html>');
      return;
    }
    if (req.url === '/declared') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(20 * 1024 * 1024) });
      res.end(pdf);
      return;
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.write(Buffer.from('%PDF-'));
      res.write(Buffer.alloc(200, 0x20));
      res.end();
      return;
    }
    if (req.url === '/hang') return;
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) });
    res.end(pdf);
  });
  try {
    const base = origin(server);
    await assert.rejects(fetchPdf(`${base}/missing`), /HTTP 404/);
    await assert.rejects(fetchPdf(`${base}/html`), /Not a PDF file/);
    await assert.rejects(fetchPdf(`${base}/declared`), /16 MB/);
    await assert.rejects(fetchPdf(`${base}/stream`, { maxBytes: 32 }), /16 MB/);
    await assert.rejects(fetchPdf(`${base}/hang`, { timeoutMs: 200 }), /timeout|aborted/i);
    const got = await fetchPdf(`${base}/ok`);
    assert.equal(got.subarray(0, 5).toString(), '%PDF-');
    assert.ok(got.length > 100);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
