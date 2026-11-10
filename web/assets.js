import * as T from 'three';
import {TDSLoader} from 'three/addons/loaders/TDSLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import {clone as cloneStudio} from 'three/addons/utils/SkeletonUtils.js';

export const maps = ['academy','monument','chuninfinals','chuninfinals_dusk','kyuubilair','monument_night','preliminary','voltage_courtyard','voltage_fortress','voltage_village','voltage_market','storm_river','storm_forest','storm_sand'];
export const point = (x,y,z) => new T.Vector3(x,z,-y);
const view = b => new DataView(b);
const int = (d,p) => d.getInt32(p,true);
const short = (d,p) => d.getInt16(p,true);
const ushort = (d,p) => d.getUint16(p,true);
const float = (d,p) => d.getFloat32(p,true);
const vec = (d,p) => [float(d,p),float(d,p+4),float(d,p+8)];
function str(d,p,n){
  const end=Math.min(d.byteLength,p+n);
  let s='';
  while(p<end){const c=d.getUint8(p++);if(!c)break;s+=String.fromCharCode(c);}
  return s;
}
export function localFiles(files){
  const index=new Map();
  for(const f of files){
    const path=f.webkitRelativePath.replace(/\\/g,'/').toLowerCase();
    const marker=path.lastIndexOf('/nnk/');
    index.set(marker>=0?path.slice(marker+5):path.slice(path.indexOf('/')+1),f);
  }
  const urls=new Map();
  return {
    async bytes(path){const file=index.get(path.toLowerCase());if(!file)throw Error('Липсва '+path);return file.arrayBuffer();},
    url(path){const key=path.toLowerCase();const file=index.get(key);if(!file)return null;
      if(!urls.has(key))urls.set(key,URL.createObjectURL(file));return urls.get(key);}
  };
}
export const installedFiles={
  async bytes(path){const r=await fetch(this.url(path));if(!r.ok)throw Error('Липсва '+path);return r.arrayBuffer();},
  url(path){return 'assets/'+path.toLowerCase().split('/').map(encodeURIComponent).join('/');}
};
function rgbaTexture(d, pixels, palette, width, height, masked=false){
  if(width<1||height<1||width*height>4e6||pixels+width*height>d.byteLength||palette+768>d.byteLength)return null;
  const src=new Uint8Array(d.buffer,d.byteOffset+pixels,width*height);
  const colors=new Uint8Array(d.buffer,d.byteOffset+palette,768);
  const data=new Uint8Array(src.length*4);
  for(let i=0;i<src.length;i++){
    const c=src[i]*3,p=i*4;
    data[p]=colors[c];data[p+1]=colors[c+1];data[p+2]=colors[c+2];data[p+3]=masked&&src[i]===255?0:255;
  }
  const t=new T.DataTexture(data,width,height);
  t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;t.wrapS=t.wrapT=T.RepeatWrapping;
  t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;
  return t;
}
function mip(d,p){
  const w=int(d,p+16),h=int(d,p+20),start=int(d,p+24),last=int(d,p+36);
  if(!start||!last||w<1||h<1)return null;
  return rgbaTexture(d,p+start,p+last+(w>>3)*(h>>3)+2,w,h,str(d,p,16).startsWith('{'));
}
async function wadTextures(files){
  const result=new Map();
  await Promise.all(['narutowad.wad','nnk_rooftop.wad'].map(async path=>{
    try{
      const d=view(await files.bytes(path));
      if(str(d,0,4)!=='WAD3')return;
      const end=int(d,4), dir=int(d,8);
      for(let i=0;i<end;i++){
        const p=dir+i*32;
        if(d.getUint8(p+12)===67&&!d.getUint8(p+13))result.set(str(d,p+16,16).toLowerCase(),[d,int(d,p)]);
      }
    }catch(e){console.warn('WAD',path,e.message);}
  }));
  return result;
}
function geometry(vertices,uvs,normals){
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  if(normals)g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  else g.computeVertexNormals();
  return g;
}
function entities(d){
  return [...str(d,0,d.byteLength).matchAll(/\{([^{}]*)\}/g)].map(block=>
    Object.fromEntries([...block[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)].map(x=>[x[1],x[2]])));
}
export async function loadMap(files,name){
  if(name.startsWith('storm_')){
    const {loadStormMap}=await import('./storm/storm-map.js');
    return loadStormMap(name);
  }
  if(name.startsWith('voltage_')){
    const {loadVoltageMap}=await import('./voltage/voltage-map.js');
    return loadVoltageMap(name);
  }
  const root='nnk_'+name;
  const d=view(await files.bytes('maps/'+root+'.bsp'));
  if(int(d,0)!==30)throw Error('Невалиден GoldSrc BSP.');
  const l=Array.from({length:15},(_,i)=>new DataView(d.buffer,int(d,4+i*8),int(d,8+i*8)));
  const tex=l[2],texInfo=l[6],faces=l[7],light=l[8],edges=l[12],surf=l[13],verts=l[3];
  const groups=new Map(),group=new T.Group(),wad=await wadTextures(files);
  const isLair=name==='kyuubilair',seal=isLair?{elapsed:0,opening:false,open:false}:null;
  const gateModel=4*64;
  const gateFaces=isLair?[int(l[14],gateModel+56),int(l[14],gateModel+60)]:null;
  for(let p=0;p+20<=faces.byteLength;p+=20){
    const start=int(faces,p+4), count=short(faces,p+8), info=short(faces,p+10)*40;
    if(count<3||info<0)continue;
    const id=int(texInfo,info+32),off=int(tex,4+id*4);
    if(off<0)continue;
    const label=str(tex,off,16).toLowerCase();
    if(isLair&&label==='scrollwater')continue;
    const caveBoundary=name==='kyuubilair'&&(label.startsWith('sky')||label==='{blue');
    if(!caveBoundary&&((name==='academy'&&label==='temp')||/^(sky|clip|aaatrigger|null|nodraw|hint|skip|origin|bevel|\{blue)/.test(label)))continue;
    const w=int(tex,off+16)||64,h=int(tex,off+20)||64;
    const sealClip=gateFaces&&p/20>=gateFaces[0]&&p/20<gateFaces[0]+gateFaces[1];
    const key=sealClip?'seal:'+id:id;
    if(!groups.has(key))groups.set(key,{off,label,sealClip,xyz:[],uv:[],colors:[]});
    const dest=groups.get(key), poly=[];
    for(let j=0;j<count;j++){
      const edge=int(surf,(start+j)*4),v=ushort(edges,Math.abs(edge)*4+(edge<0?2:0))*12;
      const [x,y,z]=vec(verts,v);
      const u=(x*float(texInfo,info)+y*float(texInfo,info+4)+z*float(texInfo,info+8)+float(texInfo,info+12))/w;
      const t=(x*float(texInfo,info+16)+y*float(texInfo,info+20)+z*float(texInfo,info+24)+float(texInfo,info+28))/h;
      poly.push({xyz:[x,z,-y],uv:[u,t]});
    }
    const lightOffset=int(faces,p+16);
    const minU=Math.floor(Math.min(...poly.map(v=>v.uv[0]*w))/16),maxU=Math.ceil(Math.max(...poly.map(v=>v.uv[0]*w))/16);
    const minV=Math.floor(Math.min(...poly.map(v=>v.uv[1]*h))/16),maxV=Math.ceil(Math.max(...poly.map(v=>v.uv[1]*h))/16);
    const width=maxU-minU+1,height=maxV-minV+1;
    const hasLight=lightOffset>=0&&lightOffset+width*height*3<=light.byteLength;
    for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]]){
      dest.xyz.push(...v.xyz);dest.uv.push(...v.uv);
      if(hasLight){
        const x=T.MathUtils.clamp(Math.round(v.uv[0]*w/16)-minU,0,width-1);
        const y=T.MathUtils.clamp(Math.round(v.uv[1]*h/16)-minV,0,height-1);
        const at=lightOffset+(y*width+x)*3;
        for(let c=0;c<3;c++)dest.colors.push(.36+.64*(light.getUint8(at+c)/255));
      }else dest.colors.push(.9,.9,.9);
    }
  }
  for(const {off,label,sealClip,xyz,uv,colors} of groups.values()){
    const caveBoundary=name==='kyuubilair'&&(label.startsWith('sky')||label==='{blue');
    const t=caveBoundary?null:mip(tex,off)??(wad.has(label)?mip(...wad.get(label)):null);
    const m=new T.MeshLambertMaterial({color:caveBoundary?0x282328:t?0xffffff:0x88866a,map:t,vertexColors:true,side:T.DoubleSide,alphaTest:label.startsWith('{')?.5:0});
    const geo=geometry(xyz,uv);geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    const mesh=new T.Mesh(geo,m);mesh.name=label;mesh.userData.bsp=true;
    if(caveBoundary&&label==='{blue'){mesh.visible=false;mesh.userData.cameraBoundary=true;mesh.userData.sealClip=sealClip;}
    group.add(mesh);
  }
  const es=entities(l[0]);
  const spawns=es.filter(e=>/^info_player_(deathmatch|start)$/.test(e.classname)&&e.origin)
    .sort((a,b)=>Number(b.classname.endsWith('deathmatch'))-Number(a.classname.endsWith('deathmatch')))
    .map(e=>({position:point(...e.origin.split(/\s+/).map(Number)),angle:Number(e.angle??0),combat:e.classname.endsWith('deathmatch')}));
  if(!spawns.length)throw Error('Картата няма начални позиции.');
  const planes=l[1],clip=l[9],models=l[14],hull=int(models,40);
  const obstacles=es.filter(e=>/^(func_wall|func_door|func_breakable|func_train)$/.test(e.classname)&&e.model?.startsWith('*')).flatMap(e=>{
    const p=Number(e.model.slice(1))*64;
    if(p+64>models.byteLength)return [];
    const [x,y,z]=vec(models,p),[X,Y,Z]=vec(models,p+12);
    const origin=e.origin?point(...e.origin.split(/\s+/).map(Number)):new T.Vector3();
    const box=new T.Box3(point(x,Y,z),point(X,y,Z)).expandByScalar(40).translate(origin);
    const faceStart=int(models,p+56),faceCount=int(models,p+60);
    let noClimb=faceCount>0;
    for(let i=faceStart;i<faceStart+faceCount&&noClimb;i++){
      const info=short(faces,i*20+10)*40;
      const texture=int(texInfo,info+32),offset=int(tex,4+texture*4);
      noClimb=offset>=0&&str(tex,offset,16).toLowerCase().includes('nowall');
    }
    return [{box,origin,hull:int(models,p+40),pointHull:int(models,p+36),noClimb,
      sealRoom:isLair&&p===44*64,sealGate:isLair&&p===gateModel}];
  });
  const activeBrush=o=>!o.sealRoom||!seal.open;
  function blocked(p,hull,origin){
    let index=hull,limit=clip.byteLength/8+1;
    const x=p.x-(origin?.x??0),y=p.y-(origin?.y??0),z=p.z-(origin?.z??0);
    while(index>=0&&limit-->0){
      const row=index*8;
      if(row+8>clip.byteLength)return true;
      const q=int(clip,row)*20;
      const dot=x*float(planes,q)-z*float(planes,q+4)+y*float(planes,q+8);
      index=short(clip,row+(dot>=float(planes,q+12)?4:6));
    }
    return index===-2||index===-6||index>=0;
  }
  const throughSeal=p=>seal?.open&&p.x>=2452&&p.x<2468&&p.y>=-78&&p.y<150&&Math.abs(p.z)<96;
  function solid(p){
    // The seal has a player-only clip plane in the world hull as well as a brush.
    // Open only the middle of that slab, keeping the floor and cave sides solid.
    if(throughSeal(p))return pointSolid(p);
    return blocked(p,hull)||obstacles.some(o=>activeBrush(o)&&o.box.containsPoint(p)&&blocked(p,o.hull,o.origin));
  }
  function contents(p,index,origin){
    const nodes=l[5],leaves=l[10],x=p.x-(origin?.x??0),y=p.y-(origin?.y??0),z=p.z-(origin?.z??0);
    let limit=nodes.byteLength/24+1;
    while(index>=0&&limit-->0){
      const row=index*24;
      if(row+24>nodes.byteLength)return -2;
      const q=int(nodes,row)*20;
      const dot=x*float(planes,q)-z*float(planes,q+4)+y*float(planes,q+8);
      index=short(nodes,row+(dot>=float(planes,q+12)?4:6));
    }
    return index>=0?-2:int(leaves,(-1-index)*28);
  }
  const pointSolid=p=>contents(p,int(models,36))===-2||
    obstacles.some(o=>activeBrush(o)&&(!o.sealGate||!throughSeal(p))&&
      o.box.containsPoint(p)&&contents(p,o.pointHull,o.origin)===-2);
  const barkCells=new Map(),barkCellSize=48;
  const noClimb=p=>{
    if(obstacles.some(o=>o.noClimb&&o.box.containsPoint(p)&&contents(p,o.pointHull,o.origin)===-2))return true;
    const x=Math.floor(p.x/barkCellSize),z=Math.floor(p.z/barkCellSize);
    for(let i=x-1;i<=x+1;i++)for(let j=z-1;j<=z+1;j++){
      const points=barkCells.get(i+':'+j);
      if(points?.some(point=>point.distanceToSquared(p)<32**2))return true;
    }
    return false;
  };
  function mapVolume(e){
    const n=Number(e.model.slice(1))*64;
    if(!Number.isInteger(n)||n<0||n+64>models.byteLength)return null;
    const [x,y,z]=vec(models,n),[X,Y,Z]=vec(models,n+12);
    const origin=e.origin?point(...e.origin.split(/\s+/).map(Number)):new T.Vector3();
    const box=new T.Box3(point(x,Y,z),point(X,y,Z)).translate(origin),hull=int(models,n+36);
    return {box,contains:p=>box.containsPoint(p)&&contents(p,hull,origin)!==-1};
  }
  const waterBrushes=es.filter(e=>e.classname==='func_water'&&e.model?.startsWith('*')).map(mapVolume).filter(Boolean);
  const water=p=>contents(p,int(models,36))===-3||
    waterBrushes.some(w=>w.contains(p));
  function waterline(position,above=38,below=42){
    if(isLair){
      const probe=position.clone();
      for(const w of waterBrushes){
        const top=w.box.max.y;
        if(top>=position.y-below&&top<=position.y+above&&w.contains(probe.setY(top-.125)))return top;
      }
      return null;
    }
    const probe=position.clone();probe.y+=above;
    if(water(probe))return null;
    let hi=probe.y;
    for(probe.y-=6;probe.y>=position.y-below&&!water(probe);probe.y-=6)hi=probe.y;
    if(probe.y<position.y-below||pointSolid(probe))return null;
    let lo=probe.y;
    for(let i=0;i<10;i++){
      probe.y=(lo+hi)/2;
      if(water(probe))lo=probe.y;else hi=probe.y;
    }
    return lo;
  }
  const terrain=[],roof=[],cameraWalls=[],academyWalls=[];
  const floorRay=new T.Raycaster(new T.Vector3(),new T.Vector3(0,-1,0),0,112);
  function floorY(p){
    const q=p.clone();
    if(pointSolid(q))return null;
    for(let i=4;i<=112;i+=4){
      q.y=p.y-i;
      if(pointSolid(q)){
        let lo=q.y,hi=q.y+4;
        for(let j=0;j<6;j++){q.y=(lo+hi)/2;if(pointSolid(q))lo=q.y;else hi=q.y;}
        if(name.startsWith('monument')&&terrain.length){
          floorRay.ray.origin.copy(p);
          const rendered=floorRay.intersectObjects(terrain,false)[0]?.point.y;
          if(rendered!==undefined&&Math.abs(rendered-hi)<=28)return rendered;
        }
        return hi;
      }
    }
    floorRay.ray.origin.copy(p);
    return floorRay.intersectObjects(terrain,false)[0]?.point.y??null;
  }
  const teleports=es.filter(e=>e.classname==='trigger_teleport'&&e.model?.startsWith('*')).flatMap(e=>{
    const to=es.find(t=>t.targetname===e.target&&t.origin);
    const p=Number(e.model.slice(1))*64;
    if(!to||p+64>models.byteLength)return [];
    const [x,y,z]=vec(models,p),[X,Y,Z]=vec(models,p+12);
    const origin=e.origin?point(...e.origin.split(/\s+/).map(Number)):new T.Vector3();
    const box=new T.Box3(point(x,Y,z),point(X,y,Z)).translate(origin);
    const hull=int(models,p+36);
    return [{contains:position=>box.containsPoint(position)&&contents(position,hull,origin)===-2,
      to:point(...to.origin.split(/\s+/).map(Number))}];
  });
  const [waterMeshes=[],animatedProps=[]]=await Promise.all([addMapModels(files,group,root),addMapProps(files,group,es)]);
  const sealGate=seal&&group.getObjectByName('kyuubi-seal-gate');
  const gateStart=sealGate?.position.z??0;
  const sealPush=isLair&&es.find(e=>e.classname==='trigger_push'&&e.targetname==='push');
  const pushVolume=sealPush&&mapVolume(sealPush);
  const ambience=es.filter(e=>e.classname==='ambient_generic'&&e.message?.toLowerCase().endsWith('.wav'))
    .map(e=>({path:e.message,gain:Number(e.health??10)/10,triggered:!!(Number(e.spawnflags)&16)}));
  function updateMap(dt,playerPosition){
    let event=null;
    if(seal?.opening&&!seal.open){
      const previous=seal.elapsed;
      seal.elapsed+=dt;
      if(previous<.1&&seal.elapsed>=.1){
        event={growl:ambience.find(track=>track.triggered),shake:4};
        for(const prop of animatedProps)if(prop.touch)prop.touch.reset().play().crossFadeFrom(prop.idle,.2,false);
      }
      if(!seal.pushed&&seal.elapsed>=.1&&playerPosition&&pushVolume?.contains(playerPosition)){
        seal.pushed=true;
        const [pitch,yaw]=sealPush.angles.split(/\s+/).map(value=>T.MathUtils.degToRad(Number(value)));
        (event??={}).push=point(Math.cos(pitch)*Math.cos(yaw),Math.cos(pitch)*Math.sin(yaw),-Math.sin(pitch))
          .multiplyScalar(Number(sealPush.speed));
      }
      if(sealGate)sealGate.position.z=gateStart+820*T.MathUtils.smoothstep(seal.elapsed,3,4);
      seal.open=seal.elapsed>=4;
    }
    for(const prop of animatedProps)prop.mixer.update(dt);
    return event;
  }
  const canReleaseSeal=p=>Boolean(seal&&!seal.opening&&p.x>=2280&&p.x<=2470&&Math.abs(p.z)<96&&p.y<150);
  function releaseSeal(p){
    if(!canReleaseSeal(p))return false;
    seal.opening=true;return true;
  }
  const waterSurface=waterMeshes.length?new T.Box3():null;
  group.updateMatrixWorld(true);
  for(const mesh of waterMeshes)waterSurface.expandByObject(mesh);
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(name==='academy'&&mesh.visible&&!mesh.userData.radarScenery&&
       !/leaf|bark|grnd|terrain|fence|cable|swing/i.test(mesh.name)&&mesh.material?.alphaTest===0){
      academyWalls.push(mesh);
    }
    if(/ground|grnd|terrain|terr_inner|^cliffs$/i.test(mesh.name)&&mesh.visible)terrain.push(mesh);
    if(mesh.userData.cameraBoundary)cameraWalls.push(mesh);
    if(name==='kyuubilair'&&mesh.userData.bsp&&!mesh.userData.cameraBoundary)roof.push(mesh);
  });
  if(name.startsWith('monument')){
    const vegetation=group.getObjectsByProperty('isMesh',true).filter(mesh=>/bark|^leaf/i.test(mesh.name));
    for(const mesh of vegetation){
      if(/bark/i.test(mesh.name)){
        const position=mesh.geometry.attributes.position,point=new T.Vector3(),seen=new Set();
        for(let i=0;i<position.count;i++){
          point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
          const sample=[point.x,point.y,point.z].map(value=>Math.round(value/12)).join(':');
          if(seen.has(sample))continue;
          seen.add(sample);
          const key=Math.floor(point.x/barkCellSize)+':'+Math.floor(point.z/barkCellSize);
          let cell=barkCells.get(key);
          if(!cell){cell=[];barkCells.set(key,cell);}
          cell.push(point.clone());
        }
      }
      partitionVegetation(mesh);
    }
  }
  const roofRay=new T.Raycaster(),roofDirection=new T.Vector3();
  const wallRay=new T.Raycaster(),wallMatrix=new T.Matrix3(),wallNormal=new T.Vector3();
  function hasVisibleWall(position,direction,distance){
    wallRay.set(position,direction);wallRay.far=distance+5;
    return wallRay.intersectObjects(academyWalls,false).some(hit=>{
      if(!hit.face||Math.abs(hit.distance-distance)>5)return false;
      wallMatrix.getNormalMatrix(hit.object.matrixWorld);
      wallNormal.copy(hit.face.normal).applyNormalMatrix(wallMatrix);
      return Math.abs(wallNormal.y)<.35;
    });
  }
  const traceBounds=new T.Box3();
  const nodes=l[5],leaves=l[10];
  // Split the segment on BSP planes in travel order so thin walls cannot fall
  // between camera samples. Brush models have their own point hull and origin.
  function firstSolid(index,from,delta,origin,end){
    const x=from.x-(origin?.x??0),y=from.y-(origin?.y??0),z=from.z-(origin?.z??0);
    const remaining=[];
    let start=0,budget=nodes.byteLength/24+1;
    while(budget-->0){
      if(index<0){
        if(int(leaves,(-1-index)*28)===-2)return start;
        if(!remaining.length)return Infinity;
        end=remaining.pop();start=remaining.pop();index=remaining.pop();
        continue;
      }
      const row=index*24;
      if(row+24>nodes.byteLength)return Infinity;
      const plane=int(nodes,row)*20;
      const nx=float(planes,plane),ny=float(planes,plane+8),nz=-float(planes,plane+4);
      const base=nx*x+ny*y+nz*z-float(planes,plane+12);
      const slope=nx*delta.x+ny*delta.y+nz*delta.z;
      const front=base+slope*start>=0,endFront=base+slope*end>=0;
      if(front!==endFront){
        const split=Math.max(start,Math.min(end,-base/slope));
        remaining.push(short(nodes,row+(endFront?4:6)),split,end);
        end=split;
      }
      index=short(nodes,row+(front?4:6));
    }
    return Infinity;
  }
  function traceSolid(from,to){
    roofDirection.subVectors(to,from);
    const length=roofDirection.length();
    if(length<.001)return Infinity;
    traceBounds.min.copy(from).min(to);traceBounds.max.copy(from).max(to);
    let hit=firstSolid(int(models,36),from,roofDirection,null,1);
    for(const brush of obstacles){
      if(hit===0)break;
      if(!activeBrush(brush)||!traceBounds.intersectsBox(brush.box))continue;
      const distance=firstSolid(brush.pointHull,from,roofDirection,brush.origin,Math.min(1,hit));
      if(brush.sealGate&&seal.open&&distance<Infinity&&throughSeal(from.clone().addScaledVector(roofDirection,distance)))continue;
      hit=Math.min(hit,distance);
    }
    return hit*length;
  }
  function roofDistance(from,to,forCamera=false){
    if(!roof.length&&!cameraWalls.length)return Infinity;
    roofDirection.subVectors(to,from);
    const distance=roofDirection.length();
    if(distance<.001)return Infinity;
    roofRay.set(from,roofDirection.divideScalar(distance));roofRay.far=distance;
    const visible=roofRay.intersectObjects(roof,false)[0]?.distance??Infinity;
    if(!forCamera)return visible;
    const boundaries=seal?.open?cameraWalls.filter(mesh=>!mesh.userData.sealClip):cameraWalls;
    return Math.min(visible,roofRay.intersectObjects(boundaries,false)[0]?.distance??Infinity);
  }
  const hazards=es.filter(e=>e.classname==='trigger_hurt'&&Number(e.dmg)>0&&e.model?.startsWith('*')).flatMap(e=>{
    const p=Number(e.model.slice(1))*64;
    if(!Number.isInteger(p)||p<0||p+64>models.byteLength)return [];
    const [x,y,z]=vec(models,p),[X,Y,Z]=vec(models,p+12);
    const origin=e.origin?point(...e.origin.split(/\s+/).map(Number)):new T.Vector3();
    const box=new T.Box3(point(x,Y,z),point(X,y,Z)).translate(origin);
    const modelHull=int(models,p+36);
    const sealHazard=isLair&&p===46*64;
    return [{damage:Number(e.dmg),contains:p=>(!sealHazard||!seal.open)&&box.containsPoint(p)&&contents(p,modelHull,origin)===-2}];
  });
  const lightEnvironment=es.find(e=>e.classname==='light_environment');
  const [r,g,b,intensity]=lightEnvironment?._light?.split(/\s+/).map(Number)??[225,232,247,150];
  const angle=(lightEnvironment?.angles?.split(/\s+/)[1]??110)*Math.PI/180;
  const elevation=-(Number(lightEnvironment?.pitch??-45))*Math.PI/180;
  const lighting={
    color:new T.Color().setRGB(.55+.45*r/255,.55+.45*g/255,.55+.45*b/255,T.SRGBColorSpace),
    direction:point(-Math.cos(angle)*Math.cos(elevation),-Math.sin(angle)*Math.cos(elevation),Math.sin(elevation)),
    intensity:T.MathUtils.clamp(intensity/205,.5,1.25)
  };
  const skyBoundary=p=>contents(p,int(models,36))===-6;
  return {group,spawns,solid,pointSolid,traceSolid,noClimb,skyBoundary,floorY,water,waterline,waterMeshes,waterSurface,teleports,hazards,roofDistance,lighting,
    animatedProps,updateMap,ambience,shallowWater:isLair,releaseSeal:seal?releaseSeal:null,canReleaseSeal:seal?canReleaseSeal:null,
    hasVisibleWall:name==='academy'?hasVisibleWall:null,
    sky:es[0]?.skyname??(name==='academy'?'misty':name.startsWith('monument')?'nnk_konoha':null)};
}
function partitionVegetation(mesh){
  const source=mesh.geometry,index=source.index,position=source.attributes.position;
  if(!index||index.count<24000)return;
  const chunks=new Map(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),center=new T.Vector3();
  const ranges=source.groups.length?source.groups:[{start:0,count:index.count,materialIndex:0}];
  for(const range of ranges){
    for(let i=range.start;i<range.start+range.count;i+=3){
      const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
      a.fromBufferAttribute(position,ia);b.fromBufferAttribute(position,ib);c.fromBufferAttribute(position,ic);
      center.copy(a).add(b).add(c).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
      const key=Math.floor(center.x/768)+':'+Math.floor(center.z/768)+':'+range.materialIndex;
      let chunk=chunks.get(key);
      if(!chunk){chunk={indices:[],bounds:new T.Box3(),material:range.materialIndex};chunks.set(key,chunk);}
      chunk.indices.push(ia,ib,ic);
      chunk.bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c);
    }
  }
  const container=new T.Group();
  container.position.copy(mesh.position);container.quaternion.copy(mesh.quaternion);container.scale.copy(mesh.scale);
  for(const chunk of chunks.values()){
    const geo=new T.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes))geo.setAttribute(name,attribute);
    geo.setIndex(chunk.indices);
    geo.boundingBox=chunk.bounds;geo.boundingSphere=chunk.bounds.getBoundingSphere(new T.Sphere());
    const part=new T.Mesh(geo,Array.isArray(mesh.material)?mesh.material[chunk.material]:mesh.material);
    part.name=mesh.name;part.userData.vegetation=true;container.add(part);
  }
  mesh.parent.add(container);mesh.removeFromParent();
}
async function addMapModels(files,group,name){
  let cfg;
  try{cfg=new TextDecoder().decode(await files.bytes('maps/'+name+'.txt'));}
  catch(e){console.warn('Map models',name,e.message);return;}
  const records=[...cfg.matchAll(/MODEL\s+(\S+)\s*\{([^}]*)\}/gi)];
  const manager=new T.LoadingManager();
  const texturesReady=new Promise(resolve=>{manager.onLoad=resolve;});
  const parseJob='nnk-map-models';
  manager.itemStart(parseJob);
  manager.setURLModifier(url=>{
    const detail=/^models\/nnk_monument(?:_night)?\/(mcliffs|minner|mtherest)\.dds$/i.test(url);
    return files.url(url.replace(/\.dds$/i,detail?'-detail.webp':'.webp'))??url;
  });
  manager.addHandler(/\.tga$/i,new TGALoader(manager));
  const loader=new TDSLoader(manager);
  const extras=new T.Group();extras.rotation.x=-Math.PI/2;
  const waterMeshes=[];
  let hideBsp=false;
  const buffers=await Promise.allSettled(records.map(([,path])=>files.bytes(path)));
  for(const [i,[,path,options]] of records.entries()){
    try{
      const buffer=buffers[i];
      if(buffer.status==='rejected')throw buffer.reason;
      const model=loader.parse(buffer.value,path.slice(0,path.lastIndexOf('/')+1));
      if(/\/kyugate\.3ds$/i.test(path))model.name='kyuubi-seal-gate';
      const loc=options.match(/ORIGIN\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
      if(loc)model.position.set(...loc.slice(1).map(Number));
      if(/\/kyuwater\.3ds$/i.test(path))model.position.z+=.6;
      const rot=options.match(/ROTATION\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
      if(rot)model.rotation.set(...rot.slice(1).map(value=>T.MathUtils.degToRad(Number(value))));
      const scale=options.match(/SCALE\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
      if(scale)model.scale.set(...scale.slice(1).map(Number));
      const diffuse=new Map();
      function convert(material){
        if(diffuse.has(material))return diffuse.get(material);
        const map=material.map??null;
        const foliage=/leaf|leav|foliage|bboard/i.test(map?.name??'')||/leaf|leav|foliage|bboards|\/bbrd\./i.test(path);
        if(map){map.colorSpace=T.SRGBColorSpace;map.anisotropy=8;}
        const next=new T.MeshLambertMaterial({
          color:map?0xffffff:material.color,map,side:T.DoubleSide,
          alphaMap:foliage?null:material.alphaMap??null,
          alphaTest:foliage || material.alphaMap ? 0.42 : 0,
          opacity:foliage?1:material.opacity,transparent:!foliage&&material.opacity<1
        });
        diffuse.set(material,next);return next;
      }
      model.traverse(obj=>{
        if(!obj.isMesh)return;
        obj.userData.radarScenery=/\/(?:[cm]bboards|bbrd|mount\w*)\.3ds$/i.test(path);
        if(/\/(?:mwater|kyuwater)\.3ds$/i.test(path)){
          const normalUrl=files.url('gfx/fx/bump3.bmp')??files.url(path.replace(/[^/]+$/,'water_sh.png'));
          const normalMap=normalUrl?new T.TextureLoader().load(normalUrl):null;
          if(normalMap){
            normalMap.wrapS=normalMap.wrapT=T.RepeatWrapping;
            normalMap.repeat.set(16,16);
          }
          obj.material=new T.MeshPhongMaterial({
            color:name==='nnk_kyuubilair'?0x435440:name.endsWith('_night')?0x28445b:0x3e7885,
            normalMap,normalScale:new T.Vector2(.85,.85),specular:0xc4e9f5,
            shininess:45,reflectivity:.5,side:T.DoubleSide,transparent:true,opacity:200/255,depthWrite:false
          });
          obj.material.onBeforeCompile=shader=>{
            const normalChunk=T.ShaderChunk.normal_fragment_maps.replace(
              'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
              `float waterDistance = length(vViewPosition);
               vec3 base = texture2D(normalMap, vNormalMapUv).xyz;
               vec3 detail = texture2D(normalMap, vNormalMapUv * 4.0).xyz;
               vec3 mapN = mix(base, detail, 1.0 - clamp(waterDistance / 300.0, 0.0, 1.0)) * 2.0 - 1.0;
               mapN.xy *= 1.0 - clamp(waterDistance / 1200.0, 0.0, 1.0);`
            );
            shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',normalChunk);
          };
          waterMeshes.push(obj);
        }else obj.material=Array.isArray(obj.material)?obj.material.map(convert):convert(obj.material);
      });
      extras.add(model);
      if(/\bKILLMAP\b/i.test(options)&&model.children.length)hideBsp=true;
    }catch(e){console.warn('Map model',path,e.message);}
  }
  manager.itemEnd(parseJob);
  await texturesReady;
  if(hideBsp)for(const mesh of group.children)if(mesh.userData.bsp)mesh.visible=false;
  group.add(extras);
  return waterMeshes;
}
async function addMapProps(files,group,entities){
  const props=entities.filter(e=>/^env_model(_static)?$/.test(e.classname)&&e.origin&&
    e.model?.toLowerCase().endsWith('.mdl')&&e.model.toLowerCase()!=='models/player/orioke/orioke.mdl');
  if(!props.length)return;
  const container=new T.Group(),models=new Map(),animated=[];
  group.add(container);
  await Promise.all(props.map(async e=>{
    const path=e.model.toLowerCase();
    const isAnimated=/\/kyuubi\.mdl$/i.test(path)&&!!e.m_iszSequence;
    if(!models.has(path))models.set(path,loadStudio(files,path,isAnimated,null).catch(error=>{
      console.warn('Map prop',path,error.message);return null;
    }));
    const prototype=await models.get(path);
    if(!prototype)return;
    const prop=isAnimated?cloneStudio(prototype):prototype.clone(true);
    prop.position.copy(point(...e.origin.split(/\s+/).map(Number)));
    const yaw=Number(e.angles?.split(/\s+/)[1]??e.angle??0);
    prop.rotation.y=T.MathUtils.degToRad(yaw);
    container.add(prop);
    if(isAnimated){
      const clip=prototype.animation(e.m_iszSequence);
      if(!clip)return;
      const mixer=new T.AnimationMixer(prop),idle=mixer.clipAction(clip).play();
      const reaction=prototype.animation(e.m_iszSequence_Hit);
      const touch=reaction?mixer.clipAction(reaction).setLoop(T.LoopOnce,1):null;
      if(touch)mixer.addEventListener('finished',event=>{if(event.action===touch)idle.reset().play().fadeIn(.2);});
      animated.push({root:prop,mixer,idle,touch});
    }
  }));
  return animated;
}
export async function loadSky(files,sky){
  if(!sky)return null;
  sky=sky.replace(/_+$/,'');
  const separator=sky==='misty'?'':'_';
  const sides=['rt','lf','up','dn','bk','ft'].map(side=>files.url('gfx/env/'+sky+separator+side+'.png'));
  if(sides.some(s=>!s))return null;
  try{
    const cube=await new T.CubeTextureLoader().loadAsync(sides);
    for(const [face,angle] of [[2,-Math.PI/2],...(sky==='misty'?[[3,Math.PI/2]]:[])]){
      const source=cube.images[face],canvas=document.createElement('canvas');
      canvas.width=source.width;canvas.height=source.height;
      const context=canvas.getContext('2d');
      context.translate(canvas.width/2,canvas.height/2);context.rotate(angle);
      context.drawImage(source,-canvas.width/2,-canvas.height/2);
      cube.images[face]=canvas;
    }
    return cube;
  }catch{return null;}
}

export async function loadOriokeCloud(files){
  const cloud=await loadStudio(files,'models/jutsus/Orioke_clouds.mdl',true,null);
  const url=files.url('models/jutsus/orioke_clouds/Clouds.png');
  if(!url)return cloud;
  const map=await new T.TextureLoader().loadAsync(url);
  map.colorSpace=T.SRGBColorSpace;
  cloud.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    mesh.material.dispose();
    mesh.material=new T.MeshBasicMaterial({map,side:T.DoubleSide,transparent:true,alphaTest:.025,depthWrite:false});
  });
  return cloud;
}
export async function loadCharacter(files,name){
  const path='models/player/'+name+'/';
  const model=await loadStudio(files,path+name+'.mdl',true);
  const highResolution={
    naruto:['body'],sasuke:['body'],kakashi:['body','face'],sakura:['body','head']
  }[name];
  if(!highResolution)return model;
  const materials=new Set();
  model.traverse(mesh=>{if(mesh.isSkinnedMesh)materials.add(mesh.material);});
  const loader=new T.TextureLoader();
  await Promise.all([...materials].map(async material=>{
    const stem=material.name.toLowerCase().replace(/\.bmp$/,'');
    if(!highResolution.includes(stem))return;
    const url=files.url(path+name+'/'+stem+'.webp');
    if(!url)return;
    const texture=await loader.loadAsync(url).catch(()=>null);
    if(!texture)return;
    texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;texture.anisotropy=8;
    texture.needsUpdate=true;
    material.map?.dispose();material.map=texture;
  }));
  return model;
}
export async function loadWeaponModel(files,path){
  const model=await loadStudio(files,'models/weapons/'+path,false);
  const box=new T.Box3().setFromObject(model,true),size=box.getSize(new T.Vector3());
  if(box.isEmpty()||size.lengthSq()===0)throw Error('Празен модел на оръжие '+path);
  model.position.sub(box.getCenter(new T.Vector3()));
  const root=new T.Group();root.add(model);
  root.userData.weaponSize=Math.max(size.x,size.y,size.z);
  const axes=['x','y','z'].sort((a,b)=>size[b]-size[a]);
  if(/shuriken/i.test(path)){
    const axis=new T.Vector3();axis[axes[2]]=1;
    root.quaternion.setFromUnitVectors(axis,new T.Vector3(0,1,0));
  }else if(/kunai/i.test(path)){
    const axis=new T.Vector3();axis[axes[0]]=1;
    root.quaternion.setFromUnitVectors(axis,new T.Vector3(1,0,0));
  }
  return root;
}
export async function loadRasengan(files,file='rasengan.mdl'){
  const model=await loadStudio(files,'models/jutsus/'+file,true,null);
  const bounds=new T.Box3().setFromObject(model,true),size=bounds.getSize(new T.Vector3());
  if(bounds.isEmpty()||size.lengthSq()===0)throw Error('Празен модел на Rasengan');
  model.position.sub(bounds.getCenter(new T.Vector3()));
  const root=new T.Group();root.add(model);
  root.scale.setScalar(2/Math.max(size.x,size.y,size.z));
  let index=0;
  model.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const material=mesh.material;
    const glow=file!=='rasengan.mdl'||index++>=2;
    mesh.material=new T.MeshBasicMaterial({
      map:material.map,side:T.DoubleSide,transparent:glow,
      blending:glow?T.AdditiveBlending:T.NormalBlending,depthWrite:!glow
    });
    material.dispose();
  });
  const effect=new T.Group();effect.add(root);
  effect.animations=[model.animation(model.sequenceNames[0])].filter(Boolean);
  return effect;
}
export function loadPakkun(files){
  return loadStudio(files,'models/dogs/Pakkun.mdl',true,23);
}
export function loadKawarimiLog(files){
  return loadStudio(files,'models/weapons/kawarimi_log.mdl',true);
}
async function loadStudio(files,name,character,modelHeight=66){
  const d=view(await files.bytes(name));
  if(str(d,0,4)!=='IDST'||int(d,4)!==10)throw Error('Неподдържан модел '+name);
  const bones=[], count=int(d,140), boneOffset=int(d,144), skelRoot=new T.Group();
  const animationGroup=int(d,int(d,176)+100);
  for(let i=0;i<count;i++){
    const p=boneOffset+i*112,parent=int(d,p+32),bone=new T.Bone();
    bone.name='nnkBone'+i;
    bone.userData.studioName=str(d,p,32);
    bone.position.set(...vec(d,p+64));
    bone.rotation.set(...vec(d,p+76),'ZYX');
    (parent<0?skelRoot:bones[parent]).add(bone);
    bones.push(bone);
  }
  skelRoot.updateMatrixWorld(true);
  const skeleton=new T.Skeleton(bones);
  const clips=[], sequences=new Map();
  for(let k=0;k<int(d,164);k++){
    const seq=int(d,168)+k*176,label=str(d,seq,32);
    if((!character&&k!==0)||int(d,seq+156)!==0||int(d,seq+56)<1)continue;
    sequences.set(character?label:'static',seq);
  }
  function animation(label){
    const cached=T.AnimationClip.findByName(clips,label);
    if(cached)return cached;
    const seq=sequences.get(label);
    if(seq===undefined)return null;
    const frames=character?int(d,seq+56):1;
    const name=character?label:'static';
    const anim=animationGroup+int(d,seq+124), fps=float(d,seq+32);
    if(anim<0||anim+count*12>d.byteLength||fps<=0)return null;
    const times=Float32Array.from({length:frames},(_,i)=>i/fps);
    const tracks=[];
    for(let i=0;i<count;i++){
      const b=boneOffset+i*112,offset=anim+i*12, axes=[];
      for(let axis=0;axis<6;axis++){
        const base=float(d,b+64+axis*4),scale=float(d,b+88+axis*4),off=ushort(d,offset+axis*2);
        const values=new Float32Array(frames).fill(base);
        if(off){
          let p=offset+off,f=0;
          while(f<frames&&p+2<=d.byteLength){
            const valid=d.getUint8(p),span=d.getUint8(p+1);
            if(!span||valid>span||p+2+valid*2>d.byteLength)break;
            for(let j=0;j<span&&f<frames;j++,f++){
              values[f]=valid?base+short(d,p+2+Math.min(j,valid-1)*2)*scale:base;
            }
            p+=2+valid*2;
          }
        }
        axes.push(values);
      }
      const xyz=[],quat=[],q=new T.Quaternion();
      for(let frame=0;frame<frames;frame++){
        xyz.push(...axes.slice(0,3).map(a=>a[frame]));
        q.setFromEuler(new T.Euler(axes[3][frame],axes[4][frame],axes[5][frame],'ZYX'));
        quat.push(q.x,q.y,q.z,q.w);
      }
      tracks.push(new T.VectorKeyframeTrack(bones[i].name+'.position',times,xyz),
        new T.QuaternionKeyframeTrack(bones[i].name+'.quaternion',times,quat));
    }
    const clip=new T.AnimationClip(name,Math.max(1/fps,(frames-1)/fps),tracks);
    clips.push(clip);return clip;
  }
  if(character){
    for(const name of ['idle','run','jump','block','jutsu_seal_idle','punch1'])animation(name);
  }else animation('static');
  const mats=[], sizes=[];
  for(let i=0;i<int(d,180);i++){
    const p=int(d,184)+i*80,w=int(d,p+68),h=int(d,p+72),start=int(d,p+76),mask=(int(d,p+64)&64)!==0;
    mats.push(new T.MeshStandardMaterial({name:str(d,p,64),map:rgbaTexture(d,start,start+w*h,w,h,mask),side:T.DoubleSide,alphaTest:mask?.5:0}));
    sizes.push([w,h]);
  }
  const group=new T.Group();group.add(skelRoot);
  for(let part=0;part<int(d,204);part++){
    const body=int(d,208)+part*76, model=int(d,body+72);
    const verts=[], vertexBones=[], vertexCount=int(d,model+80), normals=[];
    for(let i=0;i<int(d,model+92);i++){
      const bone=d.getUint8(int(d,model+96)+i);
      normals.push(new T.Vector3(...vec(d,int(d,model+100)+i*12)).transformDirection(bones[bone].matrixWorld).toArray());
    }
    for(let i=0;i<vertexCount;i++){
      const p=int(d,model+88)+i*12;
      const bone=d.getUint8(int(d,model+84)+i);
      const v=new T.Vector3(...vec(d,p)).applyMatrix4(bones[bone].matrixWorld);
      verts.push([v.x,v.y,v.z]);vertexBones.push(bone);
    }
    for(let i=0;i<int(d,model+72);i++){
      const mesh=int(d,model+76)+i*20, skin=int(d,mesh+8);
      const material=mats.length?ushort(d,int(d,200)+skin*2):0;
      const [w,h]=sizes[material]??[64,64],positions=[],uv=[],indices=[],weights=[],smooth=[];
      let p=int(d,mesh+4);
      for(let sections=0;sections<20000;sections++){
        const n=short(d,p);p+=2;if(!n)break;
        const strip=[];
        for(let j=0;j<Math.abs(n);j++,p+=8)strip.push([ushort(d,p),ushort(d,p+2),short(d,p+4)/w,short(d,p+6)/h]);
        for(let j=2;j<strip.length;j++){
          const tri=n<0?[strip[0],strip[j-1],strip[j]]:j%2?[strip[j-1],strip[j-2],strip[j]]:[strip[j-2],strip[j-1],strip[j]];
          for(const [v,n,u,t] of tri){if(!verts[v])throw Error('Невалиден връх');positions.push(...verts[v]);uv.push(u,t);smooth.push(...(normals[n]??[0,0,1]));indices.push(vertexBones[v],0,0,0);weights.push(1,0,0,0);}
        }
      }
      if(positions.length){
        const geo=geometry(positions,uv,smooth);
        geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));
        geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
        const object=new T.SkinnedMesh(geo,mats[material]??new T.MeshStandardMaterial({color:0xff9d39}));
        group.add(object);object.bind(skeleton);object.frustumCulled=false;
      }
    }
  }
  group.rotation.x=-Math.PI/2;
  const idle=T.AnimationClip.findByName(clips,character?'idle':'static');
  if(idle){
    const mixer=new T.AnimationMixer(group);
    mixer.clipAction(idle).play();mixer.update(0);
  }
  group.updateMatrixWorld(true);
  if(!character){
    const props=new T.Group(),vertex=new T.Vector3();
    group.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;
      const geo=mesh.geometry.clone(),positions=geo.getAttribute('position');
      for(let i=0;i<positions.count;i++){
        mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld);
        positions.setXYZ(i,vertex.x,vertex.y,vertex.z);
      }
      geo.deleteAttribute('skinIndex');geo.deleteAttribute('skinWeight');geo.computeVertexNormals();
      props.add(new T.Mesh(geo,mesh.material));
      mesh.geometry.dispose();
    });
    return props;
  }
  const box=new T.Box3().setFromObject(group,true);
  if(box.isEmpty())throw Error('Празен модел '+name);
  const height=box.max.y-box.min.y;
  group.position.y=-box.min.y;
  const wrapper=new T.Group();wrapper.add(group);wrapper.scale.setScalar(modelHeight/height);
  if(modelHeight===null){group.position.y=0;wrapper.scale.setScalar(1);}
  wrapper.userData.nativeScale=modelHeight===null?1:height/modelHeight;
  wrapper.userData.nativeFeet=-box.min.y;
  wrapper.animations=clips;wrapper.animation=animation;wrapper.sequenceNames=[...sequences.keys()];
  return wrapper;
}

