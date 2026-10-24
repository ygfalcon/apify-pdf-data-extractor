import { parseDate } from '../lib/dates.js';
import { findMoney, isMoneyToken, moneyEq, parseMoneyToken, round2 } from '../lib/money.js';

function field(value, confidence, source) {
  if (value == null || value === '') return null;
  return { value, confidence, source };
}

function moneyItems(line) {
  const out = [];
  for (const it of line.items) {
    const s = it.s.trim();
    if (!isMoneyToken(s)) continue;
    const parsed = parseMoneyToken(s);
    if (parsed) out.push({ ...parsed, x: it.x });
  }
  return out;
}

const VENDOR_LABEL = /(from|seller|vendor|supplier|sold by|remit to)\b/i;
const BUYER_LABEL = /(to(?=\s*:)|bill(ed)? to|sold to|buyer|purchaser|customer|invoice to|ordered by)\b/i;
const SHIP_LABEL = /(ship(ped)? to|deliver(y)? to)\b/i;

function labelValue(lines, re) {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].text;
    const m = text.match(re);
    if (!m) continue;
    const after = text.slice((m.index ?? 0) + m[0].length).replace(/^[\s:#.-]+/, '').trim();
    if (after) return after.split(/\s{2,}/)[0].trim();
    const next = lines[i + 1]?.text?.trim();
    if (next) return next;
  }
  return null;
}

function lastMoney(line) {
  if (!line) return null;
  const positioned = moneyItems(line);
  const moneys = positioned.length ? positioned : findMoney(line.text);
  return moneys.length ? moneys[moneys.length - 1].value : null;
}

function amountBeside(lines, i) {
  const own = lastMoney(lines[i]);
  if (own != null) return own;
  const next = lines[i + 1];
  if (!next) return null;
  const letters = next.text.replace(/[\d,.$()\s*-]/g, '');
  if (/[A-Za-z]/.test(letters)) return null;
  return lastMoney(next);
}

function summaryAmount(lines, re, skip) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = lines[i].text;
    if (skip && skip.test(text)) continue;
    if (!re.test(text)) continue;
    const value = amountBeside(lines, i);
    if (value != null) return value;
  }
  return null;
}

function pickTotal(lines) {
  const totals = [];
  const balances = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].text;
    if (/sub\s*total/i.test(text)) continue;
    const value = amountBeside(lines, i);
    if (value == null) continue;
    if (/balance due|amount remaining|remaining balance|change due/i.test(text)) balances.push(value);
    else if (/total due|amount due|invoice total|grand total|(?:^|\s)total\b/i.test(text)) totals.push(value);
  }
  if (totals.length) return totals[totals.length - 1];
  return balances.length ? balances[balances.length - 1] : null;
}

