import { getDocumentProxy, getMeta } from 'unpdf';

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

export async function readTextLayer(buffer, maxPages = 60) {
  // unpdf rejects Node Buffer even though Buffer is a Uint8Array.
  const bytes = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages;
  const lines = [];
  const charsPerPage = [];
  const fonts = new Set();
  const fields = {};
  const limit = Math.min(pageCount, maxPages);
  for (let p = 1; p <= limit; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
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
    }
    charsPerPage.push(chars);
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
      if (row) row.items.push(it);
      else rows.push({ page: p, y: it.y, items: [it] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      row.text = joinItems(row.items);
    }
    rows.sort((a, b) => b.y - a.y);
    lines.push(...rows);
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
    meta = m?.info ?? {};
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
}

/** Image-only PDFs have almost no text and no fillable fields. Those are unsupported. */
export function isScanned(layer) {
  if (!layer?.charsPerPage?.length) return true;
  const hasFields = layer.fields && Object.keys(layer.fields).length > 0;
  return layer.charsPerPage.every((c) => c < 40) && !hasFields;
}
