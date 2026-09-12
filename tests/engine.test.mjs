import assert from 'node:assert/strict';
import { Crossing } from '../dist/engine.mjs';
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
 const g=clean('run');advance(g,35.1);assert.equal(g.phase,'upgrade');assert.equal(g.sector,2);
 const frozen=g.time;advance(g,2);assert.equal(g.time,frozen);assert.throws(()=>g.upgrade('unknown'));
 g.upgrade('engine');assert.equal(g.upgrades.engine,1);assert.equal(g.phase,'play');
 advance(g,35);assert.equal(g.phase,'upgrade');g.upgrade('repair');advance(g,35.1);
 assert.equal(g.phase,'end');assert.equal(g.win,true);assert.equal(g.delivered,3);
 g.reset('block');assert.equal(g.time,0);assert.equal(g.score,0);assert.equal(g.player.hull,100);assert.equal(g.entities.length,0);
 g.player.invincible=0;g.damage(100);assert.equal(g.phase,'end');assert.equal(g.win,false);
}
console.log('PASS: movement bounds, boost, cooldown, collision grace, repairs, interceptions, breaches, upgrades, win/loss, restart.');
