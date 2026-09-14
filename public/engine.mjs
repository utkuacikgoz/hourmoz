export function seededRandom(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const FIBONACCI = Object.freeze([1, 1, 2, 3, 5, 8, 13]);
export function difficultyAt(seconds) {
 const stage = clamp(Math.floor(Math.max(0, seconds) / 15), 0, 6);
 const pressure = FIBONACCI[stage];
 return {stage, pressure, spawnInterval: Math.max(.28, 3.6 / pressure), speed: 8 + stage * 2.5,
   fireInterval: Math.max(.48, 4.8 / Math.sqrt(pressure)), missileSpeed: 14 + stage * 3,
   salvo: stage < 4 ? 1 : stage < 6 ? 2 : 3, armed: seconds >= 18};
}
export class Crossing {
 constructor(random=Math.random){this.random=random;this.reset('run');this.phase='menu'}
 reset(mode){this.mode=mode;this.phase='play';this.time=0;this.sector=1;this.score=0;this.combo=1;this.comboTime=0;this.stopped=0;this.escaped=0;this.delivered=0;this.entities=[];this.shots=[];this.events=[];this.id=0;this.formation=0;this.spawn=2;this.pickup=7;this.difficulty=difficultyAt(0);this.nextPost=24;this.postUntil=0;this.panicUntil=0;this.nextCheckpoint=42;this.checkpointUntil=0;this.payoffUntil=0;this.lastHit=null;this.nearMisses=0;this.player={x:0,z:23,vx:0,vz:0,hull:100,boost:100,cooldown:0,invincible:2,decoy:0};this.input={x:0,z:0,boost:false,fire:false,aim:null};}
 event(type,data={}){this.events.push({type,...data})}
 add(type,x,z,extra={}){const e={id:++this.id,type,x,z,vx:0,vz:0,age:0,hp:type==='tanker'?4:type==='escort'?3:1,r:type==='tanker'?3.4:type==='escort'?2.1:1.4,cool:1+this.random()*2,...extra};this.entities.push(e);return e}
 reward(n){this.score+=n*this.combo;this.comboTime=7;this.combo=Math.min(5,this.combo+1)}
 damage(n,source='collision'){if(this.player.invincible>0)return;this.lastHit=source;this.player.hull=Math.max(0,this.player.hull-n);this.player.invincible=1.2;this.combo=1;this.event('hit',{x:this.player.x,z:this.player.z});if(!this.player.hull)this.end(false)}
 end(win){if(this.phase!=='play')return;this.phase='end';this.win=win;if(win)this.score+=Math.round(this.player.hull)*20;this.event('end',{win})}
 ability(){const p=this.player;if(this.phase!=='play'||p.cooldown>0)return;if(this.mode==='run'){p.decoy=3.2;p.cooldown=10;this.event('decoy',{x:p.x,z:p.z});}else{let aim=this.input.aim;if(!aim){const target=this.entities.filter(e=>['tanker','escort'].includes(e.type)&&e.z<p.z+4).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];aim=target??{x:p.x,z:p.z-50}}let dx=aim.x-p.x,dz=aim.z-p.z,d=Math.hypot(dx,dz)||1;this.shots.push({id:++this.id,x:p.x,z:p.z-2,vx:dx/d*76,vz:dz/d*76,age:0});p.cooldown=.28;this.event('fire',{x:p.x,z:p.z});}}
 payCheckpoint(){if(this.phase!=='play'||this.time>=this.checkpointUntil||this.score<300)return false;this.score-=300;this.checkpointUntil=0;this.payoffUntil=this.time+4;this.player.invincible=Math.max(this.player.invincible,4);this.entities=this.entities.filter(e=>!e.checkpoint);this.event('payoff');return true}
 tick(dt){if(this.phase!=='play')return;dt=Math.min(dt,.05);const p=this.player;this.time+=dt;const previousStage=this.difficulty.stage;this.difficulty=difficultyAt(this.time);if(this.difficulty.stage>previousStage){this.event('difficulty',{pressure:this.difficulty.pressure,stage:this.difficulty.stage})}this.comboTime-=dt;if(this.comboTime<=0)this.combo=1;p.cooldown=Math.max(0,p.cooldown-dt);p.invincible=Math.max(0,p.invincible-dt);p.decoy=Math.max(0,p.decoy-dt);const boosting=this.input.boost&&p.boost>1;this.boosting=boosting;p.boost=clamp(p.boost+(boosting?-32:13)*dt,0,100);const speed=(this.mode==='run'?20:23)*(boosting?1.75:1);let ix=this.input.x,iz=this.input.z,len=Math.hypot(ix,iz);if(len>1){ix/=len;iz/=len}p.vx+=(ix*speed-p.vx)*Math.min(1,dt*6);p.vz+=(iz*speed-p.vz)*Math.min(1,dt*6);p.x=clamp(p.x+p.vx*dt,-30,30);p.z=clamp(p.z+p.vz*dt,-14,34);if(this.input.fire)this.ability();
 if(this.time>=this.nextPost){this.nextPost+=28;this.postUntil=this.time+2;this.panicUntil=this.time+8;this.event('post')}
 if(this.mode==='run'&&this.time>=this.nextCheckpoint){this.nextCheckpoint+=36;this.checkpointUntil=this.time+6;const gap=Math.floor(this.random()*5);for(let lane=0;lane<5;lane++)if(lane!==gap)this.add('mine',-24+lane*12,-36,{vz:10,checkpoint:true});this.event('checkpoint')}
 this.spawn-=dt;this.pickup-=dt;
 if(this.spawn<=0){
  const d=this.difficulty;this.spawn=Math.max(1.65,d.spawnInterval*2.2)*(this.mode==='block'?1.2:1);
  if(this.entities.length<140){const pattern=this.formation++%3;
   if(d.stage<2){const x=(this.random()-.5)*48;this.add(this.mode==='block'?'tanker':!d.armed?'mine':'escort',x,-60,{vz:d.speed,cool:2.5});}
   else if(pattern===0&&this.mode==='run'){const gap=Math.floor(this.random()*5);for(let lane=0;lane<5;lane++)if(Math.abs(lane-gap)>0)this.add('mine',-24+lane*12,-60,{vz:d.speed});}
   else if(pattern===1){const side=this.formation%2?1:-1;for(let i=0;i<2;i++)this.add('tanker',side*(24-i*9),-60-i*14,{vz:d.speed*.85,crossing:-side*5});}
   else{for(const x of[-22,22])this.add(this.mode==='block'?'tanker':'escort',x,-60,{vz:d.speed,cool:2.5});}
  }
 }

 if(this.pickup<=0){this.pickup=12+this.random()*5;this.add('repair',(this.random()-.5)*48,-58,{vz:12})}
 const remove=new Set();for(const e of [...this.entities]){e.age+=dt;e.cool-=dt;e.z+=e.vz*dt;if(e.crossing)e.x=clamp(e.x+e.crossing*dt,-29,29);if(this.time>=this.postUntil&&this.time<this.panicUntil&&['tanker','escort'].includes(e.type))e.x=clamp(e.x+Math.sin((this.time-this.postUntil)*2.2+e.id)*dt*12,-29,29);if(e.type==='escort'){e.x=clamp(e.x+Math.sin(e.age*1.4+e.id)*dt*2.5,-29,29);if(this.difficulty.armed&&e.cool<=.85&&e.aim===undefined&&e.z<p.z-6&&e.z>-42){e.aim=Math.atan2(p.x-e.x,p.z-e.z);e.cool=.85;}if(e.aim!==undefined&&e.cool<=0&&this.entities.length<180){e.cool=this.difficulty.fireInterval;const angle=e.aim;delete e.aim;for(let shot=0;shot<this.difficulty.salvo;shot++){const a=angle+(shot-(this.difficulty.salvo-1)/2)*.18;this.add('missile',e.x,e.z+2,{vx:Math.sin(a)*this.difficulty.missileSpeed,vz:Math.cos(a)*this.difficulty.missileSpeed,r:.8})}this.event('enemyfire',{x:e.x,z:e.z})}}
 if(e.type==='missile'){if(p.decoy>0){e.vx+=(e.x-p.x)*dt*2;e.vz+=dt*8;}e.x+=e.vx*dt;}
 if(e.z>48||Math.abs(e.x)>55||e.age>18){remove.add(e);if(this.mode==='block'&&e.type==='tanker'){this.escaped++;this.lastHit='escaped';this.player.hull=Math.max(0,this.player.hull-16);this.combo=1;this.event('escaped');if(!this.player.hull)this.end(false)}else if(this.mode==='run'&&['mine','escort'].includes(e.type))this.score+=30;continue;}
 const clearance=Math.hypot((e.x-p.x)*.5,(e.z-p.z)*.75)-(e.r+1.4);
 if(['mine','escort','missile'].includes(e.type)){if(clearance<=0)e.hit=true;if(p.invincible>0)e.protected=true;if(e.closest===undefined||clearance<e.closest)e.closest=clearance;else if(!e.passed&&e.closest>0&&e.closest<1.6&&clearance>e.closest+.35){e.passed=true;if(!e.hit&&!e.protected){const points=50*this.combo;this.nearMisses++;this.reward(50);this.event('nearMiss',{points,x:p.x,z:p.z})}}}

 if(Math.hypot((e.x-p.x)*.5,(e.z-p.z)*.75)<e.r+1.4){if(e.type==='repair'){p.hull=clamp(p.hull+22,0,100);p.boost=clamp(p.boost+30,0,100);this.reward(75);remove.add(e);this.event('repair',{x:e.x,z:e.z})}else{e.hit=true;this.damage(e.type==='missile'?18:e.type==='mine'?28:23,e.type);if(e.type!=='tanker')remove.add(e)}}}
 const deadShots=new Set();for(const s of this.shots){s.age+=dt;s.x+=s.vx*dt;s.z+=s.vz*dt;if(s.age>1.9){deadShots.add(s);continue}for(const e of this.entities){if(remove.has(e)||!['tanker','escort','mine'].includes(e.type))continue;if(Math.hypot((e.x-s.x)*.5,(e.z-s.z)*.75)<e.r+1){e.hp--;deadShots.add(s);this.event('impact',{x:s.x,z:s.z});if(e.hp<=0){remove.add(e);this.reward(e.type==='tanker'?250:150);this.stopped++;this.event('destroy',{x:e.x,z:e.z,big:e.type==='tanker'});if(this.random()<.2)this.add('repair',e.x,e.z,{vz:7})}break}}}
 this.entities=this.entities.filter(e=>!remove.has(e));this.shots=this.shots.filter(s=>!deadShots.has(s));if(this.phase!=='play')return;if(this.time>=105){if(this.mode==='run')this.delivered++;this.end(true);return}const next=1+Math.floor(this.time/35);if(next>this.sector){this.sector=next;this.delivered+=this.mode==='run'?1:0;this.score+=1000;this.entities=this.entities.filter(e=>e.z<-20);this.shots=[];this.event('sector',{sector:this.sector})}
 }
}
