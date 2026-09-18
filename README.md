# Is Hormuz Open?

A standalone naval arcade game with real Hormuz coastlines, a daily challenge, named leaderboards, and a sourced real-world status indicator. No ad networks: the only placement is a sponsor of the day, whose name is painted on the tankers and sold at a fixed price on the sponsor page.

## Run

- `npm install`
- `npm run build` — writes the deployable site to `dist/public` (hashed bundles under `/assets`) and the API-only Worker to `dist/server`.
- `npm run dev` — opens an HTTP server at http://127.0.0.1:4173 that serves the unbundled files in `public/` with the production security headers.
- `npm run preview` — builds, then runs the deployable site and Worker in local workerd with a local database at http://127.0.0.1:8788, the same shape as the Cloudflare deployment (no account needed). Ranked runs, leaderboards, stats and the sponsor page all work locally; payments need Stripe test keys in the environment. Node 22 with experimental SQLite support is required for the local development server.
- `npm test` — simulation, golden replay, API, security, analytics and sponsorship tests.
- `npm run lint` and `npm run format` — ESLint and Prettier; CI runs both plus `npm run format:check`.
- `npm run deploy:check` — bundles the Worker with Wrangler in dry-run mode to validate the deploy configuration without credentials.
- `npm run test:browser` — after a build, runs the site and Worker in local workerd with a local D1 and drives a full round in headless Chromium (needs `npx playwright install chromium` once).

Deployment to Cloudflare is described in `docs/cloudflare.md`; sponsorship setup in `docs/sponsorships.md`.

Open the HTTP URL; opening an HTML file directly cannot run the modules or leaderboard API.

## Game

WASD/arrows steer, Shift boosts, Space deploys a decoy or fires the deck gun. Mouse aiming and touch joystick controls are supported. Escape pauses.

Each run lasts up to 105 seconds. Difficulty rises every 15 seconds using a Fibonacci-based curve. There are no enemy missiles in the opening 18 seconds. Later stages increase traffic, projectile speed, firing frequency, and salvo size. Repair pickups give players recovery opportunities. Active entities are bounded to protect rendering performance.

## Leaderboards

Cloudflare D1 stores ranked sessions and scores. The server issues a daily seed and replays recorded inputs with the same fixed-step engine before accepting a name and score. Client-supplied score totals are never trusted. One best score per anonymous browser identity and mode is listed each UTC day. Duplicate submissions are idempotent. Browser storage holds only local preferences and the local personal best.

Names are public to the site's audience. This is replay validation, not protection against bots or tool-assisted play. Changing game rules requires a new engine version and invalidating outstanding sessions before a public release.

## Real-world context

The IMO status endpoint checks the current official Middle East page and caches the result for ten minutes. A matching report about vessels unable to leave yields **Disrupted**, not a claim of total closure. Changed or unavailable source content yields **Unverified** or **Unavailable**. Source date and check time are shown separately. It is not an AIS feed or navigation advice.

- Coastline: Natural Earth 1:10m land, public domain, clipped to 54.3–58.6°E and 24.3–28.1°N. The course is a fictional gameplay route, not an official traffic separation scheme. Ship scale and terrain height are stylized.
- Historical incident: [UK government report on Stena Impero, July 2019](https://www.gov.uk/government/news/iran-tanker-seizure-uk-government-response).
- Current status: [IMO Middle East report](https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-strait-of-hormuz.aspx).

Three.js 0.180.0 is vendored with its MIT license. The game has no sound. Google Fonts are optional; system fonts are fallbacks. WebGL is required. Adding `?graphics=low` to the game URL starts at the lowest quality level (no shadows, reduced resolution) for weak devices; the game also lowers quality on its own when frames stay slow.

## Release checks

GitHub runs lint, formatting, the simulation, API and security checks, a Wrangler dry run, and the browser round-trip on every push and pull request. A manual "Live site check" workflow in the Actions tab fetches robots.txt, the sitemap and the home page from the live site as a plain client and as Googlebot, and prints what Cloudflare answers. When both check jobs pass on `main`, the deploy job applies pending D1 migrations and runs `wrangler deploy`, using the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; without them it skips. Worker secrets (owner email, Stripe keys, Access audience, rate-limit key) are set once with `wrangler secret put` and persist across deploys. Bump `public/rules.mjs` whenever simulation rules change, then run `npm run golden:update`: the golden replay test pins a hash of the engine to the current rules version and fails when either changes alone. Older sessions and scores are excluded from the current competition. Rollback uses a previously saved Sites version, with database migrations kept backward-compatible.

Rate limits use Cloudflare’s supplied client address, hashed per minute and keyed with `RATE_LIMIT_SECRET` when set, plus global request budgets. A client over its own cap never consumes the global budget, so one address cannot lock everyone else out. When that header is unavailable, requests share the fallback bucket. Distributed bots remain possible; watch request volume and tune limits before a large campaign. No raw client addresses are stored.
