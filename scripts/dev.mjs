import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {localDB} from './local-db.mjs';
import {securityHeaders} from '../server/security.mjs';
import worker from '../dist/server/index.js';
// Optional sponsorship settings from the shell, so the tip link and prices can be checked locally.
const env = {DB: localDB('.local/game.sqlite')};
for (const name of ['TIP_URL', 'SPONSOR_DAY_PRICE', 'SPONSOR_WEEK_PRICE'])
  if (process.env[name]) env[name] = process.env[name];
const types = {
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  png: 'image/png',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain',
};
// Static files are served straight from public/ with the same security headers as production.
createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request('http://127.0.0.1:4173' + req.url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    let response;
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/owner-login')) {
      const path = new URL(request.url).pathname;
      try {
        const file = 'public' + (path === '/' ? '/index.html' : path);
        // Clean page paths mirror the static host, which serves /sponsor for sponsor.html.
        const data = await readFile(file).catch(() => readFile(file + '.html'));
        const ext = path.split('.').pop();
        response = new Response(data, {
          headers: {'Content-Type': types[ext] ?? 'text/html', ...securityHeaders(new URL(request.url))},
        });
      } catch {
        response = new Response('Not found', {status: 404});
      }
    } else response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('Server error');
  }
}).listen(4173, '127.0.0.1', () => console.log('Game preview: http://127.0.0.1:4173'));
