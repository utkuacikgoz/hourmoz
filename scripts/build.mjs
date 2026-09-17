import './validate-sponsors.mjs';
import {readFile, writeFile, mkdir, readdir, cp, rm, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {securityHeaders} from '../server/security.mjs';

// Output layout:
//   dist/public/          the site, for Workers Static Assets: pages, hashed JS and CSS under /assets, _headers
//   dist/server/index.js  the Worker, holding API code only
//   dist/.openai/         manifest and migrations for the legacy Sites host
// INLINE_ASSETS=1 additionally embeds dist/public into the Worker for a host without a static-assets layer.

const OUT = 'dist/public';
const hash = content => createHash('sha256').update(content).digest('hex').slice(0, 10);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

await rm('dist', {recursive: true, force: true});
await mkdir(OUT + '/assets', {recursive: true});

// 1. One bundle per page. three.js is tree-shaken into the game bundle; names carry a content hash.
const client = await build({
  entryPoints: ['public/game.js', 'public/sponsor.mjs', 'public/stats.mjs', 'public/sponsor-admin.mjs'],
  outdir: OUT + '/assets',
  entryNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  metafile: true,
});
const bundles = {};
for (const [file, meta] of Object.entries(client.metafile.outputs))
  if (meta.entryPoint) bundles[meta.entryPoint.replace(/^public\//, '')] = file.replace(/^dist\/public/, '');

// 2. Stylesheets, hashed. community.css imports style.css by its hashed name.
const style = await readFile('public/style.css', 'utf8');
const styleName = `/assets/style-${hash(style)}.css`;
await writeFile(OUT + styleName, style);
const communitySource = await readFile('public/community.css', 'utf8');
if (!communitySource.includes("@import url('/style.css');")) throw new Error('community.css must import /style.css');
const community = communitySource.replace("@import url('/style.css');", `@import url('${styleName}');`);
const communityName = `/assets/community-${hash(community)}.css`;
await writeFile(OUT + communityName, community);

// 3. Pages with their references rewritten, plus the remaining static files. Modules are only shipped bundled.
const refs = {
  'style.css': styleName,
  '/community.css': communityName,
  'game.js': bundles['game.js'],
  '/sponsor.mjs': bundles['sponsor.mjs'],
  '/stats.mjs': bundles['stats.mjs'],
  '/sponsor-admin.mjs': bundles['sponsor-admin.mjs'],
};
const skipped = new Set(['sponsors.json']);
for (const entry of await readdir('public', {withFileTypes: true})) {
  if (entry.isDirectory() || /\.(js|mjs|css)$/.test(entry.name) || skipped.has(entry.name)) continue;
  if (entry.name.endsWith('.html')) {
    let html = await readFile('public/' + entry.name, 'utf8');
    for (const [from, to] of Object.entries(refs)) html = html.replaceAll(`"${from}"`, `"${to}"`);
    const unresolved = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs|css))"/g)]
      .map(m => m[1])
      .filter(ref => !ref.startsWith('/assets/'));
    if (unresolved.length) throw new Error(`${entry.name} references unbundled files: ${unresolved.join(', ')}`);
    await writeFile(OUT + '/' + entry.name, html);
  } else await cp('public/' + entry.name, OUT + '/' + entry.name);
}

// 4. Headers for the static host: the same policy as the Worker, and immutable caching for hashed files.
const policy = securityHeaders(new URL('https://example.invalid/'));
await writeFile(
  OUT + '/_headers',
  [
    '/*',
    ...Object.entries(policy).map(([name, value]) => `  ${name}: ${value}`),
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
);

// 5. The Worker. The site is embedded only when a host has no static-assets layer.
const embedded = {};
async function collect(dir, base = '') {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const rel = base + '/' + entry.name;
    if (entry.isDirectory()) await collect(dir + '/' + entry.name, rel);
    else if (entry.name !== '_headers') {
      const binary = /\.(png|ico)$/.test(rel);
      embedded[rel] = {
        body: await readFile(dir + '/' + entry.name, binary ? 'base64' : 'utf8'),
        encoding: binary ? 'base64' : 'utf8',
        type: types[rel.slice(rel.lastIndexOf('.'))] ?? 'application/octet-stream',
      };
    }
  }
}
if (process.env.INLINE_ASSETS === '1') await collect(OUT);
await writeFile('server/assets.generated.mjs', 'export const assets=' + JSON.stringify(embedded) + ';');
await mkdir('dist/server', {recursive: true});
await build({
  entryPoints: ['server/worker.mjs'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
await mkdir('dist/.openai', {recursive: true});
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', {recursive: true});
const workerSize = (await stat('dist/server/index.js')).size;
const gameSize = (await stat(OUT + bundles['game.js'])).size;
console.log(
  `Built site (${Object.keys(bundles).length} bundles, game ${Math.round(gameSize / 1024)} KB) and Worker (${Math.round(workerSize / 1024)} KB${process.env.INLINE_ASSETS === '1' ? ', site embedded' : ''}).`,
);
