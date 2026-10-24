import { inferDateOrder, isDateToken, parseDate } from '../lib/dates.js';
import { findMoney, isMoneyToken, moneyEq, parseMoneyToken, round2 } from '../lib/money.js';

function field(value, confidence, source) {
  if (value == null || value === '') return null;
  return { value, confidence, source };
}

function moneyItems(line) {
  const out = [];
  const items = line.items || [];
  for (let i = 0; i < items.length; i += 1) {
    let s = items[i].s.trim();
    let x = items[i].x;
    if (/^(?:[$€£₹]|Rs\.?)$/i.test(s) && items[i + 1]) {
      const next = items[i + 1].s.trim();
      if (isMoneyToken(next) || /^\d/.test(next)) {
        const combined = parseMoneyToken(`${s} ${next}`) || parseMoneyToken(next);
        if (combined) {
          out.push({ ...combined, x: items[i + 1].x });
          i += 1;
          continue;
        }
      }
    }
    if (!isMoneyToken(s)) continue;
    const parsed = parseMoneyToken(s);
    if (parsed) out.push({ ...parsed, x });
  }
  return out;
}

function lineMoneys(line) {
  const positioned = moneyItems(line);
  if (positioned.length) return positioned;
  return findMoney(line.text).map((m, index) => ({ ...m, x: index }));
}

const DATE_TEXT = String.raw`[A-Za-z]{3,12}\.?\s+\d{1,2}\s*,?\s+\d{4}|\d{1,2}\.?\s+[A-Za-z]{3,12}\.?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}`;

function isHeading(text) {
  const t = String(text ?? '').trim();
  return /^(?:tax\s+)?(?:invoice|receipt|purchase order|bill|factuur|facture|rechnung|payment receipt|retail invoices?(?:\/bill)?|kopie factuur)\b[. ]*$/i.test(t);
}

function isStreet(text) {
  return /\d/.test(text) && /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|weg|straat|rue|blvd)\b/i.test(text);
}

const CUSTOMER_MARK = /factuuradres|afleveradres|bill to|ship to|sold to|guest name|billing address|shipping address/i;

function cleanVendor(name) {
  if (!name) return null;
  let s = String(name).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+#\s*\d+\b.*$/i, '');
  s = s.replace(/[.,]+$/, '');
  s = s.replace(/\.(?:com|net|org)\b.*$/i, '');
  return s.trim() || null;
}

function entityName(text) {
  const m = String(text).match(/\b([A-Z][\w.&'-]*(?:\s+[A-Z0-9][\w.&'-]*){0,6}),?\s+(AG|B\.V\.|GmbH|SAS|Sarl|Pvt\.?(?:\s+Ltd\.?)?|LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Limited|Corp\.?|Corporation|PLC|N\.V\.)\b/);
  if (!m) return null;
  const comma = /,/.test(m[0]);
  return cleanVendor(comma ? `${m[1]}, ${m[2]}` : `${m[1]} ${m[2]}`);
}

