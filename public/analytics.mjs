export function trafficSource(search,referrer,origin){
 const params=new URLSearchParams(search);
 if(params.has('ghost')||params.has('challenge'))return 'challenge';
 const aliases={twitter:'x',x:'x',reddit:'reddit',instagram:'instagram',tiktok:'tiktok',youtube:'youtube',facebook:'facebook',linkedin:'linkedin',google:'search',bing:'search'};
 const campaign=params.get('utm_source')?.toLowerCase();
 if(campaign)return aliases[campaign]||'other';
 try{const url=new URL(referrer);if(url.origin===origin)return 'direct';const host=url.hostname.replace(/^www\./,'');
 for(const [domain,source] of [['t.co','x'],['x.com','x'],['twitter.com','x'],['reddit.com','reddit'],['instagram.com','instagram'],['tiktok.com','tiktok'],['youtube.com','youtube'],['facebook.com','facebook'],['linkedin.com','linkedin'],['google.com','search'],['bing.com','search'],['duckduckgo.com','search']])if(host===domain||host.endsWith('.'+domain))return source;
 return 'other';}catch{return 'direct'}
}
const browser=typeof document!=='undefined';
export const analyticsEnabled=browser&&navigator.doNotTrack!=='1'&&!navigator.globalPrivacyControl;
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true,signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error();return r.json()}
// Start the cookie handshake before ranked play so both use the same browser identity.
export const landing=analyticsEnabled?post('/api/visits',{id:crypto.randomUUID(),source:trafficSource(location.search,document.referrer,location.origin)}).catch(()=>null):Promise.resolve(null);
export async function trackVisit(event){const visit=await landing;if(visit)void post('/api/visit-events',{visitId:visit.id,event}).catch(()=>{})}
async function setupSponsors(){
 try{const r=await fetch('/api/sponsor',{signal:AbortSignal.timeout(5000)});if(!r.ok)return;const {sponsor,bookingUrl}=await r.json();
 for(const container of document.querySelectorAll('[data-sponsor]')){
 if(sponsor){const label=document.createElement('span'),link=document.createElement('a');label.textContent='TODAY’S SPONSOR';link.textContent=sponsor.name;link.href=sponsor.url;link.target='_blank';link.rel='sponsored noopener noreferrer';link.onclick=()=>trackVisit('sponsor_click');container.append(label,link);
 // Require a visible placement for a full second; hidden result screens do not count.
 let timer;const observer=new IntersectionObserver(entries=>{clearTimeout(timer);if(entries[0].isIntersecting&&entries[0].intersectionRatio>=.5&&!document.hidden)timer=setTimeout(()=>{trackVisit('sponsor_view');observer.disconnect()},1000)},{threshold:.5});observer.observe(container);document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden){observer.unobserve(container);observer.observe(container)}});
 }
 if(bookingUrl){const link=document.createElement('a');link.className='sponsor-booking';link.textContent='Sponsor a day';link.href=bookingUrl;link.target='_blank';link.rel='noopener noreferrer';link.onclick=()=>trackVisit('booking_click');container.append(link)}
 container.hidden=!sponsor&&!bookingUrl;
 }
 }catch{}
}
if(browser)void setupSponsors();
