# Sponsor of the day

One sponsor at a time, at a fixed price: **sponsor of the day** ($15) or **sponsor of the week** (seven consecutive days, $59). Days run 00:00 to 24:00 UTC and can be booked up to 60 days ahead. The sponsor's name is painted across the deck of every tanker in the game and shown with a link on the menu ("Today's sponsor") and the results screen ("Delivered by"). A booked date cannot be taken by anyone else; there is no bidding.

Prices are whole US cents in the Worker variables `SPONSOR_DAY_PRICE` and `SPONSOR_WEEK_PRICE` (defaults 1500 and 5900, valid range 100 to 1000000). Changing them affects new checkouts only.

## Tip link

`TIP_URL` is an optional HTTPS Stripe Payment Link. When it is set, the results screen shows "Tip the captain" pointing at it and `/api/sponsor` returns it as `tipUrl`. Create the link in the Stripe dashboard (Payment Links → New; "customer chooses price" works well), then either add `"TIP_URL": "https://buy.stripe.com/…"` to `vars` in `wrangler.jsonc` or run `wrangler secret put TIP_URL` to keep it out of the repository. The game stores nothing about tips; Stripe has the records.

## Runtime setup

Set these as encrypted Worker secrets (see `docs/cloudflare.md`), never in source control or public files:

- `STRIPE_SECRET_KEY`: Stripe server key. Needs Checkout Sessions create/read and Refunds create permissions. Use test mode for integration checks first.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the endpoint below.
- `AUCTION_OWNER_EMAIL`: the site owner's Cloudflare Access sign-in email, used only on the server to authorize sponsor management. Never a public contact address.

Register `<APP_ORIGIN>/api/stripe/webhook` in Stripe with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. Do not enable live payments until a complete test checkout, a rejected double booking and a stale-hold refund have been verified in the real Stripe test environment. Local tests mock Stripe; they do not verify account permissions, delivery, receipts or settlement.

The public page is `/sponsor`; owner controls are `/sponsor-admin`. Owner access uses the Cloudflare Access identity supplied by the Worker runtime and an explicit server allowlist. The local dev server has no owner identity or payment credentials by default.

## Booking and race handling

Booking is a reservation in two steps:

1. `POST /api/sponsorship/bookings` validates the name, HTTPS URL, slot (`day` or `week`) and start date, then inserts the booking and one `sponsor_days` row per date in a single transaction. The primary key on (day, environment) makes two bookings for the same date impossible: the losing transaction rolls back and the visitor is told which date was taken. The dates are held for 45 minutes. The Stripe Checkout it opens expires after 35 minutes, and a booking can reopen its checkout only during its first 10 minutes, so a checkout never outlives its hold.
2. Only signed webhook data or a server-retrieved Checkout Session activates the placement. Session id, mode, currency, amount, booking reference and live/test mode must match. Fulfilment claims every date of the booking again (`ON CONFLICT DO NOTHING`) and marks it paid only if it holds all of them; otherwise it becomes `refund_pending` and the full amount is refunded with a stable idempotency key. Replayed events never charge or refund twice, and a failed refund stays pending for the next webhook or status check.

Holds older than 45 minutes are released by the next booking attempt, and `checkout.session.expired` releases them at once. A payment that completes after its hold was released still wins when nobody else took the dates in between.

`charge.refunded` removes the placement and frees its dates. A dispute removes the placement from the game but keeps the dates reserved until it closes: won restores it, lost counts as a refund. The owner can hide or show a placement on `/sponsor-admin`; refunds are issued in Stripe, and a full refund frees the dates through the webhook.

Test-mode bookings (a Stripe key containing `_test_`) are stored separately, are visible only to the signed-in owner on `/sponsor`, and never appear in the game. To see the deck lettering locally, run `npm run dev`, insert a paid row for today into `sponsor_slots` and `sponsor_days` in `.local/game.sqlite`, and open the game.

Open game tabs refresh the sponsor about once a minute and whenever the tab becomes visible; the tanker lettering follows in the same refresh. Sponsor views and clicks are counted once per sponsor per visit.

## Data

Stripe collects email and payment details; the game stores the sponsor name, website, dates, amount, status and Stripe's session and payment references for reconciliation. Paid sponsor names and dates are public; amounts and buyer identifiers are not. Booking rows that never completed checkout are deleted after 30 days. Analytics reports are public aggregates, not audited impressions or guaranteed revenue.

## Stats

`/stats` refreshes every 30 seconds while visible. Online means an anonymous browser with a visible game tab checking in within 90 seconds; multiple tabs count once. Expired presence is removed on later check-ins. Other totals cover the last 30 days: game starts, unique players, visitors, finishes, repeat plays, returning players, shares, traffic sources and sponsor engagement. GPC/Do Not Track opts out of client analytics. No all-time totals are invented for records that were already deleted.
