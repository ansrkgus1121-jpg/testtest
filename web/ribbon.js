/* Adapted from fogleman/ribbon, MIT, Copyright (c) 2017 Michael Fogleman.
 * Commit 568057efb726b6f8b8a5c6b067a27f411a77f487:
 * ribbon/spline.go: cubic B-spline basis and offset-plane interpolation.
 * ribbon/ribbon.go: roundedRectangleProfile, createSegmentMesh, triangulateQuad.
 * Changes: JS arrays, direct polynomial evaluation of the SAME B-spline basis
 * instead of forward differences; audio control points replace protein planes;
 * derived tangent frames replace peptide planes, fixed rounded profiles with
 * original endpoint easing, GPU-ready typed arrays and surface normals.
 * See ../RIBBON-LICENSE.txt. This is an algorithm port, not the Go executable.
 */
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const lerp=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function spline(points, steps) {
  if(points.length!==4||steps<1)throw Error('Four points and positive steps required');
  return Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,t2=t*t,t3=t2*t;
    const w=[(1-3*t+3*t2-t3)/6,(4-6*t2+3*t3)/6,(1+3*t+3*t2-3*t3)/6,t3/6];
    return [0,1,2].map(axis=>Number(points.reduce((s,p,j)=>s+p[axis]*w[j],0).toFixed(10)));
  });
}

export function profile(n,w,h){
  const result=[],r=h/2,hw=w/2-r,hh=h/2,m=n/4;
  for(let segment=0;segment<4;segment++)for(let i=0;i<m;i++){
    const t=i/m;
    if(segment===0)result.push([hw-2*hw*t,hh,0]);
    else if(segment===2)result.push([-hw+2*hw*t,-hh,0]);
    else {
      const a=(segment===1?Math.PI/2:3*Math.PI/2)+Math.PI*t;
      result.push([(segment===1?-hw:hw)+Math.cos(a)*r,Math.sin(a)*r,0]);
    }
  }
  return result;
}

export function buildRibbon(points,width,thickness,steps=6){
  const detail=8,segments=points.length-3,ringCount=segments*steps+1;
  const positions=new Float32Array(segments*steps*detail*18),normals=new Float32Array(positions.length);
  // Parallel transport avoids frame flips when a folded chain crosses a world axis.
  let previous=null;
  const frames=points.map((p,i)=>{
    const tangent=unit(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)]));
    let side=previous?sub(previous,mul(tangent,dot(previous,tangent))):cross(tangent,[0,0,1]);
    if(Math.hypot(...side)<1e-5)side=cross(tangent,Math.abs(tangent[1])<.9?[0,1,0]:[1,0,0]);
    side=unit(side);previous=side;
    return {p,side,normal:unit(cross(tangent,side))};
  });
  const section=profile(detail,width,thickness),rings=new Float32Array(ringCount*detail*3);
  // Sweep the same offset-plane B-spline basis as the upstream implementation.
  // Calculate shared rings once, instead of duplicating splines for every quad.
  for(let ring=0;ring<ringCount;ring++){
    const seg=Math.min(Math.floor(ring/steps),segments-1),t=(ring-seg*steps)/steps;
    const t2=t*t,t3=t2*t,w=[(1-3*t+3*t2-t3)/6,(4-6*t2+3*t3)/6,(1+3*t+3*t2-3*t3)/6,t3/6];
    const taper=seg===0?Math.sqrt(1-(t-1)**2):seg===segments-1?Math.sqrt(1-t*t):1;
    for(let j=0;j<detail;j++)for(let axis=0;axis<3;axis++){
      let value=0;
      for(let k=0;k<4;k++){
        const f=frames[seg+k];
        value+=w[k]*(f.p[axis]+taper*(f.side[axis]*section[j][0]+f.normal[axis]*section[j][1]));
      }
      rings[(ring*detail+j)*3+axis]=value;
    }
  }
  const ringNormals=new Float32Array(rings.length);
  const point=(r,j)=>Array.from(rings.subarray((r*detail+j)*3,(r*detail+j)*3+3));
  for(let r=1;r<ringCount-1;r++)for(let j=0;j<detail;j++){
    const along=sub(point(r+1,j),point(r-1,j));
    const across=sub(point(r,(j+1)%detail),point(r,(j+detail-1)%detail));
    const normal=unit(cross(across,along));
    ringNormals.set(normal,(r*detail+j)*3);
  }
  // Collapsed tips have no unique surface normal; use zero to avoid false seams.
  let cursor=0;
  const vertex=(r,j)=>{
    const offset=(r*detail+j)*3;
    for(let axis=0;axis<3;axis++){
      positions[cursor]=rings[offset+axis];normals[cursor++]=ringNormals[offset+axis];
    }
  };
  for(let r=0;r<ringCount-1;r++)for(let j=0;j<detail;j++){
    const next=(j+1)%detail;
    vertex(r,next);vertex(r+1,next);vertex(r+1,j);
    vertex(r,next);vertex(r+1,j);vertex(r,j);
  }
  return {positions,normals};
}

