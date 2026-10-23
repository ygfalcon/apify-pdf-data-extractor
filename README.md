# PDF Data Extractor: Invoices, Receipts, W-9 & Bank Statement Analyzer

Turn **digital PDF invoices, receipts, purchase orders, W-9s and bank statements** into structured JSON. Bank-statement mode is built for underwriting: every transaction, a **pass/fail reconciliation**, **true revenue**, a **102-category** taxonomy, and **MCA positions** that include missed and bounced payments.

| Mode | Price |
|---|---|
| `extract`: any document, type auto-detected | **$0.03 per document** |
| `bank_statement`: transactions + underwriting summary | **$0.25 per statement** (non-statements in the batch are billed as $0.03 documents) |
| `preview`: page 1 only | Free |

You're charged only for successful extractions. Failed downloads, non-PDFs and scanned image-only PDFs are not charged. Scanned PDFs stay unsupported on purpose: this actor reads the text layer and does not run OCR.

## Input
```json
{ "mode": "bank_statement", "pdfUrls": ["https://example.com/statement.pdf"] }
```

## Bank statement summary
Each statement item includes a `summary` block:

- bank, account holder, account last 4, period
- opening and closing balances, deposit and withdrawal totals
- **true revenue**: credits, excluding internal transfers, loan proceeds (MCA funding, cash advances, line-of-credit draws), and reversals of loan or MCA payments
- average daily balance, lowest balance, negative-balance days
- NSF / overdraft / returned-item count and fees
- **reconciliation_status**: `pass`, `fail`, or `incomplete`
- MCA position count, missed payments, bounced payments, monthly debt service, holdback
- tamper flags (editing-software metadata, modification long after creation, unusual font count, many round-dollar deposits) and integrity flags when reconciliation fails

`reconciliation` is two checks, and the statement passes only when both pass:

1. **Summary totals.** Printed opening, credits, debits, and ending foot, and the extracted transactions match those totals and the ending balance.
2. **Running balance.** Each printed balance equals the previous balance plus that row's amount, starting from the opening balance.

If the statement does not print a running balance, that check is `incomplete` and the statement cannot pass. `metrics.reconciled` is true only for `pass`.

## Transactions and MCA
Every transaction has `category`, `category_group`, and `true_revenue`. The category list is in `src/bank/taxonomy.js` (102 categories).

MCA and loan positions come from a lender list and from a recurring-payment pattern (four or more equal debits). For a daily weekday pull, weekends are not missed days; a skipped business day is. A returned or rejected debit within five days is a bounced payment and is linked to the nearest matching pull. Bounced amounts are taken out of `total_paid` and out of true revenue.

Layouts covered by the sample PDFs in `test/fixtures/`: single amount plus running balance (including a second page and a wrapped description), split withdrawal and deposit columns, DR/CR, deposit/withdrawal sections, right-aligned columns, and amount-only statements.

## Invoices
Invoice, receipt, and purchase-order items include line items and a `checks` object. Line math (`quantity × unit price`), the sum of line items against the subtotal, and subtotal − discount + tax against the total are each `pass`, `fail`, or `incomplete`.

## Where this sits relative to Ocrolus, MoneyThumb, and Heron
Those products OCR scans and, in Ocrolus's case, compare a PDF to aggregator data. This actor does not. On **digital** statements it reports the underwriting figures those products are used for:

| | Ocrolus | MoneyThumb | Heron | This actor (digital PDFs) |
|---|---|---|---|---|
| Summary reconciliation | PDF vs. bank data, severity-scored | Transaction totals vs. starting/ending balance | Starting balance ± amounts = ending balance | Pass/fail on printed summary totals |
| Running balance | Analytics on extracted rows | Reconciled balance chain | High-level balance check | Per-row pass/fail against the printed balance |
| True revenue | Revenue and counterparty analytics | Strips transfers, MCA, loans, and other non-true credits | Inflows minus transfers, refunds, chargebacks, and financing | Credits minus internal transfers, loan/MCA proceeds, and financing reversals |
| Categories | Lender, NSF, payroll, insurance, and related buckets | Repeating, transfer, debt, NSF | Large label set with analytics groups | 102 fixed categories with groups |
| MCA | Lender transaction lists | MCA deposits and repeating payments | Positions, holdback, missed payments | List plus unnamed recurring positions, missed dates, bounced payments |
| Tamper | Docs-to-digital mismatch score | Non-reconciled summary and fraud flags | Anomaly / data-quality checks | Metadata flags plus a failed reconciliation |
| Scans | OCR | OCR | OCR | Unsupported, not charged |

## Limitations
Works on digital (text-layer) PDFs. Scanned or photographed PDFs are not supported and are not charged. Automated extraction: verify before relying on it. Not credit, legal, or tax advice.
