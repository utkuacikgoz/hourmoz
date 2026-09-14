// The course follows water south of Qeshm, north of Musandam, then into the Gulf of Oman.
export const route=[[55.05,26.26],[55.55,26.34],[56.0,26.40],[56.42,26.58],[56.61,26.45],[56.72,26.14],[56.86,25.85],[57.25,25.50]];
export const project=([lon,lat])=>({x:(lon-56.3)*89.6,z:(26.4-lat)*100});
export function course(t){
 const u=t*(route.length-1),i=Math.max(0,Math.min(route.length-2,Math.floor(u))),f=u-i;
 const a=route[i],b=route[i+1],before=route[i-1]??a.map((v,j)=>2*v-b[j]),after=route[i+2]??b.map((v,j)=>2*v-a[j]);
 const value=j=>.5*((2*a[j])+(-before[j]+b[j])*f+(2*before[j]-5*a[j]+4*b[j]-after[j])*f*f+(-before[j]+3*a[j]-3*b[j]+after[j])*f*f*f);
 const deriv=j=>.5*((-before[j]+b[j])+2*(2*before[j]-5*a[j]+4*b[j]-after[j])*f+3*(-before[j]+3*a[j]-3*b[j]+after[j])*f*f);
 const p=project([value(0),value(1)]),dx=deriv(0)*89.6,dz=-deriv(1)*100,length=Math.hypot(dx,dz);return {...p,dx:dx/length,dz:dz/length};
}
export function worldPoint(x,z,time){const base=.10+time/105*.76,t=base+(23-z)/300,p=course(t);return{x:p.x-p.dz*x*.32,z:p.z+p.dx*x*.32,angle:Math.atan2(-p.dx,-p.dz),t}}
export function logicalPoint(x,z,time){let best=null;for(let i=0;i<=300;i++){const t=i/300,p=course(t),distance=Math.hypot(p.x-x,p.z-z);if(!best||distance<best.distance)best={...p,t,distance}}return{x:((x-best.x)*-best.dz+(z-best.z)*best.dx)/.32,z:23-(best.t-(.10+time/105*.76))*300}}
