# PDF Data Extractor: Invoices, Receipts, W-9 & Bank Statement Analyzer

Turn **PDF invoices, receipts, purchase orders, W-9s and bank statements** into structured JSON without templates or training. Each field has a **confidence score**, and the math is cross-checked: line items against the subtotal, subtotal plus tax against the total, and running balances on statements.

**Bank statement mode** returns every transaction, categorized, plus the numbers underwriters check: **average daily balance**, lowest balance, negative days, **NSF/overdraft count and fees**, **monthly revenue deposits**, deposit trend, **existing MCA and loan positions** with payment frequency, monthly debt service (DSCR inputs) and **integrity flags** (balances that don't reconcile, summary mismatches, edited-PDF metadata).

| Mode | Price |
|---|---|
| `extract`: any document, type auto-detected | **$0.03 per document** |
| `bank_statement`: transactions + underwriting metrics | **$0.25 per statement** (non-statements in the batch are billed as $0.03 documents) |
| `preview`: page 1 only | Free |

You're charged only for successful extractions. Failed downloads, non-PDFs and scanned image-only PDFs are not charged.

## Input
```json
{ "mode": "bank_statement", "pdfUrls": ["https://falcondocs.vercel.app/samples/bank-statement.pdf"] }
```

## Accuracy
100% field accuracy on a 20-document synthetic holdout set (exact match, amounts within $0.01). See https://falcondocs.vercel.app/accuracy. Real-world documents will score lower, so use the confidence scores to decide what to review.

## Limitations
Works on digital (text-layer) PDFs. Scanned or photographed PDFs are not supported yet.

Also available as a pay-per-call REST/MCP API with x402: https://falcondocs.vercel.app

Automated extraction: verify before relying on it. Not credit, legal or tax advice.
