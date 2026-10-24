/** Pay-per-event names. Prices live in .actor/pricing.json: document $0.029, bank-statement $0.24. */

// A full bank-statement analysis is always billed as a statement, whatever the mode, so extract mode
// cannot return the $0.24 analysis for the $0.029 document price. Preview is free.
export function chargeEvent(mode, documentType) {
  if (mode === 'preview') return null;
  if (mode !== 'bank_statement' && mode !== 'extract') return null;
  return documentType === 'bank_statement' ? 'bank-statement' : 'document';
}

export function isBillable(result) {
  if (!result) return false;
  if (result.scanned || result.error || result.vision_error || result.vision_unavailable) return false;
  return true;
}
