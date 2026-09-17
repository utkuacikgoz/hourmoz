import {RequestError} from './security.mjs';
// Owner identity comes only from the Cloudflare Access runtime context. Client-supplied headers
// are never trusted, and any missing piece of configuration fails closed.
export async function isOwner(request, env, ctx) {
  if (!env?.AUCTION_OWNER_EMAIL || !env.CF_ACCESS_AUD) return false;
  const access = ctx?.access;
  if (!access || access.aud !== env.CF_ACCESS_AUD) return false;
  let email;
  try { email = (await access.getIdentity())?.email; } catch { return false; }
  return typeof email === 'string' && email.toLowerCase() === env.AUCTION_OWNER_EMAIL.toLowerCase();
}
export async function requireOwner(request, env, ctx) { if (!await isOwner(request, env, ctx)) throw new RequestError('Owner sign-in required.', 403); }
