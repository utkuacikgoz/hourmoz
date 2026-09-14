import assert from 'node:assert/strict';
import { Crossing } from '../public/engine.mjs';
const advance=(g,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)g.tick(1/60)};
const clean=mode=>{const g=new Crossing(()=>.5);g.reset(mode);g.spawn=999;g.pickup=999;return g};
// The same elapsed simulation time is used regardless of renderer frame rate.
{
 const g=clean('run');g.input.x=1;g.input.boost=true;advance(g,3);
 assert.equal(g.player.x,30);assert(g.player.boost<10);
 g.input.boost=false;advance(g,2);assert(g.player.boost>20);
 g.ability();assert(g.player.decoy>0);const cooldown=g.player.cooldown;g.ability();assert.equal(g.player.cooldown,cooldown);
}
{
 const g=clean('run');g.player.invincible=0;g.add('mine',0,23);g.tick(1/60);
 assert.equal(g.player.hull,72);g.add('mine',0,23);g.tick(1/60);assert.equal(g.player.hull,72);
 g.add('repair',0,23);g.tick(1/60);assert.equal(g.player.hull,94);
}
{
 const g=clean('block');const target=g.add('tanker',0,0);g.input.fire=true;advance(g,2);
 assert(!g.entities.includes(target));assert.equal(g.stopped,1);assert(g.score>=250);
 const hull=g.player.hull;g.add('tanker',20,49);g.tick(1/60);assert.equal(g.player.hull,hull-16);assert.equal(g.escaped,1);
}
{
 const g=clean('run');advance(g,35.1);assert.equal(g.phase,'play');assert.equal(g.sector,2);
 const checkpointTime=g.time;advance(g,1);assert(g.time>checkpointTime);
 advance(g,34);assert.equal(g.phase,'play');assert.equal(g.sector,3);
 assert(!g.events.some(e=>e.type==='upgrade'));advance(g,35);
 assert.equal(g.phase,'end');assert.equal(g.win,true);assert.equal(g.delivered,3);
 g.reset('block');assert.equal(g.time,0);assert.equal(g.score,0);assert.equal(g.player.hull,100);assert.equal(g.entities.length,0);
 g.player.invincible=0;g.damage(100);assert.equal(g.phase,'end');assert.equal(g.win,false);
}
console.log('PASS: movement bounds, boost, cooldown, collision grace, repairs, interceptions, breaches, uninterrupted checkpoints, win/loss, restart.');
// Satirical events stay deterministic and payoffs cannot be repeated or bought on credit.
{
 const g=clean('run');g.time=42;g.tick(1/60);assert.equal(g.phase,'play');assert(g.checkpointUntil>g.time);assert.equal(g.entities.filter(e=>e.checkpoint).length,4);
 g.score=299;assert.equal(g.payCheckpoint(),false);g.score=700;assert.equal(g.payCheckpoint(),true);assert.equal(g.score,400);assert.equal(g.player.invincible,4);assert(!g.entities.some(e=>e.checkpoint));assert.equal(g.payCheckpoint(),false);
 g.reset('run');assert.equal(g.payoffUntil,0);assert.equal(g.checkpointUntil,0);
 const traffic=clean('block');traffic.time=24;traffic.tick(1/60);const ship=traffic.add('tanker',0,-40,{vz:0});advance(traffic,1);assert.equal(ship.x,0);advance(traffic,2);assert.notEqual(ship.x,0);assert.equal(traffic.checkpointUntil,0);
}
console.log('PASS: satire warning, traffic movement, payoff cost, safe passage, restart.');
{
 const g=clean('run');g.player.invincible=0;g.add('missile',5,21,{vz:12,r:.8});advance(g,1);const awards=g.events.filter(e=>e.type==='nearMiss');assert.equal(awards.length,1);assert.equal(awards[0].points,50);assert.equal(g.player.hull,100);advance(g,1);assert.equal(g.events.filter(e=>e.type==='nearMiss').length,1);
 const protectedRun=clean('run');protectedRun.add('missile',5,21,{vz:12,r:.8});advance(protectedRun,1);assert.equal(protectedRun.nearMisses,0);
}
console.log('PASS: close-call detection, exact points, single award, immunity exclusion.');
{
 const g=clean('run');g.time=30;g.spawn=0;g.tick(1/60);assert.equal(g.entities.filter(e=>e.type==='mine').length,4);assert.equal(new Set(g.entities.map(e=>e.x)).size,4);
 const firing=clean('run');firing.time=20;const escort=firing.add('escort',-20,-20,{cool:0,vz:0});firing.tick(1/60);assert(Number.isFinite(escort.aim));assert(!firing.entities.some(e=>e.type==='missile'));advance(firing,.5);assert(!firing.entities.some(e=>e.type==='missile'));advance(firing,.4);assert(firing.entities.some(e=>e.type==='missile'));
}
console.log('PASS: mine formation gap and warning before missile launch.');
{
 const g=clean('run');g.time=90;g.player.z=-14;g.player.invincible=100;advance(g,8);assert(g.finale);assert.equal(g.phase,'end');assert(g.time<105);assert(g.win);
 const block=clean('block');block.time=90;block.player.z=-14;advance(block,8);assert.equal(block.phase,'play');advance(block,7.1);assert.equal(block.phase,'end');
 g.reset('run');assert.equal(g.finale,false);
}
console.log('PASS: visible exit timing, early forward escape, patrol countdown, reset.');
