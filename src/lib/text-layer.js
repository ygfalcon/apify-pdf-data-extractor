import { Worker } from 'node:worker_threads';
import { getDocumentProxy, getMeta } from 'unpdf';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 8000;
const MAX_LINES = 15000;

function joinItems(items) {
  let text = '';
  let end = -1;
  for (const it of items) {
    if (end >= 0) {
      const gap = it.x - end;
      text += gap > 12 ? '  ' : gap > 1 ? ' ' : '';
    }
    text += it.s;
    end = it.x + (it.w || 0);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function asBytes(buffer) {
  if (!buffer) return new Uint8Array();
  if (buffer instanceof Uint8Array) return new Uint8Array(buffer);
  return new Uint8Array(buffer);
}

function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === '%PDF-';
}

function plainMeta(info) {
  const out = {};
  if (!info || typeof info !== 'object') return out;
  for (const [key, value] of Object.entries(info)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      out[key] = `D:${value.getUTCFullYear()}${p(value.getUTCMonth() + 1)}${p(value.getUTCDate())}${p(value.getUTCHours())}${p(value.getUTCMinutes())}${p(value.getUTCSeconds())}Z`;
    }
  }
  return out;
}

/**
 * Read the PDF text layer in this process. Callers go through readTextLayer,
 * which runs this in a worker so a stuck file can be killed.
 */
export async function readTextLayerDirect(buffer, maxPages = 60) {
  const bytes = asBytes(buffer);
  if (bytes.length > MAX_BYTES) throw new Error('File larger than 16 MB');
  if (!looksLikePdf(bytes)) throw new Error('Not a PDF file');
  const timeoutMs = Number(process.env.PDF_PARSE_TIMEOUT_MS || 20_000);
  const deadline = Date.now() + timeoutMs;
  const pdf = await getDocumentProxy(bytes, {
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const pageCount = pdf.numPages;
    const lines = [];
    const charsPerPage = [];
    const fonts = new Set();
    const fields = {};
    const limit = Math.min(pageCount, maxPages);
    for (let p = 1; p <= limit; p += 1) {
      if (Date.now() > deadline) throw new Error('PDF parse timed out');
      const page = await pdf.getPage(p);
      const content = await page.getTextContent({ includeMarkedContent: false });
      let chars = 0;
      const items = [];
      for (const m of content.items) {
        if (!m.str || !m.str.trim()) continue;
        if (m.fontName) fonts.add(m.fontName);
        chars += m.str.trim().length;
        items.push({
          x: m.transform[4],
          y: m.transform[5],
          w: m.width || 0,
          s: m.str,
        });
        if (items.length > MAX_ITEMS) throw new Error('PDF page is too dense to extract safely');
      }
      charsPerPage.push(chars);
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const row = rows.length && Math.abs(rows[rows.length - 1].y - it.y) < 2.5 ? rows[rows.length - 1] : null;
        if (row) row.items.push(it);
        else rows.push({ page: p, y: it.y, items: [it] });
      }
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        row.text = joinItems(row.items);
      }
      rows.sort((a, b) => b.y - a.y);
      lines.push(...rows);
      if (lines.length > MAX_LINES) throw new Error('PDF has too much text to extract safely');
      try {
        const annots = await page.getAnnotations();
        for (const g of annots) {
          if (g.fieldName && typeof g.fieldValue === 'string' && g.fieldValue.trim() && g.fieldValue !== 'Off') {
            fields[g.fieldName] = g.fieldValue.trim();
          }
        }
      } catch {
        // Annotations are optional. A missing form dictionary is not a scan.
      }
    }
    let meta = {};
    try {
      const m = await getMeta(pdf);
      meta = plainMeta(m?.info);
    } catch {
      meta = {};
    }
    return {
      pageCount,
      lines,
      text: lines.map((l) => l.text).join('\n'),
      charsPerPage,
      fonts: fonts.size,
      meta,
      fields,
    };
  } finally {
    await pdf.destroy?.();
  }
}

let worker = null;
let idleTimer = null;
let seq = 0;
let chain = Promise.resolve();
const inflight = new Map();

function dropWorker(child) {
  if (worker === child) worker = null;
  child?.terminate();
}

function rejectOwned(child, err) {
  for (const [id, job] of inflight) {
    if (job.child !== child) continue;
    clearTimeout(job.timer);
    inflight.delete(id);
    job.reject(err);
  }
}

function ensureWorker() {
  if (worker) return worker;
  const child = new Worker(new URL('./text-layer-worker.js', import.meta.url), { execArgv: [] });
  child.on('message', (msg) => {
    const job = inflight.get(msg.id);
    if (!job || job.child !== child) return;
    inflight.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.layer);
    scheduleIdleStop();
  });
  child.on('error', (err) => {
    rejectOwned(child, err);
    dropWorker(child);
  });
  child.on('exit', () => {
    if (worker === child) worker = null;
    rejectOwned(child, new Error('PDF parse failed'));
  });
  worker = child;
  return child;
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inflight.size === 0) dropWorker(worker);
  }, 200);
}

function readOnce(buffer, maxPages) {
  const timeoutMs = Number(process.env.PDF_PARSE_TIMEOUT_MS || 20_000);
  clearTimeout(idleTimer);
  const id = ++seq;
  const child = ensureWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!inflight.has(id)) return;
      inflight.delete(id);
      dropWorker(child);
      reject(new Error('PDF parse timed out'));
    }, timeoutMs);
    inflight.set(id, { resolve, reject, timer, child });
    try {
      child.postMessage({ id, maxPages, buffer: asBytes(buffer) });
    } catch (err) {
      clearTimeout(timer);
      inflight.delete(id);
      reject(err);
    }
  });
}

export async function readTextLayer(buffer, maxPages = 60) {
  const bytes = asBytes(buffer);
  if (bytes.length > MAX_BYTES) throw new Error('File larger than 16 MB');
  if (!looksLikePdf(bytes)) throw new Error('Not a PDF file');
  const run = chain.then(() => readOnce(bytes, maxPages));
  chain = run.then(() => {}, () => {});
  return run;
}

/** Image-only PDFs have almost no text and no fillable fields. Those are unsupported. */
export function isScanned(layer) {
  if (!layer?.charsPerPage?.length) return true;
  const hasFields = layer.fields && Object.keys(layer.fields).length > 0;
  return layer.charsPerPage.every((c) => c < 40) && !hasFields;
}
