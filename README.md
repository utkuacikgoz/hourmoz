# Is Hormuz Open?

A standalone naval arcade game with real Hormuz coastlines, a daily challenge, named leaderboards, and a sourced real-world status indicator. No ads.

## Run

- `npm install`
- `npm run build`
- `npm run dev` — opens an HTTP server at http://127.0.0.1:4173. Node 22 with experimental SQLite support is required for the local development server.
- `npm test` — simulation and API tests.

Open the HTTP URL; opening an HTML file directly cannot run the modules or leaderboard API.

## Game

WASD/arrows steer, Shift boosts, Space deploys a decoy or fires the deck gun. Mouse aiming and touch joystick controls are supported. Escape pauses.

Each run lasts up to 105 seconds. Fibonacci traffic pressure rises every 15 seconds: 1, 1, 2, 3, 5, 8, 13. There are no enemy missiles in the opening 18 seconds. Later stages increase traffic, projectile speed, firing frequency, and salvo size. Repairs and upgrades give players recovery opportunities. Active entities are bounded to protect rendering performance.

## Leaderboards

Cloudflare D1 stores ranked sessions and scores. The server issues a daily seed and replays recorded inputs with the same fixed-step engine before accepting a name and score. Client-supplied score totals are never trusted. One best score per anonymous browser identity and mode is listed each UTC day. Duplicate submissions are idempotent. Browser storage holds only local preferences and the local personal best.

Names are public to the site's audience. This is replay validation, not protection against bots or tool-assisted play. Changing game rules requires a new engine version and invalidating outstanding sessions before a public release.

## Real-world context

The IMO status endpoint checks the current official Middle East page and caches the result for ten minutes. A matching report about vessels unable to leave yields **Disrupted**, not a claim of total closure. Changed or unavailable source content yields **Unverified** or **Unavailable**. Source date and check time are shown separately. It is not an AIS feed or navigation advice.

- Coastline: Natural Earth 1:10m land, public domain, clipped to 54.3–58.6°E and 24.3–28.1°N. The course is a fictional gameplay route, not an official traffic separation scheme. Ship scale and terrain height are stylized.
- Historical incident: [UK government report on Stena Impero, July 2019](https://www.gov.uk/government/news/iran-tanker-seizure-uk-government-response).
- Current status: [IMO Middle East report](https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-strait-of-hormuz.aspx).

Three.js 0.180.0 is vendored with its MIT license. Sound is opt-in. Google Fonts are optional; system fonts are fallbacks. WebGL is required.
