/** Pay-per-event names. Prices live in .actor/pricing.json: document $0.029, bank-statement $0.24. */

// A full bank-statement analysis is always billed as a statement, whatever the mode, so extract mode
// cannot return the $0.24 analysis for the $0.029 document price. Preview is free.
export function chargeEvent(mode, documentType) {
  if (mode === 'preview') return null;
  if (mode !== 'bank_statement' && mode !== 'extract') return null;
  return documentType === 'bank_statement' ? 'bank-statement' : 'document';
}

function fieldPresent(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'object' && 'value' in value) return value.value != null && value.value !== '';
  return true;
}

function hasUsefulContent(result) {
  if (Array.isArray(result.transactions) && result.transactions.length > 0) return true;
  if (Array.isArray(result.line_items) && result.line_items.length > 0) return true;
  return Object.values(result.fields || {}).some(fieldPresent);
}

/**
 * Bank statements are the $0.24 event. Bill one only when opening + credits − debits
 * equals closing. Failed, empty, scanned, and unreconciled parses are not billable.
 */
export function isBillable(result) {
  if (!result) return false;
  if (result.scanned || result.error || result.vision_error || result.vision_unavailable || result.blank || result.timed_out) return false;
  if (result.mode === 'preview' || result.summary?.preview) return false;
  if (result.document_type === 'bank_statement') {
    const status = result.reconciliation_status || result.reconciliation?.status || result.summary?.reconciliation_status;
    if (status !== 'pass') return false;
    const checks = result.reconciliation?.summary_totals?.checks;
    if (!Array.isArray(checks)) return false;
    return checks.some((c) => c.name === 'opening_plus_transactions_equals_ending' && c.status === 'pass');
  }
  return hasUsefulContent(result);
}
