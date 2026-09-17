const $ = id => document.getElementById(id);
let current = null,
  busy = false,
  bidId = crypto.randomUUID();
async function api(path, data) {
  const r = await fetch(path, {
    method: data ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json'},
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'Could not connect.');
  return value;
}
async function refresh() {
  try {
    current = await api('/api/auction');
    $('test-signin').hidden = !current.testAvailable || current.enabled;
    $('current-name').textContent = current.sponsor?.name || (current.highest ? 'Spot available' : 'Be the first.');
    $('current-price').textContent = current.highest ? '$' + current.highest / 100 : 'Opening bid: $5';
    $('amount').min = current.minimum / 100;
    if (!$('amount').value) $('amount').value = current.minimum / 100;
    $('pay').disabled = busy || !current.enabled;
    $('bids').replaceChildren(
      ...current.bids.map(b => {
        const row = document.createElement('div');
        row.className = 'bid-row';
        const name = document.createElement('span'),
          amount = document.createElement('strong');
        name.textContent = b.name;
        amount.textContent = '$' + b.amount / 100;
        row.append(name, amount);
        return row;
      }),
    );
    if (!current.bids.length) $('bids').textContent = 'No paid bids yet.';
    if (!current.enabled) $('message').textContent = 'Sponsorship payments open soon.';
    else if (current.testMode && !payment)
      $('message').textContent = 'TEST MODE · No real money. Test bids stay private.';
  } catch (e) {
    $('message').textContent = e.message;
  }
}
$('bid-form').onsubmit = async e => {
  e.preventDefault();
  if (busy || !current?.enabled) return;
  busy = true;
  $('pay').disabled = true;
  $('message').textContent = 'Opening secure checkout…';
  try {
    const data = await api('/api/auction/bids', {
      id: bidId,
      name: $('name').value,
      url: $('url').value,
      amount: Number($('amount').value) * 100,
      accepted: $('terms').checked,
    });
    location.assign(data.url);
  } catch (e) {
    $('message').textContent = e.message;
    bidId = crypto.randomUUID();
    busy = false;
    $('pay').disabled = false;
    void refresh();
  }
};
const payment = new URLSearchParams(location.search).get('payment');
let checks = 0;
async function checkPayment() {
  if (!payment || document.hidden) return;
  try {
    const p = await api('/api/auction/payment', {id: payment});
    $('message').textContent =
      p.status === 'paid'
        ? p.current
          ? 'You’re the sponsor. Your placement is live.'
          : 'Your sponsorship activated and has since been outbid.'
        : p.status === 'refunded'
          ? 'A higher bid won before yours. Your refund has been issued.'
          : p.status === 'refund_pending'
            ? 'A higher bid won before yours. Your refund is processing.'
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
}, 15000);
