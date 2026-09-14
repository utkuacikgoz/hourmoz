import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker,{replay,classifyStatus} from '../server/worker.mjs';
import { Crossing,seededRandom,difficultyAt } from '../public/engine.mjs';
import { localDB } from '../scripts/local-db.mjs';
const env={DB:localDB()},origin='https://game.example';
const req=(path,data,cookie='')=>new Request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});
let response=await worker.fetch(req('/api/runs',{mode:'run'}),env);assert.equal(response.status,201);const cookie=response.headers.get('set-cookie').split(';')[0],session=await response.json();
const client=new Crossing(seededRandom(session.seed));client.reset('run');let ticks=0,records=[[0,'i',[0,0,0,0,null,null]]];
while(client.phase!=='end'&&ticks<6302){if(client.phase==='upgrade'){records.push([ticks,'u','repair']);client.upgrade('repair')}client.tick(1/60);client.events=[];ticks++}
assert.equal(client.phase,'end');const verified=replay(session.seed,'run',records,ticks);assert.equal(verified.score,client.score);assert.equal(verified.player.hull,client.player.hull);
// Wall-clock checks reject a fabricated instantaneous run.
response=await worker.fetch(req('/api/scores',{name:'Captain Test',runId:session.id,records,ticks},cookie),env);assert.equal(response.status,400);
env.DB.sqlite.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(Date.now()-110000,session.id);
response=await worker.fetch(req('/api/scores',{name:'Captain Test',runId:session.id,records,ticks},cookie),env);assert.equal(response.status,200);assert.equal((await response.json()).saved,true);
response=await worker.fetch(req('/api/leaderboard?mode=run'),env);const board=await response.json();assert.equal(board.entries.length,1);assert.equal(board.entries[0].name,'Captain Test');assert.equal(board.entries[0].score,client.score);
response=await worker.fetch(req('/api/scores',{name:'Captain Test',runId:session.id,records,ticks},cookie),env);assert.equal((await response.json()).alreadySaved,true);
response=await worker.fetch(req('/api/scores',{name:'<script>alert(1)</script>',runId:session.id,records,ticks},cookie),env);assert.equal(response.status,400);
const badOrigin=new Request(origin+'/api/runs',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{"mode":"run"}'});assert.equal((await worker.fetch(badOrigin,env)).status,403);
assert.throws(()=>replay(session.seed,'run',[[0,'i',[99,0,0,0,null,null]]],ticks));assert.throws(()=>replay(session.seed,'run',records,1));
assert.equal(classifyStatus('<p>Information related to shipping and seafarers</p><p>stranded on vessels unable to exit the Strait of Hormuz</p>').status,'disrupted');assert.equal(classifyStatus('unrelated old article about shipping').status,'unverified');
assert.deepEqual([0,15,30,45,60,75,90].map(t=>difficultyAt(t).pressure),[1,1,2,3,5,8,13]);assert.equal(difficultyAt(17).armed,false);assert(difficultyAt(90).spawnInterval<difficultyAt(0).spawnInterval/10);assert.equal(difficultyAt(90).salvo,3);
// Early rounds have time to learn; no projectiles are fired during the first 17 seconds.
for(let seed=1;seed<=20;seed++){const g=new Crossing(seededRandom(seed));g.reset('run');for(let i=0;i<17*60;i++){g.tick(1/60);assert(!g.events.some(e=>e.type==='enemyfire'));g.events=[]}assert(g.player.hull>0)}
const indexes=env.DB.sqlite.prepare('EXPLAIN QUERY PLAN SELECT name, score FROM scores WHERE mode = ? AND created_at >= ? ORDER BY score DESC LIMIT 10').all('run',0);assert(indexes.some(x=>x.detail.includes('idx_scores_mode_score')));
console.log('PASS: deterministic replay, ranked save/read, idempotency, invalid names, cross-origin rejection, clock checks, source parsing, Fibonacci ramp, opening difficulty, leaderboard index.');