export async function loadSprite(files,path){
  const d=view(await files.bytes('sprites/'+path));
  if(str(d,0,4)!=='IDSP'||int(d,4)!==2)throw Error('Невалиден GoldSrc SPR');
  const format=int(d,12),colors=ushort(d,40),palette=42;
  if(colors!==256)throw Error('Неподдържана SPR палитра');
  let at=palette+colors*3;
  const frames=[];
  for(let i=0;i<int(d,28)&&i<48;i++){
    if(int(d,at)!==0)break;
    const w=int(d,at+12),h=int(d,at+16),start=at+20;
    if(w<1||h<1||start+w*h>d.byteLength||w*h>1048576)break;
    const pixels=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const id=d.getUint8(start+y*w+x),rgb=palette+(format===2?255:id)*3,i=((h-1-y)*w+x)*4;
      pixels[i]=d.getUint8(rgb);pixels[i+1]=d.getUint8(rgb+1);pixels[i+2]=d.getUint8(rgb+2);
      pixels[i+3]=format===2?id:format===3&&id===255?0:255;
    }
    const texture=new T.DataTexture(pixels,w,h);
    texture.colorSpace=T.SRGBColorSpace;texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearFilter;
    texture.needsUpdate=true;frames.push(texture);at=start+w*h;
  }
  return {frames,additive:format===1};
}

