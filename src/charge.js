/** Pay-per-event names. Prices live in .actor/pricing.json and must stay 0.03 and 0.25. */

export function chargeEvent(mode, documentType) {
  if (mode === 'preview') return null;
  if (mode === 'bank_statement') return documentType === 'bank_statement' ? 'bank-statement' : 'document';
  if (mode === 'extract') return 'document';
  return null;
}

export function isBillable(result) {
  if (!result) return false;
  if (result.scanned || result.error || result.vision_error || result.vision_unavailable) return false;
  return true;
}
