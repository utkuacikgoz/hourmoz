import {RequestError} from './security.mjs';
export async function isOwner(request,env,ctx){
 if(!env.AUCTION_OWNER_EMAIL)return false;
 let email;
 if(env.AUTH_PROVIDER==='cloudflare-access'){
  // Only trust runtime-authenticated identity, never client-supplied email headers.
  if(!ctx?.access||!env.CF_ACCESS_AUD||ctx.access.aud!==env.CF_ACCESS_AUD)return false;
  try{email=(await ctx.access.getIdentity())?.email}catch{return false}
 }else if(env.AUTH_PROVIDER==='sites'){
  if(!request.headers.get('oai-authenticated-user-id'))return false;
  email=request.headers.get('oai-authenticated-user-email');
 }else return false;
 return typeof email==='string'&&email.toLowerCase()===env.AUCTION_OWNER_EMAIL.toLowerCase();
}
export async function requireOwner(request,env,ctx){if(!await isOwner(request,env,ctx))throw new RequestError('Owner sign-in required.',403)}
