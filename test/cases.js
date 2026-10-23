/** Shared digital-statement fixtures. Balances are derived from amounts. */

export const HARBOR = {
  bank: 'Harbor National Bank',
  holder: 'NORTHWIND SUPPLY LLC',
  account: '4582',
  periodLabel: 'January 1, 2026 through January 31, 2026',
  opening: 4000,
  layout: 'combined',
  pageBreakAfter: 4,
  rows: [
    { date: '2026-01-02', pdfDate: '01/02', cell: 'STRIPE TRANSFER', continuation: ['ORIG ID 180000'], description: 'STRIPE TRANSFER ORIG ID 180000', amount: 1250, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-01-05', pdfDate: '01/05', cell: 'TRANSFER FROM SAVINGS', description: 'TRANSFER FROM SAVINGS', amount: 500, category: 'savings_transfer_in', trueRevenue: false },
    { date: '2026-01-06', pdfDate: '01/06', cell: 'WIRE IN ONDECK CAPITAL FUNDING', description: 'WIRE IN ONDECK CAPITAL FUNDING', amount: 8000, category: 'mca_proceeds', trueRevenue: false },
    { date: '2026-01-07', pdfDate: '01/07', cell: 'CHECK 1042', description: 'CHECK 1042', amount: -85.4, category: 'check_paid', trueRevenue: false },
    { date: '2026-01-08', pdfDate: '01/08', cell: 'FORWARD FINANCING ACH', description: 'FORWARD FINANCING ACH', amount: -189, category: 'mca_payment', trueRevenue: false },
    { date: '2026-01-09', pdfDate: '01/09', cell: 'FORWARD FINANCING ACH', description: 'FORWARD FINANCING ACH', amount: -189, category: 'mca_payment', trueRevenue: false },
    { date: '2026-01-12', pdfDate: '01/12', cell: 'FORWARD FINANCING ACH', description: 'FORWARD FINANCING ACH', amount: -189, category: 'mca_payment', trueRevenue: false },
    { date: '2026-01-14', pdfDate: '01/14', cell: 'FORWARD FINANCING ACH', description: 'FORWARD FINANCING ACH', amount: -189, category: 'mca_payment', trueRevenue: false },
    { date: '2026-01-15', pdfDate: '01/15', cell: 'RETURNED ACH FORWARD FINANCING', description: 'RETURNED ACH FORWARD FINANCING', amount: 189, category: 'mca_payment_reversal', trueRevenue: false },
    { date: '2026-01-15', pdfDate: '01/15', cell: 'NSF FEE', description: 'NSF FEE', amount: -35, category: 'nsf_fee', trueRevenue: false },
    { date: '2026-01-16', pdfDate: '01/16', cell: 'ADP PAYROLL', description: 'ADP PAYROLL', amount: -2400, category: 'payroll_wages', trueRevenue: false },
  ],
};

export const SPLIT = {
  bank: 'Cedar Trust Company',
  holder: 'BRIGHT LOOM INC',
  account: '2290',
  periodLabel: 'February 1, 2026 through February 28, 2026',
  opening: 1000,
  layout: 'split',
  rows: [
    { date: '2026-02-02', pdfDate: '02/02', cell: 'ACH CREDIT ACME CO', description: 'ACH CREDIT ACME CO', amount: 400, category: 'ach_customer_payment', trueRevenue: true },
    { date: '2026-02-03', pdfDate: '02/03', cell: 'CHECK 2001', description: 'CHECK 2001', amount: -25, category: 'check_paid', trueRevenue: false },
    { date: '2026-02-04', pdfDate: '02/04', cell: 'TRANSFER FROM CHECKING', description: 'TRANSFER FROM CHECKING', amount: 100, category: 'internal_transfer_in', trueRevenue: false },
  ],
};

export const DRCR = {
  bank: 'Pine Credit Union',
  holder: 'HARBOR FISH LLC',
  account: '1008',
  periodLabel: 'March 1, 2026 through March 31, 2026',
  opening: 2500,
  layout: 'drcr',
  rows: [
    { date: '2026-03-02', pdfDate: '03/02', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 640, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-03-03', pdfDate: '03/03', cell: 'FORWARD FINANCING ACH', description: 'FORWARD FINANCING ACH', amount: -189, category: 'mca_payment', trueRevenue: false },
  ],
};

export const SECTIONED = {
  bank: 'Lakeshore Savings Bank',
  holder: 'MAPLE GOODS LLC',
  account: '7741',
  periodLabel: 'April 1, 2026 through April 30, 2026',
  opening: 900,
  layout: 'sectioned',
  rows: [
    { date: '2026-04-02', pdfDate: '04/02', section: 'credit', cell: 'CASH DEPOSIT', description: 'CASH DEPOSIT', amount: 300, category: 'cash_deposit', trueRevenue: true },
    { date: '2026-04-03', pdfDate: '04/03', section: 'credit', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 150, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-04-06', pdfDate: '04/06', section: 'debit', cell: 'RENT PAYMENT', description: 'RENT PAYMENT', amount: -900, category: 'rent', trueRevenue: false },
  ],
};

export const AMOUNT_ONLY = {
  bank: 'Relay National Bank',
  holder: 'NORTH STAR LLC',
  account: '3331',
  periodLabel: 'May 1, 2026 through May 31, 2026',
  opening: 200,
  layout: 'amount_only',
  rows: [
    { date: '2026-05-04', pdfDate: '05/04', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 100, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-05-05', pdfDate: '05/05', cell: 'CHECK 9', description: 'CHECK 9', amount: -40, category: 'check_paid', trueRevenue: false },
  ],
};

export const RIGHT_ALIGNED = {
  bank: 'Summit National Bank',
  holder: 'ALDER MILL LLC',
  account: '9090',
  periodLabel: 'June 1, 2026 through June 30, 2026',
  opening: 50,
  layout: 'combined',
  align: 'right',
  rows: [
    { date: '2026-06-01', pdfDate: '06/01', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 75.25, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-06-02', pdfDate: '06/02', cell: 'CHECK 55', description: 'CHECK 55', amount: -10, category: 'check_paid', trueRevenue: false },
  ],
};
