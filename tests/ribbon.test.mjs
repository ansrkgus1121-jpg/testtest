import test from 'node:test';
import assert from 'node:assert/strict';
import {spline, profile, buildRibbon, frameAt, controlPoints, shapeForId} from '../web/ribbon.js';

test('cubic B-spline reproduces independent Bernstein weights',()=>{
  const a=spline([[0,0,0],[1,0,0],[2,6,0],[3,0,6]],2);
  assert.deepEqual(a[0],[1,1,0]);
  assert.deepEqual(a[1],[1.5,2.875,.125]);
  assert.deepEqual(a[2],[2,4,1]);
});
test('rounded profile and closed surface have finite geometry',()=>{
  const p=profile(8,2,.2);assert.equal(p.length,8);
  assert.ok(Math.abs(Math.max(...p.map(v=>v[0]))-1)<1e-6);
  const points=Array.from({length:8},(_,i)=>[i,Math.sin(i),Math.cos(i)]);
  const mesh=buildRibbon(points,.3,.04,4);
  assert.equal(mesh.positions.length,(8-3)*4*8*6*3);
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.ok(mesh.normals.every(Number.isFinite));
  assert.ok(mesh.normals.some(x=>Math.abs(x)>.5));
});
test('seek interpolates, clamps and deterministically rebuilds shape',()=>{
  const data={fps:50,stems:{bass:{energy:[0,1,0],onset:[0,.5,0]}}};
  assert.equal(frameAt(data,.01).bass.energy,.5);
  assert.equal(frameAt(data,50).bass.energy,0);
  assert.equal(frameAt(data,-10).bass.energy,0);
  assert.deepEqual(controlPoints(2,4,.5,.2,1),controlPoints(2,4,.5,.2,1));
  assert.notDeepEqual(controlPoints(2,4,.5,.2,1),controlPoints(2,4,0,0,1));
});

test('folded chains have resolved coils and occupy all three dimensions',()=>{
  for(let stem=0;stem<4;stem++){
    const points=controlPoints(stem,0,0,0,1);
    assert.ok(points.length>=100,'enough control points to resolve local helices');
    for(let axis=0;axis<3;axis++){
      const values=points.map(p=>p[axis]);
      assert.ok(Math.max(...values)-Math.min(...values)>1.8,'volumetric folded path');
    }
    assert.deepEqual(points,controlPoints(stem,20,0,0,1),'silence is stationary');
  }
});

test('smooth surface normals agree at duplicated triangle vertices',()=>{
  const mesh=buildRibbon(controlPoints(0,1,.4,.2,1),.2,.04,3);
  const normals=new Map();let shared=0;
  for(let i=0;i<mesh.positions.length;i+=3){
    const p=Array.from(mesh.positions.slice(i,i+3));
    const n=Array.from(mesh.normals.slice(i,i+3));
    assert.ok(n.every(Number.isFinite));
    const key=p.map(x=>x.toFixed(5)).join(',');
    if(normals.has(key)){
      const previous=normals.get(key);
      if(Math.hypot(...n)>.9&&Math.hypot(...previous)>.9){
        assert.ok(n.reduce((sum,v,j)=>sum+v*previous[j],0)>.98,'shared vertices have smooth lighting');shared++;
      }
    }else normals.set(key,n);
  }
  assert.ok(shared>100);
});

test('surface lighting normals follow triangle winding',()=>{
  const mesh=buildRibbon(Array.from({length:8},(_,i)=>[i,0,0]),.25,.04,3);
  for(let i=0;i<mesh.positions.length;i+=9){
    const p=mesh.positions;
    const a=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]];
    const b=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];
    const face=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    if(Math.hypot(...face)<1e-8)continue;
    const average=[0,1,2].map(k=>mesh.normals[i+k]+mesh.normals[i+3+k]+mesh.normals[i+6+k]);
    assert.ok(face.reduce((s,x,k)=>s+x*average[k],0)>0,'normals must face the same direction as the surface');
  }
});

test('song identity picks a stable but distinct three-dimensional fold',()=>{
  const first='1'.repeat(64),second='2'.repeat(64);
  const a=shapeForId(first),b=shapeForId(second);
  assert.deepEqual(a,shapeForId(first),'reopening the same song keeps its shape');
  assert.notDeepEqual(a,b,'a different song gets a different shape');
  assert.notDeepEqual(controlPoints(0,0,0,0,1,a),controlPoints(0,0,0,0,1,b));
  assert.deepEqual(controlPoints(0,0,0,0,1,a),controlPoints(0,20,0,0,1,a),'shape stays still during silence');
  for(const shape of [a,b]){
    const vertices=buildRibbon(controlPoints(2,8,.5,.1,1,shape),.2,.04,3).positions;
    assert.ok(vertices.every(Number.isFinite));
  }
});
