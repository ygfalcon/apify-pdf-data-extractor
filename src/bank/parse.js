import { accountHolder } from './holder.js';
import { isDateToken, parseDate, parsePeriod } from '../lib/dates.js';
import { findMoney, isMoneyToken, parseMoneyToken, round2, stripMoney } from '../lib/money.js';

function visibleItems(line) {
  return line.items.filter((it) => it.s && it.s.trim());
}

function moneyItems(line) {
  const items = visibleItems(line);
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (/^(DR|CR)$/i.test(it.s.trim())) continue;
    let s = it.s.trim();
    let w = it.w || 0;
    const next = items[i + 1];
    if (next && next.s.trim() === '-' && next.x - (it.x + w) < 14) {
      s = `${s}-`;
      w = next.x + (next.w || 0) - it.x;
    }
    if (next && /^(DR|CR)$/i.test(next.s.trim()) && next.x - (it.x + w) < 80) {
      s = `${s} ${next.s.trim()}`;
      w = next.x + (next.w || 0) - it.x;
    }
    if (!isMoneyToken(s)) continue;
    const parsed = parseMoneyToken(s);
    if (!parsed) continue;
    out.push({ x: it.x, w, s, parsed });
  }
  if (out.length) return out;
  const text = line.text || '';
  if (!/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2})/.test(text.trim())) return out;
  for (const match of text.matchAll(/\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?\s*-?\*?(?:\s*(?:DR|CR))?|(?:USD\s*)\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?/gi)) {
    const parsed = parseMoneyToken(match[0]);
    if (!parsed) continue;
    out.push({ x: 1000 + match.index, w: match[0].length, s: match[0], parsed, synthetic: true });
  }
  return out;
}

function headerGroups(line) {
  const items = visibleItems(line);
  const groups = [];
  for (const it of items) {
    const prev = groups[groups.length - 1];
    const gap = prev ? it.x - (prev.x + prev.w) : Infinity;
    if (prev && gap < 14) {
      prev.text += ` ${it.s.trim()}`;
      prev.w = it.x + (it.w || 0) - prev.x;
    } else {
      groups.push({ x: it.x, w: it.w || 0, text: it.s.trim() });
    }
  }
  return groups;
}

