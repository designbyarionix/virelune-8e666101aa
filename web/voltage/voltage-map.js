import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const layouts = {
  voltage_courtyard: {
    width: 1760, depth: 1480, floor: 'floor', wallHeight: 245,
    walls: [[-470, 0, 320, 42, 120], [470, 0, 320, 42, 120]],
    portals: [[0, -480], [0, 480]]
  },
  voltage_fortress: {
    width: 2100, depth: 1600, floor: 'floor2', wallHeight: 295,
    walls: [[-420, -215, 650, 46, 164], [420, 215, 650, 46, 164],
      [-720, 130, 46, 490, 120], [720, -130, 46, 490, 120]],
    portals: [[-750, -520], [750, 520]]
  },
  voltage_village: {
    width: 2460, depth: 1980, floor: 'floor', wallHeight: 235,
    walls: [[-300,-80,175,42,76],[305,145,170,42,76]],
    portals: [[0,0]],
    buildings: [
      ['longhouse',-785,-440,420,235,275],['roundhouse',765,-410,320,260,300],
      ['shop',-755,450,390,155,240],['longhouse',770,415,410,228,255]
    ],
    gate: [0,-845,375,235,34]
  },
  voltage_market: {
    width: 2180, depth: 1760, floor: 'floor2', wallHeight: 225,
    walls: [[-290,-80,40,220,70],[295,130,180,42,65]],
    portals: [[0,-485],[0,490]],
    buildings: [
      ['shop',-700,-480,340,175,270],['shop',700,-455,340,175,265],
      ['roundhouse',-750,0,275,232,270],['longhouse',740,20,350,233,275],
      ['longhouse',-690,510,382,220,270],['shop',710,500,330,165,265]
    ],
    gate: [0,-780,405,240,40]
  }
};
const vector = (x,y,z) => new T.Vector3(x,y,z);
const gltf = new GLTFLoader(), textures = new T.TextureLoader();
const models = new Map();

async function loadTile(name) {
  if(!models.has(name)){
    const promise = Promise.all([
      gltf.loadAsync('voltage/'+name+'.glb'),
      textures.loadAsync('voltage/'+name+'.webp')
    ]).then(([file, texture]) => {
      texture.colorSpace = T.SRGBColorSpace;
      texture.flipY = false;
      texture.anisotropy = 4;
      const object = file.scene;
      const bounds = new T.Box3().setFromObject(object,true);
      const size = bounds.getSize(new T.Vector3());
      const center = bounds.getCenter(new T.Vector3());
      object.position.sub(vector(center.x,bounds.min.y,center.z));
      const material = new T.MeshLambertMaterial({
        map: texture, side: T.DoubleSide, alphaTest: name==='portal'||name==='rasenshuriken'?.35:0
      });
      object.traverse(mesh => { if(mesh.isMesh)mesh.material=material; });
      return {object,size,animations:file.animations};
    }).catch(error => { models.delete(name); throw error; });
    models.set(name,promise);
  }
  return models.get(name);
}
function instance(tile,x,z,width,height,depth,quarterTurn=false,y=0) {
  const pivot = new T.Group();
  const mesh = tile.object.clone(true);
  mesh.scale.set(
    (quarterTurn?depth:width)/tile.size.x,
    height/Math.max(.01,tile.size.y),
    (quarterTurn?width:depth)/tile.size.z
  );
  mesh.position.multiply(mesh.scale);
  pivot.add(mesh);pivot.position.set(x,y,z);
  if(quarterTurn)pivot.rotation.y=Math.PI/2;
  return pivot;
}

export async function loadVoltageRasenshuriken() {
  const tile=await loadTile('rasenshuriken');
  const root=new T.Group();root.add(tile.object);
  root.userData.weaponSize=Math.max(tile.size.x,tile.size.y,tile.size.z);
  root.animations=tile.animations;
  return root;
}

