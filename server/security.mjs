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

// Per-minute budgets. A client is one Cloudflare-supplied address. The client cap is checked
// first, so a client that is over its own cap never consumes the shared budget and one address
// cannot lock everyone else out. Bids and replay verification have their own counters.
const LIMITS = {
  api: {client: 180, global: 3000},
  verify: {client: 16, global: 300},
  bid: {client: 6, global: 60},
};
const VERIFY_PATHS = new Set(['/api/scores', '/api/challenge']);
let cleanedBucket = -1;

export function requestKind(request) {
  if (request.method !== 'POST') return 'api';
  const path = new URL(request.url).pathname;
  if (VERIFY_PATHS.has(path)) return 'verify';
  if (path === '/api/auction/bids') return 'bid';
  return 'api';
}

// Only a hash of the address is stored, keyed with RATE_LIMIT_SECRET when configured, and rows
// live for about three minutes. Never persist the raw network address.
async function clientKey(request, bucket, secret) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const data = new TextEncoder().encode(bucket + ':' + ip);
  let digest;
  if (secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    digest = await crypto.subtle.sign('HMAC', key, data);
  } else digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function count(database, key, bucket) {
  const row = await database.prepare('INSERT INTO rate_limits (key, bucket, count) VALUES (?, ?, 1) ON CONFLICT(key, bucket) DO UPDATE SET count = count + 1 RETURNING count').bind(key, bucket).first();
  return row.count;
}

export async function limitRequest(request, database, secret = null) {
  const kind = requestKind(request), limits = LIMITS[kind];
  const bucket = Math.floor(Date.now() / 60000);
  const client = await clientKey(request, bucket, secret);
  if (await count(database, `${client}:${kind}`, bucket) > limits.client) throw new RequestError('Too many requests. Try again in a minute.', 429);
  if (await count(database, `global:${kind}`, bucket) > limits.global) throw new RequestError('The game is busy. Try again in a minute.', 429);
  // Expired buckets are swept once per minute per isolate instead of on every request.
  if (cleanedBucket !== bucket) {
    cleanedBucket = bucket;
    await database.prepare('DELETE FROM rate_limits WHERE bucket < ?').bind(bucket - 2).run();
  }
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// Applied to every page and asset. The pages use no inline scripts or styles, so the policy can stay strict.
export function securityHeaders(url) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': CSP,
  };
  if (url.protocol === 'https:') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}
