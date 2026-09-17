import assert from 'node:assert/strict';
import worker from '../server/worker.mjs';
import {localDB} from '../scripts/local-db.mjs';
import {RULES_VERSION} from '../public/rules.mjs';
import {trafficSource} from '../public/analytics.mjs';
import {sponsorship} from '../server/analytics.mjs';
const env = {DB: localDB()},
  origin = 'https://game.example';
const request = (path, data, cookie = '') =>
  worker.fetch(
    new Request(origin + path, {
      method: data ? 'POST' : 'GET',
      headers: {Origin: origin, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Cookie: cookie},
      body: data ? JSON.stringify(data) : undefined,
    }),
    env,
  );
assert.equal(trafficSource('?utm_source=reddit&email=private', '', origin), 'reddit');
assert.equal(trafficSource('', 'https://evilreddit.com/private', origin), 'other');
assert.equal(trafficSource('', 'https://old.reddit.com/r/games', origin), 'reddit');
assert.equal(trafficSource('?ghost=123', 'https://t.co/secret', origin), 'challenge');
assert.equal(trafficSource('?utm_source=private-person', '', origin), 'other');
const id = crypto.randomUUID();
let r = await request('/api/visits', {id, source: 'reddit'});
assert.equal(r.status, 201);
const cookie = r.headers.get('set-cookie').split(';')[0];
assert.equal((await request('/api/visits', {id, source: 'x'}, cookie)).status, 201);
assert.equal((await request('/api/visits', {id, source: 'x'}, 'hormuz_player=' + crypto.randomUUID())).status, 404);
for (let i = 0; i < 2; i++)
  assert.equal((await request('/api/runs', {mode: 'run', rules: RULES_VERSION, visitId: id}, cookie)).status, 201);
let m = await (await request('/api/metrics')).json();
assert.equal(m.visits, 1);
assert.equal(m.visitors, 1);
assert.equal(m.playingVisits, 1);
assert.equal(m.sources[0].source, 'reddit');
assert.equal(m.sources[0].starts, 2);
assert(!JSON.stringify(m).includes(id));
const otherCookie = 'hormuz_player=' + crypto.randomUUID();
r = await request('/api/runs', {mode: 'run', rules: RULES_VERSION, visitId: id}, otherCookie);
const run = await r.json();
assert.equal(env.DB.sqlite.prepare('SELECT visit_id FROM runs WHERE id=?').get(run.id).visit_id, null);
await request('/api/runs', {mode: 'run', rules: RULES_VERSION, analytics: false}, cookie);
m = await (await request('/api/metrics')).json();
assert.equal(m.starts, 3);
// Sponsor views and clicks count once per visit against today's paid placement; hidden placements stop counting.
const slotId = crypto.randomUUID(),
  today = new Date().toISOString().slice(0, 10);
env.DB.sqlite
  .prepare(
    "INSERT INTO sponsor_slots (id, player_id, name, url, start_day, days, amount, status, test_mode, created_at, paid_at) VALUES (?, 'seed', 'Test sponsor', 'https://example.com', ?, 1, 1500, 'paid', 0, ?, ?)",
  )
  .run(slotId, today, Date.now(), Date.now());
env.DB.sqlite.prepare('INSERT INTO sponsor_days (day, test_mode, slot_id) VALUES (?, 0, ?)').run(today, slotId);
assert.equal((await sponsorship(Date.now(), env.DB)).sponsor.id, slotId);
assert.equal((await sponsorship(Date.now() + 86400000, env.DB)).sponsor, null);
assert.equal((await sponsorship()).sponsor, null);
assert.equal((await sponsorship(Date.now(), env.DB)).tipUrl, null);
assert.equal(
  (await sponsorship(Date.now(), env.DB, {TIP_URL: 'https://buy.stripe.com/tip'})).tipUrl,
  'https://buy.stripe.com/tip',
);
const sponsorId = crypto.randomUUID();
await request('/api/visits', {id: sponsorId, source: 'direct'}, cookie);
for (const event of ['sponsor_view', 'sponsor_view', 'sponsor_click', 'booking_click'])
  assert.equal((await request('/api/visit-events', {visitId: sponsorId, event}, cookie)).status, 200);
assert.equal(
  (await request('/api/visit-events', {visitId: sponsorId, event: 'sponsor_click'}, otherCookie)).status,
  404,
);
m = await (await request('/api/metrics')).json();
assert.equal(m.sponsorViews, 1);
assert.equal(m.sponsorClicks, 1);
assert.equal(m.bookingClicks, 1);
assert.equal(m.campaigns[0].views, 1);
assert.equal(m.campaigns[0].name, 'Test sponsor');
env.DB.sqlite.prepare('UPDATE sponsor_slots SET hidden = 1 WHERE id = ?').run(slotId);
assert.equal((await sponsorship(Date.now(), env.DB)).sponsor, null);
assert.equal((await request('/api/visit-events', {visitId: sponsorId, event: 'sponsor_view'}, cookie)).status, 409);
env.DB.sqlite.prepare('UPDATE visits SET created_at=?').run(Date.now() - 31 * 86400000);
await request('/api/visits', {id: crypto.randomUUID(), source: 'direct'}, cookie);
assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 1);
console.log(
  'PASS: source privacy, visit deduplication, cookie ownership, replay-safe funnel, analytics opt-out, daily sponsor, event deduplication, tip link and retention.',
);
