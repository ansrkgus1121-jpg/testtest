import * as THREE from './vendor/three.module.js';
import {buildRibbon,controlPoints,frameAt,shapeForId} from './ribbon.js';
import {hsvToHex,hexToHsv,wheelPointToHsv} from './color-picker.js';

const $=id=>document.getElementById(id);
const audio=$('audio'),names=['vocals','drums','bass','other'];
const palettes={default:[0xd99465,0x65c7c1,0xcfd5db,0xf3ede2],bright:[0xff7e67,0x5cd9ef,0xafd66b,0xe4a4e8],mono:[0xeeeeee,0xbababa,0x999999,0xdddddd]};
const validColors=value=>Array.isArray(value)&&value.length===4&&value.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffff);
let savedColors=null;
try{savedColors=JSON.parse(localStorage.getItem('ribbonColors'));}catch{}
let customColors=validColors(savedColors?.colors)?[...savedColors.colors]:[...palettes.default];
const savedPalette=savedColors?.palette==='custom'?'custom':Object.hasOwn(palettes,savedColors?.palette)?savedColors.palette:'default';
let colors=savedPalette==='custom'?[...customColors]:[...palettes[savedPalette]];
$('palette').value=savedPalette;
let data=null,job=null,generation=0,renderer=null,scene,camera,meshes=[],dirty=true,lastTime=-1,lastDraw=0;
let currentShape=null;
let visualError='';
$('motion').checked=!matchMedia('(prefers-reduced-motion: reduce)').matches;

function syncColorSwatches(){
 names.forEach((name,i)=>{
  document.querySelector(`[data-color="${name}"] .swatch`).style.backgroundColor=`#${colors[i].toString(16).padStart(6,'0')}`;
 });
}
function saveColors(){try{localStorage.setItem('ribbonColors',JSON.stringify({palette:$('palette').value,colors:customColors}));}catch{}}
syncColorSwatches();

const wheel=$('color-wheel'),bar=$('brightness-bar'),wheelCtx=wheel.getContext('2d'),barCtx=bar.getContext('2d');
const wheelRadius=118,wheelCenter=120;
let pickedIndex=-1,pickedHsv={h:0,s:0,v:1};
const wheelImage=wheelCtx.createImageData(240,240);
for(let y=0;y<240;y++)for(let x=0;x<240;x++){
 const dx=x+.5-wheelCenter,dy=y+.5-wheelCenter,d=Math.hypot(dx,dy),offset=(y*240+x)*4;
 if(d>wheelRadius)continue;
 const {h,s}=wheelPointToHsv(dx,dy,wheelRadius),hex=hsvToHex(h,s,1);
 wheelImage.data[offset]=hex>>16&255;wheelImage.data[offset+1]=hex>>8&255;wheelImage.data[offset+2]=hex&255;wheelImage.data[offset+3]=255;
}
function paintPicker(){
 wheelCtx.clearRect(0,0,240,240);wheelCtx.putImageData(wheelImage,0,0);
 const rad=pickedHsv.h*Math.PI/180,x=wheelCenter+Math.cos(rad)*pickedHsv.s*wheelRadius,y=wheelCenter+Math.sin(rad)*pickedHsv.s*wheelRadius;
 wheelCtx.beginPath();wheelCtx.arc(x,y,5,0,Math.PI*2);wheelCtx.lineWidth=3;wheelCtx.strokeStyle='#000';wheelCtx.stroke();
 wheelCtx.beginPath();wheelCtx.arc(x,y,4,0,Math.PI*2);wheelCtx.lineWidth=2;wheelCtx.strokeStyle='#fff';wheelCtx.stroke();
 const full=hsvToHex(pickedHsv.h,pickedHsv.s,1),gradient=barCtx.createLinearGradient(0,0,0,240);
 gradient.addColorStop(0,`#${full.toString(16).padStart(6,'0')}`);gradient.addColorStop(1,'#000');
 barCtx.fillStyle=gradient;barCtx.fillRect(0,0,24,240);
 const by=(1-pickedHsv.v)*239;
 barCtx.fillStyle='#000';barCtx.fillRect(0,Math.max(0,by-2),24,4);barCtx.fillStyle='#fff';barCtx.fillRect(0,Math.max(0,by-1),24,2);
 bar.setAttribute('aria-valuenow',String(Math.round(pickedHsv.v*100)));
 $('picked-color').style.backgroundColor=`#${hsvToHex(pickedHsv.h,pickedHsv.s,pickedHsv.v).toString(16).padStart(6,'0')}`;
}
function applyPickedColor(){
 colors[pickedIndex]=hsvToHex(pickedHsv.h,pickedHsv.s,pickedHsv.v);
 customColors=[...colors];$('palette').value='custom';saveColors();syncColorSwatches();dirty=true;paintPicker();
}
$('ribbon-colors').addEventListener('click',event=>{
 const button=event.target.closest('[data-color]');if(!button)return;
 pickedIndex=names.indexOf(button.dataset.color);pickedHsv=hexToHsv(colors[pickedIndex]);
 $('color-title').textContent=`${button.getAttribute('aria-label')}`;paintPicker();$('color-dialog').showModal();
});
$('color-close').addEventListener('click',()=>$('color-dialog').close());
function pickerPointer(canvas,event){
 const rect=canvas.getBoundingClientRect();
 if(canvas===wheel){const x=(event.clientX-rect.left)*240/rect.width-wheelCenter,y=(event.clientY-rect.top)*240/rect.height-wheelCenter;
  const next=wheelPointToHsv(x,y,wheelRadius);pickedHsv.h=next.h;pickedHsv.s=next.s;
 }else pickedHsv.v=1-Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
 applyPickedColor();
}
for(const canvas of [wheel,bar]){
 canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);pickerPointer(canvas,event);});
 canvas.addEventListener('pointermove',event=>{if(canvas.hasPointerCapture(event.pointerId))pickerPointer(canvas,event);});
 canvas.addEventListener('keydown',event=>{
  if(canvas===wheel){if(event.key==='ArrowLeft')pickedHsv.h=(pickedHsv.h+358)%360;else if(event.key==='ArrowRight')pickedHsv.h=(pickedHsv.h+2)%360;else if(event.key==='ArrowUp')pickedHsv.s=Math.min(1,pickedHsv.s+.03);else if(event.key==='ArrowDown')pickedHsv.s=Math.max(0,pickedHsv.s-.03);else return;
  }else{if(event.key==='ArrowUp')pickedHsv.v=Math.min(1,pickedHsv.v+.03);else if(event.key==='ArrowDown')pickedHsv.v=Math.max(0,pickedHsv.v-.03);else return;}
  event.preventDefault();applyPickedColor();
 });
}

