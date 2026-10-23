import { Actor, log } from 'apify';
import { extractDocument } from './engine.js';

const EVENTS = { extract: 'document', bank_statement: 'bank-statement' };
const MAX = 4 * 1024 * 1024 * 4; // 16 MB per file on Apify

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const mode = input.mode ?? 'extract';
if (!['extract', 'bank_statement', 'preview'].includes(mode)) await Actor.fail(`Unknown mode "${mode}". Use extract, bank_statement or preview.`);
const docType = input.documentType ?? 'auto';
const sources = [...new Set([...(input.pdfUrls ?? []).map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean)])];
if (!sources.length) await Actor.fail('Add at least one PDF URL in "pdfUrls".');

const dataset = await Actor.openDataset();
const stats = { mode, requested: sources.length, succeeded: 0, failed: 0, charged: 0, stoppedByBudget: false };

async function fetchPdf(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http(s)://');
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'falcon-docs-actor/1.0' } });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX) throw new Error('File larger than 16 MB');
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF file');
    return buf;
}

for (const url of sources) {
    if (stats.stoppedByBudget) break;
    try {
        const buf = await fetchPdf(url);
        const type = mode === 'bank_statement' ? 'auto' : docType;
        const r = await extractDocument(buf, { mode: mode === 'preview' ? 'preview' : 'full', type: type === 'auto' ? undefined : type });
        if (r.vision_error || r.error) throw new Error(r.note || r.vision_error || r.error);
        const item = { sourceUrl: url, ...r };
        if (mode !== 'preview') {
            const c = await Actor.charge({ eventName: mode === 'bank_statement' && r.document_type !== 'bank_statement' ? 'document' : EVENTS[mode], count: 1 });
            stats.charged += c?.chargedCount ?? 0;
            if (c?.eventChargeLimitReached && !(c?.chargedCount > 0)) { stats.stoppedByBudget = true; break; }
            if (c?.eventChargeLimitReached) stats.stoppedByBudget = true;
        }
        await dataset.pushData(item);
        stats.succeeded++;
        log.info(`OK ${url} -> ${r.document_type} (${r.pages} pages)`);
    } catch (e) {
        stats.failed++;
        log.warning(`Failed ${url}: ${e.message}`);
        await dataset.pushData({ sourceUrl: url, error: e.message, charged: false });
    }
}
await Actor.setValue('SUMMARY', stats);
log.info(`Done: ${JSON.stringify(stats)}`);
await Actor.exit();
