import { moneyEq, round2 } from '../lib/money.js';

/**
 * Pass/fail reconciliation against the statement summary and the running balance.
 * status is fail when either check fails. A summary that matches passes even when
 * the statement prints no running balance (that sub-check stays incomplete).
 */
export function reconcile({ opening, ending, printedCredits, printedDebits, transactions }) {
  const credits = round2(transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)) ?? 0;
  const debits = round2(transactions.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0)) ?? 0;
  const netEnding = opening == null ? null : round2(opening + credits - debits);

  const summaryChecks = [];
  if (opening != null && ending != null && printedCredits != null && printedDebits != null) {
    const expected = round2(opening + printedCredits - printedDebits);
    summaryChecks.push({
      name: 'printed_summary_foots',
      status: moneyEq(expected, ending) ? 'pass' : 'fail',
      expected,
      actual: ending,
      difference: round2(expected - ending),
    });
  }
  if (printedCredits != null) {
    summaryChecks.push({
      name: 'credits_match_transactions',
      status: moneyEq(credits, printedCredits) ? 'pass' : 'fail',
      expected: printedCredits,
      actual: credits,
      difference: round2(credits - printedCredits),
    });
  }
  if (printedDebits != null) {
    summaryChecks.push({
      name: 'debits_match_transactions',
      status: moneyEq(debits, printedDebits) ? 'pass' : 'fail',
      expected: printedDebits,
      actual: debits,
      difference: round2(debits - printedDebits),
    });
  }
  if (opening != null && ending != null) {
    summaryChecks.push({
      name: 'opening_plus_transactions_equals_ending',
      status: moneyEq(netEnding, ending) ? 'pass' : 'fail',
      expected: ending,
      actual: netEnding,
      difference: round2((netEnding ?? 0) - ending),
    });
  }

  let summaryStatus = 'incomplete';
  if (summaryChecks.length) summaryStatus = summaryChecks.every((c) => c.status === 'pass') ? 'pass' : 'fail';

  const breaks = [];
  let runningStatus = 'incomplete';
  const withBalance = transactions.filter((t) => t.balance != null);
  if (opening != null && transactions.length > 0 && withBalance.length === transactions.length) {
    let prev = opening;
    transactions.forEach((t, index) => {
      const expected = round2(prev + t.amount);
      if (!moneyEq(expected, t.balance)) {
        breaks.push({
          index,
          date: t.date,
          description: t.description,
          previous: prev,
          amount: t.amount,
          expected,
          actual: t.balance,
          difference: round2(t.balance - expected),
        });
      }
      prev = t.balance;
    });
    runningStatus = breaks.length ? 'fail' : 'pass';
  }

  // A clean pass requires opening + credits − debits = closing. Matching a printed
  // credit total alone is not enough, and that statement must not be billed as clean.
  // A missing running balance stays incomplete on its own check and can still pass here.
  const equation = summaryChecks.find((c) => c.name === 'opening_plus_transactions_equals_ending');
  let status = 'incomplete';
  if (summaryStatus === 'fail' || runningStatus === 'fail') status = 'fail';
  else if (summaryStatus === 'pass' && equation?.status === 'pass') status = 'pass';

  return {
    status,
    summary_totals: {
      status: summaryStatus,
      opening_balance: opening,
      ending_balance: ending,
      printed_credits: printedCredits,
      printed_debits: printedDebits,
      transaction_credits: credits,
      transaction_debits: debits,
      expected_ending: netEnding,
      checks: summaryChecks,
    },
    running_balance: {
      status: runningStatus,
      break_count: breaks.length,
      breaks: breaks.slice(0, 25),
    },
  };
}
