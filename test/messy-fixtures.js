/**
 * Synthetic digital PDFs with fictional parties. No real personal data.
 * Layouts are the awkward ones banks and vendors actually emit: short headers
 * with right-aligned amounts, a date and amounts packed into one text run,
 * daily-balance tables, and year-spanning periods.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildStatement } from './pdf-builder.js';

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function withBalances(opening, rows) {
  let balance = opening;
  return rows.map((row) => {
    balance = round2(balance + row.amount);
    return { ...row, balance };
  });
}

async function blank() {
  const doc = await PDFDocument.create();
  const when = new Date('2026-02-28T00:00:00Z');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  doc.setProducer('digital-statement-fixture');
  doc.setCreator('digital-statement-fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return { doc, font };
}

function draw(page, font, text, x, y, size = 9) {
  page.drawText(String(text), { x, y, size, font });
}

function drawRight(page, font, text, right, y, size = 9) {
  const width = font.widthOfTextAtSize(String(text), size);
  page.drawText(String(text), { x: right - width, y, size, font });
}

function money(n) {
  const sign = n < 0 ? '-' : '';
  const [dollars, cents] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export const SPLIT_ROWS = [
  { date: '2026-02-02', description: 'STRIPE TRANSFER ORIG ID 180000', amount: 1250, category: 'card_batch_deposit', trueRevenue: true, credit: 'USD 1,250.00' },
  { date: '2026-02-03', description: 'CHECK 2001', amount: -25, category: 'check_paid', trueRevenue: false, debit: '25.00' },
  { date: '2026-02-04', description: 'TRANSFER FROM CHECKING', amount: 100, category: 'internal_transfer_in', trueRevenue: false, credit: '100.00' },
  { date: '2026-02-05', description: 'NSF FEE', amount: -35, category: 'nsf_fee', trueRevenue: false, debit: '(35.00)' },
  { date: '2026-02-06', description: 'WIRE IN ONDECK CAPITAL FUNDING', amount: 8000, category: 'mca_proceeds', trueRevenue: false, credit: '8,000.00' },
  { date: '2026-02-09', description: 'MONTHLY SERVICE FEE', amount: -12, category: 'monthly_maintenance_fee', trueRevenue: false, debit: '12.00-' },
];

/** Short headers, wide columns, amounts right-aligned away from the header word. */
export async function buildWideSplit() {
  const { doc, font } = await blank();
  const opening = 4000;
  const rows = withBalances(opening, SPLIT_ROWS);
  const credits = round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const debits = round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  const ending = round2(opening + credits - debits);
  const debitRight = 370;
  const creditRight = 500;
  const balanceRight = 600;

  let page = doc.addPage([612, 792]);
  let y = 750;
  const put = (text, x, size = 9) => draw(page, font, text, x, y, size);
  const header = () => {
    put('Date', 36);
    put('Description', 90);
    put('Debit', 260);
    put('Credit', 400);
    put('Balance', 530);
    y -= 14;
  };

  put('Redwood Community Bank', 36, 14);
  y -= 16;
  put('NORTHWIND SUPPLY LLC', 36);
  y -= 12;
  put('100 Harbor Avenue', 36);
  y -= 12;
  put('Austin, TX 78701', 36);
  y -= 12;
  put('Business Checking Statement', 36);
  y -= 12;
  put('Account ending in 4582', 36);
  y -= 12;
  put('Statement Period: February 1, 2026 through February 28, 2026', 36);
  y -= 16;
  put(`Beginning Balance ${money(opening)}`, 36);
  y -= 12;
  put(`Deposits and Credits ${money(credits)}`, 36);
  y -= 12;
  put(`Withdrawals and Debits ${money(debits)}`, 36);
  y -= 12;
  put(`Service Charge ${money(12)}`, 36);
  y -= 12;
  put(`Ending Balance ${money(ending)}`, 36);
  y -= 18;
  header();

  put('02/01', 36);
  put('PREVIOUS STATEMENT BALANCE', 90);
  drawRight(page, font, money(opening), balanceRight, y);
  y -= 12;

  const stripe = rows[0];
  put('02/02', 36);
  put('STRIPE TRANSFER', 90);
  drawRight(page, font, stripe.credit, creditRight, y);
  drawRight(page, font, money(stripe.balance), balanceRight, y);
  y -= 12;

  page = doc.addPage([612, 792]);
  y = 750;
  put('Redwood Community Bank', 36, 12);
  y -= 14;
  put('Account Number: ****4582', 36);
  y -= 16;
  header();
  put('ORIG ID 180000', 36);
  y -= 12;

  for (const row of rows.slice(1)) {
    put(row.date.slice(5).replace('-', '/'), 36);
    put(row.description, 90);
    if (row.debit) drawRight(page, font, row.debit, debitRight, y);
    if (row.credit) drawRight(page, font, row.credit, creditRight, y);
    drawRight(page, font, money(row.balance), balanceRight, y);
    y -= 12;
  }

  y -= 8;
  put(`Total Deposits This Page ${money(credits)}`, 36);
  y -= 18;
  put('Daily Ending Balances', 36);
  y -= 14;
  put('Date', 36);
  put('Balance', 200);
  y -= 12;
  for (const [date, bal] of [['02/02', '9,999.00'], ['02/03', '8,888.00'], ['02/04', '7,777.00']]) {
    put(date, 36);
    put(bal, 200);
    y -= 12;
  }

  return Buffer.from(await doc.save());
}

