import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Runs the deployable output (dist/public and dist/server) in local workerd with a local D1
// database, the same shape as production. Data persists in .local/preview between runs.
// Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AUCTION_OWNER_EMAIL, CF_ACCESS_AUD, TIP_URL,
// SPONSOR_DAY_PRICE and SPONSOR_WEEK_PRICE from the environment are passed through for local checks.
const root = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(join(root, 'dist/server/index.js'))) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
const port = Number(process.env.PORT || 8788);
const origin = `http://127.0.0.1:${port}`;
const state = join(root, '.local', 'preview');
mkdirSync(state, {recursive: true});
const vars = {APP_ORIGIN: origin};
for (const name of [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'AUCTION_OWNER_EMAIL',
  'CF_ACCESS_AUD',
  'TIP_URL',
  'SPONSOR_DAY_PRICE',
  'SPONSOR_WEEK_PRICE',
])
  if (process.env[name]) vars[name] = process.env[name];
const config = join(state, 'wrangler.json');
writeFileSync(
  config,
  JSON.stringify(
    {
      name: 'hourmuz-preview',
      main: join(root, 'dist/server/index.js'),
      compatibility_date: '2026-09-16',
      assets: {
        directory: join(root, 'dist/public'),
        binding: 'ASSETS',
        html_handling: 'auto-trailing-slash',
        not_found_handling: 'none',
        run_worker_first: ['/api/*', '/owner-login'],
      },
      vars,
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'hourmuz-preview',
          database_id: '00000000-0000-0000-0000-000000000000',
          migrations_dir: join(root, 'drizzle'),
        },
      ],
    },
    null,
    2,
  ),
);
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const env = {...process.env, WRANGLER_SEND_METRICS: 'false'};
const persist = ['--persist-to', join(state, 'data')];
const migrate = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, ...persist], {
  env,
  stdio: 'inherit',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
console.log(
  `\nPreview: ${origin}\nThe same site and Worker that deploy runs, on a local database in .local/preview. Press Ctrl+C to stop.\n`,
);
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
    '--show-interactive-dev-session=false',
    ...persist,
  ],
  {env, stdio: 'inherit'},
);
dev.on('exit', code => process.exit(code ?? 0));
