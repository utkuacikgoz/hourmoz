const $ = id => document.getElementById(id);
const DAY = 86400000;
const pretty = day =>
  new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const rangeText = (start, days) =>
  days === 1
    ? pretty(start)
    : pretty(start) + ' – ' + pretty(new Date(Date.parse(start + 'T00:00:00Z') + (days - 1) * DAY).toISOString());
async function refresh() {
  try {
    const r = await fetch('/api/sponsorship/admin');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    $('message').textContent = '';
    $('bookings').replaceChildren(
      ...data.bookings.map(b => {
        const div = document.createElement('div');
        div.className = 'admin-row';
        const title = document.createElement('h2'),
          text = document.createElement('p'),
          link = document.createElement('a'),
          button = document.createElement('button');
        title.textContent = b.name + ' · ' + rangeText(b.startDay, b.days) + ' · $' + b.amount / 100;
        text.textContent = (b.testMode ? 'TEST · ' : '') + b.status + (b.hidden ? ' · hidden' : '');
        link.href = b.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = b.url;
        button.textContent = b.hidden ? 'Show' : 'Hide';
        button.onclick = async () => {
          button.disabled = true;
          try {
            const r = await fetch('/api/sponsorship/admin', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({id: b.id, action: b.hidden ? 'show' : 'hide'}),
            });
            if (!r.ok) throw new Error('Could not update the booking.');
            await refresh();
          } catch (e) {
            $('message').textContent = e.message;
            button.disabled = false;
          }
        };
        div.append(title, text, link, document.createElement('br'), button);
        return div;
      }),
    );
    if (!data.bookings.length) $('message').textContent = 'No bookings yet.';
  } catch (e) {
    $('message').textContent = e.message;
  }
}
$('refresh').onclick = refresh;
void refresh();