function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function remember(id){try{id?localStorage.setItem('ribbonJob',id):localStorage.removeItem('ribbonJob');}catch{}}
function busy(value){$('file').disabled=value;$('analyze').disabled=value;$('sample').disabled=value;$('remove').disabled=value||!job;}
function clear(){
 audio.pause();audio.removeAttribute('src');audio.load();data=null;lastTime=-1;dirty=true;
 $('settings').disabled=true;$('empty').hidden=false;$('track').textContent='';
 for(const n of names)$('meter-'+n).value=0;
 for(const mesh of meshes){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
 meshes=[];if(renderer)renderer.render(scene,camera);
}
async function request(url,options){
 const r=await fetch(url,options);
 if(!r.ok){let text;try{text=(await r.json()).detail;}catch{text='서버 응답을 읽을 수 없습니다.';}throw Error(typeof text==='string'?text:'요청을 처리할 수 없습니다.');}
 return r.json();
}

function resize(){
 if(!renderer)return;
 const width=$('visual').clientWidth,height=$('visual').clientHeight;
 renderer.setSize(width,height,false);camera.aspect=width/height;
 camera.position.set(2.6,1.6,width/height<1?8.6:5.5);camera.lookAt(0,0,0);camera.updateProjectionMatrix();dirty=true;
}
function initializeVisual(){
 if(!renderer){
  try{
   renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,alpha:false,preserveDrawingBuffer:true});
   renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x000000);
   renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
   renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
   scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(44,1,.1,100);camera.position.set(0,1.1,6.2);camera.lookAt(0,0,0);
   scene.add(new THREE.HemisphereLight(0xddeaff,0x292331,.8));
   const light=new THREE.DirectionalLight(0xfff2df,3.2);light.position.set(-3,5,6);
   light.castShadow=true;light.shadow.mapSize.set(1024,1024);
   Object.assign(light.shadow.camera,{left:-3.5,right:3.5,top:3.5,bottom:-3.5,near:.5,far:18});
   light.shadow.bias=-.0003;light.shadow.normalBias=.025;scene.add(light);
   const rim=new THREE.DirectionalLight(0xb7d9ff,1.5);rim.position.set(4,1,-4);scene.add(rim);
   new ResizeObserver(resize).observe($('visual'));resize();
  }catch{
   visualError='이 브라우저에서 WebGL을 사용할 수 없습니다. 하드웨어 가속을 켠 Chrome에서 다시 열어주세요.';
   $('empty').textContent=visualError;$('empty').hidden=false;return;
  }
 }
 for(let i=0;i<4;i++){
  const shape=buildRibbon(controlPoints(i,0,0,0,1,currentShape),.18,.035,3);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(shape.positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal',new THREE.BufferAttribute(shape.normals,3).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.MeshStandardMaterial({color:colors[i],metalness:.08,roughness:.38,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);meshes.push(mesh);
 }
 $('empty').hidden=true;dirty=true;
}
function draw(now){
 requestAnimationFrame(draw);
 if(!data||document.hidden)return;
 const t=audio.currentTime||0;
 if(!dirty&&(t===lastTime||now-lastDraw<33))return;
 const frames=frameAt(data,t),strength=Number($('strength').value);
 for(let i=0;i<4;i++){
  const name=names[i],f=frames[name];$('meter-'+name).value=f.energy;
  if(!renderer||!meshes[i])continue;
  const motion=$('motion').checked;
  const points=controlPoints(i,motion?t:0,motion?f.energy:0,motion?f.onset:0,strength,currentShape);
  const shape=buildRibbon(points,.18+(motion?f.energy*strength*.09:0),.035,3);
  const mesh=meshes[i];
  for(const [key,values] of [['position',shape.positions],['normal',shape.normals]]){
   mesh.geometry.attributes[key].array.set(values);mesh.geometry.attributes[key].needsUpdate=true;
  }
  mesh.material.color.setHex(colors[i]);
  mesh.visible=document.querySelector(`[data-stem="${name}"]`).checked;
 }
 if(renderer)renderer.render(scene,camera);
 dirty=false;lastTime=t;lastDraw=now;
}
requestAnimationFrame(draw);
document.addEventListener('visibilitychange',()=>dirty=true);
audio.addEventListener('seeked',()=>dirty=true);
audio.addEventListener('error',()=>{if(data)message('음원을 재생할 수 없습니다. 분석 결과를 삭제한 뒤 다시 분석하세요.',true);});
$('settings').addEventListener('input',()=>{dirty=true;$('strengthValue').value=Number($('strength').value).toFixed(2);});
$('palette').addEventListener('change',()=>{
 colors=$('palette').value==='custom'?[...customColors]:[...palettes[$('palette').value]];
 syncColorSwatches();saveColors();dirty=true;
});
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('visual').requestFullscreen();}catch{message('이 브라우저에서 전체 화면을 열 수 없습니다.',true);}};