function vendorName(lines, text) {
  const top = lines.slice(0, 20);
  for (let i = 0; i < top.length; i += 1) {
    const item0 = (top[i].items?.[0]?.s || '').trim();
    if (/^(from|seller|supplier)\s*:?\s*$/i.test(item0)) return cleanVendor(top[i + 1]?.items?.[0]?.s);
    if (/^vendor\s*:?\s*$/i.test(item0) && !/ship\s*to/i.test(top[i].text)) return cleanVendor(top[i + 1]?.items?.[0]?.s);
  }
  for (const line of top) {
    const inline = line.text.match(/^(?:from|seller|supplier|vendor)\s*:\s*(.+)$/i);
    if (inline && !/ship\s*to/i.test(line.text)) return cleanVendor(inline[1]);
  }
  const pay = text.match(/payment received by\s+([A-Za-z][A-Za-z0-9.&'-]{1,30})/i);
  if (pay) return cleanVendor(pay[1]);
  const tit = text.match(/titulaire du compte\s*:\s*([A-Za-z0-9][A-Za-z0-9 .&'-]{1,40})/i);
  if (tit) return cleanVendor(tit[1]);
  if (isHeading(lines[0]?.text || '')) {
    const ord = text.match(/ordered through\s*:?\s*([A-Za-z0-9][A-Za-z0-9.-]{1,40})/i);
    if (ord) return cleanVendor(ord[1]);
  }
  const sas = text.match(/\b([A-Z][A-Za-z0-9&]+)\s+SAS\b/);
  const firstLine = (lines[0]?.text || '').trim();
  if (sas && firstLine.toLowerCase().startsWith(sas[1].toLowerCase())) return sas[1];

  let customer = false;
  for (const line of top) {
    if (CUSTOMER_MARK.test(line.text)) { customer = true; continue; }
    if (customer) continue;
    const name = entityName(line.text);
    if (name) return name;
  }
  customer = false;
  for (let i = 0; i < top.length; i += 1) {
    if (CUSTOMER_MARK.test(top[i].text)) { customer = true; continue; }
    if (customer || !isStreet(top[i].text)) continue;
    for (let j = i - 1; j >= 0 && j >= i - 4; j -= 1) {
      if (isHeading(top[j].text) || isStreet(top[j].text)) continue;
      const name = (top[j].items?.[0]?.s || top[j].text || '').trim();
      if (name && !CUSTOMER_MARK.test(name) && /[A-Za-z]/.test(name) && name.length < 60) return cleanVendor(name);
    }
    break;
  }
  customer = false;
  for (const line of lines.slice(0, 8)) {
    if (CUSTOMER_MARK.test(line.text)) { customer = true; continue; }
    if (customer) continue;
    const name = (line.items?.[0]?.s || '').trim();
    if (!name || isHeading(name) || isHeading(line.text)) continue;
    if (/^(bill to|ship to|invoice|date|page|factuuradres|afleveradres)\b/i.test(name)) continue;
    return cleanVendor(name);
  }
  return null;
}

const VENDOR_LABEL = /^(?:from|seller|vendor|supplier|sold by|remit to)\b/i;
const BUYER_LABEL = /^(?:to(?=\s*:)|bill(?:ed)? to|sold to|buyer|purchaser|customer|invoice to|ordered by)\b/i;
const SHIP_LABEL = /^(?:ship(?:ped)? to|deliver(?:y)? to)\b/i;

function headerText(line) {
  return (line?.items?.[0]?.s ?? line?.text ?? '').trim();
}

// Value of a labeled party block, inline or on the next line in the same column.
// Two blocks can sit side by side on one row.
function blockValue(lines, re, maxLine = 25) {
  const top = lines.slice(0, maxLine);
  for (let i = 0; i < top.length; i += 1) {
    for (const it of top[i].items ?? []) {
      const s = it.s.trim();
      const m = s.match(re);
      if (!m || m.index !== 0) continue;
      const inline = s.slice(m[0].length).replace(/^[\s:#.-]+/, '').trim();
      if (inline) return inline;
      if (!/^[\s:]*$/.test(s.slice(m[0].length))) continue;
      const next = top[i + 1];
      if (!next?.items?.length) continue;
      const below = next.items
        .map((n) => ({ n, d: Math.abs(n.x - it.x) }))
        .filter(({ d }) => d < 60)
        .sort((a, b) => a.d - b.d)[0];
      const value = below?.n.s.trim();
      if (value && !/^\d+([.,]\d+)?$/.test(value)) return value;
    }
  }
  return null;
}

function parties(lines, type) {
  const fromIdx = lines.slice(0, 12).findIndex((line) => /^(?:from|seller|vendor|supplier)\s*:?\s*$/i.test(headerText(line)));
  let vendorFromLabel = fromIdx >= 0 ? headerText(lines[fromIdx + 1]) || null : null;
  const labeledVendor = blockValue(lines, VENDOR_LABEL);
  if (!vendorFromLabel && labeledVendor) vendorFromLabel = labeledVendor;
  const headerIssuer = lines.slice(0, 4).map(headerText).find((text) => text && !/^(?:tax\s+)?(?:invoice|receipt|purchase order|bill to|sold to|vendor|ship to)\b/i.test(text) && !/^[\d#]/.test(text)) || null;
  const labeledBuyer = blockValue(lines, BUYER_LABEL);
  const shipTo = blockValue(lines, SHIP_LABEL);
  const buyerName = labeledBuyer
    ?? (type === 'purchase_order' && headerIssuer && headerIssuer !== vendorFromLabel ? headerIssuer : null);
  return {
    vendorName: vendorFromLabel || headerIssuer,
    vendorLabeled: Boolean(vendorFromLabel),
    buyerName,
    buyerSource: labeledBuyer ? 'label' : 'header',
    shipTo,
  };
}

function valueBeside(lines, labelTest) {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const label = (lines[i].items || []).find((it) => labelTest(it.s.trim()));
    if (!label) continue;
    let best = null;
    let bestD = 55;
    for (const it of lines[i + 1].items || []) {
      const d = Math.abs(it.x - label.x);
      if (d < bestD) {
        bestD = d;
        best = it.s.trim();
      }
    }
    if (best) return best;
  }
  return null;
}

function invoiceNumber(lines, text) {
  const labeled = text.match(/(?:invoice\s*(?:number|no\.?|#)|factuurnummer|rechnungsnr\.?|rechnungsnummer|facture\s*n°|factuur\s*n°)\s*[:.]?\s*#?\s*([A-Z0-9][A-Z0-9/._-]*\d[A-Z0-9/._-]*)/i);
  if (labeled && !/^(date|number)$/i.test(labeled[1])) return labeled[1];
  const inline = text.match(/\binvoice\s+#?\s*([A-Z0-9][A-Z0-9/._-]*\d[A-Z0-9/._-]*)/i);
  if (inline) return inline[1];
  const col = valueBeside(lines, (s) => /^factuur$/i.test(s) || /^booking id$/i.test(s));
  if (col && /\d/.test(col) && !isDateToken(col)) return col;
  for (const line of lines.slice(0, 30)) {
    const hash = line.text.trim().match(/^#\s*([A-Za-z0-9][\w/-]*)/);
    if (hash) return hash[1];
  }
  return null;
}

function poNumber(lines) {
  for (const line of lines) {
    const m = line.text.match(/p\.?o\.?\s*(?:number|no\.?|#)\s*[:.]?\s*([A-Z0-9][\w-]*)/i);
    if (m) return m[1];
  }
  return null;
}

function dateByLabels(lines, labelRes, order) {
  for (const labelRe of labelRes) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const m = line.text.match(labelRe);
      if (!m) continue;
      const after = line.text.slice((m.index ?? 0) + m[0].length);
      const inline = after.match(new RegExp(String.raw`^[\s:.-]{0,12}(${DATE_TEXT})`, 'i'));
      if (inline) return parseDate(inline[1], null, order);
      const item = (line.items || []).find((it) => labelRe.test(it.s));
      const next = lines[i + 1];
      if (!item || !next) continue;
      let best = null;
      let bestD = 40;
      for (const it of next.items || []) {
        const s = it.s.trim();
        if (!new RegExp(String.raw`^(?:${DATE_TEXT})$`, 'i').test(s)) continue;
        const d = Math.abs(it.x - item.x);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) return parseDate(best, null, order);
    }
  }
  return null;
}

function findIssued(lines, text, type, order) {
  if (type === 'receipt') {
    const labeled = dateByLabels(lines, [/receipt date/i, /(?<!order )(?<!due )(?<!payment )\bdate\b\s*:?/i], order);
    if (labeled) return labeled;
    for (const line of lines.slice(0, 12)) {
      const m = line.text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
      if (m) return parseDate(m[1], null, order);
    }
    return null;
  }
  if (type === 'purchase_order') {
    return dateByLabels(lines, [/p\.?o\.?\s*date/i, /order date/i, /(?<!due )\bdate\b\s*:?/i], order);
  }
  const du = text.match(/(?:facture|factuur|rechnung)[^\n]{0,48}?\bdu\s+(\d{1,2}\.?\s+[A-Za-z]{3,12}\s+\d{4})/i);
  if (du) return parseDate(du[1], null, order);
  return dateByLabels(lines, [
    /invoice date/i,
    /factuurdatum/i,
    /factuur datum/i,
    /rechnungsdatum/i,
    /(?<!order )(?<!due )(?<!payment )\bdate\b\s*:/i,
  ], order);
}

function findDue(lines, text, order) {
  const lim = text.match(/date limite de paiement(?:\s+le)?\s+(\d{1,2}\.?\s+[A-Za-z]{3,12}\s+\d{4})/i);
  if (lim) return parseDate(lim[1], null, order);
  return dateByLabels(lines, [/due date/i, /vervaldatum/i, /zahlungsziel/i, /\bdue\b\s*:/i], order);
}

function btwBreakdown(lines) {
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!/grondslag/i.test(lines[i].text)) continue;
    const cols = [];
    for (const it of lines[i].items || []) {
      let key = null;
      if (/grondslag/i.test(it.s)) key = 'subtotal';
      else if (/btw bedrag|tva|mwst/i.test(it.s)) key = 'tax';
      else if (/\btotaal\b|\btotal\b/i.test(it.s)) key = 'total';
      if (key && !cols.some((c) => c.key === key)) cols.push({ key, x: it.x });
    }
    const moneys = lineMoneys(lines[i + 1]);
    const pairs = [];
    for (const money of moneys) {
      for (const col of cols) pairs.push({ money, key: col.key, d: Math.abs(money.x - col.x) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedM = new Set();
    const usedK = new Set();
    const out = {};
    for (const pair of pairs) {
      if (usedM.has(pair.money) || usedK.has(pair.key) || pair.d > 80) continue;
      usedM.add(pair.money);
      usedK.add(pair.key);
      out[pair.key] = pair.money.value;
    }
    return out;
  }
  return null;
}

function nearestMoney(line, labelRe) {
  const moneys = lineMoneys(line);
  if (!moneys.length) return null;
  const label = (line.items || []).find((it) => labelRe.test(it.s));
  if (!label || moneys[0].x == null) return moneys[moneys.length - 1].value;
  const sorted = [...moneys].sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x));
  return sorted[0].value;
}

function amountOnlyText(text) {
  const letters = String(text ?? '').replace(/rs\.?|usd|eur|gbp|inr/gi, '').replace(/[^A-Za-z]/g, '');
  return !letters;
}

function scanAmount(lines, re, reject, choose = 'last') {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = lines[i].text;
    if (reject && reject.test(text)) continue;
    if (!re.test(text)) continue;
    let line = lines[i];
    let moneys = lineMoneys(line);
    if (!moneys.length) {
      const next = lines[i + 1];
      if (next && amountOnlyText(next.text)) {
        const nextMoneys = lineMoneys(next);
        if (nextMoneys.length) {
          line = next;
          moneys = nextMoneys;
        }
      }
    }
    if (!moneys.length) continue;
    if (choose === 'first') return moneys[0].value;
    if (choose === 'nearest') return nearestMoney(line, re);
    return moneys[moneys.length - 1].value;
  }
  return null;
}

function detectCurrency(text) {
  if (/₹|\bRs\.?\b|\bINR\b/.test(text)) return 'INR';
  if (/€|\bEUR\b/.test(text)) return 'EUR';
  if (/£|\bGBP\b/.test(text)) return 'GBP';
  if (/\bUSD\b|US Dollars|\$/.test(text)) return 'USD';
  if (/\b(?:India|Bangalore|Karnataka)\b/.test(text)) return 'INR';
  return null;
}

function columnKey(text) {
  const t = text.toLowerCase();
  if (/qty|quantity|aantal|menge|nombre|hoeveelheid/.test(t)) return 'qty';
  if (/disc|rabatt/.test(t)) return 'disc';
  if (/amount|bedrag|zeilenbetrag|montant|prijs incl|prix incl|\btotal\b/.test(t)) return 'amount';
  if (/unit price|\brate\b|prijs|vk-preis|p\.u\.?|\bprice\b/.test(t)) return 'unit';
  if (/\btax|\btva\b|\bbtw\b|\bvat\b|\bmwst\b|\bgst\b/.test(t)) return 'tax';
  if (/desc|beschreibung|\bitem\b|product|omschrijving|bezeichnung|désignation|designation|artikel|article|service|\btitle\b/.test(t)) return 'desc';
  return null;
}

function headerColumns(line) {
  const cols = [];
  for (const it of line.items || []) {
    const key = columnKey(it.s);
    if (!key || cols.some((c) => c.key === key)) continue;
    cols.push({ key, x: it.x, text: it.s });
  }
  return cols;
}

function isTableHeader(line) {
  const cols = headerColumns(line);
  return cols.some((c) => c.key === 'desc') && cols.some((c) => ['amount', 'unit', 'qty', 'price'].includes(c.key) || c.key === 'amount' || c.key === 'unit' || c.key === 'qty');
}

function isStrongTotal(text) {
  if (/sub\s*total|subtotaal|total\s+ht|total\s+hors|exclusief/i.test(text)) return false;
  return /grand total|total due|amount due|balance due|total ttc|factuur totaal|total facture|somme à payer|total eur|\*\*\*\*\s*balance|^total\b|\btotal\b|^totaal\b|\btotaal\b/i.test(text);
}

function isSkipSummary(text) {
  if (/sub\s*total|subtotaal|total\s+ht|total\s+hors|exclusief|grondslag/i.test(text)) return true;
  if (/\b(shipping|freight|versand|discount|rabatt)\b/i.test(text)) return true;
  if (/\b(tva|vat|gst|mwst|btw)\b/i.test(text)) return true;
  if (/\btax\b/i.test(text)) return true;
  return false;
}

function isContinuation(prev, text) {
  const t = text.trim();
  if (!prev || !t) return false;
  if (/^(this is|description\s*:|notes\s*:)/i.test(t)) return false;
  if (/[,/&:-]\s*$/.test(prev)) return true;
  if (/^(parts|dienst|grundgeb)/i.test(t)) return true;
  if (/^\d{2}[./]\d{2}[./]\d{2,4}\s*[-–]\s*\d{2}[./]\d{2}[./]\d{2,4}$/.test(t)) return true;
  if (t.length <= 48 && !/^(page\b|invoice\b|factuur|facture|rechnung|subtotal|total|tax\b)/i.test(t)) return true;
  return false;
}

function parseQtyNumber(raw) {
  const s = String(raw).trim();
  if (/^\d{1,3}(?:[.,]\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/[.,](?=\d{3}\b)/g, ''));
  return Number(s.replace(',', '.'));
}

function qtyCandidates(line) {
  const out = [];
  for (const it of line.items || []) {
    const s = it.s.trim();
    if (/^\d+(?:[.,]\d+)?\s*%$/.test(s)) continue;
    const m = s.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:pcs|pc|st|stk|x|units?|kg|g|l))?$/i);
    if (!m) continue;
    const value = parseQtyNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    out.push({ value, x: it.x, raw: s });
  }
  return out;
}

function assignMoneys(moneys, cols) {
  const pairs = [];
  for (const money of moneys) {
    for (const key of ['amount', 'unit', 'tax', 'disc']) {
      const col = cols.find((c) => c.key === key);
      if (!col) continue;
      pairs.push({ money, key, d: Math.abs(money.x - col.x) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedM = new Set();
  const usedK = new Set();
  const out = {};
  for (const pair of pairs) {
    if (usedM.has(pair.money) || usedK.has(pair.key) || pair.d > 90) continue;
    usedM.add(pair.money);
    usedK.add(pair.key);
    out[pair.key] = pair.money;
  }
  return out;
}

function parseDataLine(line, cols) {
  const moneys = moneyItems(line);
  if (!moneys.length) return null;
  const assigned = cols.length ? assignMoneys(moneys, cols) : {};
  let amount = assigned.amount?.value ?? moneys[moneys.length - 1].value;
  let unit = assigned.unit?.value ?? null;
  if (unit == null && !cols.length && moneys.length >= 2) unit = moneys[moneys.length - 2].value;
  const usedX = new Set(Object.values(assigned).map((m) => m.x));
  if (!assigned.amount) usedX.add(moneys[moneys.length - 1].x);
  if (!assigned.unit && unit != null && moneys.length >= 2) usedX.add(moneys[moneys.length - 2].x);

  let discPct = null;
  const discCol = cols.find((c) => c.key === 'disc');
  if (discCol) {
    const token = qtyCandidates(line)
      .filter((q) => !usedX.has(q.x))
      .sort((a, b) => Math.abs(a.x - discCol.x) - Math.abs(b.x - discCol.x))[0];
    if (token && Math.abs(token.x - discCol.x) < 50) discPct = token.value;
    else if (assigned.disc) discPct = Math.abs(assigned.disc.value);
  }
  const taxAmt = assigned.tax ? assigned.tax.value : null;

  const qtyCol = cols.find((c) => c.key === 'qty');
  const qtyPool = qtyCandidates(line).filter((q) => !usedX.has(q.x) && q.x !== assigned.amount?.x && q.x !== assigned.unit?.x);
  let qty = null;
  if (qtyCol) {
    const hit = [...qtyPool].sort((a, b) => Math.abs(a.x - qtyCol.x) - Math.abs(b.x - qtyCol.x))[0];
    if (hit && Math.abs(hit.x - qtyCol.x) < 80) {
      qty = hit.value;
      usedX.add(hit.x);
    }
  } else {
    const bare = (line.items || []).map((it) => it.s.trim()).find((s) => /^\d+(?:\.\d+)?$/.test(s) && !isMoneyToken(s));
    if (bare != null) qty = Number(bare);
    else if (moneys.length >= 3 && isMoneyToken((line.items || [])[0]?.s?.trim?.() || '')) qty = moneys[0].value;
  }
  if (qty != null) {
    const qtyItem = (line.items || []).find((it) => Math.abs(it.x - (qtyCol?.x ?? it.x)) < 80 && new RegExp(`^${qty}(?:[.,]0+)?(?:\\s|$)`).test(it.s.trim()));
    if (qtyItem) usedX.add(qtyItem.x);
  }

  const description = (line.items || [])
    .filter((it) => !usedX.has(it.x))
    .map((it) => it.s.trim())
    .filter((s) => s && !isMoneyToken(s) && !/^\d+(?:[.,]\d+)?\s*%$/.test(s) && !/^(?:[$€£₹]|Rs\.?)$/i.test(s) && s !== String(qty))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { description, quantity: qty, unit_price: unit, amount, discPct, taxAmt };
}

function lineItems(lines) {
  const headerAt = lines.findIndex((l) => isTableHeader(l));
  if (headerAt < 0) return [];
  const cols = headerColumns(lines[headerAt]);
  const items = [];
  let pending = null;
  for (const line of lines.slice(headerAt + 1)) {
    if (isTableHeader(line)) continue;
    const text = line.text.trim();
    if (isStrongTotal(text)) break;
    if (isSkipSummary(text)) continue;
    const parsed = parseDataLine(line, cols);
    if (!parsed) {
      if (items.length && isContinuation(items[items.length - 1].description, text)) {
        items[items.length - 1].description = `${items[items.length - 1].description} ${text}`.replace(/\s+/g, ' ').trim();
        pending = null;
      } else if (text) pending = text;
      continue;
    }
    let description = parsed.description;
    if (!description && pending && !/^(this is|description\s*:|notes\s*:)/i.test(pending)) description = pending;
    pending = null;
    if (!description) continue;
    items.push({
      description,
      quantity: parsed.quantity,
      unit_price: parsed.unit_price,
      amount: parsed.amount,
      discPct: parsed.discPct,
      taxAmt: parsed.taxAmt,
    });
  }
  return items;
}

function detailSectionItems(lines) {
  const start = lines.findIndex((l) => /^detail$/i.test(l.text.trim()));
  if (start < 0) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.text.trim();
    if (/^(total\b|\*\s*may include|service provider|all charges)/i.test(text)) break;
    if (/^(charges|vat|credits|tax)\b/i.test(text)) continue;
    const moneys = moneyItems(line);
    if (moneys.length !== 1) continue;
    const description = (line.items || [])
      .map((it) => it.s.trim())
      .filter((s) => s && !isMoneyToken(s) && !/^(?:[$€£₹]|Rs\.?)$/i.test(s))
      .join(' ')
      .trim();
    if (!description) continue;
    items.push({ description, quantity: null, unit_price: null, amount: moneys[0].value, discPct: null, taxAmt: null });
  }
  return items;
}

function receiptItems(lines) {
  const end = lines.findIndex((l) => /\bsub\s*total\b|^subtotal\b/i.test(l.text));
  const slice = end < 0 ? lines : lines.slice(0, end);
  const items = [];
  let qtyHint = null;
  for (const line of slice) {
    const text = line.text.trim();
    if (!text) continue;
    if (/^\d+\s*@/.test(text) || (line.items || []).some((it) => it.s.trim() === '@')) {
      const q = text.match(/(\d+)\s*@/);
      qtyHint = q ? Number(q[1]) : qtyHint;
      continue;
    }
    if (/savings|discount|subtotal|tax\b|balance|visa|mastercard|auth\b|thank/i.test(text)) continue;
    const moneys = lineMoneys(line);
    if (moneys.length !== 1) continue;
    const description = text.replace(/(?:[$€£₹]|Rs\.?\s*)?-?\d[\d.,]*\s*(?:[$€£₹]|€)?\s*$/i, '').trim();
    if (!description || description.length < 2 || isDateToken(description)) continue;
    items.push({ description, quantity: qtyHint, unit_price: null, amount: moneys[0].value, discPct: null, taxAmt: null });
    qtyHint = null;
  }
  return items.filter((it) => !/^(?:reg\b|\d{1,2}[/.-]\d)/i.test(it.description));
}

function check(name, expected, actual) {
  if (expected == null || actual == null) return { name, status: 'incomplete', expected, actual, difference: null };
  const difference = round2(actual - expected);
  return { name, status: moneyEq(expected, actual) ? 'pass' : 'fail', expected, actual, difference };
}

function publicItem(it) {
  return {
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    amount: it.amount,
  };
}

export function analyzeCommercial(layer, type) {
  const lines = layer.lines;
  const text = layer.text || '';
  const order = inferDateOrder(text);
  let items = lineItems(lines);
  if (!items.length && type === 'receipt') items = receiptItems(lines);
  if (!items.length) items = detailSectionItems(lines);

  const table = btwBreakdown(lines);
  const facture = (() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!/total facture/i.test(lines[i].text)) continue;
      const moneys = lineMoneys(lines[i]);
      if (moneys.length >= 2) return moneys;
    }
    return null;
  })();

  let subtotal = scanAmount(lines, /exclusief/i, null, 'nearest');
  if (subtotal == null) subtotal = scanAmount(lines, /total\s+ht|total\s+hors/i, null, 'last');
  if (subtotal == null && table?.subtotal != null) subtotal = table.subtotal;
  if (subtotal == null) subtotal = scanAmount(lines, /\bsub\s*total\b|\bsubtotaal\b/i, /exclusief/i, 'last');
  if (subtotal == null && facture) subtotal = facture[0].value;

  let tax = table?.tax ?? null;
  if (tax == null) {
    tax = scanAmount(lines, /\b(?:sales\s+tax|tax|tva|vat|gst|mwst|btw)\b/i, /inclusief|inclus|exclusief|total|totaal|facture|factuur/i, 'last');
  }
  const discount = scanAmount(lines, /(?:^|\b)(?:contractor\s+)?(?:discount|rabatt)\b/i, null, 'last');
  let shipping = scanAmount(lines, /\b(?:shipping|freight|versand)\b/i, /ship\s*to/i, 'last');
  if (shipping != null) shipping = Math.abs(shipping);

  let total = scanAmount(lines, /grand total|total due|amount due|total ttc|factuur totaal|somme à payer|total eur|\*\*\*\*\s*balance|total facture/i, /sub\s*total|total\s+ht|balance due|change due/i, 'last');
  if (total == null) total = scanAmount(lines, /\btotaal\b/i, /sub/i, 'last');
  if (total == null) total = scanAmount(lines, /\btotal\b/i, /sub\s*total|total\s+ht|total\s+hors|exclusief|total facture|balance due|change due/i, 'last');
  if (total == null && table?.total != null) total = table.total;
  if (total == null) total = scanAmount(lines, /balance due|change due|amount remaining/i, /sub\s*total/i, 'last');

  if (subtotal == null && total != null && (tax == null || tax === 0) && discount == null && shipping == null) subtotal = total;

  const publicItems = items.map(publicItem);
  const lineSum = publicItems.length ? round2(publicItems.reduce((s, it) => s + it.amount, 0)) : null;
  const discountMag = discount == null ? 0 : Math.abs(discount);
  const expectedTotal = subtotal == null && total == null
    ? null
    : round2((subtotal ?? lineSum ?? 0) - discountMag + (shipping ?? 0) + (tax ?? 0));

  const lineMath = items
    .filter((it) => it.quantity != null && it.unit_price != null)
    .map((it) => {
      const expected = round2(it.quantity * it.unit_price * (1 - (it.discPct || 0) / 100) + (it.taxAmt || 0));
      return {
        description: it.description,
        expected,
        actual: it.amount,
        status: moneyEq(expected, it.amount) ? 'pass' : 'fail',
      };
    });
  const checks = [
    check('line_items_vs_subtotal', subtotal, lineSum),
    check('subtotal_tax_vs_total', total, expectedTotal),
  ];
  if (lineMath.length) {
    checks.push({
      name: 'quantity_times_price',
      status: lineMath.every((row) => row.status === 'pass') ? 'pass' : 'fail',
      lines: lineMath,
    });
  }
  const applicable = checks.filter((c) => c.status !== 'incomplete');
  let status = 'incomplete';
  if (applicable.length) status = applicable.every((c) => c.status === 'pass') ? 'pass' : 'fail';

  const party = parties(lines, type);
  const named = vendorName(lines, text);
  // Purchase orders print the buyer in the letterhead and the seller on a Vendor label.
  // Other documents keep the letterhead / ordered-through name; a label is only the fallback.
  let vendor = named || null;
  if (type === 'purchase_order' && party.vendorLabeled && party.vendorName) vendor = party.vendorName;
  else if (!vendor && party.vendorLabeled) vendor = party.vendorName;
  const number = type === 'purchase_order' ? poNumber(lines) : type === 'receipt' ? null : invoiceNumber(lines, text);
  const issuedDate = findIssued(lines, text, type, order);
  const dueDate = type === 'invoice' ? findDue(lines, text, order) : null;
  const currency = detectCurrency(text);

  const fields = {
    vendor_name: field(vendor, party.vendorLabeled ? 0.9 : 0.8, party.vendorLabeled ? 'label' : 'header'),
    buyer_name: field(party.buyerName, party.buyerSource === 'label' ? 0.85 : 0.7, party.buyerSource),
    ...(party.shipTo ? { ship_to: field(party.shipTo, 0.85, 'label') } : {}),
    currency: field(currency, currency ? 0.9 : 0.3, 'text'),
    ...(type === 'purchase_order'
      ? { po_number: field(number, 0.93, 'label'), po_date: field(issuedDate, 0.9, 'label') }
      : type === 'receipt'
        ? { merchant_name: field(vendor, 0.8, 'header'), date: field(issuedDate, 0.85, 'label') }
        : {
          invoice_number: field(number, 0.93, 'label'),
          invoice_date: field(issuedDate, 0.92, 'label'),
          due_date: field(dueDate, 0.92, 'label'),
        }),
    subtotal: field(subtotal, status === 'pass' ? 0.99 : 0.6, 'label'),
    tax: field(tax, status === 'pass' ? 0.99 : 0.6, 'label'),
    total: field(total, status === 'pass' ? 0.99 : 0.6, 'label'),
    line_item_count: field(publicItems.length, publicItems.length ? 0.9 : 0.3, 'table'),
  };

  if (!publicItems.length && total == null && subtotal == null) return { weak: true };

  return {
    fields,
    line_items: publicItems,
    checks: { status, checks },
    summary: {
      document_type: type,
      number,
      vendor,
      buyer: party.buyerName,
      total,
      subtotal,
      tax,
      currency,
      line_item_check: checks.find((c) => c.name === 'line_items_vs_subtotal')?.status ?? 'incomplete',
      total_check: checks.find((c) => c.name === 'subtotal_tax_vs_total')?.status ?? 'incomplete',
      status,
    },
  };
}
