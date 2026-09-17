import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../server/worker.mjs';
import {
  submitBooking,
  fulfillSession,
  publicSponsorship,
  paidSponsor,
  sponsorFor,
  releaseStaleHolds,
  verifyStripeSignature,
  ownerBookings,
  reviewBooking,
  prices,
  tipUrl,
  slotDays,
  dayString,
} from '../server/sponsors.mjs';
const DB = localDB(),
  origin = 'https://game.example',
  env = {
    DB,
    APP_ORIGIN: origin,
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    AUCTION_OWNER_EMAIL: 'owner@example.com',
    CF_ACCESS_AUD: 'admin-app',
  };
const DAY = 86400000,
  MINUTE = 60000;
const player = crypto.randomUUID(),
  player2 = crypto.randomUUID(),
  sessions = new Map(),
  refunds = new Set(),
  originalFetch = globalThis.fetch;
let failRefund = false;
globalThis.fetch = async (url, options) => {
  const path = new URL(url).pathname,
    params = new URLSearchParams(options.body);
  if (path === '/v1/checkout/sessions') {
    const id = params.get('metadata[slot_id]'),
      session = {
        id: 'cs_test_' + id,
        url: 'https://checkout.stripe.com/test/' + id,
        status: 'open',
        mode: 'payment',
        currency: 'usd',
        amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
        metadata: {slot_id: id},
        client_reference_id: id,
        payment_intent: 'pi_' + id,
        payment_status: 'paid',
        livemode: false,
        expires_at: Number(params.get('expires_at')),
        label: params.get('line_items[0][price_data][product_data][name]'),
      };
    sessions.set(id, session);
    return Response.json(session);
  }
  if (path.startsWith('/v1/checkout/sessions/')) {
    return Response.json([...sessions.values()].find(s => path.endsWith(s.id)));
  }
  if (path.startsWith('/v1/payment_intents/')) {
    const session = [...sessions.values()].find(s => path.endsWith(s.payment_intent));
    return Response.json({metadata: session.metadata});
  }
  if (path.startsWith('/v1/charges/')) {
    return Response.json({payment_intent: path.split('/').pop().replace('ch_', 'pi_')});
  }
  if (path === '/v1/refunds') {
    if (failRefund) return new Response('', {status: 503});
    refunds.add(options.headers['Idempotency-Key']);
    return Response.json({status: 'succeeded'});
  }
  throw new Error('Unexpected Stripe path ' + path);
};
const today = dayString(),
  day = n => dayString(Date.now() + n * DAY);
const booking = (startDay, slot = 'day', extra = {}) => ({
  id: crypto.randomUUID(),
  name: 'Test Sponsor',
  url: 'https://example.com',
  slot,
  startDay,
  accepted: true,
  ...extra,
});
const status = id => DB.sqlite.prepare('SELECT status FROM sponsor_slots WHERE id=?').get(id).status;
const heldDays = id => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sponsor_days WHERE slot_id=?').get(id).n;
const age = (id, minutes) =>
  DB.sqlite.prepare('UPDATE sponsor_slots SET created_at=? WHERE id=?').run(Date.now() - minutes * MINUTE, id);
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
  {name: 'HMAC', hash: 'SHA-256'},
  false,
  ['sign'],
);
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const signature = async (raw, timestamp = String(Math.floor(Date.now() / 1000))) =>
  't=' +
  timestamp +
  ',v1=' +
  hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + raw)));