export async function buildMonospace() {
  const { doc, font } = await blank();
  const page = doc.addPage([612, 792]);
  const lines = [
    'Relay National Bank',
    'NORTH STAR LLC',
    'Business Checking Statement',
    'Account Number: ****3331',
    'Statement Period: May 1, 2026 through May 5, 2026',
    'Beginning Balance 200.00',
    'Deposits and Credits 100.00',
    'Withdrawals and Debits 40.00',
    'Ending Balance 260.00',
    '',
    'Date        Description              Amount        Balance',
    '05/04       STRIPE TRANSFER          100.00        300.00',
    '05/05       CHECK 9                  -40.00        260.00',
  ];
  let y = 740;
  for (const line of lines) {
    if (line) draw(page, font, line, 36, y, 10);
    y -= 14;
  }
  return Buffer.from(await doc.save());
}

export async function buildYearSpan() {
  return buildStatement({
    bank: 'Harbor National Bank',
    holder: 'NORTHWIND SUPPLY LLC',
    account: '4582',
    periodLabel: 'December 28 – January 15, 2026',
    opening: 1000,
    layout: 'combined',
    rows: [
      { date: '2025-12-29', pdfDate: '12/29', cell: 'CASH DEPOSIT', description: 'CASH DEPOSIT', amount: 300, category: 'cash_deposit', trueRevenue: true },
      { date: '2026-01-05', pdfDate: '01/05', cell: 'CHECK 55', description: 'CHECK 55', amount: -10, category: 'check_paid', trueRevenue: false },
    ],
  });
}

export async function buildMessyInvoice() {
  const { doc, font } = await blank();
  const page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text, x = 48, size = 11) => {
    draw(page, font, text, x, y, size);
    y -= 16;
  };
  line('From: Harbor Goods LLC', 48, 13);
  line('Invoice Number: INV-88421');
  line('Invoice Date: March 4, 2026');
  line('Due Date: April 3, 2026');
  y -= 6;
  draw(page, font, 'Description', 48, y, 9);
  draw(page, font, 'Qty', 280, y, 9);
  draw(page, font, 'Unit Price', 360, y, 9);
  draw(page, font, 'Amount', 470, y, 9);
  y -= 16;
  draw(page, font, 'Widget assembly', 48, y, 9);
  draw(page, font, '2.00', 280, y, 9);
  draw(page, font, '10.00', 360, y, 9);
  draw(page, font, '20.00', 470, y, 9);
  y -= 14;
  draw(page, font, 'Gasket kit', 48, y, 9);
  draw(page, font, '1,000', 280, y, 9);
  draw(page, font, '0.02', 360, y, 9);
  draw(page, font, '20.00', 470, y, 9);
  y -= 20;
  line('Subtotal 40.00', 360, 10);
  line('Discount 2.00', 360, 10);
  line('Tax 3.04', 360, 10);
  line('Total 41.04', 360, 10);
  line('Payment 41.04', 360, 10);
  line('Balance Due 0.00', 360, 10);
  return Buffer.from(await doc.save());
}

