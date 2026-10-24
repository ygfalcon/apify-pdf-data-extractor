import { lookup as dnsLookup } from 'node:dns/promises';
import { blockedHostname, isPrivateAddress } from '../input.js';

export const MAX_PDF_BYTES = 16 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function isLoopbackLiteral(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

async function defaultLookup(hostname) {
  return dnsLookup(hostname);
}

function addressesOf(result) {
  if (!result) return [];
  if (typeof result === 'string') return [result];
  if (Array.isArray(result)) return result.flatMap(addressesOf);
  if (typeof result.address === 'string') return [result.address];
  return [];
}

async function assertResolvable(url, lookup) {
  if (url.username || url.password) throw new Error('URL must not include a password or userinfo credentials.');
  if (blockedHostname(url.hostname)) throw new Error('Host is not allowed. Private and link-local addresses are blocked.');
  const resolved = await lookup(url.hostname);
  const addresses = addressesOf(resolved);
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address))) {
    throw new Error('Host is not allowed. Private and link-local addresses are blocked.');
  }
}

export async function readLimitedBody(response, { maxBytes = MAX_PDF_BYTES, timeoutMs = 60_000 } = {}) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('File larger than 16 MB');
  }
  if (!response.body) throw new Error('Empty download. Not charged.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Download timed out (timeout). Not charged.')), timeoutMs);
      });
      let next;
      try {
        next = await Promise.race([reader.read(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      const { done, value } = next;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('File larger than 16 MB');
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return Buffer.concat(chunks);
}

/**
 * Download one PDF and stop once it exceeds the size cap.
 * A declared Content-Length and a body that keeps going are both rejected.
 * Redirects are checked again so a public URL cannot hop onto a private address.
 * A direct loopback URL is allowed so a local test server can serve a fixture.
 */
export async function fetchPdf(url, {
  fetchImpl = globalThis.fetch,
  lookup = defaultLookup,
  maxBytes = MAX_PDF_BYTES,
  timeoutMs = 60_000,
  maxRedirects = 3,
} = {}) {
  if (typeof url !== 'string' || url.length > 2048) throw new Error('URL is too long');
  let current = url;
  let loopbackStart = false;
  try {
    loopbackStart = isLoopbackLiteral(new URL(url).hostname);
  } catch {
    throw new Error('URL must start with http(s)://');
  }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error('URL must start with http(s)://');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must start with http(s)://');
    const directLoopback = loopbackStart && isLoopbackLiteral(parsed.hostname);
    if (!directLoopback) await assertResolvable(parsed, lookup);
    let res;
    try {
      res = await fetchImpl(parsed.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'falcon-docs-actor/1.0' },
      });
    } catch (err) {
      const name = err?.name || '';
      if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(err?.message || '')) {
        throw new Error('Download timed out (timeout). Not charged.');
      }
      throw new Error('Download failed. Not charged.');
    }
    if (REDIRECTS.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect had no destination. Not charged.');
      if (hop === maxRedirects) throw new Error('Too many redirects. Not charged.');
      current = new URL(location, parsed).href;
      continue;
    }
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = await readLimitedBody(res, { maxBytes, timeoutMs });
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF file');
    return buf;
  }
  throw new Error('Too many redirects. Not charged.');
}
