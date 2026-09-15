# Daily sponsorships

Configuration: `public/sponsors.json`. Currently no paid sponsor or booking contact is configured. Do not publish a fake sponsor to fill the slot.

- `bookingUrl`: the owner's approved public HTTPS booking/payment/contact link or `mailto:` address. Null hides the inquiry link.
- `schedule`: confirmed sponsor days. Each entry has a unique lowercase `id`, `day` (`YYYY-MM-DD`, UTC), `name` (up to 60 characters), and HTTPS `url`.
- One sponsor per UTC day. Builds reject duplicate days/IDs and invalid links/dates.
- The sponsor name links to its site, labelled “TODAY’S SPONSOR”, on the menu and results. Gameplay stays uninterrupted.
- Each day's placement starts and ends at UTC midnight, resolved on the server when the page loads. Already-open pages retain the placement they loaded; events after expiry are rejected.
- Add a confirmed booking to the schedule and deploy the updated source before its date. The schedule is public; do not put contracts, emails, payment details or secrets in it.

Inquiries and payment are handled through the configured link. This does not create a payment processor account, take payment, reserve inventory, or automatically confirm bookings. Agree price and dates with the sponsor before adding it. No prices, sponsors, sales or revenue have been invented.

## Measurement

`/stats.html` shows public aggregates for the last 30 days: visitors, visits, starts, completions, repeat plays, returning players, shares, challenge activity, traffic-source conversion, sponsor views/clicks and inquiry-link clicks. `/api/metrics` exposes the same aggregate data.

A view requires 50% visibility for one continuous second. Views and clicks count once per page visit across both placements. Client-reported counts can be blocked or manipulated, and are not audited billable impressions. Share counts do not confirm a social post; inquiry clicks do not confirm a booking. No revenue is inferred from clicks.

Source categories come from `utm_source` or referring-site categories; raw query strings and referral URLs are not stored. For campaigns use `?utm_source=reddit`, `x`, `instagram`, `tiktok`, `youtube`, `facebook`, or `linkedin`. Challenge links take priority. Unknown sources are grouped as “other”.

The existing anonymous leaderboard cookie identifies browsers; no analytics vendor key is needed. GPC/Do Not Track disables client analytics. Visit attribution begins with this release; historical runs are not retroactively attributed. Reports exclude records older than 30 days; subsequent visit/run requests clean up old records.
