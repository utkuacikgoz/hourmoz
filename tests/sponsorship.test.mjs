import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../server/worker.mjs';
import {submitBid,fulfillSession,publicAuction,paidSponsor,verifyStripeSignature,ownerBids,reviewBid} from '../server/auction.mjs';
const DB=localDB(),origin='https://game.example',env={DB,APP_ORIGIN:origin,STRIPE_SECRET_KEY:'sk_test_example',STRIPE_WEBHOOK_SECRET:'whsec_example',AUCTION_OWNER_EMAIL:'owner@example.com',CF_ACCESS_AUD:'admin-app'};
const player=crypto.randomUUID(),sessions=new Map(),refunds=new Set(),originalFetch=globalThis.fetch;
let failRefund=false;
globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname,params=new URLSearchParams(options.body);
 if(path==='/v1/checkout/sessions'){
 const id=params.get('metadata[bid_id]'),session={id:'cs_test_'+id,url:'https://checkout.stripe.com/test/'+id,status:'open',mode:'payment',currency:'usd',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),metadata:{bid_id:id},client_reference_id:id,payment_intent:'pi_'+id,payment_status:'paid',livemode:false};sessions.set(id,session);return Response.json(session);
 }
 if(path.startsWith('/v1/payment_intents/')){const session=[...sessions.values()].find(s=>path.endsWith(s.payment_intent));return Response.json({metadata:session.metadata})}
 if(path.startsWith('/v1/charges/')){return Response.json({payment_intent:path.split('/').pop().replace('ch_','pi_')})}
 if(path==='/v1/refunds'){if(failRefund)return new Response('',{status:503});refunds.add(options.headers['Idempotency-Key']);return Response.json({status:'succeeded'})}
 throw new Error('Unexpected Stripe path '+path);
};
const bid=amount=>({id:crypto.randomUUID(),name:'Test Sponsor',url:'https://example.com',amount,accepted:true});
const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const signature=async(raw,timestamp=String(Math.floor(Date.now()/1000)))=>'t='+timestamp+',v1='+hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw)));
const webhook=async event=>{const raw=JSON.stringify(event);return worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':await signature(raw)},body:raw}),env)};
const status=id=>DB.sqlite.prepare('SELECT status FROM sponsor_bids WHERE id=?').get(id).status;
try{
 assert.equal((await publicAuction(DB,true,1)).minimum,500);
 await assert.rejects(()=>submitBid(DB,{},bid(500),player),/not connected/);
 for(const data of [{...bid(400)},{...bid(550)},{...bid(500),url:'javascript:alert(1)'},{...bid(500),accepted:false},{...bid(500),name:'<script>'}])await assert.rejects(()=>submitBid(DB,env,data,player));
 const a=bid(500),b=bid(600),equal=bid(500);for(const data of [a,b,equal])await submitBid(DB,env,data,player);
 assert.equal((await publicAuction(DB,true,1)).bids.length,0); // unpaid checkouts stay private
 await assert.rejects(()=>submitBid(DB,env,a,crypto.randomUUID()),/Invalid bid/);
 const tampered={...sessions.get(a.id),amount_total:1};await assert.rejects(()=>fulfillSession(DB,env,tampered),/does not match/);
 assert.equal((await fulfillSession(DB,env,{...sessions.get(a.id),payment_status:'unpaid'})).status,'pending');
 assert.equal((await fulfillSession(DB,env,sessions.get(a.id))).status,'paid');
 assert.equal((await paidSponsor(DB,1)).id,a.id);
 assert.equal((await fulfillSession(DB,env,sessions.get(a.id))).status,'paid'); // delivery retries don't refund winner
 assert.equal((await fulfillSession(DB,env,sessions.get(b.id))).status,'paid');assert.equal((await paidSponsor(DB,1)).id,b.id);
 failRefund=true;await assert.rejects(()=>fulfillSession(DB,env,sessions.get(equal.id)),/unavailable/);assert.equal(status(equal.id),'refund_pending');
 failRefund=false;assert.equal((await fulfillSession(DB,env,sessions.get(equal.id))).status,'refunded');await fulfillSession(DB,env,sessions.get(equal.id));assert.equal(refunds.size,1);assert.equal((await paidSponsor(DB,1)).id,b.id);
 assert.equal((await publicAuction(DB,true)).bids.length,0);assert.equal(await paidSponsor(DB),null);const summary=await publicAuction(DB,true,1);assert.equal(summary.minimum,700);assert.equal(summary.bids.length,2);assert(!JSON.stringify(summary).includes(player));assert(!JSON.stringify(summary).includes('session_id'));
 const c=bid(700),d=bid(700);await submitBid(DB,env,c,player);await submitBid(DB,env,d,player);await Promise.all([fulfillSession(DB,env,sessions.get(c.id)),fulfillSession(DB,env,sessions.get(d.id))]);assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM sponsor_bids WHERE amount=700 AND status='paid'").get().count,1);
 const raw='{"type":"test"}',timestamp=String(Math.floor(Date.now()/1000)),good=await signature(raw,timestamp);await verifyStripeSignature(raw,good,env.STRIPE_WEBHOOK_SECRET);await assert.rejects(()=>verifyStripeSignature(raw+' ',good,env.STRIPE_WEBHOOK_SECRET));await assert.rejects(()=>verifyStripeSignature(raw,'t=1,v1='+good.split('v1=')[1],env.STRIPE_WEBHOOK_SECRET));
 const earlyRefund=bid(800);await submitBid(DB,env,earlyRefund,player);const refundedResponse=await webhook({type:'charge.refunded',data:{object:{refunded:true,payment_intent:sessions.get(earlyRefund.id).payment_intent}}});assert.equal(refundedResponse.status,200);assert.equal((await fulfillSession(DB,env,sessions.get(earlyRefund.id))).status,'refunded');assert.notEqual((await paidSponsor(DB,1)).id,earlyRefund.id);
 console.log('PASS: checkout validation, private pending bids, confirmed-payment activation, monotonic sponsor price, concurrent equal bids, idempotent delivery/refund retries, webhook signatures.');

 // Refunded, disputed and hidden placements hand the spot back to the next active sponsor and the floor follows.
 const top=await paidSponsor(DB,1);assert.equal(top.amount,700);
 const e=bid(900);await submitBid(DB,env,e,player);assert.equal((await fulfillSession(DB,env,sessions.get(e.id))).status,'paid');assert.equal((await paidSponsor(DB,1)).id,e.id);assert.equal((await publicAuction(DB,true,1)).minimum,1000);
 await webhook({type:'charge.refunded',data:{object:{refunded:true,payment_intent:sessions.get(e.id).payment_intent}}});assert.equal(status(e.id),'refunded');assert.equal((await paidSponsor(DB,1)).id,top.id);assert.equal((await publicAuction(DB,true,1)).minimum,800);
 const topIntent=sessions.get(top.id).payment_intent;
 await webhook({type:'charge.dispute.created',data:{object:{status:'needs_response',payment_intent:topIntent}}});assert.equal(status(top.id),'disputed');assert.equal((await paidSponsor(DB,1)).id,b.id);assert.equal((await publicAuction(DB,true,1)).minimum,700);
 await webhook({type:'charge.dispute.closed',data:{object:{status:'won',payment_intent:topIntent}}});assert.equal(status(top.id),'paid');assert.equal((await paidSponsor(DB,1)).id,top.id);
 await webhook({type:'charge.dispute.created',data:{object:{status:'needs_response',payment_intent:null,charge:topIntent.replace('pi_','ch_')}}});await webhook({type:'charge.dispute.closed',data:{object:{status:'lost',payment_intent:topIntent}}});assert.equal(status(top.id),'refunded');assert.equal((await paidSponsor(DB,1)).id,b.id);
 await reviewBid(DB,{id:b.id,action:'hide'});assert.equal((await paidSponsor(DB,1)).id,a.id);assert.equal((await publicAuction(DB,true,1)).minimum,600);await reviewBid(DB,{id:b.id,action:'show'});assert.equal((await paidSponsor(DB,1)).id,b.id);
 const f=bid(1000);await submitBid(DB,env,f,player);await webhook({type:'checkout.session.expired',data:{object:{id:sessions.get(f.id).id}}});assert.equal(status(f.id),'expired');await assert.rejects(()=>submitBid(DB,env,f,player),/expired/);assert.equal((await fulfillSession(DB,env,sessions.get(f.id))).status,'paid');assert.equal((await paidSponsor(DB,1)).id,f.id);
 assert.equal((await ownerBids(DB)).bids[0].status,'paid');assert(!(await ownerBids(DB)).bids.some(row=>row.status==='expired'));
 const ceiling=bid(1000000);await submitBid(DB,env,ceiling,player);assert.equal((await fulfillSession(DB,env,sessions.get(ceiling.id))).status,'paid');await assert.rejects(()=>submitBid(DB,env,bid(1000000),player),/maximum price/);
 console.log('PASS: refunded, disputed and hidden sponsors hand the spot back, expired checkouts can still settle, admin list puts paid first, ceiling is explained.');

 const identity=email=>({access:{aud:'admin-app',getIdentity:async()=>({email})}});
 const request=(path,data,headers={},ctx)=>worker.fetch(new Request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined}),env,ctx);
 assert.equal((await request('/api/auction/admin')).status,403);
 assert.equal((await request('/api/auction/admin',null,{'oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-id':'owner','Cf-Access-Authenticated-User-Email':'owner@example.com'})).status,403);
 assert.equal((await request('/api/auction/admin',null,{},identity('other@example.com'))).status,403);
 assert.equal((await request('/api/auction/admin',null,{},identity('owner@example.com'))).status,200);
 const visitId=crypto.randomUUID(),response=await request('/api/visits',{id:visitId,source:'direct'}),cookie=response.headers.get('Set-Cookie').split(';')[0];
 for(let i=0;i<2;i++)assert.equal((await request('/api/presence',{visitId},{Cookie:cookie})).status,200);assert.equal((await (await request('/api/metrics')).json()).online,1);
 assert.equal((await request('/api/presence',{visitId},{Cookie:'hormuz_player='+crypto.randomUUID()})).status,404);
 DB.sqlite.prepare('UPDATE presence SET seen_at=?').run(Date.now()-91000);assert.equal((await (await request('/api/metrics')).json()).online,0);
 console.log('PASS: owner authorization comes only from Access identity, unique online presence and expiry.');
}finally{globalThis.fetch=originalFetch}
