import {RULES_VERSION} from '../public/rules.mjs';
import assert from 'node:assert/strict';
import worker, {replay, classifyStatus} from '../server/worker.mjs';
import {Crossing, seededRandom, difficultyAt} from '../public/engine.mjs';
import {localDB} from '../scripts/local-db.mjs';
const env = {DB: localDB()},
  origin = 'https://game.example';
const req = (path, data, cookie = '') =>
  new Request(origin + path, {
    method: data ? 'POST' : 'GET',
    headers: {Origin: origin, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Cookie: cookie},
    body: data ? JSON.stringify(data) : undefined,
  });
let response = await worker.fetch(req('/api/runs', {mode: 'run', rules: RULES_VERSION}), env);
assert.equal(response.status, 201);
const cookie = response.headers.get('set-cookie').split(';')[0],
  session = await response.json();
const client = new Crossing(seededRandom(session.seed));
client.reset('run', session.seed);
let ticks = 0,
  records = [[0, 'i', [0, 0, 0, 0, null, null]]];
while (client.phase !== 'end' && ticks < 6302) {
  client.tick(1 / 60);
  client.events = [];
  ticks++;
}
assert.equal(client.phase, 'end');
const verified = replay(session.seed, 'run', records, ticks);
assert.equal(verified.score, client.score);
assert.equal(verified.player.hull, client.player.hull);
// Wall-clock checks reject a fabricated instantaneous run.
response = await worker.fetch(
  req('/api/scores', {name: 'Captain Test', runId: session.id, records, ticks}, cookie),
  env,
);
assert.equal(response.status, 400);
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now() - 110000, session.id);
response = await worker.fetch(
  req('/api/scores', {name: 'Captain Test', runId: session.id, records, ticks}, cookie),
  env,
);
assert.equal(response.status, 200);
assert.equal((await response.json()).saved, true);
response = await worker.fetch(req('/api/leaderboard?mode=run'), env);
const board = await response.json();
assert.equal(board.entries.length, 1);
assert.equal(board.entries[0].name, 'Captain Test');
assert.equal(board.entries[0].score, client.score);
response = await worker.fetch(
  req('/api/scores', {name: 'Captain Test', runId: session.id, records, ticks}, cookie),
  env,
);
assert.equal((await response.json()).alreadySaved, true);
response = await worker.fetch(
  req('/api/scores', {name: '<script>alert(1)</script>', runId: session.id, records, ticks}, cookie),
  env,
);
assert.equal(response.status, 400);
const badOrigin = new Request(origin + '/api/runs', {
  method: 'POST',
  headers: {Origin: 'https://other.example', 'Content-Type': 'application/json'},
  body: '{"mode":"run"}',
});
assert.equal((await worker.fetch(badOrigin, env)).status, 403);
assert.throws(() => replay(session.seed, 'run', [[0, 'i', [99, 0, 0, 0, null, null]]], ticks));
assert.throws(() => replay(session.seed, 'run', records, 1));
assert.equal(
  classifyStatus(
    '<p>Information related to shipping and seafarers</p><p>stranded on vessels unable to exit the Strait of Hormuz</p>',
  ).status,
  'disrupted',
);
assert.equal(classifyStatus('unrelated old article about shipping').status, 'unverified');
assert.deepEqual(
  [0, 15, 30, 45, 60, 75, 90].map(t => difficultyAt(t).pressure),
  [1, 1, 2, 3, 5, 8, 13],
);
assert.equal(difficultyAt(17).armed, false);
assert(difficultyAt(90).spawnInterval < difficultyAt(0).spawnInterval / 10);
assert.equal(difficultyAt(90).salvo, 3);
// Early rounds have time to learn; no projectiles are fired during the first 17 seconds.
for (let seed = 1; seed <= 20; seed++) {
  const g = new Crossing(seededRandom(seed));
  g.reset('run');
  for (let i = 0; i < 17 * 60; i++) {
    g.tick(1 / 60);
    assert(!g.events.some(e => e.type === 'enemyfire'));
    g.events = [];
  }
  assert(g.player.hull > 0);
}
const indexes = env.DB.sqlite
  .prepare(
    'EXPLAIN QUERY PLAN SELECT name, score FROM scores WHERE mode = ? AND created_at >= ? ORDER BY score DESC LIMIT 10',
  )
  .all('run', 0);
assert(indexes.some(x => x.detail.includes('idx_scores_mode_score')));
console.log(
  'PASS: deterministic replay, ranked save/read, idempotency, invalid names, cross-origin rejection, clock checks, source parsing, Fibonacci ramp, opening difficulty, leaderboard index.',
);

// Launch metrics count runs once and never expose player identifiers.
let metrics = await (await worker.fetch(req('/api/metrics'), env)).json();
assert.equal(metrics.starts, 1);
assert.equal(metrics.players, 1);
for (const event of ['complete', 'complete', 'share'])
  assert.equal((await worker.fetch(req('/api/events', {runId: session.id, event}, cookie), env)).status, 200);