export function frameAt(data,time){
  const result={};
  for(const [name,stem] of Object.entries(data.stems)){
    const t=clamp(time*data.fps,0,stem.energy.length-1),i=Math.floor(t),j=Math.min(i+1,stem.energy.length-1),f=t-i;
    result[name]={energy:stem.energy[i]*(1-f)+stem.energy[j]*f,onset:stem.onset[i]*(1-f)+stem.onset[j]*f};
  }
  return result;
}

const DEFAULT_SHAPE={phase:0,bend:1,turns:0,coil:1};

export function shapeForId(id){
  // The server ID includes the music bytes. Mixing all digits avoids relying
  // on only a short hash prefix; the same analyzed song recreates its shape.
  if(!/^[a-f0-9]{64}$/i.test(id))throw Error('Invalid song ID');
  let state=2166136261;
  for(const digit of id){state=Math.imul(state^digit.charCodeAt(0),16777619)>>>0;}
  const next=()=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)/4294967296;
  };
  return {phase:(next()-.5)*2.2,bend:.75+next()*.5,
    turns:(next()-.5)*3.2,coil:.78+next()*.5};
}

export function controlPoints(index,time,energy,onset,strength,shape=DEFAULT_SHAPE){
  const e=energy*strength,o=onset*strength,phase=index*1.47+shape.phase;
  const center=u=>{
    const t=u*Math.PI*2;
    return [1.08*Math.cos(t+phase)+.42*shape.bend*Math.cos(2*t-phase),
      1.18*Math.sin(t*1.25+phase)+.25*shape.bend*Math.cos(t*3+phase),
      1.02*Math.sin(t+phase)+.5*Math.cos(t*1.7-phase)];
  };
  let previous=null;
  return Array.from({length:160},(_,i)=>{
    const u=i/159,p=center(u),tangent=unit(sub(center(u+.001),center(u-.001)));
    let side=previous?sub(previous,mul(tangent,dot(previous,tangent))):cross(tangent,[0,0,1]);
    if(Math.hypot(...side)<1e-5)side=cross(tangent,[0,1,0]);
    side=unit(side);previous=side;const normal=unit(cross(tangent,side));
    // Alternating compact helices and broader turns resemble a folded chain.
    const envelope=(.19+.09*Math.sin(u*Math.PI*7+phase)**2)*shape.coil;
    const angle=u*Math.PI*2*(11.5+index*.7+shape.turns)+phase+e*.18*Math.sin(time*1.4+u*8);
    const radius=envelope+e*.06+o*(index===1?.10:.025);
    const coil=add(mul(side,Math.cos(angle)*radius),mul(normal,Math.sin(angle)*radius));
    const motion=[Math.sin(u*9+time)*e*.075,Math.cos(u*7+time*1.2)*e*.09,Math.sin(u*11-time)*e*.07];
    const scale=1+e*(index===2?.12:.04);
    return add(mul(add(p,coil),scale),motion);
  });
}
