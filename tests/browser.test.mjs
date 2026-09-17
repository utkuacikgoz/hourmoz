import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// End-to-end check of the deployable output: the static site and the Worker run in local workerd
// against a local D1, and a headless browser loads the game, plays a round, saves a score and
// restarts. Run `npm run build` first; `npm run test:browser` runs this file.
const root = fileURLToPath(new URL('..', import.meta.url));
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const env = {...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true'};
const work = mkdtempSync(join(tmpdir(), 'hourmoz-browser-'));
const port = await new Promise(resolve => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const {port} = probe.address();
    probe.close(() => resolve(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const config = join(work, 'wrangler.json');
writeFileSync(
  config,
  JSON.stringify({
    name: 'hourmuz-browser-test',
    main: join(root, 'dist/server/index.js'),
    compatibility_date: '2026-09-16',
    assets: {
      directory: join(root, 'dist/public'),
      binding: 'ASSETS',
      html_handling: 'auto-trailing-slash',
      not_found_handling: 'none',
      run_worker_first: ['/api/*', '/owner-login'],
    },
    vars: {APP_ORIGIN: origin},
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'hourmuz-browser-test',
        database_id: '00000000-0000-0000-0000-000000000000',
        migrations_dir: join(root, 'drizzle'),
      },
    ],
  }),
);
const migrate = spawnSync(
  wrangler,
  ['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', join(work, 'state')],
  {env, encoding: 'utf8'},
);
assert.equal(migrate.status, 0, 'migrations applied locally:\n' + migrate.stdout + migrate.stderr);
const dev = spawn(
  wrangler,
  [
    'dev',
    '--config',
    config,
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    join(work, 'state'),
    '--show-interactive-dev-session=false',
  ],
  {env, detached: true, stdio: ['ignore', 'pipe', 'pipe']},
);
let devLog = '';
dev.stdout.on('data', chunk => (devLog += chunk));
dev.stderr.on('data', chunk => (devLog += chunk));
const stop = () => {
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
const deadline = Date.now() + 90000;
let ready = false;
while (Date.now() < deadline && !ready) {
  try {
    ready = (await fetch(origin + '/sponsor', {signal: AbortSignal.timeout(2000)})).status === 200;
  } catch {}
  if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(ready, 'local workerd came up:\n' + devLog.slice(-2000));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const context = await browser.newContext({viewport: {width: 720, height: 480}});
  const page = await context.newPage();
  // Diagnostics for the CI log: focus changes and long frames explain any unexpected pause.
  await page.addInitScript(() => {
    window.__events = [];
    window.addEventListener('blur', () => window.__events.push('blur@' + Math.round(performance.now())));
    window.addEventListener('focus', () => window.__events.push('focus@' + Math.round(performance.now())));
    document.addEventListener('visibilitychange', () =>
      window.__events.push(document.visibilityState + '@' + Math.round(performance.now())),
    );
    let previous = performance.now();
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback =>
      raf(now => {
        if (now - previous > 250) window.__events.push('gap' + Math.round(now - previous) + '@' + Math.round(now));
        previous = now;
        callback(now);
      });
  });
  const errors = [];
  page.on('pageerror', error => errors.push('page error: ' + error.message));
  page.on('console', message => {
    // Font requests may be blocked on restricted networks; everything else must be clean.
    if (message.type() === 'error' && !/ERR_CERT|fonts\.g/.test(message.text())) errors.push(message.text());
  });

  // Low graphics keeps software rendering on a CI runner fast enough to play a whole round.
  const landing = await page.goto(origin + '/?graphics=low', {waitUntil: 'load'});
  assert.equal(landing.status(), 200);
  assert.match(
    landing.headers()['content-security-policy'] ?? '',
    /script-src 'self'/,
    'CSP header served with the page',
  );
  await page.waitForTimeout(1500);
  assert(await page.locator('#menu').isVisible(), 'menu visible');
  assert(!(await page.locator('#load-error').isVisible()), 'WebGL initialised');
  assert.match(await page.title(), /game/i);

  await page.bringToFront();
  await page.click('#deploy');
  await page.waitForTimeout(1500);
  assert(await page.locator('#hud').isVisible(), 'HUD visible after PLAY');
  const diagnostics = async () =>
    JSON.stringify({
      events: await page.evaluate(() => window.__events.slice(-12)),
      focus: await page.evaluate(() => document.hasFocus()),
      loadError: await page.locator('#load-error').isVisible(),
    });
  assert.equal(
    await page.locator('#pause-screen').isVisible(),
    false,
    'game is not paused right after starting ' + (await diagnostics()),
  );

  const started = Date.now();
  let ended = false;
  let step = 0;
  while (Date.now() - started < 300000) {
    if (await page.locator('#end-screen').isVisible()) {
      ended = true;
      break;
    }
    assert.equal(
      await page.locator('#pause-screen').isVisible(),
      false,
      'no automatic pause during play ' + (await diagnostics()),
    );
    const side = step++ % 2 ? 'a' : 'd';
    await page.keyboard.down('w');
    await page.keyboard.down(side);
    await page.waitForTimeout(500);
    await page.keyboard.up(side);
    await page.keyboard.up('w');
    if (step % 6 === 0) await page.keyboard.press('Space');
  }
  assert(ended, 'the round reached the results screen (clock ' + (await page.locator('#clock').textContent()) + ')');
  await page.waitForTimeout(1500);
  const title = await page.locator('#end-title').innerText();
  assert(title.length > 3, 'results title shown: ' + title);
  assert.match(await page.locator('#end-kicker').textContent(), /DAILY CHALLENGE/);
  assert.equal(
    await page.locator('#score-form').evaluate(form => form.hidden),
    false,
    'ranked run offers the score form',
  );

  await page.fill('#player-name', 'CI Captain');
  await page.click('#save-score');
  await page.waitForFunction(
    () => /today|already|could not|expired|allows/i.test(document.getElementById('save-message').textContent),
    null,
    {timeout: 15000},
  );
  const saved = await page.locator('#save-message').textContent();
  assert.match(saved, /#\d+ today/, 'score saved and ranked: ' + saved);
  await page.waitForFunction(
    () => document.getElementById('end-leaderboard').textContent.includes('CI Captain'),
    null,
    {timeout: 10000},
  );

  await page.click('#retry');
  await page.waitForTimeout(1500);
  assert(await page.locator('#hud').isVisible(), 'PLAY AGAIN starts a new round');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(await page.locator('#pause-screen').isVisible(), 'Escape pauses');

  for (const [path, text] of [
    ['/sponsor', 'Sponsor name'],
    ['/stats', 'Games played'],
    ['/privacy', 'What we keep'],
    ['/terms', 'How it works'],
  ]) {
    const response = await page.goto(origin + path, {waitUntil: 'load'});
    assert.equal(response.status(), 200, path);
    await page.waitForTimeout(800);
    // Headings are upper-cased by CSS, so compare case-insensitively.
    const body = (await page.locator('body').innerText()).toLowerCase();
    assert(body.includes(text.toLowerCase()), `${path} shows "${text}"`);
  }
  await page.goto(origin + '/stats', {waitUntil: 'load'});
  await page.waitForFunction(() => document.querySelectorAll('#metrics .metric').length >= 2, null, {timeout: 15000});
  const played = await page.locator('#metrics .metric').nth(1).locator('strong').textContent();
  assert(Number(played.replace(/\D/g, '')) >= 1, 'stats count the round: ' + played);
  assert.deepEqual(errors, [], 'no browser errors');
  console.log(
    'PASS: built site and Worker serve the game in workerd; a round plays to the results screen, the score ranks, restart and pages work.',
  );
} finally {
  await browser.close();
  stop();
  await new Promise(resolve => setTimeout(resolve, 1500));
  rmSync(work, {recursive: true, force: true});
}