const webhook = async event => {
  const raw = JSON.stringify(event);
  return worker.fetch(
    new Request(origin + '/api/stripe/webhook', {
      method: 'POST',
      headers: {'Stripe-Signature': await signature(raw)},
      body: raw,
    }),
    env,
  );
};
try {
  // Prices and the tip link come from the environment, with safe defaults and validation.
  assert.deepEqual(prices({}), {day: 1500, week: 5900});
  assert.deepEqual(prices({SPONSOR_DAY_PRICE: '2500', SPONSOR_WEEK_PRICE: '5'}), {day: 2500, week: 5900});
  assert.equal(tipUrl({TIP_URL: 'https://buy.stripe.com/abc'}), 'https://buy.stripe.com/abc');
  assert.equal(tipUrl({TIP_URL: 'javascript:alert(1)'}), null);
  assert.equal(tipUrl({}), null);
  assert.deepEqual(slotDays('2026-12-30', 3), ['2026-12-30', '2026-12-31', '2027-01-01']);
  const open = await publicSponsorship(DB, env, 1);
  assert.equal(open.sponsor, null);
  assert.deepEqual(open.booked, []);
  assert.equal(open.prices.day, 1500);
  await assert.rejects(() => submitBooking(DB, {}, booking(today), player), /not connected/);
  for (const data of [
    booking(today, 'month'),
    booking(day(-1)),
    booking(day(61)),
    booking('2026-02-30'),
    booking(today, 'day', {url: 'javascript:alert(1)'}),
    booking(today, 'day', {accepted: false}),
    booking(today, 'day', {name: '<script>'}),
  ])
    await assert.rejects(() => submitBooking(DB, env, data, player));

  // A booking holds its dates from the moment checkout opens; the checkout carries the price and the dates.
  const a = booking(today);
  const opened = await submitBooking(DB, env, a, player);
  assert.equal(opened.url, 'https://checkout.stripe.com/test/' + a.id);
  assert.equal(sessions.get(a.id).amount_total, 1500);
  assert.match(sessions.get(a.id).label, new RegExp('sponsor of the day · ' + today, 'i'));
  assert(sessions.get(a.id).expires_at * 1000 - Date.now() > 30 * MINUTE, 'checkout outlives Stripe’s minimum');
  assert.deepEqual((await publicSponsorship(DB, env, 1)).booked, [today]);
  assert.equal((await publicSponsorship(DB, env, 1)).bookings.length, 0); // unpaid checkouts stay private
  await assert.rejects(() => submitBooking(DB, env, booking(today), player), /just booked/);
  await assert.rejects(() => submitBooking(DB, env, booking(day(-6), 'week'), player), /passed/);
  await assert.rejects(() => submitBooking(DB, env, a, crypto.randomUUID()), /Invalid booking/);
  assert.equal((await submitBooking(DB, env, a, player)).url, opened.url); // a retry reuses the same session
  const tampered = {...sessions.get(a.id), amount_total: 1};
  await assert.rejects(() => fulfillSession(DB, env, tampered), /does not match/);
  assert.equal((await fulfillSession(DB, env, {...sessions.get(a.id), payment_status: 'unpaid'})).status, 'pending');
  assert.equal((await fulfillSession(DB, env, sessions.get(a.id))).status, 'paid');
  assert.equal((await paidSponsor(DB, 1)).id, a.id);
  assert.equal(await paidSponsor(DB), null); // test bookings never reach the live game
  assert.equal((await fulfillSession(DB, env, sessions.get(a.id))).status, 'paid'); // delivery retries are idempotent
  const summary = await publicSponsorship(DB, env, 1);
  assert.equal(summary.sponsor.name, 'Test Sponsor');
  assert.equal(summary.bookings.length, 1);
  assert(!JSON.stringify(summary).includes(player));
  assert(!JSON.stringify(summary).includes('session'));
  assert(!JSON.stringify(summary).includes('amount'));

  // A week books seven consecutive days at the week price and blocks every one of them.
  const w = booking(day(3), 'week');
  await submitBooking(DB, env, w, player);
  assert.equal(sessions.get(w.id).amount_total, 5900);
  assert.equal((await fulfillSession(DB, env, sessions.get(w.id))).status, 'paid');
  assert.equal((await sponsorFor(DB, day(9), 1)).id, w.id);
  assert.equal(await sponsorFor(DB, day(10), 1), null);
  await assert.rejects(() => submitBooking(DB, env, booking(day(9)), player), /just booked/);
  await assert.rejects(() => submitBooking(DB, env, booking(day(1), 'week'), player), /just booked/);
  await submitBooking(DB, env, booking(day(1)), player);

  // Two checkouts racing for the same day: exactly one gets to hold it.
  const results = await Promise.allSettled([
    submitBooking(DB, env, booking(day(2)), player),
    submitBooking(DB, env, booking(day(2)), player),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /just booked/);
  assert.equal(
    DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sponsor_days WHERE day=? AND test_mode=1').get(day(2)).n,
    1,
  );

  // Holds expire: after 45 minutes the date goes back on sale, and a payment that lands after the date
  // was resold is refunded in full (retried until Stripe accepts it, never twice).
  const stale = booking(day(14));
  await submitBooking(DB, env, stale, player);
  age(stale.id, 50);
  assert(!(await publicSponsorship(DB, env, 1)).booked.includes(day(14)), 'stale holds are not shown as taken');
  await assert.rejects(() => submitBooking(DB, env, stale, player), /expired/);
  const resold = booking(day(14));
  await submitBooking(DB, env, resold, player);
  assert.equal(status(stale.id), 'expired');
  assert.equal(heldDays(stale.id), 0);
  failRefund = true;
  await assert.rejects(() => fulfillSession(DB, env, sessions.get(stale.id)), /unavailable/);
  assert.equal(status(stale.id), 'refund_pending');
  failRefund = false;
  assert.equal((await fulfillSession(DB, env, sessions.get(stale.id))).status, 'refunded');
  await fulfillSession(DB, env, sessions.get(stale.id));
  assert.equal(refunds.size, 1);
  assert.equal((await fulfillSession(DB, env, sessions.get(resold.id))).status, 'paid');
  assert.equal((await sponsorFor(DB, day(14), 1)).id, resold.id);
  // A late payment on a released hold still wins when nobody took the dates meanwhile.
  const late = booking(day(15));
  await submitBooking(DB, env, late, player);
  age(late.id, 50);
  await releaseStaleHolds(DB);
  assert.equal(status(late.id), 'expired');
  assert.equal(heldDays(late.id), 0);
  assert.equal((await fulfillSession(DB, env, sessions.get(late.id))).status, 'paid');
  assert.equal((await sponsorFor(DB, day(15), 1)).id, late.id);
  assert.equal(heldDays(late.id), 1);

  const raw = '{"type":"test"}',
    timestamp = String(Math.floor(Date.now() / 1000)),
    good = await signature(raw, timestamp);
  await verifyStripeSignature(raw, good, env.STRIPE_WEBHOOK_SECRET);
  await assert.rejects(() => verifyStripeSignature(raw + ' ', good, env.STRIPE_WEBHOOK_SECRET));
  await assert.rejects(() => verifyStripeSignature(raw, 't=1,v1=' + good.split('v1=')[1], env.STRIPE_WEBHOOK_SECRET));
  // A refund that arrives before fulfilment keeps the booking refunded and its date free.
  const earlyRefund = booking(day(16));
  await submitBooking(DB, env, earlyRefund, player);
  const refundedResponse = await webhook({
    type: 'charge.refunded',
    data: {object: {refunded: true, payment_intent: sessions.get(earlyRefund.id).payment_intent}},
  });
  assert.equal(refundedResponse.status, 200);
  assert.equal((await fulfillSession(DB, env, sessions.get(earlyRefund.id))).status, 'refunded');
  assert.equal(await sponsorFor(DB, day(16), 1), null);
  assert(!(await publicSponsorship(DB, env, 1)).booked.includes(day(16)));
  console.log(
    'PASS: prices and tip link, booking validation, date holds, private checkouts, confirmed-payment activation, week ranges, concurrent bookings, hold expiry with refund or late activation, webhook signatures.',
  );

  // Refunds, disputes and hidden placements take the sponsor out of the game; refunds also free the dates.
  await webhook({
    type: 'charge.refunded',
    data: {object: {refunded: true, payment_intent: sessions.get(w.id).payment_intent}},
  });
  assert.equal(status(w.id), 'refunded');
  assert.equal(await sponsorFor(DB, day(3), 1), null);
  assert.equal(heldDays(w.id), 0);
  const again = booking(day(3), 'week'); // the week is free again
  await submitBooking(DB, env, again, player2);
  assert.equal((await fulfillSession(DB, env, sessions.get(again.id))).status, 'paid');
  const intent = sessions.get(a.id).payment_intent;
  await webhook({type: 'charge.dispute.created', data: {object: {status: 'needs_response', payment_intent: intent}}});
  assert.equal(status(a.id), 'disputed');
  assert.equal(await paidSponsor(DB, 1), null);
  assert((await publicSponsorship(DB, env, 1)).booked.includes(today), 'a disputed day stays reserved');
  await webhook({type: 'charge.dispute.closed', data: {object: {status: 'won', payment_intent: intent}}});
  assert.equal(status(a.id), 'paid');
  assert.equal((await paidSponsor(DB, 1)).id, a.id);
  await webhook({
    type: 'charge.dispute.created',
    data: {object: {status: 'needs_response', payment_intent: null, charge: intent.replace('pi_', 'ch_')}},
  });
  await webhook({type: 'charge.dispute.closed', data: {object: {status: 'lost', payment_intent: intent}}});
  assert.equal(status(a.id), 'refunded');
  assert.equal(heldDays(a.id), 0);
  assert(!(await publicSponsorship(DB, env, 1)).booked.includes(today));
  await reviewBooking(DB, {id: again.id, action: 'hide'});
  assert.equal(await sponsorFor(DB, day(3), 1), null);
  assert((await publicSponsorship(DB, env, 1)).booked.includes(day(3)), 'hidden placements keep their dates');
  await reviewBooking(DB, {id: again.id, action: 'show'});
  assert.equal((await sponsorFor(DB, day(3), 1)).id, again.id);
  // Stripe closing a checkout frees the date at once; a payment that still lands re-reserves it.
  const f = booking(day(12));
  await submitBooking(DB, env, f, player2);
  await webhook({type: 'checkout.session.expired', data: {object: {id: sessions.get(f.id).id}}});
  assert.equal(status(f.id), 'expired');
  assert.equal(heldDays(f.id), 0);
  await assert.rejects(() => submitBooking(DB, env, f, player2), /expired/);
  assert.equal((await fulfillSession(DB, env, sessions.get(f.id))).status, 'paid');
  assert.equal((await sponsorFor(DB, day(12), 1)).id, f.id);
  const owner = await ownerBookings(DB);
  assert.equal(owner.bookings[0].status, 'paid');
  assert(!owner.bookings.some(row => row.status === 'expired'));
  console.log(
    'PASS: refunded, disputed and hidden sponsors leave the game, refunds free the dates, expired checkouts can still settle, admin list puts paid first.',
  );

  const identity = email => ({access: {aud: 'admin-app', getIdentity: async () => ({email})}});
  const request = (path, data, headers = {}, ctx) =>
    worker.fetch(
      new Request(origin + path, {
        method: data ? 'POST' : 'GET',
        headers: {Origin: origin, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...headers},
        body: data ? JSON.stringify(data) : undefined,
      }),
      env,
      ctx,
    );
  assert.equal((await request('/api/sponsorship/admin')).status, 403);
  assert.equal(
    (
      await request('/api/sponsorship/admin', null, {
        'oai-authenticated-user-email': 'owner@example.com',
        'oai-authenticated-user-id': 'owner',
        'Cf-Access-Authenticated-User-Email': 'owner@example.com',
      })
    ).status,
    403,
  );
  assert.equal((await request('/api/sponsorship/admin', null, {}, identity('other@example.com'))).status, 403);
  assert.equal((await request('/api/sponsorship/admin', null, {}, identity('owner@example.com'))).status, 200);
  // In test mode anonymous visitors see payments as unavailable; the signed-in owner can book and pay.
  const anon = await (await request('/api/sponsorship')).json();
  assert.equal(anon.enabled, false);
  assert.equal(anon.testAvailable, true);
  assert.equal(anon.sponsor, null);
  const owned = await (await request('/api/sponsorship', null, {}, identity('owner@example.com'))).json();
  assert.equal(owned.enabled, true);
  assert.equal(owned.testMode, true);
  assert(owned.booked.length > 0);
  const g = booking(day(20));
  const created = await request('/api/sponsorship/bookings', g, {}, identity('owner@example.com'));
  assert.equal(created.status, 201);
  const cookie = created.headers.get('Set-Cookie').split(';')[0];
  assert.equal(
    (await request('/api/sponsorship/bookings', booking(day(20)), {Cookie: cookie}, identity('owner@example.com')))
      .status,
    409,
  );
  const paid = await request('/api/sponsorship/payment', {id: g.id}, {Cookie: cookie}, identity('owner@example.com'));
  assert.equal(paid.status, 200);
  const paidBody = await paid.json();
  assert.equal(paidBody.status, 'paid');
  assert.equal(paidBody.startDay, day(20));
  assert.equal(paidBody.endDay, day(20));
  assert.equal(paidBody.live, false);
  assert.equal(
    (
      await request(
        '/api/sponsorship/payment',
        {id: g.id},
        {Cookie: 'hormuz_player=' + crypto.randomUUID()},
        identity('owner@example.com'),
      )
    ).status,
    404,
  );
  // The game endpoint never shows test bookings, and carries the tip link only when one is configured.
  const game = await (await request('/api/sponsor')).json();
  assert.equal(game.sponsor, null);
  assert.equal(game.tipUrl, null);
  assert.equal(game.bookingUrl, '/sponsor');
  const tipped = await (
    await worker.fetch(new Request(origin + '/api/sponsor', {headers: {'Cache-Control': 'no-cache'}}), {
      ...env,
      TIP_URL: 'https://buy.stripe.com/tip',
    })
  ).json();
  assert.equal(tipped.tipUrl, 'https://buy.stripe.com/tip');
  const visitId = crypto.randomUUID(),
    response = await request('/api/visits', {id: visitId, source: 'direct'}),
    visitCookie = response.headers.get('Set-Cookie').split(';')[0];
  for (let i = 0; i < 2; i++)
    assert.equal((await request('/api/presence', {visitId}, {Cookie: visitCookie})).status, 200);
  assert.equal((await (await request('/api/metrics')).json()).online, 1);
  assert.equal(
    (await request('/api/presence', {visitId}, {Cookie: 'hormuz_player=' + crypto.randomUUID()})).status,
    404,
  );
  DB.sqlite.prepare('UPDATE presence SET seen_at=?').run(Date.now() - 91000);
  assert.equal((await (await request('/api/metrics')).json()).online, 0);
  console.log(
    'PASS: owner authorization comes only from Access identity, booking and payment API round trip, tip link exposure, unique online presence and expiry.',
  );
} finally {
  globalThis.fetch = originalFetch;
}