export async function loadXpr(files,path,compact){
  const d=view(await files.bytes('sprites/'+path));
  const entries=[];
  for(let at=0;at+30<=d.byteLength&&d.getUint32(at,true)===0x04034b50;){
    const flags=ushort(d,at+6),method=ushort(d,at+8),length=d.getUint32(at+18,true);
    const size=d.getUint32(at+22,true),names=ushort(d,at+26),extra=ushort(d,at+28);
    const name=str(d,at+30,names),offset=at+30+names+extra;
    if(flags&9||offset+length>d.byteLength||size>2e6||entries.length>=48)throw Error('Неподдържан XPR архив');
    if(/\.png$/i.test(name)&&(method===0||method===8))entries.push({name,method,size,offset,length});
    at=offset+length;
  }
  if(!entries.length)throw Error('Липсват кадри в XPR');
  entries.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const selected=compact&&entries.length>compact.frames?
    Array.from({length:compact.frames},(_,i)=>entries[Math.round(i*(entries.length-1)/(compact.frames-1))]):entries;
  const loader=new T.TextureLoader();
  const frames=await Promise.all(selected.map(async ({method,size,offset,length})=>{
    const bytes=new Uint8Array(d.buffer,d.byteOffset+offset,length);
    let image=new Blob([bytes],{type:'image/png'});
    if(method===8){
      const stream=image.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const data=await new Response(stream).arrayBuffer();
      if(data.byteLength!==size)throw Error('Повреден XPR кадър');
      image=new Blob([data],{type:'image/png'});
    }
    const url=URL.createObjectURL(image);
    try{
      let texture=await loader.loadAsync(url);
      const source=texture.image;
      if(compact&&source&&Math.max(source.width,source.height)>compact.size){
        const canvas=document.createElement('canvas');
        const scale=compact.size/Math.max(source.width,source.height);
        canvas.width=Math.max(1,Math.round(source.width*scale));
        canvas.height=Math.max(1,Math.round(source.height*scale));
        canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
        texture.dispose();texture=new T.CanvasTexture(canvas);
      }
      texture.colorSpace=T.SRGBColorSpace;
      if(compact){texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;}
      return texture;
    }
    finally{URL.revokeObjectURL(url);}
  }));
  return {frames,additive:false};
}
