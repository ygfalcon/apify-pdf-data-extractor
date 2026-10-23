import { mkdirSync, writeFileSync } from 'node:fs';
import { AMOUNT_ONLY, DRCR, HARBOR, RIGHT_ALIGNED, SECTIONED, SPLIT } from './cases.js';
import { buildInvoice, buildScanned, buildStatement } from './pdf-builder.js';

const dir = new URL('./fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

const files = [
  ['harbor-combined.pdf', await buildStatement(HARBOR)],
  ['cedar-split-columns.pdf', await buildStatement(SPLIT)],
  ['pine-dr-cr.pdf', await buildStatement(DRCR)],
  ['lakeshore-sectioned.pdf', await buildStatement(SECTIONED)],
  ['relay-amount-only.pdf', await buildStatement(AMOUNT_ONLY)],
  ['summit-right-aligned.pdf', await buildStatement(RIGHT_ALIGNED)],
  ['harbor-running-balance-break.pdf', await buildStatement({ ...HARBOR, corrupt: 'running', pageBreakAfter: 0 })],
  ['harbor-summary-mismatch.pdf', await buildStatement({ ...HARBOR, corrupt: 'ending', pageBreakAfter: 0 })],
  ['invoice.pdf', await buildInvoice()],
  ['invoice-total-mismatch.pdf', await buildInvoice({ total: 50 })],
  ['scanned.pdf', await buildScanned()],
];

for (const [name, bytes] of files) writeFileSync(new URL(name, dir), bytes);
console.log(`wrote ${files.length} sample PDFs`);
