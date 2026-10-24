import { analyzeStatement } from './bank/analyze.js';
import { chargeEvent, isBillable } from './charge.js';
import { classify } from './classify.js';
import { analyzeCommercial } from './docs/commercial.js';
import { analyzeW9 } from './docs/w9.js';
import { isScanned, readTextLayer } from './lib/text-layer.js';

const SCANNED_NOTE = 'Scanned or image-only PDF. Digital text-layer PDFs only; this file was not charged.';
const DISCLAIMER = 'Automated extraction. Verify before relying on it. Not credit, legal or tax advice.';
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const EMPTY_NOTE = 'No labeled fields found in this PDF. Not charged.';

function rejected(message) {
  return { error: message, note: message, charged: false };
}

function scannedResult(pages) {
  return {
    error: SCANNED_NOTE,
    note: SCANNED_NOTE,
    scanned: true,
    charged: false,
    document_type: null,
    method: 'unsupported_scan',
    pages: pages ?? null,
  };
}

function publicReadError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out|too dense|PDF parse failed|not a pdf|larger than 16/i.test(message)) return message;
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  const combined = `${name} ${message}`;
  if (/password|encrypt/i.test(combined)) {
    return 'Encrypted PDF. Password-protected files cannot be read. Not charged.';
  }
  if (/invalid pdf|pdf structure|malformed|xref|format error/i.test(combined)) {
    return 'Malformed or invalid PDF. Not charged.';
  }
  return 'Could not read this PDF. Not charged.';
}

function analyzeGeneric(layer) {
  const fields = {};
  for (const line of layer.lines) {
    const match = line.text.match(/^([A-Za-z][A-Za-z0-9 /&-]{1,40}):\s+(\S.{0,200})$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!key || fields[key]) continue;
    fields[key] = { value: match[2].trim(), confidence: 0.5, source: 'label' };
    if (Object.keys(fields).length >= 40) break;
  }
  if (!Object.keys(fields).length) {
    return { error: EMPTY_NOTE, note: EMPTY_NOTE, charged: false, fields: {} };
  }
  return { fields };
}

export { chargeEvent, isBillable };

export async function extractDocument(buffer, opts = {}) {
  const started = Date.now();
  const mode = opts.mode === 'preview' ? 'preview' : 'full';
  const bytes = buffer == null ? null : Buffer.from(buffer);
  if (!bytes || bytes.length < 5 || bytes.subarray(0, 5).toString() !== '%PDF-') return rejected('Not a PDF file');
  if (bytes.length > MAX_PDF_BYTES) return rejected('File larger than 16 MB');
  let layer;
  try {
    layer = await readTextLayer(bytes, mode === 'preview' ? 1 : 60);
  } catch (err) {
    const message = publicReadError(err);
    return rejected(message);
  }
  if (isScanned(layer)) return { ...scannedResult(layer.pageCount), elapsed_ms: Date.now() - started };

  const detected = classify(layer);
  const forced = opts.type && opts.type !== 'auto' ? opts.type : null;
  const type = forced === 'generic' ? 'generic' : (forced || detected.type);
  const confidence = forced ? 1 : detected.confidence;
  const base = {
    document_type: type,
    classification_confidence: Math.round(confidence * 100) / 100,
    method: 'text_layer',
    pages: layer.pageCount,
    pages_processed: mode === 'preview' ? 1 : Math.min(layer.pageCount, 60),
    mode,
    disclaimer: DISCLAIMER,
  };

  let body;
  if (type === 'bank_statement') body = analyzeStatement(layer, { mode });
  else if (type === 'invoice' || type === 'receipt' || type === 'purchase_order') {
    body = analyzeCommercial(layer, type);
    if (body.weak) {
      const note = 'No invoice totals or line items found. Not charged.';
      body = { error: note, note, charged: false, weak: true };
    }
  } else if (type === 'w9') body = analyzeW9(layer);
  else body = analyzeGeneric(layer);

  if (body?.error) return { ...base, ...body, elapsed_ms: Date.now() - started };
  return { ...base, ...body, elapsed_ms: Date.now() - started };
}
