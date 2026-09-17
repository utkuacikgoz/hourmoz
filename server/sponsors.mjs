import {RequestError} from './security.mjs';
const fail = (message, status = 400) => {
  throw new RequestError(message, status);
};
const DAY = 86400000,
  HOLD_MINUTES = 45, // an unfinished checkout keeps its dates reserved this long
  CHECKOUT_MINUTES = 35, // Stripe closes the checkout itself after this (its minimum is 30)
  REOPEN_MINUTES = HOLD_MINUTES - CHECKOUT_MINUTES, // a booking can reopen checkout only while it still outlives the hold
  HORIZON = 60, // days ahead that can be booked
  MIN_PRICE = 100,
  MAX_PRICE = 1000000;
export const SLOTS = {day: 1, week: 7};
const DEFAULT_PRICES = {day: 1500, week: 5900};
const NAME = /^[\p{L}\p{N} .&'!_-]{2,60}$/u;
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
// Prices are whole US cents. SPONSOR_DAY_PRICE and SPONSOR_WEEK_PRICE override the defaults.
export function prices(env = {}) {
  const read = (value, fallback) => {
    const cents = Number(value);
    return Number.isInteger(cents) && cents >= MIN_PRICE && cents <= MAX_PRICE ? cents : fallback;
  };
  return {
    day: read(env.SPONSOR_DAY_PRICE, DEFAULT_PRICES.day),
    week: read(env.SPONSOR_WEEK_PRICE, DEFAULT_PRICES.week),
  };
}
// An optional Stripe Payment Link, shown as "Tip the captain" on the results screen.
export function tipUrl(env = {}) {
  try {
    const u = new URL(env.TIP_URL);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export const dayString = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const dayValue = day => {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const t = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(t) && dayString(t) === day ? t : NaN;
};
export const slotDays = (startDay, days) =>
  Array.from({length: days}, (_, i) => dayString(dayValue(startDay) + i * DAY));
async function stripe(env, path, params = null, key = null) {
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
// The sponsor shown on a UTC day: a paid, visible booking that holds that day.
export async function sponsorFor(db, day, testing = 0) {
  return db
    .prepare(
      "SELECT s.id, s.name, s.url, s.start_day AS startDay, s.days FROM sponsor_days d JOIN sponsor_slots s ON s.id = d.slot_id WHERE d.day = ? AND d.test_mode = ? AND s.status = 'paid' AND s.hidden = 0 LIMIT 1",
    )
    .bind(day, testing)
    .first();
}
export const paidSponsor = (db, testing = 0, now = Date.now()) => sponsorFor(db, dayString(now), testing);
// Dates that cannot be booked: paid or disputed placements, and checkouts still inside their hold.
async function bookedDays(db, testing, now) {
  const rows = await db
    .prepare(
      "SELECT d.day FROM sponsor_days d JOIN sponsor_slots s ON s.id = d.slot_id WHERE d.test_mode = ? AND d.day >= ? AND d.day <= ? AND (s.status IN ('paid', 'disputed') OR (s.status = 'checkout' AND s.created_at > ?)) ORDER BY d.day",
    )
    .bind(testing, dayString(now), dayString(now + (HORIZON + 7) * DAY), now - HOLD_MINUTES * 60000)
    .all();
  return rows.results.map(r => r.day);
}
export async function publicSponsorship(db, env, testing = 0, now = Date.now()) {
  const bookings = await db
    .prepare(
      "SELECT name, start_day AS startDay, days FROM sponsor_slots WHERE status = 'paid' AND hidden = 0 AND test_mode = ? ORDER BY start_day DESC LIMIT 20",
    )
    .bind(testing)
    .all();
  return {
    testMode: !!testing,
    prices: prices(env),
    today: dayString(now),
    horizon: HORIZON,
    sponsor: await sponsorFor(db, dayString(now), testing),
    booked: await bookedDays(db, testing, now),
    bookings: bookings.results,
  };
}
// Unfinished checkouts give their dates back after the hold. The booking row stays as 'expired' so a
// payment that still completes can be matched, re-reserved or refunded.
export async function releaseStaleHolds(db, now = Date.now()) {
  const cutoff = now - HOLD_MINUTES * 60000;
  await db.batch([
    db
      .prepare(
        "DELETE FROM sponsor_days WHERE slot_id IN (SELECT id FROM sponsor_slots WHERE status = 'checkout' AND created_at < ?)",
      )
      .bind(cutoff),
    db.prepare("UPDATE sponsor_slots SET status = 'expired' WHERE status = 'checkout' AND created_at < ?").bind(cutoff),
    db.prepare("DELETE FROM sponsor_slots WHERE status = 'expired' AND created_at < ?").bind(now - 30 * DAY),
  ]);
}
export async function submitBooking(db, env, data, player, now = Date.now()) {
  if (!paymentsEnabled(env)) fail('Payments are not connected yet.', 503);
  if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) fail('Invalid booking.');
  const testing = testMode(env);
  let slot = await db.prepare('SELECT * FROM sponsor_slots WHERE id = ?').bind(data.id).first();
  if (slot && slot.player_id !== player) fail('Invalid booking.', 409);
  if (!slot) {
    const name = typeof data.name === 'string' ? data.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    if (!NAME.test(name)) fail('Use a sponsor name of 2–60 letters, numbers or simple punctuation.');
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
    const days = SLOTS[data.slot];
    if (!days) fail('Choose a day or a week.');
    const start = dayValue(data.startDay),
      today = dayValue(dayString(now));
    if (Number.isNaN(start)) fail('Choose a start date.');
    if (start < today) fail('That date has passed. Choose today or a later date.');
    if (start > today + HORIZON * DAY) fail(`Bookings open up to ${HORIZON} days ahead.`);
    const recent = await db
      .prepare('SELECT COUNT(*) AS count FROM sponsor_slots WHERE player_id = ? AND created_at > ?')
      .bind(player, now - 3600000)
      .first();
    if (recent.count >= 10) fail('Too many payment attempts. Try again in an hour.', 429);
    await releaseStaleHolds(db, now);
    const range = slotDays(data.startDay, days);
    try {
      // Every date is claimed in one transaction; a date that is already held or sold rolls the whole booking back.
      await db.batch([
        db
          .prepare(
            'INSERT INTO sponsor_slots (id, player_id, name, url, start_day, days, amount, created_at, test_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(data.id, player, name, url.href, data.startDay, days, prices(env)[data.slot], now, testing),
        ...range.map(day =>
          db.prepare('INSERT INTO sponsor_days (day, test_mode, slot_id) VALUES (?, ?, ?)').bind(day, testing, data.id),
        ),
      ]);
    } catch (error) {
      const taken = await db
        .prepare(`SELECT day FROM sponsor_days WHERE test_mode = ? AND day IN (${range.map(() => '?').join(', ')})`)
        .bind(testing, ...range)
        .first();
      if (taken)
        fail(
          days === 1
            ? 'That date was just booked. Choose another.'
            : 'One of those dates was just booked. Choose another start date.',
          409,
        );
      throw error;
    }
    slot = await db.prepare('SELECT * FROM sponsor_slots WHERE id = ?').bind(data.id).first();
    if (slot.player_id !== player) fail('Invalid booking.', 409);
  }
  if (slot.test_mode !== testing) fail('Start a payment in the current environment.', 409);
  if (slot.status === 'expired' || now - slot.created_at > REOPEN_MINUTES * 60000)
    fail('This booking attempt expired. Start a new booking.', 409);
  if (slot.status !== 'checkout') fail('This payment was already processed.', 409);
  const ORIGIN = appOrigin(env);
  const range = slotDays(slot.start_day, slot.days);
  const label =
    slot.days === 1
      ? `Sponsor of the day · ${slot.start_day}`
      : `Sponsor of the week · ${slot.start_day} to ${range[range.length - 1]}`;
  const params = {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(slot.amount),
    'line_items[0][price_data][product_data][name]': 'Is Hormuz Open? — ' + label,
    'line_items[0][price_data][product_data][description]':
      'Your name on every tanker in the game and on the menu and results screens, 00:00 to 24:00 UTC.',
    'line_items[0][quantity]': '1',
    'metadata[slot_id]': slot.id,
    'payment_intent_data[metadata][slot_id]': slot.id,
    client_reference_id: slot.id,
    success_url: ORIGIN + '/sponsor?payment=' + slot.id,
    cancel_url: ORIGIN + '/sponsor',
    expires_at: String(Math.floor(now / 1000) + CHECKOUT_MINUTES * 60),
    'custom_text[submit][message]': `One-time payment for ${label}. Your dates are held while you pay. If they are taken before the payment completes, you are refunded in full.`,
  };
  const session = slot.session_id
    ? await stripe(env, 'checkout/sessions/' + encodeURIComponent(slot.session_id))
    : await stripe(env, 'checkout/sessions', params, 'sponsor-checkout-' + slot.id);
  if (session.status !== 'open' || !session.url) fail('Checkout closed. Start a new booking.', 409);
  const target = new URL(session.url);
  if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com')
    fail('Invalid checkout response.', 503);
  await db
    .prepare('UPDATE sponsor_slots SET session_id = ? WHERE id = ? AND session_id IS NULL')
    .bind(session.id, slot.id)
    .run();
  return {url: session.url, id: slot.id};
}
export async function fulfillSession(db, env, session, now = Date.now()) {
  const id = session.metadata?.slot_id;
  if (typeof id !== 'string') return {ignored: true};
  const slot = await db.prepare('SELECT * FROM sponsor_slots WHERE id = ?').bind(id).first();
  if (!slot) return {ignored: true};
  if (
    session.id !== slot.session_id ||
    session.mode !== 'payment' ||
    session.currency !== 'usd' ||
    session.amount_total !== slot.amount ||
    session.client_reference_id !== slot.id ||
    typeof session.payment_intent !== 'string'
  )
    fail('Payment does not match its booking.', 400);
  if (session.payment_status !== 'paid') return {status: 'pending'};
  const expectedLive = !slot.test_mode;
  if (session.livemode !== expectedLive || slot.test_mode !== testMode(env)) fail('Payment environment mismatch.', 400);
  if (['checkout', 'expired'].includes(slot.status)) {
    // Claim every date of the booking in one transaction. Dates this checkout still holds are kept; if any
    // was released and sold meanwhile, the payment becomes refundable instead of overlapping.
    const held = '(SELECT COUNT(*) FROM sponsor_days WHERE slot_id = ? AND test_mode = ?) = ?';
    await db.batch([
      ...slotDays(slot.start_day, slot.days).map(day =>
        db
          .prepare(
            'INSERT INTO sponsor_days (day, test_mode, slot_id) VALUES (?, ?, ?) ON CONFLICT(day, test_mode) DO NOTHING',
          )
          .bind(day, slot.test_mode, slot.id),
      ),
      db
        .prepare(
          `UPDATE sponsor_slots SET status = CASE WHEN ${held} THEN 'paid' ELSE 'refund_pending' END, paid_at = CASE WHEN ${held} THEN ? ELSE NULL END, payment_intent = ? WHERE id = ? AND status IN ('checkout', 'expired')`,
        )
        .bind(
          slot.id,
          slot.test_mode,
          slot.days,
          slot.id,
          slot.test_mode,
          slot.days,
          now,
          session.payment_intent,
          slot.id,
        ),
      db
        .prepare(
          "DELETE FROM sponsor_days WHERE slot_id = ? AND (SELECT status FROM sponsor_slots WHERE id = ?) != 'paid'",
        )
        .bind(slot.id, slot.id),
    ]);
  }
  let result = await db.prepare('SELECT status FROM sponsor_slots WHERE id = ?').bind(slot.id).first();
  if (result.status === 'refund_pending') {
    const refund = await stripe(
      env,
      'refunds',
      {payment_intent: session.payment_intent},
      'sponsor-dates-refund-' + slot.id,
    );
    if (refund.status === 'succeeded') {
      await db
        .prepare("UPDATE sponsor_slots SET status = 'refunded' WHERE id = ? AND status = 'refund_pending'")
        .bind(slot.id)
        .run();
      result = {status: 'refunded'};
    }
  }
  return result;
}
export async function paymentStatus(db, env, id, player, now = Date.now()) {
  const slot = await db.prepare('SELECT * FROM sponsor_slots WHERE id = ? AND player_id = ?').bind(id, player).first();
  if (!slot) fail('Payment not found in this browser.', 404);
  if (slot.test_mode !== testMode(env)) fail('This payment belongs to another environment.', 409);
  if (slot.session_id && ['checkout', 'expired', 'refund_pending'].includes(slot.status)) {
    const session = await stripe(env, 'checkout/sessions/' + encodeURIComponent(slot.session_id));
    await fulfillSession(db, env, session, now);
  }
  const result = await db
    .prepare('SELECT status, start_day AS startDay, days FROM sponsor_slots WHERE id = ?')
    .bind(id)
    .first();
  const range = slotDays(result.startDay, result.days);
  return {
    ...result,
    endDay: range[range.length - 1],
    live: (await sponsorFor(db, dayString(now), slot.test_mode))?.id === id,
  };
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
    // Stripe closed the checkout: the dates go back on sale right away.
    await db.batch([
      db
        .prepare("UPDATE sponsor_slots SET status = 'expired' WHERE session_id = ? AND status = 'checkout'")
        .bind(object.id),
      db
        .prepare(
          "DELETE FROM sponsor_days WHERE slot_id IN (SELECT id FROM sponsor_slots WHERE session_id = ? AND status = 'expired')",
        )
        .bind(object.id),
    ]);
  } else if (
    event.type === 'charge.refunded' &&
    object.refunded === true &&
    typeof object.payment_intent === 'string'
  ) {
    const intent = await stripe(env, 'payment_intents/' + encodeURIComponent(object.payment_intent));
    const slotId = intent.metadata?.slot_id ?? '';
    await db.batch([
      db
        .prepare("UPDATE sponsor_slots SET status = 'refunded' WHERE payment_intent = ? OR id = ?")
        .bind(object.payment_intent, slotId),
      db
        .prepare(
          'DELETE FROM sponsor_days WHERE slot_id IN (SELECT id FROM sponsor_slots WHERE payment_intent = ? OR id = ?)',
        )
        .bind(object.payment_intent, slotId),
    ]);
  } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    // A disputed placement leaves the game (its dates stay reserved) until the dispute is won; a lost
    // dispute counts as a refund and frees the dates.
    const intentId = await disputedIntent(env, object);
    if (intentId && event.type === 'charge.dispute.created')
      await db
        .prepare(
          "UPDATE sponsor_slots SET status = 'disputed' WHERE payment_intent = ? AND status IN ('paid', 'refund_pending')",
        )
        .bind(intentId)
        .run();
    else if (intentId && ['won', 'warning_closed'].includes(object.status))
      await db
        .prepare(
          "UPDATE sponsor_slots SET status = CASE WHEN paid_at IS NULL THEN 'refund_pending' ELSE 'paid' END WHERE payment_intent = ? AND status = 'disputed'",
        )
        .bind(intentId)
        .run();
    else if (intentId)
      await db.batch([
        db
          .prepare("UPDATE sponsor_slots SET status = 'refunded' WHERE payment_intent = ? AND status = 'disputed'")
          .bind(intentId),
        db
          .prepare(
            "DELETE FROM sponsor_days WHERE slot_id IN (SELECT id FROM sponsor_slots WHERE payment_intent = ? AND status = 'refunded')",
          )
          .bind(intentId),
      ]);
  }
  return {ok: true};
}
export async function ownerBookings(db) {
  const rows = await db
    .prepare(
      "SELECT id, name, url, amount, status, hidden, test_mode AS testMode, start_day AS startDay, days, session_id AS sessionId, paid_at AS paidAt, created_at AS createdAt FROM sponsor_slots WHERE status != 'expired' ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'disputed' THEN 1 WHEN 'refund_pending' THEN 2 ELSE 3 END, start_day DESC, created_at DESC LIMIT 100",
    )
    .all();
  return {bookings: rows.results};
}
export async function reviewBooking(db, data) {
  if (typeof data.id !== 'string' || !['hide', 'show'].includes(data.action)) fail('Invalid action.');
  await db
    .prepare('UPDATE sponsor_slots SET hidden = ? WHERE id = ?')
    .bind(data.action === 'hide' ? 1 : 0, data.id)
    .run();
  return {ok: true};
}
