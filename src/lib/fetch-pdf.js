const DEFAULT_MAX = 16 * 1024 * 1024;

/**
 * Download one PDF and stop once it exceeds the size cap.
 * A declared Content-Length and a body that keeps going are both rejected.
 */
export async function fetchPdf(url, { maxBytes = DEFAULT_MAX, timeoutMs = 60_000 } = {}) {
  if (typeof url !== 'string' || url.length > 2048) throw new Error('URL is too long');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL must start with http(s)://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must start with http(s)://');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'user-agent': 'falcon-docs-actor/1.0' },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    await res.body?.cancel?.();
    throw new Error('File larger than 16 MB');
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('File larger than 16 MB');
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF file');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error('File larger than 16 MB');
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  const buf = Buffer.concat(chunks);
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF file');
  return buf;
}
