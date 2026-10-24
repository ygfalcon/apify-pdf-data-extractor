import { Actor, log } from 'apify';
import { redactSecrets, settleDocument } from './billing.js';
import { extractIsolated } from './isolate.js';
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
        const r = await extractIsolated(buf, { mode: mode === 'preview' ? 'preview' : 'full', type: type === 'auto' ? undefined : type });
        const outcome = await settleDocument({
            result: r,
            sourceUrl: url,
            mode,
            pushData: (item) => dataset.pushData(item),
            charge: (args) => Actor.charge(args),
        });
        stats.charged += outcome.chargedCount ?? 0;
        if (outcome.eventChargeLimitReached && !(outcome.chargedCount > 0)) { stats.stoppedByBudget = true; break; }
        if (outcome.eventChargeLimitReached) stats.stoppedByBudget = true;
        const previewOk = mode === 'preview' && !r?.scanned && !r?.error;
        if (outcome.billable || previewOk) {
            stats.succeeded++;
            log.info(`OK ${redactSecrets(url)} -> ${r.document_type} (${r.pages} pages)`);
        } else {
            stats.failed++;
            log.info(redactSecrets(`Not charged ${url} -> ${r.document_type || r.error || 'empty'}`));
        }
    } catch (e) {
        stats.failed++;
        const message = redactSecrets(e instanceof Error ? e.message : String(e));
        log.warning(`Failed ${redactSecrets(url)}: ${message}`);
        await dataset.pushData({ sourceUrl: redactSecrets(url), error: message, charged: false });
    }
}
await Actor.setValue('SUMMARY', stats);
log.info(`Done: ${JSON.stringify(stats)}`);
await Actor.exit();
