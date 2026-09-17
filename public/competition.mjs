import {landing, analyticsEnabled} from './analytics.mjs';
import {RULES_VERSION} from './rules.mjs';
import {coastlines} from './geography.mjs';
const $ = id => document.getElementById(id);
let selected = 'run',
  result = null,
  boardRequest = 0;
export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {'Content-Type': 'application/json', ...options.headers},
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not connect. Try again.');
  return data;
}
export async function beginRanked(mode) {
  const visit = await landing;
  try {
    return await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        analytics: analyticsEnabled,
        visitId: visit?.id,
        rules: RULES_VERSION,
        challenge: new URLSearchParams(location.search).get('ghost'),
      }),
    });
  } catch {
    return null;
  }
}
export async function loadGhost(mode, seed) {
  const id = new URLSearchParams(location.search).get('ghost');
  if (!id) return null;
  try {
    const ghost = await api('/api/challenge?id=' + encodeURIComponent(id));
    if (ghost.rules !== RULES_VERSION || ghost.mode !== mode || ghost.seed !== seed) throw new Error();
    return ghost;
  } catch {
    $('challenge-copy').textContent = 'Challenge ended. Play today’s course.';
    return null;
  }
}
export function setCompetitionMode(mode) {
  selected = mode;
}
function rows(container, entries) {
  container.replaceChildren();
  if (!entries.length) {
    const p = document.createElement('p');
    p.textContent = 'No scores yet.';
    container.append(p);
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const rank = document.createElement('span'),
      name = document.createElement('span'),
      score = document.createElement('strong');
    rank.textContent = String(i + 1).padStart(2, '0');
    name.textContent = entry.name;
    score.textContent = entry.score.toLocaleString();
    row.append(rank, name, score);
    container.append(row);
  });
}
async function loadBoard(mode, compact = false) {
  const container = $(compact ? 'end-leaderboard' : 'leaderboard-rows'),
    request = ++boardRequest;
  container.textContent = 'Loading scores…';
  try {
    const data = await api('/api/leaderboard?mode=' + mode);
    if (!compact && request !== boardRequest) return;
    if (compact && !data.entries.length) container.replaceChildren();
    else rows(container, compact ? data.entries.slice(0, 3) : data.entries);
    $('board-date').textContent = data.day + ' · UTC';
  } catch (e) {
    container.replaceChildren();
    const p = document.createElement('p');
    p.textContent = e.message;
    const b = document.createElement('button');
    b.className = 'retry-board';
    b.textContent = 'Retry';
    b.onclick = () => loadBoard(mode, compact);
    container.append(p, b);
  }
}
export function drawRunChart(samples) {
  const c = $('run-chart'),
    ctx = c.getContext('2d'),
    w = c.width,
    h = c.height;
  ctx.clearRect(0, 0, w, h);
  if (samples.length < 2) return;
  const max = Math.max(1, ...samples.map(s => s[1]));
  ctx.strokeStyle = '#ffc07a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach(([t, score], i) => {
    const x = 10 + (t / 105) * (w - 20),
      y = h - 13 - (score / max) * (h - 24);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}
