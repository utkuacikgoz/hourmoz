import {RequestError} from './security.mjs';
const fail = (message, status = 400) => {
  throw new RequestError(message, status);
};
const DAY = 86400000,
  OPENING_BID = 400,
  STEP = 100,
  MAX_BID = 1000000;
// A bid competes for the spot only while it is paid, shown, and neither refunded nor disputed.
const ACTIVE = "status = 'paid' AND hidden = 0 AND paid_at IS NOT NULL";
function appOrigin(env) {
  try {
    const u = new URL(env.APP_ORIGIN);
    if (u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash)
      return u.origin;
  } catch {}
  fail('Payment return address is not configured.', 503);
}
export const paymentsEnabled = env =>
  !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET && !!env.AUCTION_OWNER_EMAIL;
export const testMode = env => (env.STRIPE_SECRET_KEY?.includes('_test_') ? 1 : 0);
export {isOwner, requireOwner} from './identity.mjs';
async function highBid(db, testing = 0) {
  return db
    .prepare(
      `SELECT id, name, url, amount FROM sponsor_bids WHERE ${ACTIVE} AND test_mode = ? ORDER BY amount DESC, paid_at ASC LIMIT 1`,
    )
    .bind(testing)
    .first();
}
const minimumBid = high => (high?.amount ?? OPENING_BID) + STEP;
export async function paidSponsor(db, testing = 0) {
  const bid = await highBid(db, testing);
  return bid ? {id: bid.id, name: bid.name, url: bid.url, amount: bid.amount} : null;
}
export async function publicAuction(db, enabled, testing = 0) {
  const sponsor = await paidSponsor(db, testing);
  const history = await db
    .prepare(
      `SELECT name, amount, paid_at AS paidAt FROM sponsor_bids WHERE ${ACTIVE} AND test_mode = ? ORDER BY amount DESC LIMIT 20`,
    )
    .bind(testing)
    .all();
  return {
    enabled,
    testMode: !!testing,
    minimum: minimumBid(sponsor),
    highest: sponsor?.amount ?? 0,
    sponsor,
    bids: history.results,
  };
}
export async function stripe(env, path, params = null, key = null) {
  const headers = {Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Stripe-Version': '2024-06-20'};
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: params ? 'POST' : 'GET',
    headers,
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) fail('Payment service unavailable. Try again.', 503);
  return r.json();
}
export async function submitBid(db, env, data, player) {
  if (!paymentsEnabled(env)) fail('Payments are not connected yet.', 503);
  if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) fail('Invalid bid.');
  let bid = await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(data.id).first();
  if (bid && bid.player_id !== player) fail('Invalid bid.', 409);
  if (!bid) {
    const name = typeof data.name === 'string' ? data.name.normalize('NFKC').trim() : '';
    if (!/^[\p{L}\p{N} .&'!_-]{2,60}$/u.test(name))
      fail('Use a sponsor name of 2–60 letters, numbers or simple punctuation.');
    let url;
    try {
      url = new URL(data.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.href.length > 500 ||
        !url.hostname.includes('.') ||
        url.hostname.endsWith('.local') ||
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
      )
        throw new Error();
    } catch {
      fail('Enter a public HTTPS website address.');
    }
    if (data.accepted !== true) fail('Accept the sponsorship terms first.');
    const minimum = minimumBid(await highBid(db, testMode(env)));
    if (minimum > MAX_BID) fail('The sponsor spot has reached its maximum price.', 409);
    if (!Number.isSafeInteger(data.amount) || data.amount < minimum || data.amount % 100 !== 0 || data.amount > MAX_BID)
      fail(`Bid at least $${minimum / 100} USD, in whole dollars (maximum $${MAX_BID / 100}).`, 409);
    const now = Date.now();
    const recent = await db
      .prepare('SELECT COUNT(*) AS count FROM sponsor_bids WHERE player_id = ? AND created_at > ?')
      .bind(player, now - 3600000)
      .first();
    if (recent.count >= 10) fail('Too many payment attempts. Try again in an hour.', 429);
    // Stripe expires unpaid checkouts after a day; abandoned attempts are pruned after thirty.
    await db.batch([
      db
        .prepare("DELETE FROM sponsor_bids WHERE status IN ('checkout', 'expired') AND created_at < ?")
        .bind(now - 30 * DAY),
      db
        .prepare(
          'INSERT INTO sponsor_bids (id, player_id, name, url, amount, created_at, test_mode) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        )
        .bind(data.id, player, name, url.href, data.amount, now, testMode(env)),
    ]);
    bid = await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(data.id).first();
    if (bid.player_id !== player) fail('Invalid bid.', 409);
  }
  if (bid.test_mode !== testMode(env)) fail('Start a payment in the current environment.', 409);
  if (bid.status === 'expired' || Date.now() - bid.created_at > DAY)
    fail('Payment attempt expired. Start a new bid.', 409);
  if (bid.status !== 'checkout') fail('This payment was already processed.', 409);
  const ORIGIN = appOrigin(env);
  const params = {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(bid.amount),
    'line_items[0][price_data][product_data][name]': 'Is Hormuz Open? — sponsor until outbid',
    'line_items[0][quantity]': '1',
    'metadata[bid_id]': bid.id,
    'payment_intent_data[metadata][bid_id]': bid.id,
    client_reference_id: bid.id,
    success_url: ORIGIN + '/sponsor?payment=' + bid.id,
    cancel_url: ORIGIN + '/sponsor',
    'custom_text[submit][message]':
      'One-time payment. Your name and website stay visible until a higher payment replaces you. No minimum display time. If a higher bid wins before yours is processed, yours is refunded.',
  };
  const session = bid.session_id
    ? await stripe(env, 'checkout/sessions/' + encodeURIComponent(bid.session_id))
    : await stripe(env, 'checkout/sessions', params, 'sponsor-checkout-' + bid.id);
  if (session.status !== 'open' || !session.url) fail('Checkout closed. Start a new bid.', 409);
  const target = new URL(session.url);
  if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com')
    fail('Invalid checkout response.', 503);
  await db
    .prepare('UPDATE sponsor_bids SET session_id = ? WHERE id = ? AND session_id IS NULL')
    .bind(session.id, bid.id)
    .run();
  return {url: session.url, id: bid.id};
}
export async function fulfillSession(db, env, session) {
  const id = session.metadata?.bid_id;
  if (typeof id !== 'string') return {ignored: true};
  const bid = await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(id).first();
  if (!bid) return {ignored: true};
  if (
    session.id !== bid.session_id ||
    session.mode !== 'payment' ||
    session.currency !== 'usd' ||
    session.amount_total !== bid.amount ||
    session.client_reference_id !== bid.id ||
    typeof session.payment_intent !== 'string'
  )
    fail('Payment does not match its bid.', 400);
  if (session.payment_status !== 'paid') return {status: 'pending'};
  const expectedLive = !bid.test_mode;
  if (session.livemode !== expectedLive || bid.test_mode !== testMode(env)) fail('Payment environment mismatch.', 400);
  // Atomic comparison against the active sponsors: a delayed or equal-price checkout never replaces a higher one.
  // A checkout that Stripe reported as expired can still settle if the payment actually completed.
  const floor = `COALESCE((SELECT MAX(amount) FROM sponsor_bids WHERE ${ACTIVE} AND test_mode = ?), 0)`;
  await db
    .prepare(
      `UPDATE sponsor_bids SET status = CASE WHEN amount > ${floor} THEN 'paid' ELSE 'refund_pending' END, paid_at = CASE WHEN amount > ${floor} THEN ? ELSE NULL END, payment_intent = ? WHERE id = ? AND status IN ('checkout', 'expired')`,
    )
    .bind(bid.test_mode, bid.test_mode, Date.now(), session.payment_intent, bid.id)
    .run();
  let result = await db.prepare('SELECT status FROM sponsor_bids WHERE id = ?').bind(bid.id).first();
  if (result.status === 'refund_pending') {
    const refund = await stripe(
      env,
      'refunds',
      {payment_intent: session.payment_intent},
      'sponsor-outbid-refund-' + bid.id,
    );
    if (refund.status === 'succeeded') {
      await db
        .prepare("UPDATE sponsor_bids SET status = 'refunded' WHERE id = ? AND status = 'refund_pending'")
        .bind(bid.id)
        .run();
      result = {status: 'refunded'};
    }
  }
  return result;
}
export async function paymentStatus(db, env, id, player) {
  const bid = await db.prepare('SELECT * FROM sponsor_bids WHERE id = ? AND player_id = ?').bind(id, player).first();
  if (!bid) fail('Payment not found in this browser.', 404);
  if (bid.test_mode !== testMode(env)) fail('This payment belongs to another environment.', 409);
  if (bid.session_id && ['checkout', 'expired', 'refund_pending'].includes(bid.status)) {
    const session = await stripe(env, 'checkout/sessions/' + encodeURIComponent(bid.session_id));
    await fulfillSession(db, env, session);
  }
  const result = await db.prepare('SELECT status FROM sponsor_bids WHERE id = ?').bind(id).first();
  return {...result, current: (await highBid(db, bid.test_mode))?.id === id};
}
export async function verifyStripeSignature(raw, header, secret, now = Date.now()) {
  if (!secret || !header) fail('Missing webhook signature.', 400);
  const parts = header.split(',').map(s => s.trim().split('='));
  const timestamp = parts.find(p => p[0] === 't')?.[1];
  if (!/^\d+$/.test(timestamp ?? '') || Math.abs(now / 1000 - Number(timestamp)) > 300)
    fail('Webhook signature expired.', 400);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['verify'],
  );
  const message = new TextEncoder().encode(timestamp + '.' + raw);
  for (const [, value] of parts.filter(p => p[0] === 'v1')) {
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) continue;
    const bytes = Uint8Array.from(value.match(/../g), h => parseInt(h, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) return;
  }
  fail('Invalid webhook signature.', 400);
}
async function disputedIntent(env, dispute) {
  if (typeof dispute.payment_intent === 'string') return dispute.payment_intent;
  if (typeof dispute.charge !== 'string') return null;
  const charge = await stripe(env, 'charges/' + encodeURIComponent(dispute.charge));
  return typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
}
export async function stripeWebhook(db, env, request) {
  const reader = request.body?.getReader();
  if (!reader) fail('Missing webhook body.');
  const chunks = [];
  let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      fail('Webhook too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  const raw = new TextDecoder().decode(bytes);
  await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    fail('Invalid webhook.');
  }
  const object = event?.data?.object;
  if (!object || typeof object !== 'object') return {ok: true};
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type))
    return fulfillSession(db, env, object);
  if (event.type === 'checkout.session.expired' && typeof object.id === 'string') {
    await db
      .prepare("UPDATE sponsor_bids SET status = 'expired' WHERE session_id = ? AND status = 'checkout'")
      .bind(object.id)
      .run();
  } else if (
    event.type === 'charge.refunded' &&
    object.refunded === true &&
    typeof object.payment_intent === 'string'
  ) {
    const intent = await stripe(env, 'payment_intents/' + encodeURIComponent(object.payment_intent));
    await db
      .prepare("UPDATE sponsor_bids SET status = 'refunded' WHERE payment_intent = ? OR id = ?")
      .bind(object.payment_intent, intent.metadata?.bid_id ?? '')
      .run();
  } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    // A disputed placement leaves the auction until the dispute is won; a lost dispute counts as a refund.
    const intentId = await disputedIntent(env, object);
    if (intentId && event.type === 'charge.dispute.created')
      await db
        .prepare(
          "UPDATE sponsor_bids SET status = 'disputed' WHERE payment_intent = ? AND status IN ('paid', 'refund_pending')",
        )
        .bind(intentId)
        .run();
    else if (intentId && ['won', 'warning_closed'].includes(object.status))
      await db
        .prepare(
          "UPDATE sponsor_bids SET status = CASE WHEN paid_at IS NULL THEN 'refund_pending' ELSE 'paid' END WHERE payment_intent = ? AND status = 'disputed'",
        )
        .bind(intentId)
        .run();
    else if (intentId)
      await db
        .prepare("UPDATE sponsor_bids SET status = 'refunded' WHERE payment_intent = ? AND status = 'disputed'")
        .bind(intentId)
        .run();
  }
  return {ok: true};
}
export async function ownerBids(db) {
  const rows = await db
    .prepare(
      "SELECT id, name, url, amount, status, hidden, test_mode AS testMode, session_id AS sessionId, paid_at AS paidAt, created_at AS createdAt FROM sponsor_bids WHERE status != 'expired' ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'disputed' THEN 1 WHEN 'refund_pending' THEN 2 ELSE 3 END, created_at DESC LIMIT 100",
    )
    .all();
  return {bids: rows.results};
}
export async function reviewBid(db, data) {
  if (typeof data.id !== 'string' || !['hide', 'show'].includes(data.action)) fail('Invalid action.');
  await db
    .prepare('UPDATE sponsor_bids SET hidden = ? WHERE id = ?')
    .bind(data.action === 'hide' ? 1 : 0, data.id)
    .run();
  return {ok: true};
}
