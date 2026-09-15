import config from '../public/sponsors.json' with {type:'json'};
const DAY=86400000;
export const sources=new Set(['direct','challenge','x','reddit','instagram','tiktok','youtube','facebook','linkedin','search','other']);
export function sponsorship(now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 const active=config.schedule.find(s=>s.day===day&&/^[a-z0-9-]{1,60}$/.test(s.id)&&typeof s.name==='string'&&s.name.length<=60&&safeLink(s.url));
 return {bookingUrl:safeLink(config.bookingUrl,true),sponsor:active?{id:active.id,name:active.name,url:active.url,day}:null};
}
function safeLink(value,mail=false){try{const u=new URL(value);return (u.protocol==='https:'||mail&&u.protocol==='mailto:')&&!u.username&&!u.password?value:null}catch{return null}}
export async function visitMetrics(db,since){
 const totals=await db.prepare('SELECT COUNT(*) AS visits, COUNT(DISTINCT player_id) AS visitors, COALESCE(SUM(sponsor_viewed),0) AS sponsorViews, COALESCE(SUM(sponsor_clicked),0) AS sponsorClicks, COALESCE(SUM(booking_clicked),0) AS bookingClicks FROM visits WHERE created_at >= ?').bind(since).first();
 // Aggregate runs before joining: replaying must not multiply visit or sponsor counts.
 const rows=await db.prepare(`SELECT v.source, COUNT(*) AS visits, COUNT(DISTINCT v.player_id) AS visitors, SUM(COALESCE(r.starts,0)) AS starts, SUM(CASE WHEN r.starts > 0 THEN 1 ELSE 0 END) AS playingVisits, SUM(COALESCE(r.completed,0)) AS completed, SUM(COALESCE(r.shared,0)) AS shared FROM visits v LEFT JOIN (SELECT visit_id, COUNT(*) AS starts, SUM(completed) AS completed, SUM(shared) AS shared FROM runs WHERE tracked = 1 AND created_at >= ? GROUP BY visit_id) r ON r.visit_id = v.id WHERE v.created_at >= ? GROUP BY v.source ORDER BY visits DESC`).bind(since,since).all();
 const campaigns=await db.prepare('SELECT sponsor_id AS sponsor, COUNT(*) AS eligibleVisits, SUM(sponsor_viewed) AS views, SUM(sponsor_clicked) AS clicks FROM visits WHERE created_at >= ? AND sponsor_id IS NOT NULL GROUP BY sponsor_id ORDER BY views DESC').bind(since).all();
 return {...totals,playingVisits:rows.results.reduce((n,r)=>n+r.playingVisits,0),sources:rows.results,campaigns:campaigns.results};
}
export async function createVisit(db,data,player){
 if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))return {error:'Invalid visit.',status:400};
 const now=Date.now(),existing=await db.prepare('SELECT player_id FROM visits WHERE id = ?').bind(data.id).first();
 if(existing&&existing.player_id!==player)return {error:'Visit not found.',status:404};
 const {sponsor}=sponsorship(now);
 await db.batch([db.prepare('DELETE FROM visits WHERE created_at < ?').bind(now-30*DAY),db.prepare('INSERT INTO visits (id, player_id, created_at, source, sponsor_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(data.id,player,now,sources.has(data.source)?data.source:'other',sponsor?.id??null)]);
 return {id:data.id};
}
export async function visitEvent(db,data,player){
 const columns={sponsor_view:'sponsor_viewed',sponsor_click:'sponsor_clicked',booking_click:'booking_clicked'};
 if(!player||typeof data.visitId!=='string'||!Object.hasOwn(columns,data.event))return {error:'Invalid event.',status:400};
 const visit=await db.prepare('SELECT * FROM visits WHERE id = ? AND player_id = ? AND created_at >= ?').bind(data.visitId,player,Date.now()-DAY).first();
 if(!visit)return {error:'Visit not found.',status:404};
 const current=sponsorship();
 if(data.event==='booking_click'?!current.bookingUrl:!visit.sponsor_id||visit.sponsor_id!==current.sponsor?.id)return {error:'Sponsor unavailable.',status:409};
 await db.prepare('UPDATE visits SET '+columns[data.event]+' = 1 WHERE id = ? AND player_id = ?').bind(visit.id,player).run();
 return {ok:true};
}
