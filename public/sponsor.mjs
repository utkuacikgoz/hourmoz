const $ = id => document.getElementById(id);
const DAY = 86400000;
const payment = new URLSearchParams(location.search).get('payment');
let current = null,
  busy = false,
  bookingId = crypto.randomUUID();
const dayString = t => new Date(t).toISOString().slice(0, 10);
const shift = (day, n) => dayString(Date.parse(day + 'T00:00:00Z') + n * DAY);
const pretty = day =>
  new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const rangeText = (start, days) =>
  days === 1 ? pretty(start) : pretty(start) + ' – ' + pretty(shift(start, days - 1));
const dollars = cents => '$' + (cents % 100 ? (cents / 100).toFixed(2) : cents / 100);
async function api(path, data) {
  const r = await fetch(path, {
    method: data ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json'},
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let value = null;
  try {
    value = await r.json();
  } catch {}
  if (!r.ok || !value) throw new Error(value?.error || 'Could not connect.');
  return value;
}
const slotKind = () => ($('slot-week').checked ? 'week' : 'day');
const slotDays = () => (slotKind() === 'week' ? 7 : 1);
const range = (start, days) => Array.from({length: days}, (_, n) => shift(start, n));
// Default to today while most of the UTC day is left, otherwise tomorrow, skipping dates already taken.
function firstOpenDay(days) {
  for (let i = new Date().getUTCHours() >= 18 ? 1 : 0; i <= current.horizon; i++) {
    const start = shift(current.today, i);
    if (range(start, days).every(d => !current.booked.includes(d))) return start;
  }
  return current.today;
}
function availability() {
  const note = $('availability');
  delete note.dataset.state;
  if (!current) return false;
  const start = $('start').value,
    days = slotDays();
  if (!start) {
    note.textContent = 'Pick a start date.';
    return false;
  }
  if (start < current.today || start > shift(current.today, current.horizon)) {
    note.textContent = `Choose a date within the next ${current.horizon} days.`;
    return false;
  }
  const taken = range(start, days).filter(d => current.booked.includes(d));
  note.dataset.state = taken.length ? 'taken' : 'open';
  note.textContent = taken.length
    ? `Not available: ${taken.map(pretty).join(', ')} already booked.`
    : `${rangeText(start, days)} · ${dollars(current.prices[slotKind()])} · available`;
  return !taken.length;
}
function updateForm() {
  const open = availability();
  $('pay').disabled = busy || !current?.enabled || !open;
}
async function refresh() {
  try {
    current = await api('/api/sponsorship');
    $('test-signin').hidden = !current.testAvailable || current.enabled;
    $('current-name').textContent = current.sponsor?.name || 'Open today';
    $('current-detail').textContent = current.sponsor
      ? rangeText(current.sponsor.startDay, current.sponsor.days)
      : 'No sponsor yet. The tankers are sailing unnamed.';
    $('price-day').textContent = dollars(current.prices.day);
    $('price-week').textContent = dollars(current.prices.week);
    $('start').min = current.today;
    $('start').max = shift(current.today, current.horizon);
    if (!$('start').value) $('start').value = firstOpenDay(slotDays());
    const soon = current.booked.filter(d => d <= shift(current.today, current.horizon));
    $('booked').textContent = soon.length
      ? 'Already taken: ' + soon.map(pretty).join(', ') + '.'
      : `Every date in the next ${current.horizon} days is open.`;
    $('bookings').replaceChildren(
      ...current.bookings.map(b => {
        const row = document.createElement('div');
        row.className = 'booking-row';
        const name = document.createElement('span'),
          when = document.createElement('strong');
        name.textContent = b.name;
        when.textContent = rangeText(b.startDay, b.days);
        row.append(name, when);
        return row;
      }),
    );
    if (!current.bookings.length) $('bookings').textContent = 'No sponsors yet. Be the first name on the tankers.';
    if (!current.enabled) $('message').textContent = 'Sponsorship payments open soon.';
    else if (current.testMode && !payment)
      $('message').textContent = 'TEST MODE · No real money. Test bookings stay private.';
    updateForm();
  } catch (e) {
    $('message').textContent = e.message;
  }
}
for (const id of ['start', 'slot-day', 'slot-week']) {
  $(id).addEventListener('input', updateForm);
  $(id).addEventListener('change', updateForm);
}
$('booking-form').onsubmit = async e => {
  e.preventDefault();
  if (busy || !current?.enabled || !availability()) return;
  busy = true;
  $('pay').disabled = true;
  $('message').textContent = 'Opening secure checkout…';
  try {
    const data = await api('/api/sponsorship/bookings', {
      id: bookingId,
      name: $('name').value,
      url: $('url').value,
      slot: slotKind(),
      startDay: $('start').value,
      accepted: $('terms').checked,
    });
    location.assign(data.url);
  } catch (e) {
    $('message').textContent = e.message;
    bookingId = crypto.randomUUID();
    busy = false;
    void refresh();
  }
};
let checks = 0;
async function checkPayment() {
  if (!payment || document.hidden) return;
  try {
    const p = await api('/api/sponsorship/payment', {id: payment});
    const when = rangeText(p.startDay, p.days);
    $('message').textContent =
      p.status === 'paid'
        ? p.live
          ? `You’re live. Your name is on every tanker today (${when}).`
          : `Paid. Your sponsorship runs ${when}.`
        : p.status === 'refunded'
          ? 'Your dates were taken before the payment completed. A full refund has been issued.'
          : p.status === 'refund_pending'
            ? 'Your dates were taken before the payment completed. Your refund is processing.'
            : p.status === 'disputed'
              ? 'This payment is under dispute with your bank.'
              : p.status === 'expired'
                ? 'This booking expired before payment. Start a new booking.'
                : 'Checking payment…';
    if (['checkout', 'pending', 'refund_pending'].includes(p.status) && ++checks < 12) setTimeout(checkPayment, 5000);
    else if (p.status === 'checkout')
      $('message').textContent = 'Payment is still pending. Refresh after completing checkout.';
    void refresh();
  } catch (e) {
    $('message').textContent = e.message;
  }
}
await refresh();
void checkPayment();
setInterval(() => {
  if (!document.hidden && !busy) void refresh();
}, 30000);
