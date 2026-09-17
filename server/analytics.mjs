import {paidSponsor} from './auction.mjs';
import config from '../public/sponsors.json' with {type: 'json'};
const DAY = 86400000;
export const sources = new Set([
  'direct',
  'challenge',
  'x',
  'reddit',
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'linkedin',
  'search',
  'other',
]);
export async function sponsorship(now = Date.now(), db = null) {
  const day = new Date(now).toISOString().slice(0, 10);
  const active = config.schedule.find(
    s =>
      s.day === day &&
      /^[a-z0-9-]{1,60}$/.test(s.id) &&
      typeof s.name === 'string' &&
      s.name.length <= 60 &&
      safeLink(s.url),
  );
  return {
    bookingUrl: '/sponsor',
    sponsor:
      (db ? await paidSponsor(db) : null) ?? (active ? {id: active.id, name: active.name, url: active.url, day} : null),
  };
}
function safeLink(value, mail = false) {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || (mail && u.protocol === 'mailto:')) && !u.username && !u.password ? value : null;
  } catch {
    return null;
  }
}
export async function visitMetrics(db, since) {
  const totals = await db
    .prepare(
      'SELECT COUNT(*) AS visits, COUNT(DISTINCT player_id) AS visitors, COALESCE(SUM(sponsor_viewed),0) AS sponsorViews, COALESCE(SUM(sponsor_clicked),0) AS sponsorClicks, COALESCE(SUM(booking_clicked),0) AS bookingClicks FROM visits WHERE created_at >= ?',
    )
    .bind(since)
    .first();
  // Aggregate runs before joining: replaying must not multiply visit or sponsor counts.
  const rows = await db
    .prepare(
      `SELECT v.source, COUNT(*) AS visits, COUNT(DISTINCT v.player_id) AS visitors, SUM(COALESCE(r.starts,0)) AS starts, SUM(CASE WHEN r.starts > 0 THEN 1 ELSE 0 END) AS playingVisits, SUM(COALESCE(r.completed,0)) AS completed, SUM(COALESCE(r.shared,0)) AS shared FROM visits v LEFT JOIN (SELECT visit_id, COUNT(*) AS starts, SUM(completed) AS completed, SUM(shared) AS shared FROM runs WHERE tracked = 1 AND created_at >= ? GROUP BY visit_id) r ON r.visit_id = v.id WHERE v.created_at >= ? GROUP BY v.source ORDER BY visits DESC`,
    )
    .bind(since, since)
    .all();
  const campaigns = await db
    .prepare(
      'SELECT e.sponsor_id AS sponsor, MAX(b.name) AS name, SUM(e.viewed) AS views, SUM(e.clicked) AS clicks FROM sponsor_events e JOIN visits v ON v.id = e.visit_id LEFT JOIN sponsor_bids b ON b.id = e.sponsor_id WHERE v.created_at >= ? GROUP BY e.sponsor_id ORDER BY views DESC',
    )
    .bind(since)
    .all();
  return {
    ...totals,
    sponsorViews: campaigns.results.reduce((n, r) => n + r.views, 0),
    sponsorClicks: campaigns.results.reduce((n, r) => n + r.clicks, 0),
    playingVisits: rows.results.reduce((n, r) => n + r.playingVisits, 0),
    sources: rows.results,
    campaigns: campaigns.results,
  };
}
export async function createVisit(db, data, player) {
  if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) return {error: 'Invalid visit.', status: 400};
  const now = Date.now(),
    existing = await db.prepare('SELECT player_id FROM visits WHERE id = ?').bind(data.id).first();
  if (existing && existing.player_id !== player) return {error: 'Visit not found.', status: 404};
  const {sponsor} = await sponsorship(now, db);
  await db.batch([
    db
      .prepare('DELETE FROM sponsor_events WHERE visit_id IN (SELECT id FROM visits WHERE created_at < ?)')
      .bind(now - 30 * DAY),
    db.prepare('DELETE FROM visits WHERE created_at < ?').bind(now - 30 * DAY),
    db
      .prepare(
        'INSERT INTO visits (id, player_id, created_at, source, sponsor_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(data.id, player, now, sources.has(data.source) ? data.source : 'other', sponsor?.id ?? null),
  ]);
  return {id: data.id};
}
export async function visitEvent(db, data, player) {
  const columns = {sponsor_view: 'sponsor_viewed', sponsor_click: 'sponsor_clicked', booking_click: 'booking_clicked'};
  if (!player || typeof data.visitId !== 'string' || !Object.hasOwn(columns, data.event))
    return {error: 'Invalid event.', status: 400};
  const visit = await db
    .prepare('SELECT * FROM visits WHERE id = ? AND player_id = ? AND created_at >= ?')
    .bind(data.visitId, player, Date.now() - DAY)
    .first();
  if (!visit) return {error: 'Visit not found.', status: 404};
  const current = await sponsorship(Date.now(), db);
  if (
    data.event === 'booking_click'
      ? !current.bookingUrl
      : !current.sponsor || (data.sponsorId && data.sponsorId !== current.sponsor.id)
  )
    return {error: 'Sponsor unavailable.', status: 409};
  if (data.event !== 'booking_click') {
    await db
      .prepare(
        'INSERT INTO sponsor_events (visit_id, sponsor_id, viewed, clicked) VALUES (?, ?, ?, ?) ON CONFLICT(visit_id,sponsor_id) DO UPDATE SET viewed = MAX(viewed,excluded.viewed), clicked = MAX(clicked,excluded.clicked)',
      )
      .bind(visit.id, current.sponsor.id, data.event === 'sponsor_view' ? 1 : 0, data.event === 'sponsor_click' ? 1 : 0)
      .run();
    return {ok: true};
  }
  await db
    .prepare('UPDATE visits SET ' + columns[data.event] + ' = 1 WHERE id = ? AND player_id = ?')
    .bind(visit.id, player)
    .run();
  return {ok: true};
}
