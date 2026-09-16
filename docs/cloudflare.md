# Deploy to your Cloudflare account

The repository now has a Wrangler configuration for a direct Worker deployment. It is intentionally not deployable as a complete game until the account-specific D1 binding and runtime settings are configured. The existing Sites manifest remains for rollback; this workflow does not deploy to Sites.

1. Create a D1 database named `hourmuz` in the selected Cloudflare account. Add the real database ID to `wrangler.jsonc` under `d1_databases` with binding `DB`, database_name `hourmuz`, and migrations_dir `drizzle`. Do not use a fabricated ID.
2. Authenticate Wrangler against that account, apply the migrations using `wrangler d1 migrations apply DB --remote`, and deploy using `wrangler deploy`. The configuration's build command bundles the existing Worker; no static-assets router is used.
3. Set `APP_ORIGIN` to the actual HTTPS deployed origin (no path), `AUCTION_OWNER_EMAIL` to the owner email, and `CF_ACCESS_AUD` to the Access application audience. Preserve `AUTH_PROVIDER=cloudflare-access`. Put `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` into encrypted Worker secrets. The keys previously saved in Sites do not automatically transfer.
4. Configure a Cloudflare Access application with an allow policy for the owner's email. During Stripe testing, protect `/sponsor.html`, `/sponsor-admin.html` and `/api/auction*` using this same audience. Leave the game, stats and Stripe webhook public. Owner identity comes from runtime `ctx.access`, with audience and email checked in server code. Spoofed identity headers cannot authorize an owner.
5. Test with Stripe test keys. Test bids are stored separately and never appear in the game or live paid-bid history. Register the new origin's `/api/stripe/webhook` endpoint in Stripe; the old `chatgpt.site` webhook does not follow a domain move. Confirm the $5 purchase, $6 takeover and stale-payment refund.
6. Before live launch, narrow Access protection to `/sponsor-admin.html` and `/api/auction/admin` so sponsor checkout is public. Keep the audience configured. Switch to live Stripe keys and the live endpoint signing secret only after real test-mode verification. No live payment is authorized by merely running tests.
7. After the domain is owned and active in Cloudflare, bind it as a Worker Custom Domain. Update APP_ORIGIN and Stripe webhook URLs to that verified domain. Update social-card metadata URLs before final launch. Consider disabling workers.dev once the domain and Access policy work.

Current data remains on the original managed D1 database. A fresh Cloudflare D1 database does not transfer leaderboards, analytics or sponsor records. Export/import requires a separate data migration before cutting over if that history is needed.

Owner Access must be verified on the deployed Worker before payments are enabled. Missing runtime Access identity fails closed. No Cloudflare account, database, route, DNS or billing changes have been made by preparing these files.