function track(event) {
  if (analyticsEnabled && result?.session)
    void api('/api/events', {
      method: 'POST',
      body: JSON.stringify({runId: result.session.id, event}),
      keepalive: true,
    }).catch(() => {});
}
export function finishCompetition(data, samples) {
  result = data;
  track('complete');
  $('share-score').disabled = !!data.session;
  if (data.session)
    void api('/api/challenge', {
      method: 'POST',
      body: JSON.stringify({runId: data.session.id, records: data.records, ticks: data.ticks}),
    })
      .then(saved => {
        data.challengeId = saved.id;
      })
      .catch(() => {})
      .finally(() => {
        if (result === data) $('share-score').disabled = false;
      });
  drawRunChart(samples);
  $('score-form').hidden = data.session?.ranked === false;
  $('share-score').textContent = 'CHALLENGE FRIENDS';
  $('save-score').disabled = !data.session || data.session.ranked === false;
  $('save-message').textContent = data.session
    ? data.session.ranked === false
      ? 'Practice challenge · outside today’s rankings.'
      : ''
    : 'Offline run · score not ranked.';
  try {
    $('player-name').value = localStorage.getItem('hormuz-name') || '';
  } catch {}
  loadBoard(data.mode, true);
}
export function setupCompetition(pause) {
  $('score-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!result?.session) return;
    const name = $('player-name').value.trim();
    $('save-score').disabled = true;
    $('save-message').textContent = 'Saving…';
    try {
      const saved = await api('/api/scores', {
        method: 'POST',
        body: JSON.stringify({name, runId: result.session.id, records: result.records, ticks: result.ticks}),
      });
      try {
        localStorage.setItem('hormuz-name', name);
      } catch {}
      result.name = name;
      result.rank = saved.rank;
      $('save-message').textContent = saved.alreadySaved ? 'Score already saved.' : `#${saved.rank} today`;
      $('score-form').hidden = true;
      loadBoard(result.mode, true);
    } catch (error) {
      $('save-message').textContent = error.message;
      $('save-score').disabled = false;
    }
  });
  $('show-leaderboard').onclick = () => {
    pause(true);
    $('leaderboard-dialog').showModal();
    document.querySelectorAll('[data-board]').forEach(b => b.classList.toggle('active', b.dataset.board === selected));
    loadBoard(selected);
  };
  $('close-leaderboard').onclick = () => $('leaderboard-dialog').close();
  document.querySelectorAll('[data-board]').forEach(
    b =>
      (b.onclick = () => {
        document.querySelectorAll('[data-board]').forEach(x => x.classList.toggle('active', x === b));
        loadBoard(b.dataset.board);
      }),
  );
  $('status-toggle').onclick = () => {
    $('status-panel').classList.toggle('hidden');
    if (!$('status-panel').classList.contains('hidden')) pause(true);
  };
  $('close-status').onclick = () => $('status-panel').classList.add('hidden');
  $('save-card').onclick = saveCard;
  $('share-score').onclick = async () => {
    if (!result) return;
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('challenge', result.mode);
    url.searchParams.set('score', String(result.score));
    if (result.challengeId) url.searchParams.set('ghost', result.challengeId);
    url.searchParams.set('day', result.session?.day || new Date().toISOString().slice(0, 10));
    const text = `${result.name || 'I'} scored ${result.score.toLocaleString()} as ${result.mode === 'run' ? 'a tanker captain' : 'an Iranian patrol'} in Is Hormuz Open? Same course. Beat that. Race my ghost.`;
    try {
      if (navigator.share) await navigator.share({title: 'Is Hormuz Open?', text, url: url.href});
      else {
        await navigator.clipboard.writeText(text + ' ' + url.href);
        $('share-score').textContent = 'LINK COPIED';
      }
      track('share');
    } catch (e) {
      if (e.name !== 'AbortError') {
        $('save-message').textContent = 'Copy your challenge link:';
        const input = document.createElement('input');
        input.value = url.href;
        input.readOnly = true;
        input.style.width = '100%';
        $('save-message').append(input);
        input.select();
      }
    }
  };
  const params = new URLSearchParams(location.search),
    challenge = params.get('challenge'),
    score = Number(params.get('score'));
  if (['run', 'block'].includes(challenge) && Number.isFinite(score) && score > 0 && score < 1000000) {
    const current = params.get('day') === new Date().toISOString().slice(0, 10);
    $('challenge-copy').textContent = current ? `Beat ${score.toLocaleString()}.` : '';
  }
  refreshStatus();
  setInterval(refreshStatus, 600000);
}
async function refreshStatus() {
  try {
    const data = await api('/api/status');
    $('strait-status').textContent = data.label.toUpperCase();
    $('status-heading').textContent = data.label;
    $('status-detail').textContent = data.detail;
    $('status-source').href = data.sourceUrl;
    $('status-time').textContent = [
      data.sourceDate ? 'Source data: ' + data.sourceDate : null,
      data.checkedAt ? 'Checked ' + new Date(data.checkedAt).toLocaleString() : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } catch {
    $('strait-status').textContent = 'UNAVAILABLE';
    $('status-heading').textContent = 'Status unavailable';
    $('status-detail').textContent = 'The official source could not be checked.';
  }
}

async function saveCard() {
  if (!result) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a2b38';
  ctx.fillRect(0, 0, 1200, 630);
  ctx.save();
  ctx.beginPath();
  ctx.rect(620, 0, 580, 630);
  ctx.clip();
  ctx.fillStyle = '#3b5654';
  for (const poly of coastlines) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => {
      const x = 650 + (lon - 55.0) * 220,
        y = 80 + (27.6 - lat) * 210;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#ffc07a';
  ctx.font = 'bold 64px Arial';
  ctx.fillText('IS HORMUZ OPEN?', 60, 105);
  ctx.fillStyle = '#bed3cb';
  ctx.font = '24px Arial';
  ctx.fillText(
    (result.name || 'A player') + ' · ' + (result.mode === 'run' ? 'Tanker captain' : 'Iranian patrol'),
    65,
    165,
  );
  ctx.fillStyle = '#fff1cf';
  ctx.font = 'bold 126px Arial';
  ctx.fillText(result.score.toLocaleString(), 60, 320);
  ctx.fillStyle = '#bed3cb';
  ctx.font = '24px Arial';
  ctx.fillText(result.rank ? '#' + result.rank + ' on the daily leaderboard' : 'POINTS', 65, 363);
  ctx.fillStyle = '#ffc07a';
  ctx.font = 'bold 36px Arial';
  ctx.fillText('Same course. Beat that.', 65, 478);
  ctx.fillStyle = '#8baaa9';
  ctx.font = '20px Arial';
  ctx.fillText(result.session?.day || new Date().toISOString().slice(0, 10), 65, 530);
  ctx.fillText(location.host, 65, 572);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'is-hormuz-open-' + result.score + '.png';
  a.click();
  track('card');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
