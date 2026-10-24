import { analyzeStatement } from './bank/analyze.js';
import { chargeEvent, isBillable } from './charge.js';
import { classify } from './classify.js';
import { analyzeCommercial } from './docs/commercial.js';
import { analyzeW9 } from './docs/w9.js';
import { isScanned, readTextLayer } from './lib/text-layer.js';

const SCANNED_NOTE = 'Scanned or image-only PDF. Digital text-layer PDFs only; this file was not charged.';
const DISCLAIMER = 'Automated extraction. Verify before relying on it. Not credit, legal or tax advice.';

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

async function fallbackExtract(buffer, opts) {
  const { extractDocument } = await import('./engine.js');
  return extractDocument(buffer, opts);
}

export { chargeEvent, isBillable };

export async function extractDocument(buffer, opts = {}) {
  const started = Date.now();
  const mode = opts.mode === 'preview' ? 'preview' : 'full';
  let layer;
  try {
    layer = await readTextLayer(buffer, mode === 'preview' ? 1 : 60);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, note: message, charged: false };
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
    if (body.weak) body = await fallbackExtract(buffer, { ...opts, mode, type });
  } else if (type === 'w9') body = analyzeW9(layer);
  else body = await fallbackExtract(buffer, { ...opts, mode, type });

  if (body?.method === 'vision' || body?.vision_unavailable || body?.vision_error || body?.scanned) {
    return { ...scannedResult(layer.pageCount), elapsed_ms: Date.now() - started };
  }
  if (body?.error) return { ...base, ...body, elapsed_ms: Date.now() - started };
  return { ...base, ...body, elapsed_ms: Date.now() - started };
}
