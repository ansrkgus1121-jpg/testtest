export function hsvToHex(h,s,v){
 h=((h%360)+360)%360;s=Math.max(0,Math.min(1,s));v=Math.max(0,Math.min(1,v));
 const c=v*s,x=c*(1-Math.abs(h/60%2-1)),m=v-c;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return (Math.round((r+m)*255)<<16)|(Math.round((g+m)*255)<<8)|Math.round((b+m)*255);
}
export function hexToHsv(hex){
 const r=((hex>>16)&255)/255,g=((hex>>8)&255)/255,b=(hex&255)/255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 let h=0;
 if(d){if(max===r)h=60*((g-b)/d%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);}
 return {h:(h+360)%360,s:max?d/max:0,v:max};
}
export function wheelPointToHsv(x,y,r){
 const d=Math.min(1,Math.hypot(x,y)/r);
 return {h:(Math.atan2(y,x)*180/Math.PI+360)%360,s:d};
}
