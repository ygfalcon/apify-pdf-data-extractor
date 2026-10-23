import { findMoney } from '../lib/money.js';

/**
 * Account holder from the page-1 header only.
 * Transaction rows (a leading date plus an amount, or anything below the column
 * header) are out of bounds. A header line that itself contains a date or an
 * amount is not a name. Null when the header does not contain exactly one
 * plausible name, or one explicitly labeled name.
 */

const ENTITY = /\b(?:LLC|L\.L\.C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LTD\.?|LIMITED|LLP|L\.L\.P\.?|PLLC|P\.C\.|PC|COMPANY|DBA)\b/i;
const BANKISH = /\b(?:bank|credit union|n\.a\.|trust company)\b/i;
const LABEL = /^(?:account\s+holder|account\s+name|customer(?:\s+name)?|member(?:\s+name)?|prepared\s+for)\s*[:\-]\s*(.+)$/i;
const BOILER = /\b(?:statement|summary|checking|savings|balance|balances|deposit|deposits|withdrawal|withdrawals|period|page|account|number|date|description|amount|amounts|total|totals|credit|credits|debit|debits|beginning|ending|opening|closing|available|ledger|activity|through|thru|fdic|routing)\b/i;
const JUNK = /\b(?:equal housing|customer service|www\.|https?:|telephone|phone|fax|e-mail|email)\b/i;
const EMBEDDED_DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?(?:\s+\d{4})?)\b/i;
const LEADING_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?(?:\s+\d{4})?)\b/i;
const NAME_TOKEN = /^[A-Za-z][A-Za-z'’.\-]*$/;
const ADDRESS = /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|suite|ste|apt|unit|p\.?o\.?\s*box)\b/i;

function clean(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+page\s+\d+(?:\s+of\s+\d+)?$/i, '')
    .trim();
}

function containsDate(text) {
  return EMBEDDED_DATE.test(text);
}

function containsAmount(text) {
  return findMoney(text).length > 0;
}

function isColumnHeader(text) {
  if (containsAmount(text) || containsDate(text)) return false;
  return /\bdate\b/i.test(text) && /\b(?:description|details|narrative|memo|amount|debit|credit|balance|withdrawal|deposit)\b/i.test(text);
}

function isTransactionStart(text) {
  return LEADING_DATE.test(text) && containsAmount(text);
}

function headerTexts(lines) {
  const out = [];
  for (const line of lines) {
    if (line.page && line.page !== 1) break;
    const text = clean(line.text);
    if (!text) continue;
    if (isColumnHeader(text) || isTransactionStart(text)) break;
    out.push(text);
  }
  return out;
}

function isBankLine(text, bankName) {
  if (bankName && text.toLowerCase() === clean(bankName).toLowerCase()) return true;
  return BANKISH.test(text) && !ENTITY.test(text);
}

function looksLikeName(text) {
  if (!text || text.length < 2 || text.length > 80) return false;
  if (JUNK.test(text) || ADDRESS.test(text)) return false;
  if (ENTITY.test(text)) {
    return /[A-Za-z]/.test(text) && text.split(/\s+/).length <= 8 && !/\b(?:statement|summary|page)\b/i.test(text);
  }
  if (/\d/.test(text) || BOILER.test(text)) return false;
  const tokens = text.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 6) return false;
  if (!tokens.every((tok) => NAME_TOKEN.test(tok))) return false;
  const hyphenated = tokens.some((tok) => tok.includes('-') && tok.replace(/-/g, '').length >= 4);
  if (tokens.length === 1 && !hyphenated) return false;
  return true;
}

function accept(text) {
  const name = clean(text);
  if (!name || containsDate(name) || containsAmount(name)) return null;
  if (!looksLikeName(name)) return null;
  return name;
}

export function accountHolder(lines, bankName = null) {
  const labeled = [];
  const unlabeled = [];
  for (const text of headerTexts(lines)) {
    if (isBankLine(text, bankName)) continue;
    if (containsDate(text) || containsAmount(text) || JUNK.test(text)) continue;
    const label = text.match(LABEL);
    if (label) {
      const name = accept(label[1]);
      if (name && !isBankLine(name, bankName)) labeled.push(name);
      continue;
    }
    const name = accept(text);
    if (name && !isBankLine(name, bankName)) unlabeled.push(name);
  }
  const labeledUnique = [...new Set(labeled)];
  if (labeledUnique.length === 1) return labeledUnique[0];
  if (labeledUnique.length > 1) return null;
  const unlabeledUnique = [...new Set(unlabeled)];
  if (unlabeledUnique.length === 1) return unlabeledUnique[0];
  return null;
}
