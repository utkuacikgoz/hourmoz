import {RequestError} from './security.mjs';
const fail=(message,status=400)=>{throw new RequestError(message,status)};
const ORIGIN='https://hourmuz-crossing.acikgozutku1.chatgpt.site';
export const paymentsEnabled=env=>!!env.STRIPE_SECRET_KEY&&!!env.STRIPE_WEBHOOK_SECRET&&!!env.AUCTION_OWNER_EMAIL;
export function requireOwner(request,env){const email=request.headers.get('oai-authenticated-user-email');if(!env.AUCTION_OWNER_EMAIL||!request.headers.get('oai-authenticated-user-id')||email?.toLowerCase()!==env.AUCTION_OWNER_EMAIL.toLowerCase())fail('Owner sign-in required.',403)}
async function highBid(db){return db.prepare('SELECT id, name, url, amount, status, hidden FROM sponsor_bids WHERE paid_at IS NOT NULL ORDER BY amount DESC LIMIT 1').first()}
export async function paidSponsor(db){const bid=await highBid(db);return bid&&bid.status==='paid'&&!bid.hidden?{id:bid.id,name:bid.name,url:bid.url,amount:bid.amount}:null}
export async function publicAuction(db,enabled){const high=await highBid(db);const history=await db.prepare("SELECT name, amount, paid_at AS paidAt FROM sponsor_bids WHERE paid_at IS NOT NULL AND hidden = 0 AND status = 'paid' ORDER BY amount DESC LIMIT 20").all();return {enabled,minimum:(high?.amount??400)+100,highest:high?.amount??0,sponsor:await paidSponsor(db),bids:history.results}}
export async function stripe(env,path,params=null,key=null){
 const headers={Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Stripe-Version':'2024-06-20'};if(params)headers['Content-Type']='application/x-www-form-urlencoded';if(key)headers['Idempotency-Key']=key;
 const r=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers,body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(12000)});
 if(!r.ok)fail('Payment service unavailable. Try again.',503);return r.json();
}
export async function submitBid(db,env,data,player){
 if(!paymentsEnabled(env))fail('Payments are not connected yet.',503);
 if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))fail('Invalid bid.');
 let bid=await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(data.id).first();
 if(bid&&bid.player_id!==player)fail('Invalid bid.',409);
 if(!bid){
 const name=typeof data.name==='string'?data.name.normalize('NFKC').trim():'';
 if(!/^[\p{L}\p{N} .&'!_-]{2,60}$/u.test(name))fail('Use a sponsor name of 2–60 letters, numbers or simple punctuation.');
 let url;try{url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password||url.href.length>500||!url.hostname.includes('.')||url.hostname.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))throw new Error()}catch{fail('Enter a public HTTPS website address.')}
 if(data.accepted!==true)fail('Accept the sponsorship terms first.');
 const minimum=((await highBid(db))?.amount??400)+100;
 if(!Number.isSafeInteger(data.amount)||data.amount<minimum||data.amount%100!==0||data.amount>1000000)fail(`Bid at least $${minimum/100} USD, in whole dollars (maximum $10,000).`,409);
 const recent=await db.prepare('SELECT COUNT(*) AS count FROM sponsor_bids WHERE player_id = ? AND created_at > ?').bind(player,Date.now()-3600000).first();if(recent.count>=10)fail('Too many payment attempts. Try again in an hour.',429);
 await db.prepare('INSERT INTO sponsor_bids (id, player_id, name, url, amount, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(data.id,player,name,url.href,data.amount,Date.now()).run();
 bid=await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(data.id).first();
 if(bid.player_id!==player)fail('Invalid bid.',409);
 }
 if(bid.status!=='checkout')fail('This payment was already processed.',409);
 if(Date.now()-bid.created_at>86400000)fail('Payment attempt expired. Start a new bid.',409);
 const params={mode:'payment','payment_method_types[0]':'card','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(bid.amount),'line_items[0][price_data][product_data][name]':'Is Hormuz Open? — sponsor until outbid','line_items[0][quantity]':'1','metadata[bid_id]':bid.id,'payment_intent_data[metadata][bid_id]':bid.id,client_reference_id:bid.id,success_url:ORIGIN+'/sponsor.html?payment='+bid.id,cancel_url:ORIGIN+'/sponsor.html','custom_text[submit][message]':'One-time payment. Your name and website stay visible until a higher payment replaces you. No minimum display time. If a higher bid wins before yours is processed, yours is refunded.'};
 const session=bid.session_id?await stripe(env,'checkout/sessions/'+encodeURIComponent(bid.session_id)):await stripe(env,'checkout/sessions',params,'sponsor-checkout-'+bid.id);
 if(session.status!=='open'||!session.url)fail('Checkout closed. Start a new bid.',409);
 const target=new URL(session.url);if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')fail('Invalid checkout response.',503);
 await db.prepare('UPDATE sponsor_bids SET session_id = ? WHERE id = ? AND session_id IS NULL').bind(session.id,bid.id).run();
 return {url:session.url,id:bid.id};
}
export async function fulfillSession(db,env,session){
 const id=session.metadata?.bid_id;if(typeof id!=='string')return {ignored:true};
 const bid=await db.prepare('SELECT * FROM sponsor_bids WHERE id = ?').bind(id).first();if(!bid)return {ignored:true};
 if(session.id!==bid.session_id||session.mode!=='payment'||session.currency!=='usd'||session.amount_total!==bid.amount||session.client_reference_id!==bid.id||typeof session.payment_intent!=='string')fail('Payment does not match its bid.',400);
 if(session.payment_status!=='paid')return {status:'pending'};
 const expectedLive=env.STRIPE_SECRET_KEY?.includes('_live_');if(session.livemode!==expectedLive)fail('Payment environment mismatch.',400);
 // Atomic comparison: a delayed or equal-price checkout can never replace a higher sponsor.
 await db.prepare("UPDATE sponsor_bids SET status = CASE WHEN amount > COALESCE((SELECT MAX(amount) FROM sponsor_bids WHERE paid_at IS NOT NULL),0) THEN 'paid' ELSE 'refund_pending' END, paid_at = CASE WHEN amount > COALESCE((SELECT MAX(amount) FROM sponsor_bids WHERE paid_at IS NOT NULL),0) THEN ? ELSE NULL END, payment_intent = ? WHERE id = ? AND status = 'checkout'").bind(Date.now(),session.payment_intent,bid.id).run();
 let result=await db.prepare('SELECT status FROM sponsor_bids WHERE id = ?').bind(bid.id).first();
 if(result.status==='refund_pending'){
 const refund=await stripe(env,'refunds',{payment_intent:session.payment_intent},'sponsor-outbid-refund-'+bid.id);
 if(refund.status==='succeeded'){await db.prepare("UPDATE sponsor_bids SET status = 'refunded' WHERE id = ? AND status = 'refund_pending'").bind(bid.id).run();result={status:'refunded'}}
 return result;
 }
 return result;
}
export async function paymentStatus(db,env,id,player){const bid=await db.prepare('SELECT * FROM sponsor_bids WHERE id = ? AND player_id = ?').bind(id,player).first();if(!bid)fail('Payment not found in this browser.',404);if(bid.session_id&&['checkout','refund_pending'].includes(bid.status)){const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(bid.session_id));await fulfillSession(db,env,session)}const result=await db.prepare('SELECT status FROM sponsor_bids WHERE id = ?').bind(id).first();return {...result,current:(await highBid(db))?.id===id}}
export async function verifyStripeSignature(raw,header,secret,now=Date.now()){
 if(!secret||!header)fail('Missing webhook signature.',400);
 const parts=header.split(',').map(s=>s.trim().split('='));const timestamp=parts.find(p=>p[0]==='t')?.[1];
 if(!/^\d+$/.test(timestamp??'')||Math.abs(now/1000-Number(timestamp))>300)fail('Webhook signature expired.',400);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const message=new TextEncoder().encode(timestamp+'.'+raw);
 for(const [,value] of parts.filter(p=>p[0]==='v1')){if(!/^[a-f0-9]{64}$/.test(value??''))continue;const bytes=Uint8Array.from(value.match(/../g),h=>parseInt(h,16));if(await crypto.subtle.verify('HMAC',key,bytes,message))return}
 fail('Invalid webhook signature.',400);
}
export async function stripeWebhook(db,env,request){
 const reader=request.body?.getReader();if(!reader)fail('Missing webhook body.');const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();fail('Webhook too large.',413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}const raw=new TextDecoder().decode(bytes);
 await verifyStripeSignature(raw,request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET);let event;try{event=JSON.parse(raw)}catch{fail('Invalid webhook.')}
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return fulfillSession(db,env,event.data.object);
 if(event.type==='charge.refunded'&&event.data.object.refunded===true){const intentId=event.data.object.payment_intent;if(typeof intentId==='string'){const intent=await stripe(env,'payment_intents/'+encodeURIComponent(intentId));await db.prepare("UPDATE sponsor_bids SET status = 'refunded' WHERE payment_intent = ? OR id = ?").bind(intentId,intent.metadata?.bid_id??'').run()}}
 return {ok:true};
}
export async function ownerBids(db){const rows=await db.prepare('SELECT id, name, url, amount, status, hidden, session_id AS sessionId, paid_at AS paidAt FROM sponsor_bids ORDER BY created_at DESC LIMIT 100').all();return {bids:rows.results}}
export async function reviewBid(db,data){if(typeof data.id!=='string'||!['hide','show'].includes(data.action))fail('Invalid action.');await db.prepare('UPDATE sponsor_bids SET hidden = ? WHERE id = ?').bind(data.action==='hide'?1:0,data.id).run();return {ok:true}}
