import { accountHolder } from './holder.js';
import { isDateToken, parseDate, parsePeriod } from '../lib/dates.js';
import { findMoney, isMoneyToken, parseMoneyToken, round2 } from '../lib/money.js';

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
    if (next && /^(DR|CR)$/i.test(next.s.trim()) && next.x - (it.x + w) < 28) {
      s = `${s} ${next.s.trim()}`;
      w = next.x + (next.w || 0) - it.x;
    }
    if (!isMoneyToken(s)) continue;
    const parsed = parseMoneyToken(s);
    if (!parsed) continue;
    out.push({ x: it.x, w, s, parsed });
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
  if (/^date\b/i.test(t)) return 'date';
  if (/description|details|narrative|\bmemo\b|particular/i.test(t)) return 'description';
  if (/withdraw|debit|subtraction|money out/i.test(t)) return 'debit';
  if (/deposit|credit|addition|money in/i.test(t)) return 'credit';
  if (/ending daily|\bbalance\b/i.test(t)) return 'balance';
  if (/\bamount\b/i.test(t)) return 'amount';
  if (/^(check|number|num|no\.?|#)$/i.test(t)) return 'check';
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

function columnByRight(item, columns) {
  const right = item.x + (item.w || 0);
  let best = null;
  let bestDist = Infinity;
  for (const col of columns) {
    const dist = Math.abs(right - (col.x + (col.w || 0)));
    if (dist < bestDist) {
      bestDist = dist;
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
  const m = joined.match(/^([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:,?\s+\d{4})?)/);
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
  const positioned = moneyItems(line);
  if (positioned.length) return positioned.map((m) => m.parsed);
  return findMoney(line.text);
}

function isSummaryLine(line) {
  if (leadingDateToken(line)) return false;
  if (summaryAmounts(line).length !== 1) return false;
  const label = line.text.toLowerCase();
  return /(beginning|opening|previous|starting|prior|ending|closing|new|current) balance|total .*?\b(deposits|credits|withdrawals|debits|additions)\b|electronic withdrawals|deposits\s*\/\s*credits|withdrawals\s*\/\s*debits|deposits and (other )?(credits|additions)|withdrawals and (other )?debits|total (additions|subtractions)|service (charge|fee)|checks paid|other (withdrawals|debits)/.test(label);
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
  if (/\b(total|balance|summary|page|history|activity)\b/i.test(t)) return null;
  if (/^(deposits?( and (credits|additions))?|credits and deposits|additions)$/i.test(t)) return 'credit';
  if (/^(withdrawals?( and (debits|subtractions))?|debits|subtractions|other withdrawals|service charges?|fees|electronic withdrawals)$/i.test(t)) return 'debit';
  if (/^checks( paid)?$/i.test(t)) return 'checks';
  if (t.split(/\s+/).length <= 4 && /withdrawals?|debits?/i.test(t)) return 'debit';
  if (t.split(/\s+/).length <= 4 && /deposits?|credits?|additions?/i.test(t)) return 'credit';
  return null;
}

function printedTotals(lines) {
  const out = { opening: null, ending: null, credits: null, debits: null, fees: null, checks: null, other: null };
  for (const line of lines) {
    if (!isSummaryLine(line)) continue;
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
  const tagged = moneys.map((m) => ({ ...m, col: columns ? columnByRight(m, columns) : null }));
  let balance = null;
  let amount = null;
  let signSource = 'unsigned';
  const balanceItem = tagged.find((m) => m.col === 'balance');
  const debitItem = tagged.find((m) => m.col === 'debit');
  const creditItem = tagged.find((m) => m.col === 'credit');
  const amountItem = tagged.find((m) => m.col === 'amount');
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
  const m = text.match(/account(?:\s*(?:number|no\.?|#))?\s*[:#]?\s*([*Xx•.\-\s\d]{4,})/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function skipDescription(text) {
  return /^(beginning|opening|ending|closing|previous) balance$|balance forward|brought forward/i.test(text.trim());
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
      columns = header;
      continue;
    }
    const nextSection = sectionOf(line);
    if (nextSection) {
      section = nextSection;
      continue;
    }
    const moneys = moneyItems(line);
    const date = dateFromLine(line, columns, period);
    if (!date && open && moneys.length && open.amount == null && !isSummaryLine(line)) {
      const assigned = applySectionSign(assignAmounts(moneys, columns), section);
      open.amount = assigned.amount;
      open.balance = assigned.balance ?? open.balance;
      open.signSource = assigned.signSource;
      if (!open.description) open.description = descriptionOf(line, moneys);
      continue;
    }
    if (isSummaryLine(line)) continue;
    if (!date && open && !moneys.length) {
      const firstX = line.items[0]?.x ?? 0;
      const extra = line.text.trim();
      if (extra && firstX >= 70 && extra.length < 140 && line.page === open.page) {
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