async function ready(state,token){
 const features=await request(`/api/jobs/${state.id}/features`);
 if(token!==generation)return;
 data=features;currentShape=shapeForId(state.id); audio.src=`/api/jobs/${state.id}/audio`;audio.load();
 $('track').textContent=state.name;$('settings').disabled=false;
 initializeVisual();busy(false);
 message(`분석 완료${state.cached?' · 기존 분석 결과 사용':''} · ${state.duration.toFixed(1)}초${visualError?' · '+visualError:''}`,!!visualError);
}
async function follow(state,token){
 while(token===generation){
  job=state;remember(job.id);
  if(state.status==='ready'){await ready(state,token);return;}
  message(state.message);
  if(state.status==='failed'){busy(false);message(state.message,true);return;}
  await new Promise(resolve=>setTimeout(resolve,700));
  if(token!==generation)return;
  state=await request(`/api/jobs/${job.id}`);
 }
}
async function submit(file){
 if($('analyze').disabled)return;
 if(!file){message('음악 파일을 선택하세요.',true);return;}
 if(!/\.(mp3|wav)$/i.test(file.name)){message('MP3 또는 WAV 파일을 선택하세요.',true);return;}
 if(!file.size||file.size>50*1024*1024){message('0바이트보다 크고 50MB 이하인 파일을 선택하세요.',true);return;}
 const token=++generation;clear();job=null;remember(null);busy(true);message('파일을 읽는 중');
 try{
  const form=new FormData();form.append('file',file);
  const state=await request('/api/jobs',{method:'POST',body:form});
  if(token===generation)await follow(state,token);
 }catch(e){if(token===generation){busy(false);message(e.message,true);}}
}
$('upload').onsubmit=e=>{e.preventDefault();submit($('file').files[0]);};
$('sample').onclick=async()=>{
 if($('sample').disabled)return;
 $('sample').disabled=true;
 try{
  const r=await fetch('/samples/carefree-20s.mp3');if(!r.ok)throw Error('샘플 파일을 찾을 수 없습니다.');
  const file=new File([await r.blob()],'carefree-20s.mp3',{type:'audio/mpeg'});
  $('sample').disabled=false;await submit(file);
 }catch(e){$('sample').disabled=false;message(e.message,true);}
};
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{e.preventDefault();if(!$('analyze').disabled)submit(e.dataTransfer.files[0]);});
$('remove').onclick=async()=>{
 if(!job)return;
 busy(true);
 try{await request(`/api/jobs/${job.id}`,{method:'DELETE'});++generation;clear();job=null;remember(null);message('이 곡의 분석 결과를 삭제했습니다.');}
 catch(e){message(e.message,true);}
 finally{busy(false);}
};

(async()=>{
 try{
  const health=await request('/api/health');let id=health.active_id;
  if(!id)try{id=localStorage.getItem('ribbonJob');}catch{}
  if(id){busy(true);await follow(await request(`/api/jobs/${id}`),++generation);}
 }catch(e){remember(null);busy(false);message(e.message,true);}
})();
