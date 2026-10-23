/** Classify a digital text layer. Scanned pages are rejected before this runs. */
export function classify(layer) {
  const text = layer.text.toLowerCase();
  const scores = { invoice: 0, receipt: 0, purchase_order: 0, w9: 0, bank_statement: 0, generic: 0.5 };
  if (/request for taxpayer|form w-9|\bw-9\b/.test(text) || /f1_01/.test(Object.keys(layer.fields || {}).join(' '))) scores.w9 += 5;
  if (/beginning balance|opening balance|ending balance|closing balance/.test(text)) scores.bank_statement += 4;
  if (/statement period|deposits and credits|withdrawals and debits/.test(text)) scores.bank_statement += 2;
  if (/account (number|summary)/.test(text) && /balance/.test(text)) scores.bank_statement += 1;
  if (/purchase order|\bpo number|\bp\.o\./.test(text)) scores.purchase_order += 4;
  if (/\binvoice\b/.test(text)) scores.invoice += 3;
  if (/bill to|due date|amount due|total due/.test(text)) scores.invoice += 1.5;
  if (/\b(visa|mastercard|amex|change due)\b/.test(text) && /\btotal\b/.test(text)) scores.receipt += 2.5;
  if (layer.lines.length < 50 && /\bsubtotal\b/.test(text) && !/\binvoice\b/.test(text) && scores.bank_statement < 3) scores.receipt += 1.5;
  const [type, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { type, confidence: Math.min(0.99, 0.5 + score / 10) };
}
