/** Pay-per-event names. Prices live in .actor/pricing.json: document $0.029, bank-statement $0.24. */

// A full bank-statement analysis is always billed as a statement, whatever the mode, so extract mode
// cannot return the $0.24 analysis for the $0.029 document price. Preview is free.
export function chargeEvent(mode, documentType) {
  if (mode === 'preview') return null;
  if (mode !== 'bank_statement' && mode !== 'extract') return null;
  return documentType === 'bank_statement' ? 'bank-statement' : 'document';
}

function hasValue(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object' && 'value' in value) return hasValue(value.value);
  return false;
}

/**
 * A charge requires a real extraction. A bank statement is the $0.24 event only when
 * opening + credits − debits equals closing. Empty, failed, scanned, and unreconciled
 * parses are not billable. Preview is free.
 */
export function isBillable(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.scanned || result.error || result.vision_error || result.vision_unavailable) return false;
  if (result.weak || result.timed_out || result.blank || result.charged === false) return false;
  if (result.mode === 'preview' || result.summary?.preview) return false;
  if (result.document_type === 'bank_statement') {
    const status = result.reconciliation_status || result.reconciliation?.status || result.summary?.reconciliation_status;
    if (status !== 'pass') return false;
    const checks = result.reconciliation?.summary_totals?.checks;
    if (!Array.isArray(checks)) return false;
    return checks.some((check) => check.name === 'opening_plus_transactions_equals_ending' && check.status === 'pass');
  }
  if (Array.isArray(result.transactions) && result.transactions.length > 0) return true;
  if (Array.isArray(result.line_items) && result.line_items.length > 0) return true;
  if (result.summary?.total != null) return true;
  const fields = result.fields;
  if (fields && typeof fields === 'object' && Object.values(fields).some(hasValue)) return true;
  return false;
}
