import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {RULES_VERSION} from '../public/rules.mjs';
import {Crossing, seededRandom} from '../public/engine.mjs';

// Pins the simulation: a scripted run on fixed seeds must always produce the same result, and
// engine.mjs (hashed after minification, so comments and formatting do not count) must match the
// version that was pinned together with RULES_VERSION. Any change that could alter scores or
// recorded inputs must bump RULES_VERSION and re-pin with `npm run golden:update`.
const GOLDEN = new URL('./golden.json', import.meta.url);
const SEEDS = [20260917, 4242];

export function goldenRun(mode, seed) {
  const game = new Crossing();
  game.reset(mode, seed);
  const rng = seededRandom((seed ^ 0x9e3779b9) >>> 0);
  let ticks = 0;
  let actions = 0;
  while (game.phase === 'play' && ticks < 6302) {
    if (ticks % 90 === 0) {
      game.input.x = Math.round(rng() * 2 - 1);
      game.input.z = rng() < 0.5 ? -1 : 0;
    }
    game.input.boost = ticks % 600 < 120;
    game.input.fire = mode === 'block' && ticks % 12 === 0;
    if (mode === 'run' && ticks % 900 === 450) {
      game.ability();
      actions++;
    }
    if (mode === 'run' && ticks % 60 === 0 && game.payCheckpoint()) actions++;
    game.tick(1 / 60);
    game.events = [];
    ticks++;
  }
  return {
    ticks,
    time: Number(game.time.toFixed(4)),
    score: game.score,
    hull: Number(game.player.hull.toFixed(4)),
    win: game.win ?? null,
    delivered: game.delivered,
    stopped: game.stopped,
    escaped: game.escaped,
    nearMisses: game.nearMisses,
    actions,
  };
}

async function engineHash() {
  const source = readFileSync(new URL('../public/engine.mjs', import.meta.url), 'utf8');
  const {code} = await transform(source, {minify: true, format: 'esm', target: 'es2022'});
  return createHash('sha256').update(code).digest('hex');
}

const current = {
  rulesVersion: RULES_VERSION,
  engineHash: await engineHash(),
  runs: Object.fromEntries(
    SEEDS.flatMap(seed => ['run', 'block'].map(mode => [`${mode}:${seed}`, goldenRun(mode, seed)])),
  ),
};
let pinned = null;
try {
  pinned = JSON.parse(readFileSync(GOLDEN, 'utf8'));
} catch {}

if (process.argv.includes('--update')) {
  const refactor = process.argv.includes('--refactor');
  const sameRun = pinned && JSON.stringify(pinned.runs) === JSON.stringify(current.runs);
  if (pinned && pinned.engineHash !== current.engineHash && pinned.rulesVersion === current.rulesVersion && !refactor) {
    console.error(
      'engine.mjs changed but RULES_VERSION did not. Bump RULES_VERSION in public/rules.mjs first, or pass --refactor when scores and recorded inputs are provably unaffected.',
    );
    process.exit(1);
  }
  if (refactor && pinned && !sameRun) {
    console.error(
      '--refactor was given but the golden results changed, so this is a rules change. Bump RULES_VERSION instead.',
    );
    process.exit(1);
  }
  writeFileSync(GOLDEN, JSON.stringify(current, null, 1) + '\n');
  console.log('Updated tests/golden.json for RULES_VERSION ' + RULES_VERSION + '.');
  process.exit(0);
}

const hint = 'If the simulation changed, bump RULES_VERSION in public/rules.mjs and run: npm run golden:update';
assert(pinned, 'tests/golden.json is missing. Run: npm run golden:update');
assert.equal(
  current.engineHash,
  pinned.engineHash,
  'public/engine.mjs changed since the golden replay was pinned. ' + hint,
);
assert.equal(
  current.rulesVersion,
  pinned.rulesVersion,
  'RULES_VERSION changed without re-pinning the golden replay. ' + hint,
);
assert.deepEqual(current.runs, pinned.runs, 'Golden replay results differ. ' + hint);
for (const [name, result] of Object.entries(current.runs)) assert(result.ticks > 60, name + ' ended implausibly early');
console.log(
  'PASS: golden replays match for ' +
    Object.keys(current.runs).length +
    ' seed/mode pairs, engine hash pinned to RULES_VERSION ' +
    RULES_VERSION +
    '.',
);