function lineItems(lines) {
  const header = lines.findIndex((l) => /description|service|\bitems?\b|product/i.test(l.text) && /(qty|quantity|amount|price|rate)/i.test(l.text));
  if (header < 0) return [];
  const items = [];
  let pending = [];
  for (const line of lines.slice(header + 1)) {
    if (/sub\s*total|\btax\b|\bvat\b|\bgst\b|^total\b|amount due|balance due|\bdiscount\b/i.test(line.text)) break;
    let moneys = moneyItems(line);
    if (!moneys.length) {
      const text = line.text.trim();
      if (text) pending.push(text);
      continue;
    }
    const qtyToken = line.items.map((it) => it.s.trim()).find((s) => /^[\d,]+(?:\.\d+)?$/.test(s) && !isMoneyToken(s)) || null;
    let qty = qtyToken == null ? null : Number(qtyToken.replace(/,/g, ''));
    if (qty == null && moneys.length >= 3) {
      const q = moneys[0].value;
      const unit = moneys[moneys.length - 2].value;
      const amount = moneys[moneys.length - 1].value;
      if (q > 0 && q < 1_000_000 && moneyEq(round2(q * unit), amount)) {
        qty = q;
        moneys = moneys.slice(1);
      }
    }
    let description = line.items
      .map((it) => it.s.trim())
      .filter((s) => s && !isMoneyToken(s) && s !== qtyToken)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\d+(\.\d+)?%/g, '')
      .trim();
    if (!description && pending.length) description = pending.join(' ').replace(/\s+/g, ' ').trim();
    pending = [];
    const amount = moneys[moneys.length - 1].value;
    const unit = moneys.length > 1 ? moneys[moneys.length - 2].value : null;
    items.push({
      description,
      quantity: qty == null || !Number.isFinite(qty) ? null : qty,
      unit_price: unit,
      amount,
    });
  }
  return items;
}

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
  let vendorName = fromIdx >= 0 ? headerText(lines[fromIdx + 1]) || null : null;
  const labeledVendor = blockValue(lines, VENDOR_LABEL);
  if (!vendorName && labeledVendor) vendorName = labeledVendor;
  const headerIssuer = lines.slice(0, 4).map(headerText).find((text) => text && !/^(?:tax\s+)?(?:invoice|receipt|purchase order|bill to|sold to|vendor|ship to)\b/i.test(text) && !/^[\d#]/.test(text)) || null;
  if (!vendorName) vendorName = headerIssuer;
  const labeledBuyer = blockValue(lines, BUYER_LABEL);
  const shipTo = blockValue(lines, SHIP_LABEL);
  const buyerName = labeledBuyer
    ?? (type === 'purchase_order' && headerIssuer && headerIssuer !== vendorName ? headerIssuer : null);
  return {
    vendorName,
    vendorSource: fromIdx >= 0 || labeledVendor ? 'label' : 'header',
    buyerName,
    buyerSource: labeledBuyer ? 'label' : 'header',
    shipTo,
  };
}

function check(name, expected, actual) {
  if (expected == null || actual == null) return { name, status: 'incomplete', expected, actual, difference: null };
  const difference = round2(actual - expected);
  return { name, status: moneyEq(expected, actual) ? 'pass' : 'fail', expected, actual, difference };
}

export function analyzeCommercial(layer, type) {
  const lines = layer.lines;
  const items = lineItems(lines);
  const subtotal = summaryAmount(lines, /sub\s*total/i);
  const tax = summaryAmount(lines, /\b(sales\s+)?tax\b|\bvat\b|\bgst\b/i, /sub\s*total/i);
  const discount = summaryAmount(lines, /\bdiscount\b/i);
  const total = pickTotal(lines);
  const lineSum = items.length ? round2(items.reduce((s, it) => s + it.amount, 0)) : null;
  const discountMag = discount == null ? 0 : Math.abs(discount);
  const expectedTotal = subtotal == null && total == null
    ? null
    : round2((subtotal ?? lineSum ?? 0) - discountMag + (tax ?? 0));

  const lineMath = items.filter((it) => it.quantity != null && it.unit_price != null).map((it) => ({
    description: it.description,
    expected: round2(it.quantity * it.unit_price),
    actual: it.amount,
    status: moneyEq(it.quantity * it.unit_price, it.amount) ? 'pass' : 'fail',
  }));
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
  const number = labelValue(lines, type === 'purchase_order' ? /p\.?o\.?\s*(number|no\.?|#)/i : type === 'receipt' ? /receipt\s*(number|no\.?|#)/i : /invoice\s*(number|no\.?|#)/i);
  const issued = labelValue(lines, type === 'purchase_order' ? /p\.?o\.?\s*date|order date|^date\b/i : /invoice date|receipt date|^date\b/i);
  const issuedDate = issued ? parseDate(issued.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+\.? \d{4}/)?.[0] ?? issued) : null;
  const due = labelValue(lines, /due date|payment due/i);

  const fields = {
    vendor_name: field(party.vendorName, 0.8, party.vendorSource),
    buyer_name: field(party.buyerName, party.buyerSource === 'label' ? 0.85 : 0.7, party.buyerSource),
    ...(party.shipTo ? { ship_to: field(party.shipTo, 0.85, 'label') } : {}),
    ...(type === 'purchase_order'
      ? { po_number: field(number, 0.93, 'label'), po_date: field(issuedDate, 0.9, 'label') }
      : type === 'receipt'
        ? { merchant_name: field(party.vendorName, 0.8, party.vendorSource), date: field(issuedDate, 0.85, 'label') }
        : {
          invoice_number: field(number, 0.93, 'label'),
          invoice_date: field(issuedDate, 0.92, 'label'),
          due_date: field(due ? parseDate(due) : null, 0.92, 'label'),
        }),
    subtotal: field(subtotal, status === 'pass' ? 0.99 : 0.6, 'label'),
    tax: field(tax, status === 'pass' ? 0.99 : 0.6, 'label'),
    total: field(total, status === 'pass' ? 0.99 : 0.6, 'label'),
    line_item_count: field(items.length, items.length ? 0.9 : 0.3, 'table'),
  };

  if (!items.length && total == null && subtotal == null) return { weak: true };

  return {
    fields,
    line_items: items,
    checks: { status, checks },
    summary: {
      document_type: type,
      number,
      vendor: party.vendorName,
      buyer: party.buyerName,
      total,
      subtotal,
      tax,
      line_item_check: checks.find((c) => c.name === 'line_items_vs_subtotal')?.status ?? 'incomplete',
      total_check: checks.find((c) => c.name === 'subtotal_tax_vs_total')?.status ?? 'incomplete',
      status,
    },
  };
}