export async function buildStackedReceipt() {
  const { doc, font } = await blank();
  const page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text, x = 48, size = 11) => {
    draw(page, font, text, x, y, size);
    y -= 15;
  };
  line('Northwind Cafe', 48, 14);
  line('RECEIPT');
  line('Receipt Number: R-100');
  line('Date: October 2, 2026');
  y -= 6;
  draw(page, font, 'Item', 48, y, 9);
  draw(page, font, 'Qty', 220, y, 9);
  draw(page, font, 'Price', 300, y, 9);
  draw(page, font, 'Amount', 400, y, 9);
  y -= 14;
  draw(page, font, 'Latte', 48, y, 9);
  draw(page, font, '1', 220, y, 9);
  draw(page, font, '4.50', 300, y, 9);
  draw(page, font, '4.50', 400, y, 9);
  y -= 13;
  draw(page, font, 'Muffin', 48, y, 9);
  draw(page, font, '2', 220, y, 9);
  draw(page, font, '3.25', 300, y, 9);
  draw(page, font, '6.50', 400, y, 9);
  y -= 18;
  line('Subtotal', 48, 11);
  line('11.00', 48, 11);
  line('Tax 0.88', 48, 11);
  line('Total', 48, 12);
  line('11.88', 48, 12);
  line('VISA', 48, 11);
  line('Change Due 0.00', 48, 11);
  return Buffer.from(await doc.save());
}

/** Flattened W-9 headings with the checkbox mark sitting well to the left of its label. */
export async function buildWideW9() {
  const { doc, font } = await blank();
  const page = doc.addPage([612, 792]);
  const rows = [
    [750, 'Form W-9', 36],
    [732, 'Request for Taxpayer Identification Number and Certification', 36],
    [700, '1 Name of entity/individual', 36],
    [682, 'Avery Sample', 48],
    [660, '2 Business name/disregarded entity name, if different from above.', 36],
    [642, 'Sample Goods LLC', 48],
    [610, '3a Check the appropriate box for federal tax classification', 36],
    [560, '5 Address (number, street, and apt. or suite no.)', 36],
    [542, '500 Market Street', 48],
    [520, '6 City, state, and ZIP code', 36],
    [502, 'Tampa, FL 33614', 48],
    [480, '7 List account number(s) here (optional)', 36],
    [440, 'Employer identification number', 36],
    [422, '12-3456789', 430],
  ];
  for (const [y, text, x] of rows) draw(page, font, text, x, y, 10);
  draw(page, font, 'Individual/sole proprietor', 36, 588, 9);
  draw(page, font, 'C corporation', 180, 588, 9);
  draw(page, font, 'X', 250, 588, 9);
  draw(page, font, 'S corporation', 290, 588, 9);
  return Buffer.from(await doc.save());
}

export function eachDay(start, end) {
  const out = [];
  const dt = new Date(`${start}T00:00:00Z`);
  const last = end;
  while (dt.toISOString().slice(0, 10) <= last) {
    out.push(dt.toISOString().slice(0, 10));
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return out;
}

export function expectedAdb(opening, rows, start, end) {
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, round2((byDate.get(row.date) || 0) + row.amount));
  let bal = opening;
  let sum = 0;
  const days = eachDay(start, end);
  for (const day of days) {
    bal = round2(bal + (byDate.get(day) || 0));
    sum += bal;
  }
  return round2(sum / days.length);
}
