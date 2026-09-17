import assert from 'node:assert/strict';
import {readFileSync, statSync, existsSync} from 'node:fs';

// The build must produce a self-consistent static site and a Worker that holds only API code.
const site = 'dist/public';
const headers = readFileSync(site + '/_headers', 'utf8');
assert.match(headers, /^\/\*\n(?: {2}[A-Za-z-]+: .+\n)+/m, '_headers starts with a rule for every path');
assert.match(headers, /Content-Security-Policy: default-src 'self'/);
assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
assert.match(headers, /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);

for (const page of ['index.html', 'sponsor.html', 'stats.html', 'sponsor-admin.html']) {
  const html = readFileSync(`${site}/${page}`, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs|css))"/g)].map(m => m[1]);
  assert(refs.length >= 2, page + ' references a stylesheet and a script');
  for (const ref of refs) {
    assert(ref.startsWith('/assets/'), `${page} references hashed asset ${ref}`);
    assert(existsSync(site + ref), `${ref} exists`);
  }
  assert(!html.includes('onclick='), page + ' has no inline handlers');
}
const community = readFileSync(
  site + readFileSync(site + '/sponsor.html', 'utf8').match(/href="(\/assets\/community-[^"]+)"/)[1],
  'utf8',
);
assert.match(
  community,
  /@import url\('\/assets\/style-[a-f0-9]+\.css'\);/,
  'community.css imports the hashed style.css',
);
assert(!existsSync(site + '/vendor'), 'vendored three.js is only shipped inside the game bundle');
assert(!existsSync(site + '/engine.mjs'), 'raw modules are not published');

const worker = readFileSync('dist/server/index.js', 'utf8');
assert(statSync('dist/server/index.js').size < 350 * 1024, 'Worker stays under 350 KB without embedded assets');
assert(!worker.includes('PCFSoftShadowMap'), 'Worker does not contain the renderer');
assert(!worker.includes('<!doctype html>'), 'Worker embeds no pages by default');
const game = readFileSync(site + '/index.html', 'utf8').match(/src="(\/assets\/game-[^"]+)"/)[1];
assert(statSync(site + game).size < 900 * 1024, 'game bundle stays under 900 KB');
console.log(
  'PASS: static site has hashed assets, headers and no raw modules; Worker holds API code only; size budgets hold.',
);
