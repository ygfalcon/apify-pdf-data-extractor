import { PDFDocument, StandardFonts } from 'pdf-lib';

export function money(n) {
  const sign = n < 0 ? '-' : '';
  const [dollars, cents] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function withBalances(opening, rows) {
  let balance = opening;
  return rows.map((row) => {
    balance = round2(balance + row.amount);
    return { ...row, balance };
  });
}

export function totals(rows) {
  const credits = round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const debits = round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  return { credits, debits };
}

function stamp(doc) {
  const when = new Date('2026-01-31T00:00:00Z');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  doc.setProducer('digital-statement-fixture');
  doc.setCreator('digital-statement-fixture');
}

async function document() {
  const doc = await PDFDocument.create();
  stamp(doc);
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

/**
 * Digital (text-layer) bank statement.
 * layout: combined | split | drcr | sectioned | amount_only
 * align: left | right (combined only)
 * corrupt: null | 'running' | 'ending'
 */
export async function buildStatement(spec) {
  const { doc, font } = await document();
  const rows = withBalances(spec.opening, spec.rows);
  const { credits, debits } = totals(rows);
  const ending = spec.corrupt === 'ending' ? round2(spec.opening + credits - debits + (spec.endingDelta ?? 50)) : round2(spec.opening + credits - debits);
  let page = doc.addPage([612, 792]);
  let y = 750;
  let onPage = 0;
  const align = spec.align || 'left';
  const layout = spec.layout || 'combined';

  const put = (text, x, size = 9) => {
    draw(page, font, text, x, y, size);
  };
  const putRight = (text, right, size = 9) => {
    drawRight(page, font, text, right, y, size);
  };

  put(spec.bank || 'Harbor National Bank', 36, 14);
  y -= 18;
  put(spec.holder || 'NORTHWIND SUPPLY LLC', 36);
  y -= 14;
  put('Business Checking Statement', 36);
  y -= 14;
  put(`Account Number: ****${spec.account || '4582'}`, 36);
  y -= 14;
  put(`Statement Period: ${spec.periodLabel || 'January 1, 2026 through January 31, 2026'}`, 36);
  y -= 18;
  put(`Beginning Balance ${money(spec.opening)}`, 36);
  y -= 12;
  put(`Deposits and Credits ${money(credits)}`, 36);
  y -= 12;
  put(`Withdrawals and Debits ${money(debits)}`, 36);
  y -= 12;
  put(`Ending Balance ${money(ending)}`, 36);
  y -= 20;

  function columns() {
    if (layout === 'split') {
      put('Date', 36); put('Description', 100); put('Withdrawals', 300); put('Deposits', 410); put('Balance', 510);
    } else if (layout === 'amount_only') {
      put('Date', 36); put('Description', 110); put('Amount', 430);
    } else if (align === 'right') {
      putRight('Date', 80); put('Description', 110); putRight('Amount', 460); putRight('Balance', 560);
    } else {
      put('Date', 36); put('Description', 110); put('Amount', 400); put('Balance', 500);
    }
    y -= 14;
  }

  function newPage() {
    page = doc.addPage([612, 792]);
    y = 750;
    put(spec.bank || 'Harbor National Bank', 36, 12);
    y -= 18;
    columns();
    onPage = 0;
  }

  if (layout !== 'sectioned') columns();

  let section = null;
  rows.forEach((row, index) => {
    if (y < 72) newPage();
    if (layout === 'sectioned' && row.section !== section) {
      section = row.section;
      y -= 8;
      put(section === 'debit' ? 'Withdrawals' : 'Deposits', 36);
      y -= 14;
      columns();
    }
    const printedBalance = spec.corrupt === 'running' && index === (spec.corruptIndex ?? 3)
      ? round2(row.balance + (spec.runningDelta ?? 10))
      : row.balance;
    const desc = row.cell || row.description;
    if (layout === 'split') {
      put(row.pdfDate, 36);
      put(desc, 100);
      if (row.amount < 0) put(money(Math.abs(row.amount)), 300);
      if (row.amount > 0) put(money(row.amount), 410);
      put(money(printedBalance), 510);
    } else if (layout === 'amount_only') {
      put(row.pdfDate, 36);
      put(desc, 110);
      put(money(row.amount), 430);
    } else if (layout === 'drcr') {
      put(row.pdfDate, 36);
      put(desc, 110);
      put(`${money(Math.abs(row.amount))} ${row.amount < 0 ? 'DR' : 'CR'}`, 390);
      put(money(printedBalance), 500);
    } else if (layout === 'sectioned') {
      put(row.pdfDate, 36);
      put(desc, 110);
      put(money(Math.abs(row.amount)), 400);
      put(money(printedBalance), 500);
    } else if (align === 'right') {
      putRight(row.pdfDate, 80);
      put(desc, 110);
      putRight(money(row.amount), 460);
      putRight(money(printedBalance), 560);
    } else {
      put(row.pdfDate, 36);
      put(desc, 110);
      put(money(row.amount), 400);
      put(money(printedBalance), 500);
    }
    y -= 12;
    for (const extra of row.continuation || []) {
      put(extra, 110);
      y -= 12;
    }
    onPage += 1;
    if (spec.pageBreakAfter && onPage >= spec.pageBreakAfter && index < rows.length - 1) newPage();
  });

  return Buffer.from(await doc.save());
}

export async function buildInvoice({ total = 45.36 } = {}) {
  const { doc, font } = await document();
  const page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text, x = 36, size = 11) => {
    draw(page, font, text, x, y, size);
    y -= 16;
  };
  line('Northwind Supply', 36, 14);
  line('Invoice Number: INV-1001');
  line('Invoice Date: February 1, 2026');
  line('Due Date: March 3, 2026');
  y -= 8;
  draw(page, font, 'Description', 36, y, 9);
  draw(page, font, 'Qty', 260, y, 9);
  draw(page, font, 'Unit Price', 320, y, 9);
  draw(page, font, 'Amount', 430, y, 9);
  y -= 16;
  const items = [
    ['Widget', '2', '10.00', '20.00'],
    ['Gasket', '4', '5.50', '22.00'],
  ];
  for (const [desc, qty, price, amount] of items) {
    draw(page, font, desc, 36, y, 9);
    draw(page, font, qty, 260, y, 9);
    draw(page, font, price, 320, y, 9);
    draw(page, font, amount, 430, y, 9);
    y -= 14;
  }
  y -= 8;
  line('Subtotal 42.00', 36, 9);
  line('Tax 3.36', 36, 9);
  line(`Total ${money(total)}`, 36, 9);
  return Buffer.from(await doc.save());
}

export async function buildScanned() {
  const { doc } = await document();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 48, y: 400, width: 240, height: 80, borderWidth: 1 });
  return Buffer.from(await doc.save());
}
