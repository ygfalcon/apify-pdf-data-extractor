import { Actor, log } from 'apify';
import { chargeEvent, isBillable } from './extract.js';
import { extractIsolated } from './isolate.js';
import { fetchPdf } from './lib/fetch-pdf.js';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const mode = input.mode ?? 'extract';
if (!['extract', 'bank_statement', 'preview'].includes(mode)) await Actor.fail(`Unknown mode "${mode}". Use extract, bank_statement or preview.`);
const docType = input.documentType ?? 'auto';
const sources = [...new Set([...(input.pdfUrls ?? []).map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean)])];
if (!sources.length) await Actor.fail('Add at least one PDF URL in "pdfUrls".');

const dataset = await Actor.openDataset();
const stats = { mode, requested: sources.length, succeeded: 0, failed: 0, charged: 0, stoppedByBudget: false };

for (const url of sources) {
    if (stats.stoppedByBudget) break;
    try {
        const buf = await fetchPdf(url);
        const type = mode === 'bank_statement' ? 'auto' : docType;
        const r = await extractIsolated(buf, { mode: mode === 'preview' ? 'preview' : 'full', type: type === 'auto' ? undefined : type });
        if (!isBillable(r)) throw new Error(r.note || r.vision_error || r.error || 'Extraction failed');
        const item = { sourceUrl: url, ...r };
        const eventName = chargeEvent(mode, r.document_type);
        if (eventName) {
            const c = await Actor.charge({ eventName, count: 1 });
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
