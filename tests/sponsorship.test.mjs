import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../server/worker.mjs';
import {submitBid,fulfillSession,publicAuction,paidSponsor,verifyStripeSignature} from '../server/auction.mjs';
const DB=localDB(),env={DB,STRIPE_SECRET_KEY:'sk_test_example',STRIPE_WEBHOOK_SECRET:'whsec_example',AUCTION_OWNER_EMAIL:'owner@example.com'};
const player=crypto.randomUUID(),sessions=new Map(),refunds=new Set(),originalFetch=globalThis.fetch;
let failRefund=false;
globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname,params=new URLSearchParams(options.body);
 if(path==='/v1/checkout/sessions'){
 const id=params.get('metadata[bid_id]'),session={id:'cs_test_'+id,url:'https://checkout.stripe.com/test/'+id,status:'open',mode:'payment',currency:'usd',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),metadata:{bid_id:id},client_reference_id:id,payment_intent:'pi_'+id,payment_status:'paid',livemode:false};sessions.set(id,session);return Response.json(session);
 }
 if(path.startsWith('/v1/payment_intents/')){const session=[...sessions.values()].find(s=>path.endsWith(s.payment_intent));return Response.json({metadata:session.metadata})}
 if(path==='/v1/refunds'){if(failRefund)return new Response('',{status:503});refunds.add(options.headers['Idempotency-Key']);return Response.json({status:'succeeded'})}
 throw new Error('Unexpected Stripe path '+path);
};
const bid=amount=>({id:crypto.randomUUID(),name:'Test Sponsor',url:'https://example.com',amount,accepted:true});
try{
 assert.equal((await publicAuction(DB,true)).minimum,500);
 await assert.rejects(()=>submitBid(DB,{},bid(500),player),/not connected/);
 for(const data of [{...bid(400)},{...bid(550)},{...bid(500),url:'javascript:alert(1)'},{...bid(500),accepted:false},{...bid(500),name:'<script>'}])await assert.rejects(()=>submitBid(DB,env,data,player));
 const a=bid(500),b=bid(600),equal=bid(500);for(const data of [a,b,equal])await submitBid(DB,env,data,player);
 assert.equal((await publicAuction(DB,true)).bids.length,0); // unpaid checkouts stay private
 await assert.rejects(()=>submitBid(DB,env,a,crypto.randomUUID()),/Invalid bid/);
 const tampered={...sessions.get(a.id),amount_total:1};await assert.rejects(()=>fulfillSession(DB,env,tampered),/does not match/);
 assert.equal((await fulfillSession(DB,env,{...sessions.get(a.id),payment_status:'unpaid'})).status,'pending');
 assert.equal((await fulfillSession(DB,env,sessions.get(a.id))).status,'paid');
 assert.equal((await paidSponsor(DB)).id,a.id);
 assert.equal((await fulfillSession(DB,env,sessions.get(a.id))).status,'paid'); // delivery retries don't refund winner
 assert.equal((await fulfillSession(DB,env,sessions.get(b.id))).status,'paid');assert.equal((await paidSponsor(DB)).id,b.id);
 failRefund=true;await assert.rejects(()=>fulfillSession(DB,env,sessions.get(equal.id)),/unavailable/);assert.equal(DB.sqlite.prepare('SELECT status FROM sponsor_bids WHERE id=?').get(equal.id).status,'refund_pending');
 failRefund=false;assert.equal((await fulfillSession(DB,env,sessions.get(equal.id))).status,'refunded');await fulfillSession(DB,env,sessions.get(equal.id));assert.equal(refunds.size,1);assert.equal((await paidSponsor(DB)).id,b.id);
 const summary=await publicAuction(DB,true);assert.equal(summary.minimum,700);assert.equal(summary.bids.length,2);assert(!JSON.stringify(summary).includes(player));assert(!JSON.stringify(summary).includes('session_id'));
 const c=bid(700),d=bid(700);await submitBid(DB,env,c,player);await submitBid(DB,env,d,player);await Promise.all([fulfillSession(DB,env,sessions.get(c.id)),fulfillSession(DB,env,sessions.get(d.id))]);assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM sponsor_bids WHERE amount=700 AND status='paid'").get().count,1);
 const raw='{"type":"test"}',timestamp=String(Math.floor(Date.now()/1000));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));const signature=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');await verifyStripeSignature(raw,'t='+timestamp+',v1='+signature,env.STRIPE_WEBHOOK_SECRET);await assert.rejects(()=>verifyStripeSignature(raw+' ','t='+timestamp+',v1='+signature,env.STRIPE_WEBHOOK_SECRET));await assert.rejects(()=>verifyStripeSignature(raw,'t=1,v1='+signature,env.STRIPE_WEBHOOK_SECRET));
 const earlyRefund=bid(800);await submitBid(DB,env,earlyRefund,player);const refundRaw=JSON.stringify({type:'charge.refunded',data:{object:{refunded:true,payment_intent:sessions.get(earlyRefund.id).payment_intent}}});const refundBytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+refundRaw));const refundSignature=Array.from(new Uint8Array(refundBytes),b=>b.toString(16).padStart(2,'0')).join('');const refundedResponse=await worker.fetch(new Request('https://game.example/api/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':'t='+timestamp+',v1='+refundSignature},body:refundRaw}),env);assert.equal(refundedResponse.status,200);assert.equal((await fulfillSession(DB,env,sessions.get(earlyRefund.id))).status,'refunded');assert.notEqual((await paidSponsor(DB)).id,earlyRefund.id);
 const request=(path,data,headers={})=>worker.fetch(new Request('https://game.example'+path,{method:data?'POST':'GET',headers:{Origin:'https://game.example','Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined}),env);
 assert.equal((await request('/api/auction/admin')).status,403);assert.equal((await request('/api/auction/admin',null,{'oai-authenticated-user-email':'other@example.com','oai-authenticated-user-id':'other'})).status,403);assert.equal((await request('/api/auction/admin',null,{'oai-authenticated-user-email':'owner@example.com','oai-authenticated-user-id':'owner'})).status,200);
 const visitId=crypto.randomUUID(),response=await request('/api/visits',{id:visitId,source:'direct'}),cookie=response.headers.get('Set-Cookie').split(';')[0];
 for(let i=0;i<2;i++)assert.equal((await request('/api/presence',{visitId},{Cookie:cookie})).status,200);assert.equal((await (await request('/api/metrics')).json()).online,1);
 assert.equal((await request('/api/presence',{visitId},{Cookie:'hormuz_player='+crypto.randomUUID()})).status,404);
 DB.sqlite.prepare('UPDATE presence SET seen_at=?').run(Date.now()-91000);assert.equal((await (await request('/api/metrics')).json()).online,0);
 console.log('PASS: checkout validation, private pending bids, confirmed-payment activation, monotonic sponsor price, concurrent equal bids, idempotent delivery/refund retries, webhook signatures, owner authorization, unique online presence and expiry.');
}finally{globalThis.fetch=originalFetch}
