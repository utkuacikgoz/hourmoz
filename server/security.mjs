export class RequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function readJSON(request, maxBytes = 650000) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new RequestError('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Request body required.', 400);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RequestError('Request too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new RequestError('Invalid JSON.', 400); }
}
export async function limitRequest(request, database) {
  const path = new URL(request.url).pathname;
  const expensive = request.method === 'POST' && ['/api/scores', '/api/challenge'].includes(path);
  const bucket = Math.floor(Date.now() / 60000);
  // Cloudflare supplies this header. Never persist the raw network address.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bucket + ':' + ip));
  const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  for (const [scope, cap] of [[`global:${expensive ? 'verify' : 'api'}`, expensive ? 300 : 3000], [`${key}:${expensive ? 'verify' : 'api'}`, expensive ? 16 : 180]]) {
    const row = await database.prepare('INSERT INTO rate_limits (key, bucket, count) VALUES (?, ?, 1) ON CONFLICT(key, bucket) DO UPDATE SET count = count + 1 RETURNING count').bind(scope, bucket).first();
    if (row.count > cap) throw new RequestError('Too many requests. Try again in a minute.', 429);
  }
  await database.prepare('DELETE FROM rate_limits WHERE bucket < ?').bind(bucket - 2).run();
}
