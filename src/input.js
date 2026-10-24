const MODES = new Set(['extract', 'bank_statement', 'preview']);
const DOC_TYPES = new Set(['auto', 'invoice', 'receipt', 'purchase_order', 'w9', 'bank_statement', 'generic']);
const MAX_URLS = 500;
const MAX_URL_LENGTH = 2048;

export function isPrivateAddress(address) {
  let host = String(address || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);
  if (host.startsWith('::ffff:')) return isPrivateAddress(host.slice(7));
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((part) => part > 255)) return true;
    const [a, b] = n;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host === '::1' || host === '::') return true;
  if (host.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  return false;
}

export function blockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  return isPrivateAddress(host);
}

/** Syntax checks for a PDF URL. DNS and redirects are checked again at download time. */
export function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL must start with http(s)://');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('URL must start with http(s)://');
  if (url.username || url.password) throw new Error('URL must not include a password or userinfo credentials.');
  if (blockedHostname(url.hostname)) throw new Error('Host is not allowed. Private and link-local addresses are blocked.');
  return url;
}

export function normalizeInput(input = {}) {
  const mode = input.mode ?? 'extract';
  if (!MODES.has(mode)) throw new Error(`Unknown mode "${mode}". Use extract, bank_statement or preview.`);
  const documentType = input.documentType ?? 'auto';
  if (!DOC_TYPES.has(documentType)) throw new Error(`Unknown document type "${documentType}".`);
  let raw = input.pdfUrls ?? [];
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw)) throw new Error('pdfUrls must be a list of URLs.');
  if (raw.length > MAX_URLS) throw new Error(`Too many URLs. The limit is ${MAX_URLS}.`);
  const sources = [];
  const seen = new Set();
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry : entry?.url;
    if (!value) continue;
    if (value.length > MAX_URL_LENGTH) throw new Error('URL is too long.');
    assertPublicHttpUrl(value);
    if (seen.has(value)) continue;
    seen.add(value);
    sources.push(value);
  }
  if (!sources.length) throw new Error('Add at least one PDF URL in "pdfUrls".');
  return { mode, documentType, sources };
}
