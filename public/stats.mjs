const $ = id => document.getElementById(id);
let busy = false;
function cards(id, items, data) {
  $(id).replaceChildren(
    ...items.map(([label, key]) => {
      const card = document.createElement('div');
      card.className = 'metric';
      const number = document.createElement('strong'),
        title = document.createElement('span');
      number.textContent = Number(data[key] ?? 0).toLocaleString();
      title.textContent = label;
      card.append(number, title);
      return card;
    }),
  );
}
function table(id, rows) {
  $(id).replaceChildren(
    ...rows.map(values => {
      const tr = document.createElement('tr');
      for (const value of values) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    }),
  );
}
const rate = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
async function refresh() {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  $('error').textContent = '';
  try {
    const r = await fetch('/api/metrics', {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error();
    const data = await r.json();
    cards(
      'metrics',
      [
        ['Online now', 'online'],
        ['Games played', 'starts'],
        ['Unique players', 'players'],
        ['Visitors', 'visitors'],
      ],
      data,
    );
    cards(
      'extra-metrics',
      [
        ['Games finished', 'completed'],
        ['Repeat plays', 'replays'],
        ['Returning players', 'returningPlayers'],
        ['Games shared', 'shared'],
        ['Challenge games', 'challengeStarts'],
        ['Visits that played', 'playingVisits'],
      ],
      data,
    );
    table(
      'days',
      data.days.map(d => [d.day, d.players, d.starts, d.completed, d.shared]),
    );
    table(
      'sources',
      data.sources.map(r => [r.source, r.visits, r.playingVisits, rate(r.playingVisits, r.visits), r.starts, r.shared]),
    );
    table(
      'campaigns',
      data.campaigns.map(r => [r.name || r.sponsor, r.views, r.clicks, rate(r.clicks, r.views)]),
    );
    $('sponsor-empty').textContent = data.campaigns.length ? '' : 'No sponsor activity yet.';
    const dates = Array.from({length: 30}, (_, i) =>
        new Date(Date.parse(data.updatedAt) - (29 - i) * 86400000).toISOString().slice(0, 10),
      ),
      byDay = new Map(data.days.map(d => [d.day, d.starts])),
      max = Math.max(1, ...byDay.values());
    $('chart').replaceChildren(
      ...dates.map(day => {
        const count = byDay.get(day) || 0,
          bar = document.createElement('div');
        bar.style.height = (count / max) * 100 + '%';
        bar.title = day + ': ' + count + ' games';
        return bar;
      }),
    );
    $('chart-start').textContent = dates[0];
    $('updated').textContent = 'Updated ' + new Date(data.updatedAt).toLocaleTimeString();
  } catch {
    $('error').textContent = 'Stats unavailable. Existing numbers may be out of date.';
  } finally {
    busy = false;
    $('refresh').disabled = false;
  }
}
$('refresh').onclick = refresh;
void refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});
