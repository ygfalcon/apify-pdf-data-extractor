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

function summaryAmount(lines, re, skip) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = lines[i].text;
    if (skip && skip.test(text)) continue;
    if (!re.test(text)) continue;
    const positioned = moneyItems(lines[i]);
    const moneys = positioned.length ? positioned : findMoney(text);
    if (moneys.length) return moneys[moneys.length - 1].value;
  }
  return null;
}

function lineItems(lines) {
  const header = lines.findIndex((l) => /description|service|\bitems?\b|product/i.test(l.text) && /(qty|quantity|amount|price|rate)/i.test(l.text));
  if (header < 0) return [];
  const items = [];
  let pending = [];
  for (const line of lines.slice(header + 1)) {
    if (/sub\s*total|\btax\b|\bvat\b|\bgst\b|^total\b|amount due|balance due/i.test(line.text)) break;
    let moneys = moneyItems(line);
    if (!moneys.length) { pending.push(line.text.trim()); continue; }
    let qty = line.items.map((it) => it.s.trim()).find((s) => /^\d+(\.\d+)?$/.test(s) && !isMoneyToken(s));
    const first = line.items[0]?.s.trim();
    if (qty == null && moneys.length >= 3 && /^\d+(\.\d+)?$/.test(first) && moneys[0].x === line.items[0].x) {
      qty = first;
      moneys = moneys.slice(1);
    }
    let description = line.items
      .map((it) => it.s.trim())
      .filter((s) => s && !isMoneyToken(s) && s !== qty)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\d+(\.\d+)?%/g, '')
      .trim();
    if (!description && pending.length) description = pending[0];
    pending = [];
    const amount = moneys[moneys.length - 1].value;
    const unit = moneys.length > 1 ? moneys[moneys.length - 2].value : null;
    items.push({
      description,
      quantity: qty == null ? null : Number(qty),
      unit_price: unit,
      amount,
    });
  }
  return items;
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
  const total = summaryAmount(lines, /total due|amount due|balance due|\btotal\b/i, /sub\s*total/i);
  const lineSum = items.length ? round2(items.reduce((s, it) => s + it.amount, 0)) : null;
  const expectedTotal = subtotal == null && total == null
    ? null
    : round2((subtotal ?? lineSum ?? 0) - (discount ?? 0) + (tax ?? 0));

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

  const fromIdx = lines.slice(0, 12).findIndex((l) => /^(from|seller|vendor|supplier)\s*:?\s*$/i.test(l.items[0]?.s.trim() ?? ''));
  const headerText = (l) => (l?.items?.[0]?.s ?? l?.text ?? '').trim();
  const vendorLine = fromIdx >= 0
    ? { text: headerText(lines[fromIdx + 1]) }
    : (() => { const l = lines.slice(0, 4).find((x) => !/^(tax\s+)?(invoice|receipt|purchase order|bill to|sold to)\b/i.test(headerText(x)) && !/^[\d#]/.test(headerText(x))); return l ? { text: headerText(l) } : null; })();
  const number = labelValue(lines, type === 'purchase_order' ? /p\.?o\.?\s*(number|no\.?|#)/i : type === 'receipt' ? /receipt\s*(number|no\.?|#)/i : /invoice\s*(number|no\.?|#)/i);
  const issued = labelValue(lines, type === 'purchase_order' ? /p\.?o\.?\s*date|order date|^date\b/i : /invoice date|receipt date|^date\b/i);
  const issuedDate = issued ? parseDate(issued.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+\.? \d{4}/)?.[0] ?? issued) : null;
  const due = labelValue(lines, /due date|payment due/i);

  const fields = {
    vendor_name: field(vendorLine?.text?.trim() ?? null, 0.8, 'header'),
    ...(type === 'purchase_order'
      ? { po_number: field(number, 0.93, 'label'), po_date: field(issuedDate, 0.9, 'label') }
      : type === 'receipt'
        ? { merchant_name: field(vendorLine?.text?.trim() ?? null, 0.8, 'header'), date: field(issuedDate, 0.85, 'label') }
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
      total,
      subtotal,
      tax,
      line_item_check: checks.find((c) => c.name === 'line_items_vs_subtotal')?.status ?? 'incomplete',
      total_check: checks.find((c) => c.name === 'subtotal_tax_vs_total')?.status ?? 'incomplete',
      status,
    },
  };
}
