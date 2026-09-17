# Sponsor until outbid

One public sponsor spot, starting at $5 USD. Each takeover must exceed the highest successful bid by at least $1, in whole dollars. The whole new bid is a one-time payment. A paid placement has no expiry and no minimum duration: a higher confirmed payment replaces it. Open checkout sessions never change the public price.

## Runtime setup

Set these as Worker variables and encrypted secrets (see `docs/cloudflare.md`), never in source control or public files:

- `STRIPE_SECRET_KEY`: Stripe server key. Needs Checkout Sessions create/read and Refunds create permissions. Use test mode for integration checks first.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the endpoint below.
- `AUCTION_OWNER_EMAIL`: the site owner's Cloudflare Access sign-in email, used only on the server to authorize sponsor management. Never a public contact address.

Register `<APP_ORIGIN>/api/stripe/webhook` in Stripe with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. Do not enable live payments until a complete test checkout and a stale-checkout refund have been verified using the real Stripe test environment. Local tests mock Stripe; they do not verify account permissions, delivery, receipts, or payment settlement.

The public page is `/sponsor`; owner controls are `/sponsor-admin`. Owner access uses the Cloudflare Access identity supplied by the Worker runtime and an explicit server allowlist. The local dev server has no owner identity or payment credentials by default.

## Activation and race handling

The server creates an immutable bid before creating Stripe Checkout. Repeated attempts with the same ID reuse Stripe's idempotency key and session. Sponsor names and HTTPS URLs are validated; no user HTML is rendered or website content fetched.

Only signed Stripe webhook data or a server-retrieved Checkout Session can activate sponsorship. USD amount, session ID, bid metadata, client reference, payment status and live/test mode must match. A success-page URL alone proves nothing.

An atomic database comparison selects a new highest paid sponsor. Replayed events do not charge or refund twice. If an older/equal checkout completes after a higher bid was processed, it becomes `refund_pending`; the full amount is refunded with a stable Stripe idempotency key. Failure leaves that state intact for webhook retries. Refunds may take time to settle. The owner can inspect Stripe if a refund fails. Being outbid after activation does not refund a previously active placement.

Open game tabs refresh sponsor placement about once a minute and whenever the tab becomes visible. Sponsor clicks/views use the current sponsor ID, counted once per sponsor per visit. Only paid, visible, undisputed placements take part in the auction: if the highest sponsor is refunded, disputed or hidden, the next highest active sponsor is shown again and the minimum bid follows it. A dispute removes the placement until it is won; a lost dispute counts as a refund. Owner controls can hide/show a placement; refunds are managed in Stripe. Unpaid checkouts expire with their Stripe session, and a late completion still activates. Proactive moderation is not implemented.

Stripe collects email and payment details; the game stores no bidder email or card details. Bid/payment references remain in D1 for transaction reconciliation. Only paid sponsor names, amounts and dates are public. Analytics reports are public aggregates, not audited billable impressions or guaranteed revenue.

## Stats

`/stats` refreshes every 30 seconds while visible. Online means an anonymous browser with a visible game tab checking in within 90 seconds; multiple tabs count once. Expired presence is removed on later check-ins. Other totals cover the last 30 days: game starts, unique players, visitors, finishes, repeat plays, returning players, shares, traffic sources and sponsor engagement. GPC/Do Not Track opts out of client analytics. No all-time totals are invented for records that were already deleted.

## Legacy configuration

`public/sponsors.json` remains a fallback for already-booked dated placements. The paid takeover has priority. No paid sponsor is prefilled, and its former booking URL is superseded by `/sponsor`.
