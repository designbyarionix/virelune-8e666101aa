import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const scale=42,cellSize=128,bodyHeight=34;
const vector=(x,y,z)=>new T.Vector3(x,y,z);
function collision(rows,withWalls){
  const cells=new Map(),walls=new Map();
  for(const row of rows){
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=row.map(n=>n*scale);
    const a=vector(ax,ay,az),b=vector(bx,by,bz),c=vector(cx,cy,cz);
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    if(normal.lengthSq()<.01)continue;
    const floor=normal.y/normal.length()>=.38;
    const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if(floor&&Math.abs(denominator)<.01||!floor&&!withWalls)continue;
    const triangle=floor?{ax,ay,az,bx,by,bz,cx,cy,cz,denominator}:{a,b,c,minY:Math.min(ay,by,cy),maxY:Math.max(ay,by,cy)};
    const grid=floor?cells:walls;
    for(let x=Math.floor(Math.min(ax,bx,cx)/cellSize);x<=Math.floor(Math.max(ax,bx,cx)/cellSize);x++){
      for(let z=Math.floor(Math.min(az,bz,cz)/cellSize);z<=Math.floor(Math.max(az,bz,cz)/cellSize);z++){
        const key=x+':'+z;
        if(!grid.has(key))grid.set(key,[]);
        grid.get(key).push(triangle);
      }
    }
  }
  const heightAt=(p,maxY=Infinity)=>{
    const key=Math.floor(p.x/cellSize)+':'+Math.floor(p.z/cellSize);
    let best=-Infinity;
    for(const t of cells.get(key)??[]){
      const u=((t.bz-t.cz)*(p.x-t.cx)+(t.cx-t.bx)*(p.z-t.cz))/t.denominator;
      const v=((t.cz-t.az)*(p.x-t.cx)+(t.ax-t.cx)*(p.z-t.cz))/t.denominator;
      if(u<-.0001||v<-.0001||u+v>1.0001)continue;
      const y=u*t.ay+v*t.by+(1-u-v)*t.cy;
      if(y<=maxY&&y>best)best=y;
    }
    return Number.isFinite(best)?best:null;
  };
  const ray=new T.Ray(),hit=vector(0,0,0);
  const wallDistance=(start,end)=>{
    const minX=Math.floor(Math.min(start.x,end.x)/cellSize),maxX=Math.floor(Math.max(start.x,end.x)/cellSize);
    const minZ=Math.floor(Math.min(start.z,end.z)/cellSize),maxZ=Math.floor(Math.max(start.z,end.z)/cellSize);
    const minY=Math.min(start.y,end.y),maxY=Math.max(start.y,end.y);
    ray.origin.copy(start);ray.direction.subVectors(end,start);
    const length=ray.direction.length();
    if(!withWalls||length<.01)return Infinity;
    ray.direction.divideScalar(length);
    let nearest=Infinity;
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      for(const t of walls.get(x+':'+z)??[]){
        if(t.minY>maxY||t.maxY<minY)continue;
        if(!ray.intersectTriangle(t.a,t.b,t.c,false,hit))continue;
        const distance=start.distanceTo(hit);
        if(distance<=length&&distance<nearest)nearest=distance;
      }
    }
    return nearest;
  };
  const from=vector(0,0,0),to=vector(0,0,0);
  const nearWall=p=>{
    if(!withWalls)return false;
    for(const y of [-18,10]){
      from.set(p.x,p.y+y,p.z);
      for(const [x,z] of [[12,0],[-12,0],[0,12],[0,-12]]){
        to.set(p.x+x,from.y,p.z+z);
        if(wallDistance(from,to)<Infinity)return true;
      }
    }
    return false;
  };
  return {heightAt,wallDistance,nearWall};
}
export async function loadStormMap(name){
  const key={storm_river:"river",storm_forest:"forest",storm_sand:"sand"}[name];
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [model,rows]=await Promise.all([
    loader.loadAsync('storm/'+key+'.glb'),
    fetch('storm/'+key+'-collision.json').then(r=>{
      if(!r.ok)throw Error('Липсва колизията на Storm 2.');
      return r.json();
    })
  ]);
  const group=model.scene;
  group.scale.setScalar(scale);
  const waterMeshes=[],arenaWater=[],cameraObstacles=[];
  let duneTexture=null;
  const waterNormal=key==='river'?new T.TextureLoader().load('assets/gfx/fx/bump3.bmp'):null;
  if(waterNormal){
    waterNormal.wrapS=waterNormal.wrapT=T.RepeatWrapping;
    waterNormal.repeat.set(10,10);
  }
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const source=mesh.material;
    if(key==='sand'&&source.map?.name==='sa22b_sand00_0')duneTexture=source.map;
    const names=[mesh.name,source.name];
    for(let parent=mesh.parent;parent&&parent!==group;parent=parent.parent)names.push(parent.name);
    const helper=names.some(name=>/sky|^si02bback0|^si02befe|^si02bhit|^sun01/i.test(name))||
      key==='forest'&&names.some(name=>/^(?:sa03b1(?:hit|_mdl|bac001)|leafa\b|bug_01)|(?:^|\d)light\d/i.test(name))||
      key==='sand'&&names.some(name=>/^sa22b(?:_mhit|_charpos|eff|_sand00|_smk02|_01_kusa)/i.test(name));
    if(helper){mesh.visible=false;return;}
    const inArena=names.some(name=>/^si02bflo00$|^si02b_flo002/i.test(name));
    if(waterNormal&&(inArena||names.some(name=>/si02briver01/i.test(name)))){
      mesh.material=new T.MeshPhongMaterial({
        color:0x397e95,normalMap:waterNormal,normalScale:new T.Vector2(.8,.8),
        reflectivity:.45,specular:0xc2f0ff,shininess:45,side:T.DoubleSide,
        polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
      });
      waterMeshes.push(mesh);
      if(inArena)arenaWater.push(mesh);
      return;
    }
    const texture=source.map?.name??'';
    const forestCutout=/^sa03b1(?:obj00[36789]|bac00[2-9]|grass001)/i.test(texture);
    const sandCutout=/^sa22b(?:_obj|_01_obj|bac002|flo002)/i.test(texture);
    const alphaTest=key==='forest'&&(forestCutout||source.transparent)?.28:
      key==='sand'&&sandCutout?.12:source.alphaTest;
    mesh.material=new T.MeshLambertMaterial({
      name:source.name,color:source.color,map:source.map,side:T.DoubleSide,alphaTest
    });
    if(key==='forest'&&/^sa03b1flo00[56]/i.test(texture))mesh.material.color.multiply(new T.Color(0x95b47d));
    if(key==='forest'&&names.some(name=>/^trans_sa03b1tree0[1-6]$/i.test(name))||
       key==='river'&&names.some(name=>/^si02bobj10[0-3]$/i.test(name))){
      mesh.geometry.computeBoundingBox();
      cameraObstacles.push(mesh);
    }
  });
  group.updateMatrixWorld(true);
  const waterSurface=arenaWater.length?new T.Box3():null;
  for(const mesh of arenaWater)waterSurface.expandByObject(mesh);
  const withWalls=key!=='sand';
  const {heightAt,wallDistance,nearWall}=collision(rows,withWalls);
  const waterline=p=>{
    if(!waterSurface||p.x<waterSurface.min.x||p.x>waterSurface.max.x||
       p.z<waterSurface.min.z||p.z>waterSurface.max.z)return null;
    const y=waterSurface.max.y,ground=heightAt(p);
    return ground!==null&&ground<=y+1?y:null;
  };
  const water=p=>{const y=waterline(p);return y!==null&&p.y<y;};
  const floorY=p=>heightAt(p,p.y);
  const solid=p=>{
    const y=heightAt(p,p.y+bodyHeight);
    return y===null||p.y<y+bodyHeight-.08||nearWall(p);
  };
  const pointSolid=p=>{
    const y=heightAt(p,p.y+.6);
    return y!==null?p.y<y-.08:withWalls||heightAt(p)!==null;
  };
  const cameraRay=new T.Raycaster(),cameraDirection=vector(0,0,0),cameraHits=[];
  const roofDistance=(start,end,forCamera)=>{
    const collisionDistance=wallDistance(start,end);
    if(!forCamera||!cameraObstacles.length)return collisionDistance;
    cameraDirection.subVectors(end,start);
    const length=cameraDirection.length();
    if(length<.01)return Infinity;
    cameraRay.set(start,cameraDirection.divideScalar(length));
    cameraRay.far=length;
    cameraHits.length=0;
    cameraRay.intersectObjects(cameraObstacles,false,cameraHits);
    return Math.min(collisionDistance,cameraHits[0]?.distance??Infinity);
  };
  const spawns=[];
  for(const z of [-520,-260,0,260,520]){
    for(const x of [-480,-240,0,240,480]){
      const position=vector(x,0,z),ground=heightAt(position);
      if(ground===null||ground>220)continue;
      position.y=ground+38;
      if(!solid(position))spawns.push({position,angle:Math.atan2(z,-x)*180/Math.PI,combat:true});
    }
  }
  if(spawns.length<10){
    const bounds=new T.Box3();
    for(const row of rows){
      for(let i=0;i<row.length;i+=3){
        bounds.expandByPoint(vector(row[i]*scale,row[i+1]*scale,row[i+2]*scale));
      }
    }
    const center=bounds.getCenter(vector(0,0,0));
    const size=bounds.getSize(vector(0,0,0));
    if(key==='sand'){
      const geometry=new T.PlaneGeometry(420,420,28,28).rotateX(-Math.PI/2);
      const positions=geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),z=positions.getZ(i);
        positions.setY(i,2.2*Math.sin(x*.11+z*.08)+1.2*Math.sin(z*.19-x*.03));
      }
      geometry.computeVertexNormals();
      const map=duneTexture?.clone()??null;
      if(map){
        map.wrapS=map.wrapT=T.RepeatWrapping;
        map.offset.set(0,0);map.repeat.set(22,22);map.needsUpdate=true;
      }
      const valley=new T.Mesh(geometry,new T.MeshLambertMaterial({color:0xc6a979,map}));
      valley.name='sand-valley';
      valley.position.set(center.x/scale,bounds.min.y/scale-8,center.z/scale);
      group.add(valley);valley.updateMatrixWorld(true);
    }
    const columns=Math.max(3,Math.ceil(size.x/95));
    const lines=Math.max(3,Math.ceil(size.z/95));
    for(let row=0;row<lines&&spawns.length<25;row++){
      for(let column=0;column<columns&&spawns.length<25;column++){
        const x=bounds.min.x+size.x*(column+.5)/columns;
        const z=bounds.min.z+size.z*(row+.5)/lines;
        const position=vector(x,0,z),ground=heightAt(position);
        if(ground===null||ground>bounds.min.y+230)continue;
        const supported=[[12,0],[-12,0],[0,12],[0,-12]].every(([dx,dz])=>{
          const edge=heightAt(vector(x+dx,0,z+dz));
          return edge!==null&&Math.abs(edge-ground)<12;
        });
        if(!supported||spawns.some(spawn=>Math.hypot(spawn.position.x-x,spawn.position.z-z)<70))continue;
        position.y=ground+38;
        if(!solid(position))spawns.push({position,angle:Math.atan2(z-center.z,center.x-x)*180/Math.PI,combat:true});
      }
    }
  }
  if(key==='forest'){
    const forestStart=vector(-240,0,0);
    spawns.sort((a,b)=>a.position.distanceToSquared(forestStart)-b.position.distanceToSquared(forestStart));
  }else if(key==='sand'){
    const space=({position:p})=>{
      const floor=heightAt(p);
      let score=0;
      for(const radius of [30,60,90]){
        for(let i=0;i<8;i++){
          const angle=i*Math.PI/4;
          const ground=heightAt(vector(p.x+Math.cos(angle)*radius,0,p.z+Math.sin(angle)*radius));
          if(ground!==null&&Math.abs(ground-floor)<24)score++;
        }
      }
      return score;
    };
    const scores=new Map(spawns.map(spawn=>[spawn,space(spawn)]));
    spawns.sort((a,b)=>scores.get(b)-scores.get(a));
  }
  if(spawns.length<2)throw Error('Липсват свободни начални позиции на Storm 2.');
  return {group,spawns,solid,pointSolid,floorY,noClimb:()=>false,
    water,waterline,waterMeshes,waterSurface,
    teleports:[],hazards:[],roofDistance,sky:'nnk_konoha',
    lighting:{color:new T.Color(0xffecd8),direction:vector(-.4,.87,.27).normalize(),intensity:1.05}};
}