function headerKey(text) {
  const t = text.trim();
  if (/\bdate\b/i.test(t) && !/\bdue\b/i.test(t)) return 'date';
  if (/description|details|narrative|\bmemo\b|particular/i.test(t)) return 'description';
  if (/withdraw|debit|subtraction|money out|paid out/i.test(t)) return 'debit';
  if (/deposit|credit|addition|money in|paid in/i.test(t)) return 'credit';
  if (/ending daily|\bbal(?:ance)?\b/i.test(t)) return 'balance';
  if (/\bamount\b/i.test(t)) return 'amount';
  if (/^(?:check|chk|cheque)(?:\s*(?:no\.?|number|num|#))?$/i.test(t)) return 'check';
  if (/^(?:number|num|no\.?|#)$/i.test(t)) return 'check';
  return null;
}

function detectHeader(line) {
  if (moneyItems(line).length) return null;
  const cols = [];
  for (const group of headerGroups(line)) {
    const key = headerKey(group.text);
    if (!key || cols.some((c) => c.key === key)) continue;
    cols.push({ key, x: group.x, w: group.w, text: group.text });
  }
  if (!cols.some((c) => c.key === 'date')) return null;
  if (!cols.some((c) => ['amount', 'debit', 'credit', 'balance'].includes(c.key))) return null;
  return cols;
}

function isDailyBalanceHeader(cols) {
  const keys = new Set(cols.map((c) => c.key));
  return keys.has('date') && keys.has('balance') && [...keys].every((key) => key === 'date' || key === 'balance');
}

/**
 * Put a number in the column it actually overlaps. Header words are often
 * short and left-aligned while the figures are right-aligned, so comparing
 * the figure to the header word's own right edge picks the next column.
 */
function columnFor(item, columns) {
  const sorted = [...columns].sort((a, b) => a.x - b.x);
  const left = item.x;
  const right = item.x + Math.max(item.w || 0, 1);
  let best = null;
  let bestOverlap = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const col = sorted[i];
    const next = sorted[i + 1];
    const slotLeft = col.x - 8;
    const slotRight = next ? next.x - 1 : col.x + Math.max(col.w || 0, 36) + 90;
    const overlap = Math.min(right, slotRight) - Math.max(left, slotLeft);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = col;
    }
  }
  return best?.key ?? null;
}

function leadingDateToken(line) {
  const items = visibleItems(line);
  if (!items.length) return null;
  const first = items[0].s.trim();
  if (isDateToken(first)) return first;
  const joined = items.slice(0, 3).map((it) => it.s.trim()).join(' ').replace(/\s+/g, ' ');
  const m = joined.match(/^([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/);
  if (m && isDateToken(m[1])) return m[1];
  return null;
}

function dateFromLine(line, columns, period) {
  const items = visibleItems(line);
  let token = null;
  if (columns?.some((c) => c.key === 'date')) {
    const dateCol = columns.find((c) => c.key === 'date');
    const dates = items.filter((it) => isDateToken(it.s.trim()));
    if (dates.length) {
      dates.sort((a, b) => Math.abs((a.x + a.w) - (dateCol.x + dateCol.w)) - Math.abs((b.x + b.w) - (dateCol.x + dateCol.w)));
      token = dates[0].s.trim();
    }
  }
  if (!token) token = leadingDateToken(line);
  if (!token) return null;
  return parseDate(token, period);
}

function summaryAmounts(line) {
  const positioned = moneyItems(line).filter((m) => !m.synthetic);
  if (positioned.length) return positioned.map((m) => m.parsed);
  return findMoney(line.text);
}

function isPageSubtotal(label) {
  return /this page|subtotal|year to date|\bytd\b|carried forward|balance forward/i.test(label);
}

function isSummaryLine(line) {
  if (leadingDateToken(line)) return false;
  if (summaryAmounts(line).length !== 1) return false;
  const label = line.text.toLowerCase();
  return /(beginning|opening|previous|starting|prior|ending|closing|new|current) balance|total .*?\b(deposits|credits|withdrawals|debits|additions)\b|electronic withdrawals|deposits\s*\/\s*credits|withdrawals\s*\/\s*debits|deposits and (other )?(credits|additions)|withdrawals and (other )?debits|total (additions|subtractions)|service (charge|fee)|checks paid|other (withdrawals|debits)|this page/.test(label);
}

function isBannerLine(line) {
  if (moneyItems(line).length || !leadingDateToken(line)) return false;
  const t = line.text;
  if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(t)) return true;
  return /\b(?:through|thru|to)\b/i.test(t) && (t.match(/\d{4}/g) || []).length >= 2;
}

function sectionOf(line) {
  if (moneyItems(line).length || findMoney(line.text).length || leadingDateToken(line)) return null;
  const t = line.text.trim();
  if (/^daily (ending )?balances?$/i.test(t)) return 'daily';
  if (/\b(total|balance|summary|page|history|activity)\b/i.test(t)) return null;
  if (/^(deposits?( and (credits|additions))?|credits and deposits|additions|money in|paid in)$/i.test(t)) return 'credit';
  if (/^(withdrawals?( and (debits|subtractions))?|debits|subtractions|other withdrawals|service charges?|fees|electronic withdrawals|money out|paid out)$/i.test(t)) return 'debit';
  if (/^checks( paid)?$/i.test(t)) return 'checks';
  if (t.split(/\s+/).length <= 4 && /withdrawals?|debits?/i.test(t)) return 'debit';
  if (t.split(/\s+/).length <= 4 && /deposits?|credits?|additions?/i.test(t)) return 'credit';
  return null;
}

function printedTotals(lines) {
  const out = { opening: null, ending: null, credits: null, debits: null, fees: null, checks: null, other: null };
  for (const line of lines) {
    if (!isSummaryLine(line) || isPageSubtotal(line.text)) continue;
    const value = summaryAmounts(line)[0].value;
    const label = line.text.toLowerCase();
    if (out.opening == null && /(beginning|opening|previous|starting|prior) balance/.test(label)) out.opening = value;
    else if (out.ending == null && /(ending|closing|new|current) balance/.test(label)) out.ending = value;
    else if (out.credits == null && /(total .*?\b(deposits|credits|additions)\b|deposits\s*\/\s*credits|deposits and (other )?(credits|additions)|total additions)/.test(label)) out.credits = Math.abs(value);
    else if (out.debits == null && /(total .*?\b(withdrawals|debits)\b|electronic withdrawals|withdrawals\s*\/\s*debits|withdrawals and (other )?debits|total subtractions)/.test(label)) out.debits = Math.abs(value);
    else if (out.fees == null && /service (charge|fee)|total fees/.test(label)) out.fees = Math.abs(value);
    else if (out.checks == null && /checks paid/.test(label)) out.checks = Math.abs(value);
    else if (out.other == null && /other (withdrawals|debits)/.test(label)) out.other = Math.abs(value);
  }
  if (out.debits == null) {
    const parts = [out.checks, out.other, out.fees].filter((v) => v != null);
    if (parts.length) out.debits = round2(parts.reduce((a, b) => a + b, 0));
  }
  return out;
}

function assignAmounts(moneys, columns) {
  const synthetic = moneys.length > 0 && moneys.every((m) => m.synthetic);
  const cols = synthetic ? null : columns;
  const tagged = moneys.map((m) => ({ ...m, col: cols ? columnFor(m, cols) : null }));
  let balance = null;
  let amount = null;
  let signSource = 'unsigned';
  const balanceItem = tagged.find((m) => m.col === 'balance');
  const debitItem = tagged.find((m) => m.col === 'debit');
  const creditItem = tagged.find((m) => m.col === 'credit');
  const amountItem = tagged.find((m) => m.col === 'amount');
  const onlyBalance = balanceItem && !debitItem && !creditItem && !amountItem
    && tagged.every((m) => m.col === 'balance');
  if (onlyBalance) return { amount: null, balance: balanceItem.parsed.value, signSource: 'unsigned' };
  if (balanceItem) balance = balanceItem.parsed.value;
  if (debitItem || creditItem) {
    const credit = creditItem ? Math.abs(creditItem.parsed.value) : 0;
    const debit = debitItem ? Math.abs(debitItem.parsed.value) : 0;
    amount = round2(credit - debit);
    signSource = 'column';
  } else if (amountItem) {
    amount = amountItem.parsed.value;
    signSource = amountItem.parsed.explicit ? 'explicit' : 'unsigned';
  } else if (tagged.length >= 2) {
    const sorted = [...tagged].sort((a, b) => a.x - b.x);
    const bal = sorted[sorted.length - 1];
    const amt = sorted[sorted.length - 2];
    balance = bal.parsed.value;
    amount = amt.parsed.value;
    signSource = amt.parsed.explicit ? 'explicit' : 'unsigned';
  } else if (tagged.length === 1) {
    amount = tagged[0].parsed.value;
    signSource = tagged[0].parsed.explicit ? 'explicit' : 'unsigned';
  }
  return { amount, balance, signSource };
}

function applySectionSign(assigned, section) {
  if (!assigned || assigned.amount == null || assigned.signSource !== 'unsigned') return assigned;
  if (section === 'debit' || section === 'checks') {
    return { ...assigned, amount: -Math.abs(assigned.amount), signSource: 'section' };
  }
  if (section === 'credit') {
    return { ...assigned, amount: Math.abs(assigned.amount), signSource: 'section' };
  }
  return assigned;
}

function descriptionOf(line, moneys) {
  if (moneys.some((m) => m.synthetic)) {
    const text = stripMoney(String(line.text || '').replace(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s+\d{4})?)\b/, ' '));
    return text.replace(/\s+/g, ' ').trim();
  }
  const moneyX = new Set(moneys.map((m) => m.x));
  const parts = [];
  for (const it of visibleItems(line)) {
    const s = it.s.trim();
    if (!s || /^(DR|CR)$/i.test(s)) continue;
    if (moneyX.has(it.x)) continue;
    if (isDateToken(s)) continue;
    parts.push(s);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function checkNumberOf(line, columns) {
  if (!columns?.some((c) => c.key === 'check')) return null;
  const col = columns.find((c) => c.key === 'check');
  const hit = visibleItems(line)
    .filter((it) => /^\d{3,6}$/.test(it.s.trim()))
    .sort((a, b) => Math.abs((a.x + a.w) - (col.x + col.w)) - Math.abs((b.x + b.w) - (col.x + col.w)))[0];
  return hit ? hit.s.trim() : null;
}

function identityOf(lines) {
  const top = lines.filter((l) => l.page === 1).slice(0, 18);
  let bank = null;
  for (const line of top) {
    const t = line.text.trim();
    if (!bank && /bank|credit union|n\.a\.|trust company/i.test(t) && !/statement|account|period|balance|number/i.test(t)) {
      bank = t;
    }
  }
  return { bank, holder: accountHolder(lines, bank) };
}

function accountLast4(text) {
  const patterns = [
    /account(?:\s*(?:number|no\.?|#))?\s*[:#]?\s*([*Xx•.\-\s\d]{4,})/i,
    /\bacct\.?\s*#?\s*[:#]?\s*([*Xx•.\-\s\d]{4,})/i,
    /(?:account|acct\.?)[^.\n]{0,40}?ending(?:\s+in)?\s+(\d{4})\b/i,
    /\bending in\s+(\d{4})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
  }
  return null;
}

function skipDescription(text) {
  return /^(?:beginning|opening|ending|closing|previous)(?:\s+statement)?\s+balance\b|balance forward|brought forward|carried forward/i.test(String(text || '').trim());
}

function isChrome(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^page \d+(\s+of\s+\d+)?$/i.test(t)) return true;
  if (/\baccount\s*(?:number|no\.?|#|num)\b/i.test(t)) return true;
  if (/\bstatement period\b/i.test(t)) return true;
  if (/^(?:business )?(?:checking|savings) statement\b/i.test(t)) return true;
  if (/\b(?:equal housing|member fdic|customer service|routing number)\b/i.test(t)) return true;
  if (/\b(?:bank|credit union|trust company)\b/i.test(t) && !/\b(?:card|fee|transfer|ach|wire|payment|deposit|debit|credit|purchase|pos)\b/i.test(t)) return true;
  return false;
}

function isSectionTitle(text) {
  return /^(?:daily (?:ending )?balances?|total\b|subtotal\b)/i.test(String(text || '').trim());
}

/**
 * Read transactions and the printed summary from a digital statement text layer.
 * Amounts keep a signSource so a later pass can use the running balance when the
 * statement prints an unsigned amount and no debit/credit column.
 */
export function parseStatement(layer) {
  const lines = layer.lines;
  const period = parsePeriod(lines);
  const printed = printedTotals(lines);
  const identity = identityOf(lines);
  const account = accountLast4(layer.text);
  const txns = [];
  let columns = null;
  let section = null;
  let skipping = false;
  let open = null;

  const pushOpen = () => {
    if (open && open.amount != null && open.date && !skipDescription(open.description)) txns.push(open);
    open = null;
  };

  for (const line of lines) {
    if (/^page \d+(\s+of\s+\d+)?$/i.test(line.text.trim())) continue;
    if (isBannerLine(line)) continue;
    const header = detectHeader(line);
    if (header) {
      if (isDailyBalanceHeader(header)) skipping = true;
      else {
        skipping = false;
        columns = header;
      }
      continue;
    }
    const nextSection = sectionOf(line);
    if (nextSection === 'daily') {
      skipping = true;
      continue;
    }
    if (nextSection) {
      skipping = false;
      section = nextSection;
      continue;
    }
    if (skipping) continue;
    const moneys = moneyItems(line);
    const date = dateFromLine(line, columns, period);
    if (!date && !moneys.length && isChrome(line.text)) continue;
    if (!date && open && moneys.length && open.amount == null && !isSummaryLine(line)) {
      const assigned = applySectionSign(assignAmounts(moneys, columns), section);
      open.amount = assigned.amount;
      open.balance = assigned.balance ?? open.balance;
      open.signSource = assigned.signSource;
      if (!open.description) open.description = descriptionOf(line, moneys);
      continue;
    }
    if (isSummaryLine(line)) continue;
    if (!date && open && !moneys.length && !isSectionTitle(line.text)) {
      const firstX = line.items[0]?.x ?? 0;
      const extra = line.text.trim();
      const near = line.page === open.page || line.page === open.page + 1;
      if (extra && firstX >= 30 && extra.length < 140 && near) {
        open.description = `${open.description} ${extra}`.replace(/\s+/g, ' ').trim();
      }
      continue;
    }
    if (!date) continue;
    pushOpen();
    const assigned = applySectionSign(assignAmounts(moneys, columns), section);
    open = {
      date,
      description: descriptionOf(line, moneys),
      amount: assigned.amount,
      balance: assigned.balance,
      signSource: assigned.signSource,
      page: line.page,
      check_number: checkNumberOf(line, columns),
    };
  }
  pushOpen();
  return { transactions: txns, printed, identity, account, period };
}
