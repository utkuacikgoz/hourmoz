import assert from 'node:assert/strict';
import {readJSON, limitRequest, securityHeaders} from '../server/security.mjs';
import worker from '../server/worker.mjs';
import {localDB} from '../scripts/local-db.mjs';
import {Crossing, seededRandom} from '../public/engine.mjs';
await assert.rejects(() => readJSON(new Request('https://game.test', {method: 'POST', body: '{"a":"long"}'}), 4), {
  status: 413,
});
await assert.rejects(() => readJSON(new Request('https://game.test', {method: 'POST', body: 'null'})), {status: 400});
const db = localDB();
for (let i = 0; i < 16; i++)
  await limitRequest(
    new Request('https://game.test/api/scores', {
      method: 'POST',
      headers: {'CF-Connecting-IP': '192.0.2.1', Cookie: 'hormuz_player=' + i},
    }),
    db,
  );
await assert.rejects(
  () =>
    limitRequest(
      new Request('https://game.test/api/scores', {method: 'POST', headers: {'CF-Connecting-IP': '192.0.2.1'}}),
      db,
    ),
  {status: 429},
);
const a = new Crossing(seededRandom(12)),
  b = new Crossing(seededRandom(12));
a.reset('run');
b.reset('run');
for (let i = 0; i < 50; i++) {
  b.add('missile', 0, -60);
  b.add('repair', 0, -60);
}
b.entities = [];
for (let i = 0; i < 1200; i++) {
  a.player.invincible = b.player.invincible = 999;
  a.tick(1 / 60);
  b.tick(1 / 60);
}
const course = g => g.entities.filter(e => e.type !== 'missile').map(e => [e.type, e.x, e.z, e.motionId]);
assert.deepEqual(course(a), course(b));
console.log('PASS: streamed body limits, malformed JSON, cookie-independent throttling, isolated course randomness.');

// One address over its own cap never consumes the shared budget, and bids have their own counter.
const shared = localDB();
const from = (ip, path = '/api/leaderboard?mode=run', method = 'GET', secret = null) =>
  limitRequest(new Request('https://game.test' + path, {method, headers: {'CF-Connecting-IP': ip}}), shared, secret);
let rejected = 0;
for (let i = 0; i < 200; i++) {
  try {
    await from('203.0.113.9');
  } catch (e) {
    assert.equal(e.status, 429);
    rejected++;
  }
}
assert.equal(rejected, 20);
await from('203.0.113.10');
assert.equal(shared.sqlite.prepare("SELECT count FROM rate_limits WHERE key = 'global:api'").get().count, 181);
for (let i = 0; i < 6; i++) await from('203.0.113.11', '/api/auction/bids', 'POST');
await assert.rejects(() => from('203.0.113.11', '/api/auction/bids', 'POST'), {status: 429});
await from('203.0.113.11');
const before = shared.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limits').get().count;
await from('203.0.113.12', undefined, undefined, 'keyed-secret');
assert.equal(shared.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limits').get().count, before + 1);
console.log(
  'PASS: client caps are checked before the shared budget, bids are counted separately, keyed hashing works.',
);

// Every page and API response carries the security headers; HSTS only over HTTPS.
const assetsEnv = {
  DB: db,
  ASSETS: {
    fetch: async r => new Response('asset ' + new URL(r.url).pathname, {headers: {'Content-Type': 'text/plain'}}),
  },
};
const page = await worker.fetch(new Request('https://game.test/'), assetsEnv);
assert.equal(await page.text(), 'asset /');
assert.equal((await worker.fetch(new Request('https://game.test/missing.png'), {DB: db})).status, 404);
assert.equal(page.status, 200);
assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
assert.match(page.headers.get('Content-Security-Policy'), /script-src 'self'/);
assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
assert.equal(page.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
const api = await worker.fetch(new Request('https://game.test/api/leaderboard?mode=run'), {DB: db});
assert.equal(api.status, 200);
assert.equal(api.headers.get('X-Frame-Options'), 'DENY');
assert.equal(api.headers.get('Cache-Control'), 'no-store');
assert.equal(securityHeaders(new URL('http://127.0.0.1:4173/'))['Strict-Transport-Security'], undefined);
const login = await worker.fetch(new Request('https://game.test/owner-login?returnTo=https://evil.example'), {DB: db});
assert.equal(login.status, 302);
assert.equal(login.headers.get('Location'), '/sponsor-admin');
console.log('PASS: security headers on pages and APIs, HSTS only on HTTPS, owner login cannot redirect off-site.');
