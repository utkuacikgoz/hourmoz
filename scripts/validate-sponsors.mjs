import {readFileSync} from 'node:fs';
export function validateSponsors(config){
 if(!Array.isArray(config.schedule))throw new Error('Sponsor schedule must be an array.');
 const link=(value,mail=false)=>{const u=new URL(value);if(!(['https:',...(mail?['mailto:']:[])].includes(u.protocol))||u.username||u.password)throw new Error('Sponsor links must use HTTPS (booking also accepts mailto).')};
 if(config.bookingUrl!==null)link(config.bookingUrl,true);
 const days=new Set(),ids=new Set();
 for(const s of config.schedule){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||new Date(s.day+'T00:00:00Z').toISOString().slice(0,10)!==s.day)throw new Error('Use a valid UTC date for each sponsor.');
 if(days.has(s.day))throw new Error('Only one sponsor is allowed per UTC day.');days.add(s.day);
 if(!/^[a-z0-9-]{1,60}$/.test(s.id)||ids.has(s.id))throw new Error('Use a unique campaign id for each sponsor day.');ids.add(s.id);
 if(typeof s.name!=='string'||!s.name.trim()||s.name.length>60)throw new Error('Sponsor names must be 1–60 characters.');
 link(s.url);
 }
}
validateSponsors(JSON.parse(readFileSync(new URL('../public/sponsors.json',import.meta.url),'utf8')));
