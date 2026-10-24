# 📄 PDF Data Extractor: Invoices, W-9s & Bank Statements

**Drop in a PDF URL, get clean JSON back.** Invoices, receipts, purchase orders, W-9s and bank statements, with no templates to build and no OCR guesswork. Bank-statement mode goes further: every transaction categorized, a pass/fail reconciliation, true revenue, and MCA positions with missed and bounced payments, all for **$0.24 per statement**.

## 🎯 Who it's for
- **MCA, small-business and alternative lenders** who need underwriting numbers from bank statements in seconds instead of hand-keying them
- **Loan brokers and ISOs** pre-screening deals before sending them to funders
- **Bookkeepers, AP teams and accountants** turning invoices, receipts and W-9s into rows
- **Developers and AI agents** that need a cheap PDF-to-JSON step behind an API

## 🚀 Why this beats the alternatives
- ✅ **Reconciliation you can trust.** A statement passes when the printed summary totals match the extracted transactions. When a running balance is printed, every row has to match too. A mismatch tells you right away that the extraction or the document is off.
- 💰 **True revenue, computed for you.** Internal transfers, loan and MCA funding, cash advances, line-of-credit draws and reversed loan payments are stripped out.
- 🏦 **MCA stacking detection.** Positions are found from a named-lender list *and* from recurring equal debits (four or more), with monthly debt service, holdback, missed weekday pulls and bounced payments.
- 🗂️ **102 transaction categories** in groups such as revenue, payroll, financing in and out, and NSF fees.
- 🕵️ **Tamper flags.** Editing-software metadata, a file modified long after it was created, unusual font counts and many round-dollar deposits are flagged.
- 🧾 **Invoice math checks.** Quantity × unit price, line items vs. subtotal, and subtotal − discount + shipping + tax vs. total each come back `pass`, `fail` or `incomplete`.
- 🆓 **Pay only for results.** Failed downloads, non-PDFs, blank W-9s and scanned image-only PDFs cost nothing. Preview mode is free.
- ⚡ **Fast and text-layer native.** It reads the PDF's embedded text directly, with no OCR step to drift on fonts or image quality.

## ⚡ Quick start
1. Paste one or more public PDF URLs into **PDF URLs** (two samples are prefilled).
2. Pick a **Mode**: `extract` for any document, `bank_statement` for underwriting, or `preview` to test for free.
3. Click **Start**. Download the results as JSON, CSV or Excel, or pull them over the API.

```json
{ "mode": "bank_statement", "pdfUrls": ["https://falcondocs.vercel.app/samples/bank-statement.pdf"] }
```

## 📊 Sample output (real run on the prefilled sample statement)
This came from running the actor locally on the sample bank statement above. It is a fictional test document. The excerpt shows the `summary` and the first two of 64 transactions:

```json
{
  "document_type": "bank_statement",
  "reconciliation_status": "pass",
  "summary": {
    "bank_name": "Lakeshore Community Bank",
    "account_holder": "GOODWIN-JIMENEZ",
    "account_last4": "4413",
    "period_start": "2026-02-01",
    "period_end": "2026-02-28",
    "opening_balance": 18000.29,
    "closing_balance": 41549.07,
    "total_deposits": 52591.42,
    "total_withdrawals": 29042.64,
    "transaction_count": 64,
    "true_revenue": 52591.42,
    "average_daily_balance": 33719.34,
    "lowest_daily_balance": 18000.29,
    "negative_balance_days": 0,
    "nsf_count": 0,
    "reconciliation_status": "pass",
    "mca_position_count": 2,
    "mca_missed_payments": 0,
    "mca_bounced_payments": 0,
    "monthly_debt_service": 19272,
    "mca_holdback": 0.37,
    "tamper_flags": [],
    "integrity_flags": []
  },
  "transactions": [
    { "date": "2026-02-02", "description": "SQUARE INC DEPOSIT", "amount": 2873.36, "balance": 20873.65,
      "category": "card_batch_deposit", "category_group": "revenue", "true_revenue": true },
    { "date": "2026-02-02", "description": "ACH DEBIT CREDIBLY", "amount": -249, "balance": 20624.65,
      "category": "mca_payment", "category_group": "financing_out", "true_revenue": false, "funder": "Credibly" }
  ]
}
```

## 💵 Pricing, in plain English
| Mode | What you get | Price |
|---|---|---|
| `extract` | Any digital document, type auto-detected, structured fields | **$0.029 per document** (a bank statement gets the full analysis and is billed as a $0.24 statement) |
| `bank_statement` | All transactions + underwriting summary | **$0.24 per statement** (non-statements in the same batch are billed as $0.029 documents) |
| `preview` | Page 1 only | **Free** |

