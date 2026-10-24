/**
 * Frozen held-out PDFs. These are not the fixtures the parser was tuned on.
 * Run: node test/heldout/generate.js
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildStatement } from '../pdf-builder.js';

const outDir = new URL('./pdfs/', import.meta.url);

async function stamp(doc) {
  const when = new Date('2026-03-15T00:00:00Z');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  doc.setProducer('heldout-fixture');
  doc.setCreator('heldout-fixture');
}

async function invoiceDiscountQty() {
  const doc = await PDFDocument.create();
  await stamp(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text, x = 36, size = 11) => {
    page.drawText(text, { x, y, size, font });
    y -= 16;
  };
  line('PINE CONE SUPPLY', 36, 14);
  line('Invoice Number: INV-7781');
  line('Invoice Date: March 2, 2026');
  line('Due Date: April 1, 2026 Net 30');
  y -= 8;
  page.drawText('Description', { x: 36, y, size: 9, font });
  page.drawText('Qty', { x: 260, y, size: 9, font });
  page.drawText('Unit Price', { x: 320, y, size: 9, font });
  page.drawText('Amount', { x: 430, y, size: 9, font });
  y -= 16;
  for (const [desc, qty, price, amount] of [
    ['Cedar plank', '2.50', '10.00', '25.00'],
    ['Brass hinge', '3', '4.00', '12.00'],
  ]) {
    page.drawText(desc, { x: 36, y, size: 9, font });
    page.drawText(qty, { x: 260, y, size: 9, font });
    page.drawText(price, { x: 320, y, size: 9, font });
    page.drawText(amount, { x: 430, y, size: 9, font });
    y -= 14;
  }
  y -= 8;
  line('Subtotal 37.00', 36, 9);
  line('Discount (5.00)', 36, 9);
  line('Sales Tax 2.64 (8.25%)', 36, 9);
  line('Total 34.64', 36, 9);
  return Buffer.from(await doc.save());
}

async function sparse() {
  const doc = await PDFDocument.create();
  await stamp(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Quarterly notes for the file room copy only.', { x: 72, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}

function textBomb() {
  const lines = [];
  for (let i = 0; i < 6000; i += 1) {
    const y = 8000 - i * 3;
    lines.push(`BT /F1 6 Tf 36 ${y} Td (Row ${i} alpha) Tj ET`);
  }
  const stream = lines.join('\n');
  const objects = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n');
  objects.push(`4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += xref;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

const paymentCredit = {
  bank: 'Heldout National Bank',
  holder: 'ACME WIDGETS LLC',
  account: '7781',
  periodLabel: 'July 1, 2026 through July 31, 2026',
  opening: 500,
  layout: 'amount_only',
  rows: [
    { date: '2026-07-02', pdfDate: '07/02', cell: 'ACH PAYMENT FROM ACME', description: 'ACH PAYMENT FROM ACME', amount: 250, category: 'ach_customer_payment', trueRevenue: true },
    { date: '2026-07-03', pdfDate: '07/03', cell: 'CHECK 42', description: 'CHECK 42', amount: -40, category: 'check_paid', trueRevenue: false },
  ],
};

const duplicateDeposits = {
  bank: 'Heldout National Bank',
  holder: 'ACME WIDGETS LLC',
  account: '7781',
  periodLabel: 'July 1, 2026 through July 31, 2026',
  opening: 100,
  layout: 'amount_only',
  rows: [
    { date: '2026-07-02', pdfDate: '07/02', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 80, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-07-02', pdfDate: '07/02', cell: 'STRIPE TRANSFER', description: 'STRIPE TRANSFER', amount: 80, category: 'card_batch_deposit', trueRevenue: true },
    { date: '2026-07-04', pdfDate: '07/04', cell: 'CHECK 7', description: 'CHECK 7', amount: -20, category: 'check_paid', trueRevenue: false },
  ],
};

const zeroActivity = {
  bank: 'Heldout National Bank',
  holder: 'QUIET BOOKS LLC',
  account: '1001',
  periodLabel: 'September 1, 2026 through September 30, 2026',
  opening: 250,
  layout: 'combined',
  rows: [],
};

await mkdir(outDir, { recursive: true });
await writeFile(new URL('payment-credit.pdf', outDir), await buildStatement(paymentCredit));
await writeFile(new URL('duplicate-deposits.pdf', outDir), await buildStatement(duplicateDeposits));
await writeFile(new URL('zero-activity.pdf', outDir), await buildStatement(zeroActivity));
await writeFile(new URL('invoice-discount-qty.pdf', outDir), await invoiceDiscountQty());
await writeFile(new URL('sparse.pdf', outDir), await sparse());
await writeFile(new URL('malformed.pdf', outDir), Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('this is not a real pdf body '.repeat(30)),
]));
await writeFile(new URL('text-bomb.pdf', outDir), textBomb());
await copyFile('/tmp/encrypted.pdf', new URL('encrypted.pdf', outDir));
console.log('wrote held-out pdfs');