export async function loadVoltageMap(name) {
  const layout=layouts[name];
  const [floor,wall,portal]=await Promise.all([loadTile(layout.floor),loadTile('wall'),loadTile('portal')]);
  const {width,depth,wallHeight}=layout, group=new T.Group();
  const xLimit=width/2,zLimit=depth/2;
  const tileWidth=width/4,tileDepth=depth/3;
  for(let ix=0;ix<4;ix++)for(let iz=0;iz<3;iz++){
    const ground=instance(floor,(ix+.5)*tileWidth-xLimit,(iz+.5)*tileDepth-zLimit,tileWidth+.2,.01,tileDepth+.2);
    ground.traverse(o=>{if(o.isMesh)o.name='ground';});
    group.add(ground);
  }
  for(const z of [-zLimit,zLimit])for(let i=0;i<4;i++){
    group.add(instance(wall,(i+.5)*tileWidth-xLimit,z,tileWidth+1,wallHeight,28));
  }
  for(const x of [-xLimit,xLimit])for(let i=0;i<3;i++){
    group.add(instance(wall,x,(i+.5)*tileDepth-zLimit,28,wallHeight,tileDepth+1,true));
  }
  const blocks=[];
  for(const [x,z,w,d,h] of layout.walls){
    group.add(instance(wall,x,z,w,h,d,d>w));
    blocks.push(new T.Box3(vector(x-w/2,0,z-d/2),vector(x+w/2,h,z+d/2)));
  }
  if(layout.buildings){
    const unique=[...new Set(layout.buildings.map(([key])=>key))];
    const styles=new Map(await Promise.all(unique.map(async key=>[key,await loadTile(key)])));
    for(const [key,x,z,w,h,d] of layout.buildings){
      group.add(instance(styles.get(key),x,z,w,h,d));
      blocks.push(new T.Box3(vector(x-w/2,0,z-d/2),vector(x+w/2,h*.86,z+d/2)));
    }
    const [x,z,w,h,d]=layout.gate;
    group.add(instance(await loadTile('gate'),x,z,w,h,d));
    for(const direction of [-1,1]){
      const center=x+direction*w*.43;
      blocks.push(new T.Box3(vector(center-18,0,z-19),vector(center+18,h,z+19)));
    }
    blocks.push(new T.Box3(vector(x-w*.44,h*.78,z-18),vector(x+w*.44,h,z+18)));
  }
  for(const [x,z] of layout.portals)group.add(instance(portal,x,z,176,2,176,false,1));
  const bodyBlocks=blocks.map(box=>new T.Box3(
    box.min.clone().sub(vector(16,52,16)),box.max.clone().add(vector(16,34,16))
  ));
  const outside=(p,padding=0)=>Math.abs(p.x)>xLimit-padding||Math.abs(p.z)>zLimit-padding;
  const solid=p=>p.y<34||outside(p,16)||bodyBlocks.some(box=>box.containsPoint(p));
  const pointSolid=p=>p.y<0||outside(p)||blocks.some(box=>box.containsPoint(p));
  const floorY=p=>{
    if(outside(p))return null;
    let y=0;
    for(const box of blocks)if(p.x>=box.min.x&&p.x<=box.max.x&&p.z>=box.min.z&&p.z<=box.max.z&&p.y>=box.max.y)y=Math.max(y,box.max.y);
    return y;
  };
  const spawns=[];
  for(const z of [-zLimit*.8,zLimit*.8])for(const x of [-.76,-.46,-.16,.16,.46,.76]){
    spawns.push({position:vector(x*xLimit,38,z),angle:z>0?90:270,combat:true});
  }
  return {group,spawns,solid,pointSolid,floorY,noClimb:p=>outside(p),
    water:()=>false,waterline:()=>null,waterMeshes:[],waterSurface:null,
    teleports:[],hazards:[],roofDistance:()=>Infinity,sky:'nnk_konoha',
    lighting:{color:new T.Color(0xffe8ce),direction:vector(-.45,.84,.29).normalize(),intensity:1.13}};
}