You're charged only for successful extractions. A bank statement is billed the $0.24 event only when opening + credits − debits equals the closing balance. A mismatch is returned with `reconciliation_status: fail` and is not charged. 100 bank statements that pass cost $24, and 1,000 invoices cost $29. Platform usage is included in the per-event price.

## 💡 Use cases
- MCA and business-loan underwriting: ADB, NSF count, true revenue, existing positions and holdback in one pass
- Spotting stacked MCAs and missed or bounced payments before funding
- Flagging edited or doctored statements for manual review
- Accounts payable automation: invoice, PO and receipt fields (vendor, buyer, ship-to, numbers, dates, totals) plus line items into your ERP or spreadsheet
- Vendor onboarding: pulling W-9 name, business name, tax classification, address and EIN (or SSN last 4) from fillable or flattened digital W-9s
- Feeding structured financial data to AI agents through the Apify API or MCP server

## 🔍 What's in a bank-statement result
- Bank, account holder (read from the page-1 header only, null when it isn't one clear name), last 4 digits, statement period
- Opening and closing balances, deposit and withdrawal totals
- **True revenue** with a breakdown of what was excluded
- Average daily balance, lowest balance, negative-balance days
- NSF, overdraft and returned-item count and fees
- **`reconciliation_status`**: `pass`, `fail` or `incomplete`. It is two checks: (1) the printed summary totals match the extracted transactions, and (2) each printed running balance equals the previous balance plus that row. The statement fails if either check fails. When the summary matches and the statement does not print a running balance, that sub-check stays `incomplete` and the statement still passes.
- MCA position count, missed and bounced payments, monthly debt service, holdback
- Tamper flags, plus integrity flags when reconciliation fails

For daily weekday MCA pulls, weekends don't count as missed days, but a skipped business day does. A returned debit within five days counts as a bounced payment and is linked to the nearest matching pull. Bounced amounts are removed from `total_paid` and from true revenue.

Layouts covered by the test fixtures: a single amount column with running balance (including multi-page and wrapped descriptions), split withdrawal/deposit columns, DR/CR, deposit/withdrawal sections, right-aligned columns and amount-only statements.

## 🆚 How it compares with Ocrolus, MoneyThumb and Heron
Those platforms OCR scanned documents, and Ocrolus also compares a PDF with aggregator data. This actor doesn't do either. On **digital** statements it returns the underwriting figures those tools are typically used for, pay-as-you-go with no contract.

| | Ocrolus | MoneyThumb | Heron | This actor (digital PDFs) |
|---|---|---|---|---|
| Summary reconciliation | PDF vs. bank data | Totals vs. start/end balance | Start ± amounts = end | Pass/fail on printed summary totals |
| Running balance | Analytics on rows | Reconciled balance chain | High-level check | Per-row pass/fail |
| True revenue | Revenue analytics | Strips non-true credits | Inflows minus transfers and financing | Credits minus transfers, loan/MCA proceeds and reversals |
| MCA | Lender lists | MCA deposits and repeats | Positions, holdback, missed | Lender list + unnamed recurring positions, missed and bounced |
| Scans | OCR | OCR | OCR | Unsupported, and not charged |

## ❓ FAQ
**Does it work on scanned or photographed PDFs?**
No. It reads the PDF's text layer and doesn't run OCR. Scanned files are skipped and you aren't charged. If you can select text in the PDF, it will work.

**Do I need to build a template for each bank?**
No. Layouts are detected automatically.

**How do I know an extraction is right?**
Check `reconciliation_status`. `pass` means every number ties out against the statement's own printed totals and balances. Invoices get the same kind of `checks` object.

**Can I call it from code or an AI agent?**
Yes. Use the Apify API, the JavaScript/Python clients, Zapier/Make or the Apify MCP server. Each PDF becomes one dataset item.

**Is my data stored?**
Results go to your own Apify dataset under your account's retention settings.

**Is this credit, legal or tax advice?**
No. It's automated extraction, so verify the output before relying on it.

---
*Keywords: PDF to JSON, bank statement parser, bank statement analyzer, MCA underwriting, true revenue calculator, invoice OCR alternative, invoice data extraction, receipt parser, W-9 extractor, purchase order extraction, transaction categorization, average daily balance, NSF detection, statement reconciliation.*