assert.equal(
  (
    await worker.fetch(
      req('/api/events', {runId: session.id, event: 'complete'}, 'hormuz_player=00000000-0000-0000-0000-000000000000'),
      env,
    )
  ).status,
  404,
);
assert.equal(
  (await worker.fetch(req('/api/events', {runId: session.id, event: 'arbitrary'}, cookie), env)).status,
  400,
);
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now() - 86400000, session.id);
assert.equal((await worker.fetch(req('/api/runs', {mode: 'run', rules: RULES_VERSION}, cookie), env)).status, 201);
metrics = await (await worker.fetch(req('/api/metrics'), env)).json();
assert.equal(metrics.starts, 2);
assert.equal(metrics.players, 1);
assert.equal(metrics.replays, 1);
assert.equal(metrics.returningPlayers, 1);
assert.equal(metrics.completed, 1);
assert.equal(metrics.shared, 1);
assert(!JSON.stringify(metrics).includes(session.id));
assert(!JSON.stringify(metrics).includes('Captain Test'));
console.log('PASS: launch metrics, duplicate event protection, ownership, returning players, aggregate-only output.');
// Shared ghosts come from server replay, and cannot be overwritten with invented paths.
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now() - 110000, session.id);
response = await worker.fetch(req('/api/challenge', {runId: session.id, records, ticks}, cookie), env);
assert.equal(response.status, 200);
let ghost = await (await worker.fetch(req('/api/challenge?id=' + session.id), env)).json();
assert.equal(ghost.score, client.score);
assert.equal(ghost.seed, session.seed);
assert(ghost.trail.length > 1 && ghost.trail.length < 1060);
assert(!('player_id' in ghost));
response = await worker.fetch(req('/api/challenge', {runId: session.id, records: [], ticks: 1}, cookie), env);
assert.equal(response.status, 200);
assert.deepEqual(await (await worker.fetch(req('/api/challenge?id=' + session.id), env)).json(), ghost);
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now() - 86400000, session.id);
assert.equal((await worker.fetch(req('/api/challenge?id=' + session.id), env)).status, 200);
const oldChallengeRun = await (
  await worker.fetch(req('/api/runs', {mode: 'run', rules: RULES_VERSION, challenge: session.id}, cookie), env)
).json();
assert.equal(oldChallengeRun.seed, session.seed);
assert.equal(oldChallengeRun.ranked, false);
assert.equal(
  (await worker.fetch(req('/api/scores', {runId: oldChallengeRun.id, name: 'Practice', records, ticks}, cookie), env))
    .status,
  400,
);
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now() - 31 * 86400000, session.id);
assert.equal((await worker.fetch(req('/api/challenge?id=' + session.id), env)).status, 404);
console.log('PASS: verified ghost path, immutable challenge, matching seed, practice-only old courses, 30-day expiry.');

// Match the real browser lifecycle: one engine reused across starts with a fresh session seed.
for (const mode of ['run', 'block']) {
  const browser = new Crossing();
  for (const seed of [1234, 9876, 1234]) {
    browser.reset(mode, seed);
    let tick = 0;
    const input = [[0, 'i', [0, 0, 0, 0, null, null]]];
    while (browser.phase !== 'end' && tick < 6302) {
      browser.tick(1 / 60);
      browser.events = [];
      tick++;
    }
    const server = replay(seed, mode, input, tick);
    assert.equal(server.score, browser.score);
    assert.equal(server.time, browser.time);
    assert.equal(server.player.hull, browser.player.hull);
  }
}
console.log('PASS: browser lifecycle and server replay agree across seeds, modes and restarts.');

// The official status source is checked once per isolate at a time, and a failed check is remembered briefly.
{
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('offline');
  };
  try {
    const results = await Promise.all([1, 2, 3].map(() => worker.fetch(req('/api/status'), env)));
    assert.equal(calls, 1);
    assert.equal((await results[0].json()).status, 'unavailable');
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        '<p>Information related to shipping and seafarers</p><p>stranded on vessels unable to exit the Strait of Hormuz</p>',
      );
    };
    assert.equal((await (await worker.fetch(req('/api/status'), env)).json()).status, 'unavailable');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
}
console.log('PASS: status checks are coalesced and failures are cached.');

// Frequently polled reads are served from a short per-isolate cache that skips the rate limiter;
// Cache-Control: no-cache forces a fresh read, and a saved score invalidates its leaderboard.
{
  const plain = path => worker.fetch(new Request(origin + path), env);
  const used = () => env.DB.sqlite.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits').get().n;
  const first = await (await plain('/api/leaderboard?mode=block')).json();
  const before = used();
  env.DB.sqlite
    .prepare(
      "INSERT INTO scores (player_id, mode, name, score, duration, won, created_at, rules) VALUES ('cache-player', 'block', 'Cached', 5, 5, 0, ?, ?)",
    )
    .run(Date.now(), RULES_VERSION);
  assert.deepEqual(await (await plain('/api/leaderboard?mode=block')).json(), first);
  assert.equal(used(), before);
  const fresh = await (await worker.fetch(req('/api/leaderboard?mode=block'), env)).json();
  assert.equal(fresh.entries.length, first.entries.length + 1);
  assert(used() > before);
  const metrics = await plain('/api/metrics');
  assert.equal(metrics.headers.get('Cache-Control'), 'public, max-age=15');
  assert.equal((await plain('/api/leaderboard?mode=block')).headers.get('Cache-Control'), 'no-store');
  const assetsEnv = {...env, ASSETS: {fetch: async r => new Response('asset ' + new URL(r.url).pathname)}};
  const asset = await worker.fetch(new Request(origin + '/assets/game-abc.js'), assetsEnv);
  assert.equal(await asset.text(), 'asset /assets/game-abc.js');
  assert.equal(asset.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(asset.headers.get('Content-Security-Policy'), /frame-ancestors 'self' https:\/\/buildhop\.io/);
}
console.log('PASS: cached reads skip the limiter, no-cache bypasses, static requests proxy to the assets binding.');
