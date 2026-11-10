import * as T from 'three';
import {defaults,parseRules,strike} from './rules.js';
import {makeRadar} from './hud.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {maps,loadMap,loadCharacter,loadWeaponModel,loadPakkun,loadKawarimiLog,loadRasengan,loadOriokeCloud,loadSky,loadSprite,loadXpr,installedFiles} from './assets.js';

const $=id=>document.getElementById(id);
const heroes={
  naruto:{label:'Naruto',color:0xffa034,skills:{DSW:['Rasengan',30,'rush'],WS:['Kage Bunshin',35,'clone'],DW:['Orioke',20,'stun'],ADW:['Rasenshuriken',35,'rasenshuriken']}},
  sasuke:{label:'Sasuke',color:0xc692ff,skills:{ADS:['Katon Goukakyuu',30,'fire'],SDA:['Katon Housenka',20,'volley'],WSD:['Chidori',30,'rush']}},
  kakashi:{label:'Kakashi',color:0x91b9ff,skills:{DW:['Kuchiyose',25,'summon'],WS:['Kage Bunshin',35,'clone'],WSD:['Raikiri',30,'rush']}},
  sakura:{label:'Sakura',color:0xff8bb5,skills:{DSW:['Chakra Concentration',15,'boost'],WS:['Healing Jutsu',22,'heal'],SA:['Bunshin',20,'clone']}},
  anbu:{label:'ANBU',color:0xd1dbdd,skills:{ADS:['Katon',30,'fire'],DW:['Shunshin',25,'rush']}}
};
const names={academy:'Academy',monument:'Monument',chuninfinals:'Chunin Finals',chuninfinals_dusk:'Chunin Finals · Dusk',kyuubilair:'Kyuubi Lair',monument_night:'Monument · Night',preliminary:'Preliminary',voltage_courtyard:'Voltage · Двор',voltage_fortress:'Voltage · Крепост',voltage_village:'Voltage · Село Коноха',voltage_market:'Voltage · Пазарът на Коноха',storm_river:'Storm 2 · Речна арена',storm_forest:'Storm 2 · Горска арена',storm_sand:'Storm 2 · Пясъчна арена'};
const weapons=[
  {id:'kunai',label:'Kunai',icon:'Icon_Kunai',ammo:12},
  {id:'shuriken',label:'Shuriken',icon:'Icon_Shuriken',ammo:18},
  {id:'tagkunai',label:'Kunai Tag',icon:'Icon_KunaiTag',ammo:5},
  {id:'smoke',label:'Smoke Bomb',icon:'Icon_Smokebomb',ammo:4},
  {id:'tag',label:'Exploding Tag',icon:'Icon_ExplodingTag',ammo:5}
];
let oriokeModel=null;
let pakkun=null,rasenganModel=null,oriokeCloud=null,orioke=null;
const weaponModels=new Map();
let weaponTrailMap=null;
const weaponAssets={kunai:'Kunai.mdl',shuriken:'Shuriken.mdl',tagkunai:'kunai_tag.mdl',smoke:'smokebomb.mdl',tag:'tag.mdl'};
let rules=defaults,sprites=new Map(),weaponIndex=0,locked=null,lockLost=0,charged=null,mode='training';
let techniqueOrb=null,chargeClone=null,healing=null,focusMode=false,lastStride=0,chain=0,lastHit=0,secondaryUntil=0,heavy=null;
const maxChakra=10000;
for(const [id,h] of Object.entries(heroes))$('character').add(new Option(h.label,id));
for(const id of maps)$('map').add(new Option(names[id],id));
$('map').value='chuninfinals';

let renderer;
try{
  renderer=new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
  if(renderer.shadowMap){renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;}
  $('game').append(renderer.domElement);
}catch(e){$('status').textContent='WebGL 2 не е наличен в този браузър.';throw e;}
const scene=new T.Scene();
const camera=new T.PerspectiveCamera(68,1,2,24000);
const ambient=new T.HemisphereLight(0xf4f8ff,0xb2aa96,1.65);scene.add(ambient);
const sun=new T.DirectionalLight(0xffe3bd,1.45);
sun.position.set(1200,1900,500);
sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:40,far:400});
sun.shadow.bias=-.00025;sun.shadow.normalBias=1.3;sun.shadow.radius=1;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun,sun.target);
const skyColor=new T.Color(0x9ac1c2);
scene.background=skyColor;
scene.fog=new T.FogExp2(skyColor,.000095);
let viewportWidth,viewportHeight;
function resize(){
  if(innerWidth===viewportWidth&&innerHeight===viewportHeight)return;
  viewportWidth=innerWidth;viewportHeight=innerHeight;
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
}
addEventListener('resize',resize);resize();

let files,world,actors,player,score=0,paused=true,busy=false,noticeUntil=0,now=0;
let botList=[],effects=[],shots=[],allies=[],models=new Map();
let kawarimiLog=null,substitutionLogs=[];
let rasenganChargeModel=null,pendingThrow=null;
let focusSprites=[];
let routeBudget=2,baseSpritesLoaded=false;
let lan=null;
let opponentCache=botList;
const opponents=()=>opponentCache;
function refreshOpponents(){
  opponentCache=lan?[...botList,...lan.peers.values()]:botList;
}
let cameraZoom=238,cameraDistance=238;
let yaw=0,pitch=0,combo='',sealUntil=0,prepared=null,attackUntil=0,rush=null;
const keys=new Set(),taps=new Map();
const touch=new URLSearchParams(location.search).has('touch')||
  (globalThis.matchMedia?.('(pointer: coarse)').matches??false);
const quality=$('graphics-quality');
const qualityLimits={balanced:[1,1.4,1200000],detail:[1,1.6,1600000],light:[.75,1,800000]};
const perfParams=new URLSearchParams(location.search);
const fixedScale=perfParams.has('perf')?Number(perfParams.get('scale')):0;
try{quality.value=localStorage.getItem('nnk-graphics')??'balanced';}catch{quality.value='balanced';}
if(!qualityLimits[quality.value])quality.value='balanced';
let renderScale;
function resolutionRange(){
  const [minimum,maximum,pixels]=qualityLimits[quality.value];
  if(fixedScale>=1&&fixedScale<=2){
    const fixed=Math.min(devicePixelRatio,fixedScale);
    return [fixed,fixed];
  }
  const cap=Math.min(devicePixelRatio,maximum,
    Math.sqrt(pixels/(innerWidth*innerHeight)));
  const max=Math.max(Math.min(devicePixelRatio,minimum),cap);
  return [Math.min(max,minimum),max];
}
function setResolution(scale){
  if(scale===renderScale)return;
  renderScale=scale;
  renderer.setPixelRatio(renderScale);
}
quality.onchange=()=>{
  try{localStorage.setItem('nnk-graphics',quality.value);}catch{}
  setResolution(resolutionRange()[1]);
  frameWindow.frames=0;
};
setResolution(resolutionRange()[1]);
addEventListener('resize',()=>{
  const [minimum,maximum]=resolutionRange();
  setResolution(Math.min(maximum,Math.max(minimum,renderScale)));
});
if(touch)$('hud').classList.add('touch-hud');
let radar=null,radarZoom=1,showTouchScore=false;
const number=new Intl.NumberFormat('bg');
$('radar-in').onclick=()=>{radarZoom=Math.min(2.75,radarZoom+.35);};
$('radar-out').onclick=()=>{radarZoom=Math.max(1,radarZoom-.35);};
let stickX=0,stickY=0;
const movingKey=code=>keys.has(code)||
  (code==='KeyW'?stickY<-.3:code==='KeyS'?stickY>.3:code==='KeyA'?stickX<-.3:code==='KeyD'&&stickX>.3);
if(touch){
  cameraZoom=205;
  if(renderer.shadowMap)renderer.shadowMap.enabled=false;
  addEventListener('resize',()=>{
    stickX=stickY=0;
    if(innerHeight>innerWidth)keys.delete('MouseBlock');
  });
}

const alive=actor=>!actor.dead;
const enemies=(a,b)=>a!==b&&(mode==='training'?(a===player||b===player):mode==='deathmatch'||mode==='lan'||a.team!==b.team);
const motion=new T.Vector3(), goal=new T.Vector3(), forward=new T.Vector3(), right=new T.Vector3();
const fxGeo=new T.SphereGeometry(1,10,7), rippleGeo=new T.PlaneGeometry(1,1), rand=(a,b)=>a+Math.random()*(b-a);
const rasenganCoreGeometry=new T.SphereGeometry(.72,touch?14:28,touch?10:20);
const rasenganCoreMaterial=new T.ShaderMaterial({
  uniforms:{time:{value:0}},
  vertexShader:`varying vec3 surface;varying vec3 facing;
    void main(){surface=normalize(position);facing=normalize(normalMatrix*normal);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform float time;varying vec3 surface;varying vec3 facing;
    void main(){float streak=.5+.5*sin(24.0*surface.y+9.0*sin(6.0*surface.x+time*11.0));
    float light=pow(clamp(facing.z,0.0,1.0),.7);
    vec3 color=mix(vec3(.025,.36,.95),vec3(.74,.98,1.0),light*(.64+.36*pow(streak,4.0)));
    gl_FragColor=vec4(color,1.0);}`
});
const clamp=T.MathUtils.clamp;
const visualScale=root=>world.traceSolid?(root.userData.nativeScale??1):1;
function setActorScale(root){
  root.scale.setScalar(world.traceSolid?1:1/(root.userData.nativeScale??1));
}
const lanAccess=new URLSearchParams(location.search).has('lan');
const music=$('music-volume'),effectsVolume=$('effects-volume'),backgroundAudio=[];
let musicVolume=.55,sfxVolume=.8;
try{
  musicVolume=clamp(Number(localStorage.getItem('nnk-music')??.55),0,1);
  sfxVolume=clamp(Number(localStorage.getItem('nnk-sfx')??.8),0,1);
}catch{}
music.value=100*musicVolume;effectsVolume.value=100*sfxVolume;
music.oninput=()=>{
  musicVolume=Number(music.value)/100;
  for(const {audio,gain} of backgroundAudio)audio.volume=musicVolume*gain;
  try{localStorage.setItem('nnk-music',musicVolume);}catch{}
};
effectsVolume.oninput=()=>{
  sfxVolume=Number(effectsVolume.value)/100;
  try{localStorage.setItem('nnk-sfx',sfxVolume);}catch{}
};
function setBackground(tracks){
  for(const {audio} of backgroundAudio)audio.pause?.();
  backgroundAudio.length=0;
  for(const {url,gain} of tracks){
    if(!url)continue;
    const audio=new Audio(url);
    audio.loop=true;audio.volume=musicVolume*gain;
    backgroundAudio.push({audio,gain});
    audio.play().catch(()=>{});
  }
}
function theme(){return {url:files?.url('media/gamestartup.mp3'),gain:.42};}
$('title-settings').addEventListener('click',()=>{
  if(!world&&!backgroundAudio.length)setBackground([theme()]);
});
function playerName(){
  return $('player-name').value.trim().replace(/\s+/g,' ').slice(0,24);
}
function sendArena(state){
  return fetch('arena',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(3000),body:JSON.stringify(state)}).then(response=>{
    if(!response.ok)throw Error(response.status===404?'Използвай Start NNK LAN.cmd':
      response.status===409?'Арената е пълна · 10 от 10':'HTTP '+response.status);
    return response.json();
  });
}
if(lanAccess){
  $('menu').classList.add('lan-game');
  $('title-subtitle').textContent='Chunin Finals · до 10 играчи';
  $('play').firstChild.nodeValue='Старт ';
  $('lobby-profile').hidden=false;
  $('lobby-profile').append($('character-field'));
}
function message(s){$('notice').textContent=s;noticeUntil=now+2.6;}
function updateStatus(text){$('status').textContent=text;}
const cutInDuration=7/6;
let cutInUntil=0,battleStarts=0,cinematicUntil=0,pendingRasenshuriken=null;
function showJutsuCutIn(name){
  const banner=$('jutsu-cut-in');
  const portrait=$('cut-in-image');
  const url=files.url('sprites/vgui/'+player.id+'.png');
  portrait.hidden=!url;
  if(url&&portrait.getAttribute?.('src')!==url)portrait.src=url;
  $('cut-in-hero').textContent=heroes[player.id].label;
  $('cut-in-name').textContent=name;
  if(!touch){banner.hidden=true;void banner.offsetWidth;}
  banner.hidden=false;
  cutInUntil=now+cutInDuration;
  if(mode!=='lan'&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)cinematicUntil=now+.85;
}
files=installedFiles;
$('play').disabled=false;
updateStatus('Избери герой и карта. Играта зарежда ресурсите от сайта.');
function disposeTree(root){
  root.traverse(o=>{
    o.geometry?.dispose();
    const materials=Array.isArray(o.material)?o.material:[o.material];
    for(const m of materials){m?.map?.dispose();m?.normalMap?.dispose();m?.dispose();}
  });
}
async function model(id){
  if(!models.has(id))models.set(id,loadCharacter(files,id));
  const base=await models.get(id),copy=cloneSkeleton(base);
  copy.animations=base.animations;copy.animation=base.animation;copy.sequenceNames=base.sequenceNames;
  copy.traverse(mesh=>{
    if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}
    const socket=mesh.userData.studioName?.match(/^Bip01 ([LR]) (Hand|Foot)$/);
    if(socket)(copy.sockets??={})[socket[1]+socket[2]]=mesh;
  });
  return copy;
}
function openMenu(){
  if(!world||busy)return;
  paused=true;stickX=stickY=0;$('touch-controls').hidden=true;keys.clear();taps.clear();
  if(document.pointerLockElement)document.exitPointerLock();
  $('menu').classList.add('paused-game');
  $('menu').hidden=false;$('training').hidden=false;
  $('arena-settings').hidden=false;$('title-settings').setAttribute('aria-expanded','true');
}
function resume(){
  if(!world||busy)return;
  paused=false;$('menu').hidden=true;
  if(charged)releaseCharge();
  if(heavy)releaseHeavy();
  if(touch){$('touch-controls').hidden=false;return;}
  if(!document.pointerLockElement)message('Кликни в арената за управление с мишката');
  renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});
}
$('resume').onclick=resume;
$('restart-match').onclick=()=>$('play').onclick();
renderer.domElement.addEventListener('wheel',e=>{
  if(paused||!world)return;
  e.preventDefault();cameraZoom=clamp(cameraZoom+Math.sign(e.deltaY)*24,100,440);
},{passive:false});
renderer.domElement.onclick=()=>{if(!touch&&!paused&&!document.pointerLockElement)renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});};
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&!paused)openMenu();});
document.addEventListener('mousemove',e=>{
  if(paused||document.pointerLockElement!==renderer.domElement)return;
  yaw-=e.movementX*.0024;pitch=clamp(pitch-e.movementY*.0024,-1.12,1.05);
});
window.addEventListener('blur',()=>{keys.clear();taps.clear();combo='';charged=null;heavy=null;});
document.addEventListener('keydown',e=>{
  if(e.code==='F8'||e.code==='Escape'){
    if(world&&!busy){e.preventDefault();if(!e.repeat){if(paused)resume();else openMenu();}}
    return;
  }
  if(paused||!world)return;
  if(['Space','KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','KeyF','ArrowUp','ArrowDown','Tab'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  keys.add(e.code);
  const sealing=e.shiftKey||keys.has('ShiftLeft')||keys.has('ShiftRight');
  if(e.code==='Space'&&!sealing){
    jumpPlayer();
  }
  if(/^Key[WAD]$/.test(e.code)&&!sealing){
    const last=taps.get(e.code);
    if(last!==undefined&&now-last<.34){
      taps.delete(e.code);dash(e.code);
    }else taps.set(e.code,now);
  }
  if(e.code==='KeyF')toggleFocus();
  if(e.code==='KeyT')toggleTarget();
  if(e.code==='KeyC'){openMenu();$('character').focus();}
  if(e.code==='KeyB'){spawn(player,player.spawn);message('Върнат на началната позиция');}
  if(e.code==='KeyP')message(Object.entries(heroes[player.id].skills).map(([seal,skill])=>seal+' '+skill[0]).join(' · '));
  if(e.code==='ArrowUp'||e.code==='ArrowDown')cameraZoom=clamp(cameraZoom+(e.code==='ArrowUp'?-24:24),100,440);
  if(/^Digit[1-5]$/.test(e.code)){weaponIndex=Number(e.code.at(-1))-1;updateHUD();}
  if(e.code==='BracketLeft'||e.code==='BracketRight'){weaponIndex=(weaponIndex+(e.code==='BracketRight'?1:4))%5;updateHUD();}
  if(e.code==='KeyE')quickFire();
  if(e.code==='KeyR')weaponIndex=(weaponIndex+1)%weapons.length;
  if(e.code==='Enter')attack(false);
  if(sealing&&/^Key[WASD]$/.test(e.code)){
    playPose(player,{KeyW:'jutsu_seal_forward',KeyA:'jutsu_seal_left',KeyS:'jutsu_seal_back',KeyD:'jutsu_seal_right'}[e.code],.28);
    const skills=heroes[player.id].skills;
    const patterns=Object.keys(skills);
    combo=(now<sealUntil?combo:'')+e.code.at(-1);
    while(combo&&!patterns.some(pattern=>pattern.startsWith(combo)))combo=combo.slice(1);
    sealUntil=now+2;
    if(combo)sound('jutsu/Seal_'+combo.length+'.wav',.26);
    if(skills[combo]){
      prepare(skills[combo]);combo='';
    }else message(combo?'Печати · '+combo:'Невалиден печат · P за комбинациите');
  }
});
document.addEventListener('keyup',e=>{
  keys.delete(e.code);
  if(e.code==='KeyW'&&player){
    player.dashUntil=0;
    if(player.pose?.name==='dash')player.pose=null;
  }
  if(e.code.startsWith('Shift')&&!keys.has('ShiftLeft')&&!keys.has('ShiftRight'))combo='';
  if(e.code==='Enter'&&charged&&!paused)releaseCharge();
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousedown',e=>{
  if(touch||paused||(document.pointerLockElement!==renderer.domElement&&e.target!==renderer.domElement))return;
  if(e.button===0||e.button===2){e.preventDefault();attack(e.button===2);}
  if(e.button===3){e.preventDefault();keys.add('MouseBlock');}
});
document.addEventListener('mouseup',e=>{
  if(e.button===0&&charged&&!paused)releaseCharge();
  if(e.button===2&&heavy&&!paused)releaseHeavy();
  if(e.button===3)keys.delete('MouseBlock');
});
if(touch){
  const stick=$('joystick'),thumb=$('joystick-thumb');
  let stickPointer=null,lookPointer=null,lookX=0,lookY=0;
  const steer=e=>{
    const box=stick.getBoundingClientRect(),radius=box.width*.36;
    stickX=(e.clientX-box.left-box.width/2)/radius;
    stickY=(e.clientY-box.top-box.height/2)/radius;
    const length=Math.hypot(stickX,stickY);
    if(length<.13)stickX=stickY=0;
    if(length>1){stickX/=length;stickY/=length;}
    thumb.style.transform='translate('+stickX*radius+'px,'+stickY*radius+'px)';
  };
  stick.onpointerdown=e=>{if(stickPointer===null){stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);steer(e);}};
  stick.onpointermove=e=>{if(e.pointerId===stickPointer)steer(e);};
  stick.onlostpointercapture=e=>{
    if(e.pointerId!==stickPointer)return;
    stickPointer=null;stickX=stickY=0;thumb.style.transform='';
  };
  const canvas=renderer.domElement;
  canvas.onpointerdown=e=>{
    if(paused||lookPointer!==null)return;
    lookPointer=e.pointerId;lookX=e.clientX;lookY=e.clientY;canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove=e=>{
    if(e.pointerId!==lookPointer||paused)return;
    yaw-=(e.clientX-lookX)*.007;
    pitch=clamp(pitch-(e.clientY-lookY)*.006,-1.12,1.05);
    lookX=e.clientX;lookY=e.clientY;
  };
  canvas.onlostpointercapture=()=>{lookPointer=null;};
  $('touch-scroll').onclick=()=>{
    const expanded=$('touch-techniques').classList.toggle('expanded');
    $('touch-scroll').setAttribute('aria-expanded',String(expanded));
  };
  $('touch-score').onclick=()=>{showTouchScore=!showTouchScore;updateHUD();};
  const buttons={cycle:()=>{weaponIndex=(weaponIndex+1)%weapons.length;updateHUD();},jump:()=>jumpPlayer(),hit:()=>attack(false),heavy:()=>attack(true),
    dash:()=>dash('KeyW'),block:()=>keys.add('MouseBlock'),focus:()=>toggleFocus(),weapon:()=>quickFire(),
    lock:()=>toggleTarget(),menu:()=>openMenu()};
  for(const [name,action] of Object.entries(buttons)){
    const button=$('touch-'+name);
    button.onpointerdown=e=>{
      e.preventDefault();e.stopPropagation();
      button.setPointerCapture(e.pointerId);action();
    };
    button.onpointerup=button.onlostpointercapture=()=>{
      if(name==='hit'&&charged)releaseCharge();
      if(name==='heavy'&&heavy)releaseHeavy();
      if(name==='block')keys.delete('MouseBlock');
    };
  }
}
function endOrioke(){
  if(!orioke)return;
  const original=orioke.originalRoot;
  original.position.copy(player.root.position);original.quaternion.copy(player.root.quaternion);
  actors.remove(player.root);actors.add(original);
  if(orioke.cloud){
    orioke.cloudMixer.stopAllAction();actors.remove(orioke.cloud);
    orioke.cloudMaterials.forEach(material=>material.dispose());
  }
  player.root=original;player.mixer=null;player.action=null;player.pose=null;orioke=null;
}
function toggleFocus(){
  focusMode=!focusMode;message(focusMode?'Фокус на чакра':'Фокусът е спрян');
  if(focusMode){player.focusStarted=now;sound('misc/Focus_Chakra.wav');}
}
function updateFocusEffect(){
  const texture=sprites.get('chakraFocus');
  const visible=Boolean(focusMode&&player.stamina>0&&texture?.frames.length);
  if(!visible){for(const sprite of focusSprites)sprite.visible=false;return;}
  for(const [i,foot] of ['LFoot','RFoot'].entries()){
    const socket=player.root.sockets?.[foot];
    if(!socket){if(focusSprites[i])focusSprites[i].visible=false;continue;}
    let sprite=focusSprites[i];
    if(!sprite){
      sprite=new T.Sprite(new T.SpriteMaterial({map:texture.frames[0],transparent:true,
        blending:T.AdditiveBlending,depthWrite:false}));
      focusSprites[i]=sprite;actors.add(sprite);
    }
    const scale=visualScale(player.root);
    sprite.visible=true;
    socket.getWorldPosition(sprite.position);sprite.position.y+=2*scale;
    const frame=Math.floor((now-player.focusStarted)*15)%texture.frames.length;
    sprite.material.map=texture.frames[frame];
    sprite.scale.setScalar(23*scale);
  }
}
const soundTemplates=new Map();
function sound(path,volume=.37){
  const url=files?.url('sound/'+path);
  if(!url)return;
  let template=soundTemplates.get(url);
  if(!template){template=new Audio(url);soundTemplates.set(url,template);}
  const audio=template.cloneNode?.()??new Audio(url);
  audio.volume=clamp(volume*sfxVolume,0,1);
  audio.play().catch(()=>{});
}
function prepare(skill){
  prepared=skill;sound('jutsu/Jutsu_Enabled.wav');message(touch?skill[0]:skill[0]+' · ляв бутон или Enter');
}
function refreshTouchTechniques(skills){
  const icons={
    Rasengan:'rasengan',Chidori:'chidori',Raikiri:'chidori',
    'Kage Bunshin':'clone',Bunshin:'clone',
    'Katon Goukakyuu':'fire',Katon:'fire','Katon Housenka':'volley',
    Kuchiyose:'summon','Chakra Concentration':'boost','Healing Jutsu':'heal'
  };
  const strip=$('touch-techniques');
  strip.classList.remove('expanded');
  $('touch-scroll').setAttribute('aria-expanded','false');
  $('touch-scroll').hidden=skills.length<=2;
  strip.replaceChildren();
  for(const skill of skills){
    const button=document.createElement('button');
    button.type='button';button.title=skill[0];button.setAttribute('aria-label',skill[0]);
    const glyph={Orioke:'変',Shunshin:'ϟ',Rasenshuriken:'✦'}[skill[0]];
    const icon=document.createElement(glyph?'span':'img');
    if(glyph){
      icon.className='touch-technique-glyph';icon.textContent=glyph;icon.setAttribute('aria-hidden','true');
    }else{
      const art=icons[skill[0]];
      icon.src='touch-icons/'+art+(['rasengan','clone'].includes(art)?'-hud.svg':'.png');icon.alt='';
    }
    const label=document.createElement('span');label.textContent=skill[0];
    button.append(icon,label);
    let pointer=null,ownsCharge=false;
    button.onpointerdown=e=>{
      if(paused||charged||rush||heavy||keys.has('KeyQ')||keys.has('MouseBlock'))return;
      e.preventDefault();e.stopPropagation();
      pointer=e.pointerId;button.setPointerCapture(pointer);
      prepare(skill);attack(false);
      ownsCharge=charged?.skill===skill;
    };
    button.onpointerup=button.onlostpointercapture=e=>{
      if(e.pointerId!==pointer)return;
      pointer=null;
      if(ownsCharge&&charged?.skill===skill)releaseCharge();
      ownsCharge=false;
    };
    strip.append(button);
  }
}
function refreshTech(){
  if(touch)refreshTouchTechniques(Object.values(heroes[player.id].skills));
  $('techniques').replaceChildren();
  $('sequence').replaceChildren();
  for(const name of player.root.sequenceNames)$('sequence').add(new Option(name,name));
  for(const [pattern,skill] of Object.entries(heroes[player.id].skills)){
    const b=document.createElement('button');b.textContent=skill[0]+' · '+pattern;
    b.onclick=()=>{resume();prepare(skill);};$('techniques').append(b);
  }
}
$('preview-sequence').onclick=()=>{
  const name=$('sequence').value;
  if(player&&name){resume();playPose(player,name);message(name);}
};
function spawnPoint(index){
  const p=world.spawns[index%world.spawns.length].position.clone();
  for(let i=0;i<24&&world.solid(p);i++)p.y+=4;
  const q=p.clone();
  for(let i=0;i<35;i++){
    q.y=p.y-2;if(world.solid(q))break;p.y=q.y;
  }
  return p;
}
function initialSpawn(){
  const scale=visualScale(player.root);
  const zoom=cameraZoom*scale;
  const limit=world.spawns.some(s=>s.combat)?world.spawns.filter(s=>s.combat).length:world.spawns.length;
  let best=0,longest=-1;
  for(let i=0;i<limit;i++){
    const spot=spawnPoint(i),floor=world.floorY(spot),angle=T.MathUtils.degToRad(world.spawns[i].angle);
    if(floor===null)continue;
    const focus=spot.clone();focus.y=floor+48*scale;
    const back=new T.Vector3(-Math.cos(angle),.32,Math.sin(angle)).normalize();
    const clear=cameraClearance(focus,back,zoom);
    if(clear>longest){best=i;longest=clear;}
    if(clear>=zoom-10)break;
  }
  return best;
}
function botSpawn(){
  const used=[player,...botList.filter(b=>!b.dead)].map(actor=>actor.pos);
  return world.spawns.map((_,i)=>i).sort((a,b)=>{
    const value=i=>{
      const p=world.spawns[i].position;
      return Math.min(...used.map(o=>p.distanceTo(o))) - Math.abs(player.pos.y-p.y)*2;
    };
    return value(b)-value(a);
  })[0];
}
const scoreRows=[];
function updateHUD(){
  $('hero').textContent=player.name??heroes[player.id].label;
  $('arena').textContent=names[world.name];
  $('hp').value=player.hp;$('chakra').value=player.chakra;
  $('hp-value').textContent=number.format(Math.ceil(player.hp))+' / 100';
  $('chakra-value').textContent=number.format(Math.floor(player.chakra))+' / '+number.format(maxChakra);
  if(radar){
    const x=clamp(.5+(player.pos.x-radar.center.x)/(radar.radius*2),.045,.955);
    const z=clamp(.5+(player.pos.z-radar.center.z)/(radar.radius*2),.045,.955);
    const left=clamp(.5-x*radarZoom,1-radarZoom,0);
    const top=clamp(.5-z*radarZoom,1-radarZoom,0);
    $('radar-map').style.transform='translate('+left*100+'%,'+top*100+'%) scale('+radarZoom+')';
    const arrow=$('radar-arrow');
    arrow.style.left=(left+x*radarZoom)*100+'%';
    arrow.style.top=(top+z*radarZoom)*100+'%';
    arrow.style.transform='translate(-50%,-50%) rotate('+(Math.PI/2-yaw)+'rad)';
    $('radar-coordinates').textContent='('+Math.round(player.pos.x)+', '+Math.round(player.pos.z)+')';
  }
  const weapon=weapons[weaponIndex];
  $('weapon').textContent=weapon.label+' · '+(unlimited()?'∞':player.ammo[weaponIndex])+'  [E]';
  $('touch-weapon-label').textContent=weapon.label;
  $('target').hidden=!locked||!!locked.dead;
  if(locked&&!locked.dead)$('target').textContent=heroes[locked.id].label+' · '+Math.ceil(locked.hp)+' HP';
  $('score').textContent=lan?'LAN · '+(lan.peers.size+1)+' играчи'+(lan.ping===undefined?'':' · '+lan.ping+' ms'):score+' победи · '+botList.length+' бота';
  const board=$('scoreboard');board.hidden=!keys.has('Tab')&&!showTouchScore;
  if(!board.hidden){
    const ordered=[player,...opponents()].sort((a,b)=>b.kills-a.kills);
    const list=board.querySelector('ol');
    while(scoreRows.length<Math.max(10,ordered.length)){
      const row=document.createElement('li');
      scoreRows.push(row);list.append(row);
    }
    for(const [index,row] of scoreRows.entries()){
      const a=ordered[index];
      row.hidden=!a;
      if(!a)continue;
      const prefix=mode==='teamplay'?(a.team===0?'[Konoha] ':'[Shinobi] '):'';
      const label=prefix+(a.name??heroes[a.id].label)+(a===player?' · ти':a.remote?' · LAN':' · бот')+' — '+a.kills+' / '+a.deaths;
      if(row.textContent!==label)row.textContent=label;
    }
  }
}
function spawn(entity,i){
  if(entity===player)endOrioke();
  entity.pos.copy(spawnPoint(i));entity.hp=100;entity.dy=0;entity.impulse=new T.Vector3();entity.airJump=false;entity.ground=false;entity.root.visible=true;
  const y=world.floorY(entity.pos);
  entity.feetOffset=y===null?34:entity.pos.y-y;
  entity.route=[];entity.routeSearch=null;entity.replan=0;entity.swingAt=0;entity.swing=0;entity.pose=null;entity.dashUntil=0;entity.wall=null;entity.floorProbe=null;entity.safePosition=null;entity.waterWalk=false;entity.backflip=false;entity.wallLock=0;entity.wallKickUsed=false;entity.swingIndex=0;entity.lastSwing=-10;entity.powerKickAt=0;
  if(entity===player)clearRush();
  face(entity,new T.Vector3(1,0,0));
}
async function addBots(n){
  if(!world)return;
  for(let i=0;i<n&&botList.length<10;i++){
    const botIds=Object.keys(heroes),id=botIds[botList.length%botIds.length];
    const root=await model(id);
    const bot={id,root,pos:new T.Vector3(),dy:0,hp:100,next:now+2,dead:0,stun:0,team:(botList.length+1)%2,kills:0,deaths:0};
    bot.nameplate=document.createElement('span');bot.nameplate.className='bot-name';
    bot.nameplate.textContent=heroes[id].label+' · Бот '+(botList.length+1);
    bot.nameplate.hidden=true;$('bot-names').append(bot.nameplate);
    actors.add(root);spawn(bot,botSpawn());botList.push(bot);refreshOpponents();
  }
  updateHUD();
}
$('addbots').onclick=async()=>{try{await addBots(3);message('Добавени ботове');}catch(e){updateStatus(e.message);}};
const mobileRasenganTextures={
  rasenBase:{frames:8,size:256},
  rasenCharge:{frames:8,size:192},
  rasenganHit:{frames:12,size:256},
  rasenShockwave:{frames:8,size:192}
};
const uploadedRasenganFrames=new WeakSet();
function warmRasenganTextures(){
  if(!renderer.initTexture)return;
  for(const name of Object.keys(mobileRasenganTextures)){
    for(const frame of sprites.get(name)?.frames??[]){
      if(uploadedRasenganFrames.has(frame))continue;
      renderer.initTexture(frame);uploadedRasenganFrames.add(frame);
    }
  }
}
async function loadJutsuEffects(id,withBots){
  const originalFx={
        rasenganHit:'Rasen_Hit',rasenCharge:'Rasen_Charge',rasenBase:'Rasen_Base',rasenShockwave:'Shockwave',
        chidoriCore:'chidori_main',chidoriBolts:'Chidori_Bolts',chidoriHit:'Chidori_Hit',
        fireball:'Gouk_Flame',fireTrail:'Flame_trail',volley:'Hous_Flame',fireStart:'Katon_Shoot',
        heal:'Heal_Chakra',healKanji:'Heal_Kanji',heart:'Orioke_Heart',summon:'Kuchiyose_Seal',
        boost:'Chakra_Concentrate',powerHit:'Powerpunch_hit'
      };
  const perHero={
    naruto:['rasenganHit','rasenCharge','rasenBase','rasenShockwave','heart'],
    sasuke:['chidoriCore','chidoriBolts','chidoriHit','fireball','fireTrail','volley','fireStart'],
    kakashi:['chidoriCore','chidoriBolts','chidoriHit','summon'],
    sakura:['heal','healKanji','boost','powerHit'],
    anbu:['fireball','fireTrail','fireStart','chidoriCore','chidoriBolts','chidoriHit']
  };
  const keys=new Set(perHero[id]);
  if(withBots)for(const key of ['rasenganHit','rasenCharge','rasenBase','fireball','fireTrail','fireStart'])keys.add(key);
  await Promise.all([...keys].filter(key=>!sprites.has(key)||key==='rasenganHit'&&!sprites.get(key).additive).map(async key=>{
        const name=originalFx[key];
        try{
          const effect=await loadXpr(files,(key==='rasenShockwave'?'general/':'jutsus/')+name+'.xpr',touch?mobileRasenganTextures[key]:null)
            .catch(error=>key==='fireball'?loadSprite(files,'jutsus/Gouk_Flame.spr'):Promise.reject(error));
          effect.additive=/^Rasen_|^Chidori_|^chidori_main|^Shockwave$|^Chakra_Concentrate$|^Powerpunch_hit$|^Gouk_Flame$|^Hous_Flame$|^Flame_trail$|^Katon_Shoot$/i.test(name);
          sprites.set(key,effect);
        }
        catch(e){console.warn('NNK XPR',name,e.message);}
      }));
}
$('play').onclick=async()=>{
  if(!files||busy)return;
  const nameTag=playerName();
  if(lanAccess&&!nameTag){updateStatus('Въведи име и избери герой.');$('player-name').focus();return;}
  busy=true;$('play').disabled=true;updateStatus('Зареждам картата и моделите…');
  try{
    const name=lanAccess?'chuninfinals':$('map').value,id=$('character').value;
    $('hero-portrait').src=files.url('sprites/vgui/'+id+'.png')??'';
    mode=lanAccess?'lan':$('mode').value||'training';
    const [next,root,settings]=await Promise.all([loadMap(files,name),model(id),
      files.bytes('listenserver.cfg').then(b=>parseRules(new TextDecoder().decode(b))).catch(()=>defaults),
      loadJutsuEffects(id,mode!=='lan'&&Number($('bots').value)>0)]);
    if(!baseSpritesLoaded){
      const assets={hit:'taijutsu/Melee_Hit1.spr',poof:'general/Poof.spr',chidori:'jutsus/Chidori_Ball.spr',
        rasenganHit:'jutsus/Rasengan_Hit.spr',chakraFocus:'jutsus/Chakra_Focus.spr',ripple:'fx/Ripples.spr',splash:'fx/Water_Splash.spr',
        smoke:'weapons/Smokebomb.spr',explosion:'general/Explosion.spr',sparks:'general/Sparks1.spr'};
      await Promise.all(Object.entries(assets).map(async ([name,path])=>{
        try{
          const xpr={explosion:'general/Explosion.xpr',poof:'general/Poof.xpr'}[name];
          const sprite=xpr?await loadXpr(files,xpr).catch(()=>loadSprite(files,path)):await loadSprite(files,path);
          if(sprite.frames.length&&!sprites.has(name))sprites.set(name,sprite);
        }
        catch(e){console.warn('NNK sprite',path,e.message);}
      }));
      baseSpritesLoaded=true;
    }
    if(!weaponTrailMap){
      const url=files.url('sprites/weapons/Weapon_Trail.png');
      if(url)weaponTrailMap=await new T.TextureLoader().loadAsync(url).catch(()=>null);
    }
    if(!weaponModels.size){
      await Promise.all(Object.entries(weaponAssets).map(async ([key,path])=>{
        try{weaponModels.set(key,await loadWeaponModel(files,path));}
        catch(e){console.warn('NNK weapon',path,e.message);}
      }));
    }
    if(id==='naruto'&&!weaponModels.has('rasenshuriken')){
      try{
        const {loadVoltageRasenshuriken}=await import('./voltage/voltage-map.js');
        weaponModels.set('rasenshuriken',await loadVoltageRasenshuriken());
      }catch(e){console.warn('NNK Voltage Rasenshuriken',e.message);}
    }
    if(!touch&&!rasenganModel){
      try{rasenganModel=await loadRasengan(files);}catch(e){console.warn('NNK Rasengan',e.message);}
    }
    if(!touch&&id==='naruto'&&!rasenganChargeModel){
      try{rasenganChargeModel=await loadRasengan(files,'Rasen_charge.mdl');}
      catch(e){console.warn('NNK Rasengan charge',e.message);}
    }
    if(!kawarimiLog){
      try{kawarimiLog=await loadKawarimiLog(files);}catch(e){console.warn('NNK Kawarimi',e.message);}
    }
    if(id==='kakashi'&&!pakkun){
      try{pakkun=await loadPakkun(files);}catch(e){console.warn('NNK Pakkun',e.message);}
    }
    rules=settings;
    if(!oriokeModel&&id==='naruto')oriokeModel=await model('orioke');
    if(!oriokeCloud&&id==='naruto'&&files.url('models/jutsus/orioke_clouds/Clouds.png')){
      try{oriokeCloud=await loadOriokeCloud(files);}catch(e){console.warn('NNK Orioke',e.message);}
    }
    const sessionName=nameTag||heroes[id].label;
    const token=mode==='lan'?(lan?.token??Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')):null;
    const join=token?await sendArena({room:name,token,hero:id,name:sessionName,
      position:next.spawns[0].position.toArray(),yaw:0,pose:'idle'}):null;
    const sky=name==='kyuubilair'?null:await loadSky(files,next.sky);
    clearRush();
    endOrioke();
    if(world){scene.remove(world.group);disposeTree(world.group);}
    if(actors){
      for(const e of effects)e.mesh.material.dispose();
      for(const pool of spritePool.values())for(const mesh of pool)mesh.material.dispose();
      spritePool.clear();
      for(const shot of shots){
        if(!shot.model)shot.mesh.material.dispose();
        shot.trail?.material.dispose();
      }
      scene.remove(actors);
    }
    if(scene.background?.isCubeTexture)scene.background.dispose();
    const haze=name==='kyuubilair'?new T.Color(0x202534):
      name.endsWith('_night')?new T.Color(0x28374c):name.endsWith('_dusk')?new T.Color(0xc88e66):skyColor;
    scene.background=sky??haze;scene.fog.color.copy(haze);
    for(const mesh of next.waterMeshes)mesh.material.envMap=sky;
    scene.fog.density=name==='kyuubilair'?.00016:.000095;
    sun.color.copy(next.lighting.color);
    sun.position.copy(next.lighting.direction).multiplyScalar(2200);
    sun.intensity=next.lighting.intensity;
    ambient.color.set(name==='kyuubilair'?0xd8e8ff:name.endsWith('_dusk')?0xffdfc4:0xf6f8ff);
    ambient.groundColor.set(name==='kyuubilair'?0x817573:0xa8a093);
    ambient.intensity=name.endsWith('_night')?1.12:name.endsWith('_dusk')?1.33:name==='kyuubilair'?1.55:1.45;
    next.group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      mesh.receiveShadow=true;
      mesh.castShadow=false;
    });
    world={...next,name};scene.add(next.group);
    const mapAudio=(world.ambience??[]).filter(track=>!track.triggered)
      .map(track=>({url:files.url('sound/'+track.path),gain:clamp(track.gain*.55,0,1)}));
    setBackground(mapAudio.length?mapAudio:[theme()]);
    radarZoom=1;showTouchScore=false;
    radar=makeRadar(renderer,scene,$('radar-map'),world);
    actors=new T.Group();scene.add(actors);actors.add(root);
    player={id,name:join?sessionName:null,root,pos:new T.Vector3(),hp:100,team:0,kills:0,deaths:0,chakra:maxChakra,stamina:100,staminaUsed:-100,ammo:weapons.map(w=>w.ammo),dy:0,ground:false};
    botList=[];effects=[];shots=[];allies=[];orioke=null;score=0;prepared=null;attackUntil=0;focusMode=false;charged=null;heavy=null;healing=null;locked=null;chain=0;lastHit=0;secondaryUntil=0;lastStride=0;
    substitutionLogs=[];pendingThrow=null;focusSprites=[];$('bot-names').replaceChildren();
    player.spawn=join?join.slot%(world.spawns.filter(s=>s.combat).length||world.spawns.length):initialSpawn();
    spawn(player,player.spawn);yaw=T.MathUtils.degToRad(world.spawns[player.spawn].angle);pitch=-.17;cameraDistance=cameraZoom;
    if(lan)clearInterval(lan.timer);
    lan=join?{
      token,peers:new Map(),loading:new Map(),next:0,pending:false,hit:null,name:sessionName
    }:null;
    if(lan){
      player.nameplate=makeNameplate(sessionName,true);
      const match=lan;
      match.timer=setInterval(()=>pollLan(match),25);
    }
    refreshOpponents();
    if(!lan)await addBots(Number($('bots').value));
    if(touch&&(player.id==='naruto'||botList.some(bot=>bot.id==='naruto'))){
      warmRasenganTextures();
      for(const actor of [player,...botList])actor.root.animation('ref_rasengan_knockback_hit');
      const naruto=player.id==='naruto'?player:botList.find(bot=>bot.id==='naruto');
      for(const pose of ['charge','charge_bunshin','ready','thrust','end'])naruto.root.animation('ref_rasengan_'+pose);
    }
    if(renderer.compile){
      renderer.compile(scene,camera);
      const orb=makeTechniqueOrb('Rasengan');
      orb.position.copy(player.pos);
      try{renderer.compile(scene,camera);}finally{removeTechniqueOrb(orb);}
    }
    $('addbots').hidden=!!lan;
    $('hud').hidden=false;$('training').hidden=false;
    battleStarts=mode==='lan'?0:now+.8;
    cinematicUntil=0;pendingRasenshuriken=null;
    $('battle-intro').hidden=!battleStarts;
    $('battle-ready').hidden=false;$('battle-go').hidden=true;
    refreshTech();updateHUD();updateStatus('Тренировъчен мач · F8 отваря менюто.');
    busy=false;resume();
  }catch(e){console.error(e);updateStatus(e.message);busy=false;}
  finally{$('play').disabled=false;}
};
function unlimited(){return mode!=='lan'&&$('free').checked;}
function spendStamina(cost){
  if(unlimited())return true;
  if(player.stamina<cost)return false;
  player.stamina-=cost;player.staminaUsed=now;return true;
}
function dash(code){
  if(now<battleStarts)return false;
  const side=code==='KeyA'||code==='KeyD';
  if(player.wall||player.backflip||(!side&&now<player.dashUntil))return false;
  const cost=side?rules.sv_dodge_stamina_drain/10:rules.sv_dash_stamina_drain;
  if(!spendStamina(cost)){message('Недостатъчно издръжливост');return false;}
  const heading=new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  if(side){
    const axis=new T.Vector3(-heading.z,0,heading.x);
    player.dashUntil=0;player.impulse.addScaledVector(axis,code==='KeyA'?-rules.sv_dodge_speed:rules.sv_dodge_speed);
    playPose(player,code==='KeyA'?'dodge_left':'dodge_right',.32);sound('movement/Dodge.wav');
  }else{
    player.dashUntil=now+.58;
    playPose(player,'dash',.56);sound('movement/Dash.wav');
  }
  return true;
}
function wallContact(position,toward,attached=false,reach=18){
  const angles=[0,-Math.PI/4,Math.PI/4,-Math.PI/2,Math.PI/2];
  const up=new T.Vector3(0,1,0);
  if(world.traceSolid){
    for(const angle of angles){
      const direction=toward.clone().setY(0).normalize().applyAxisAngle(up,angle);
      const edge=(side,vertical)=>{
        const origin=position.clone().addScaledVector(side,vertical);
        return world.traceSolid(origin,origin.clone().addScaledVector(direction,reach+8));
      };
      const center=edge(up,0);
      if(center<.1||center>reach)continue;
      const surface=position.clone().addScaledVector(direction,center+1);
      if(world.noClimb?.(surface)||world.skyBoundary?.(surface)||
         world.hasVisibleWall&&!world.hasVisibleWall(position,direction,center))continue;
      const lower=edge(up,-5),upper=edge(up,5);
      if(!Number.isFinite(attached?lower:upper))continue;
      const tangent=new T.Vector3().crossVectors(up,direction);
      const left=edge(tangent,-5),right=edge(tangent,5);
      const normal=direction.clone().negate();
      if(Number.isFinite(lower)&&Number.isFinite(upper))normal.y=(upper-lower)/10;
      if(Number.isFinite(left)&&Number.isFinite(right))normal.addScaledVector(tangent,(right-left)/10);
      normal.normalize();
      if(Math.abs(normal.y)>.65)continue;
      return {normal,distance:center*-normal.dot(direction)};
    }
    return null;
  }
  for(let distance=14;distance<=38;distance+=4)for(const angle of angles){
    const direction=toward.clone().applyAxisAngle(up,angle);
    const probe=position.clone().addScaledVector(direction,distance);
    if(!world.pointSolid(probe)||world.noClimb?.(probe))continue;
    probe.y+=attached?-8:26;
    if(!world.pointSolid(probe)||world.noClimb?.(probe))continue;
    const tangent=new T.Vector3().crossVectors(up,direction);
    function edge(offset){
      let lo=0,hi=distance+12;
      const sample=position.clone().addScaledVector(tangent,offset);
      if(!world.pointSolid(sample.clone().addScaledVector(direction,hi)))return null;
      for(let step=0;step<8;step++){
        const depth=(lo+hi)/2;
        if(world.pointSolid(sample.clone().addScaledVector(direction,depth)))hi=depth;else lo=depth;
      }
      return hi;
    }
    const left=edge(-7),right=edge(7),center=edge(0);
    const normal=direction.clone().negate();
    if(left!==null&&right!==null)normal.addScaledVector(tangent,(right-left)/14).normalize();
    return {normal,distance:(center??distance)*-normal.dot(direction)};
  }
  return null;
}
function stepOntoLedge(position,wall){
  const up=position.clone(),across=position.clone();
  for(let rise=4;rise<=40;rise+=4){
    up.y=position.y+rise;
    if(world.solid(up))return null;
    let clear=true;
    for(let depth=6;depth<=wall.distance+25;depth+=6){
      across.copy(up).addScaledVector(wall.normal,-depth);
      if(world.solid(across)){clear=false;break;}
    }
    if(!clear)continue;
    const support=across.clone();
    for(let drop=1;drop<=16;drop++){
      support.y=across.y-drop;
      if(world.solid(support))return support.add(new T.Vector3(0,1,0));
    }
  }
  return null;
}
function jumpPlayer(){
  if(now<battleStarts)return;
  const back=movingKey('KeyS')&&!movingKey('KeyW');
  if(back&&!player.backflip&&!player.wallKickUsed&&now>=(player.wallLock??0)){
    const toward=new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const wall=player.wall??wallContact(player.pos,toward,true,32)??wallContact(player.pos,toward.negate(),true,32);
    if(wall&&wall.distance<=32&&spendStamina(rules.sv_backflip_stamina_drain)){
      player.backflip=true;player.wallKickUsed=true;player.wall=null;player.wallLock=now+.6;
      player.ground=false;player.airJump=true;player.waterWalk=false;player.dashUntil=0;
      player.flipDirection=wall.normal.clone().setY(0).normalize();
      player.flipFacing=player.flipDirection.clone().negate();player.impulse.set(0,0,0);
      player.dy=rules.sv_w_jumpheight*.62;
      playPose(player,'dodge_backflip',player.dy*2/780);sound('movement/Wall_Jump.wav');return;
    }
  }
  if(player.wall){
    if(!spendStamina(rules.sv_d_jumpheight_stamina_drain))return;
    player.impulse.addScaledVector(player.wall.normal,340);
    player.wall=null;player.wallLock=now+.5;
    player.dy=rules.sv_w_jumpheight;player.airJump=true;player.ground=false;
    playPose(player,'jump_wall',.62);sound('movement/Wall_Jump.wav');return;
  }
  if(!player.waterWalk&&world.water(player.pos)){player.dy=200;return;}
  if(player.ground||player.waterWalk){
    if(!spendStamina(back?rules.sv_backflip_stamina_drain:rules.sv_jumpheight_stamina_drain))return;
    player.waterWalk=false;player.ground=false;player.airJump=false;player.dashUntil=0;
    player.dy=back?rules.sv_jumpheight*.58:rules.sv_jumpheight;
    if(back){
      player.backflip=true;
      player.flipDirection=new T.Vector3(-Math.cos(yaw),0,Math.sin(yaw));
      player.flipFacing=player.flipDirection.clone().negate();
      player.impulse.set(0,0,0);
    }
    playPose(player,back?'dodge_backflip':'jump',back?player.dy*2/780:.35);
    sound(back?'movement/Backflip.wav':'movement/Jump.wav');
  }else if(!player.backflip&&!player.airJump&&spendStamina(rules.sv_d_jumpheight_stamina_drain)){
    const direction=new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const nearWall=wallContact(player.pos,direction);
    player.dy=nearWall?rules.sv_w_jumpheight:rules.sv_d_jumpheight;player.airJump=true;
    if(nearWall){
      player.impulse.addScaledVector(nearWall.normal,340);
      player.wallLock=now+.5;
    }
    playPose(player,nearWall?'jump_wall':keys.has('KeyS')?'jump_spin_backward':'jump_spin',.62);
    sound(nearWall?'movement/Wall_Jump.wav':'movement/Jump_Spin.wav');
  }
}
function move(entity,dx,dz,dt){
  if(entity.impulse){dx+=entity.impulse.x*dt;dz+=entity.impulse.z*dt;entity.impulse.multiplyScalar(Math.exp(-7*dt));}
  const canStep=entity.ground||entity.waterWalk||entity.dy<=0&&world.solid(entity.pos.clone().add(new T.Vector3(0,-3,0)));
  if(!entity.wall&&!entity.waterWalk)entity.dy=world.water(entity.pos)?Math.max(-42,entity.dy-155*dt):Math.max(-950,entity.dy-780*dt);
  const amount=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz),Math.abs(entity.dy*dt))/8));
  entity.ground=false;
  for(let i=0;i<amount;i++){
    let stepX=dx/amount,stepZ=dz/amount;
    if(world.traceSolid&&entity.wall&&entity.dy){
      goal.copy(entity.pos).add(new T.Vector3(stepX,entity.dy*dt/amount,stepZ));
      if(!world.solid(goal)){entity.pos.copy(goal);continue;}
    }
    if(stepX&&stepZ){
      goal.copy(entity.pos);goal.x+=stepX;goal.z+=stepZ;
      if(!world.solid(goal)){entity.pos.copy(goal);stepX=stepZ=0;}
    }
    for(const [axis,delta] of [['x',stepX],['z',stepZ],['y',entity.dy*dt/amount]]){
      if(!delta)continue;
      goal.copy(entity.pos);goal[axis]+=delta;
      const hitRoof=axis==='y'&&delta>0&&world.roofDistance?.(
        entity.pos.clone().add(new T.Vector3(0,27,0)),goal.clone().add(new T.Vector3(0,27,0)))<Infinity;
      if(!world.solid(goal)&&!hitRoof)entity.pos.copy(goal);
      else if(axis==='y'){entity.ground=delta<0;entity.dy=0;if(entity.ground)entity.airJump=false;}
      else if(!entity.wall&&canStep&&entity.dy<=0){
        for(const height of [4,8,12,18]){
          const raised=entity.pos.clone().add(new T.Vector3(0,height,0));
          goal.y=raised.y;
          if(world.solid(raised)||world.roofDistance?.(entity.pos,raised)<Infinity)break;
          if(world.solid(goal))continue;
          const landing=goal.clone();
          for(let step=0;step<height;step++){
            landing.y-=1;
            if(world.solid(landing)){landing.y+=1;break;}
          }
          if(landing.y>entity.pos.y){entity.pos.copy(landing);entity.ground=true;break;}
        }
      }
    }
  }
  if(canStep&&!entity.ground&&!entity.wall&&!entity.waterWalk&&entity.dy<0&&(dx||dz)){
    for(let drop=1;drop<=12;drop++){
      goal.copy(entity.pos);goal.y-=drop;
      if(!world.solid(goal))continue;
      entity.pos.y=goal.y+1;entity.ground=true;entity.dy=0;entity.airJump=false;break;
    }
  }
  for(const t of world.teleports)if(now>=(entity.teleportUntil??0)&&t.contains(entity.pos)){
    goal.copy(t.to);for(let n=0;n<12&&world.solid(goal);n++)goal.y+=4;
    if(!world.solid(goal)){entity.pos.copy(goal);entity.dy=0;entity.teleportUntil=now+.4;}break;
  }
  if(entity.pos.y<-3000)spawn(entity,0);
  if(world.solid(entity.pos)&&entity.safePosition&&!world.solid(entity.safePosition)){
    entity.pos.copy(entity.safePosition);entity.dy=0;entity.impulse?.set(0,0,0);
  }
  if(!world.solid(entity.pos))(entity.safePosition??=entity.pos.clone()).copy(entity.pos);
  if(entity.ground)entity.wallKickUsed=false;
}
function playPose(actor,name,duration,fit=false){
  const clip=actor.root.animation(name);
  if(!clip)return;
  actor.pose={name,until:now+(duration??clip.duration),serial:(actor.poseSerial??0)+1};
  if(fit&&duration)actor.pose.playbackDuration=duration;
  actor.poseSerial=actor.pose.serial;
}
function animate(actor,name,dt){
  if(!actor.mixer)actor.mixer=new T.AnimationMixer(actor.root);
  const pose=actor.pose&&now<actor.pose.until?actor.pose:null;
  const clip=actor.root.animation(pose?.name??name)??actor.root.animation('idle');
  if(clip&&(actor.action?.getClip()!==clip||actor.playingPose!==(pose?.serial??0))){
    const previous=actor.action;
    const action=actor.mixer.clipAction(clip).reset();
    action.setDuration(pose?.playbackDuration??clip.duration);
    action.setLoop(pose?T.LoopOnce:T.LoopRepeat,pose?1:Infinity);
    action.clampWhenFinished=!!pose;action.play();
    if(previous&&previous!==action)action.crossFadeFrom(previous,pose?.name.startsWith('dodge')?.035:.09,false);
    actor.action=action;actor.playingPose=pose?.serial??0;
    actor.actionVersion=(actor.actionVersion??0)+1;
  }
  actor.mixer.update(dt);
}
const wallBasis=new T.Matrix4(),wallTangent=new T.Vector3();
function face(actor,direction){
  setActorScale(actor.root);
  const nativeFeet=world.traceSolid?actor.root.userData.nativeFeet:undefined;
  if(nativeFeet===undefined&&actor.ground&&!actor.waterWalk&&(!actor.floorProbe||actor.floorProbe.distanceToSquared(actor.pos)>16)){
    (actor.floorProbe??=actor.pos.clone()).copy(actor.pos);
    const y=world.floorY(actor.pos);
    if(y!==null)actor.feetOffset=actor.pos.y-y;
  }
  actor.root.position.copy(actor.pos);
  if(actor.wall){
    const normal=actor.wall.normal,up=actor.wall.heading??new T.Vector3(0,1,0);
    if(up.lengthSq()<.01)up.set(0,1,0);
    const tangent=wallTangent.crossVectors(up,normal);
    const basis=wallBasis.makeBasis(up,normal,tangent);
    actor.root.quaternion.setFromRotationMatrix(basis);
    actor.root.position.addScaledVector(normal,-actor.wall.distance+3);
  }else{
    actor.root.position.y+=nativeFeet===undefined?1-actor.feetOffset:-nativeFeet;
    actor.root.rotation.set(0,Math.atan2(-direction.z,direction.x),0);
  }
}
const spritePool=new Map();
function releaseVisual(effect){
  actors.remove(effect.mesh);
  const pool=effect.pool;
  if(pool&&pool.length<4)pool.push(effect.mesh);
  else effect.mesh.material.dispose();
}
function visual(pos,color,size=16,ttl=.5,name,spriteOnly=false){
  if(effects.length>90)return;
  const sprite=sprites.get(name)??(name==='chakraGlow'?sprites.get('chakraFocus'):null);
  if(!sprite&&spriteOnly)return;
  let pool,mesh;
  if(sprite){
    if(!spritePool.has(name))spritePool.set(name,[]);
    pool=spritePool.get(name);
    mesh=pool.pop()??new T.Sprite(new T.SpriteMaterial({transparent:true,depthWrite:false}));
    mesh.material.map=sprite.frames[0];
    mesh.material.color.setHex(name==='chakraGlow'?color:0xffffff);
    mesh.material.blending=sprite.additive||name==='chakraGlow'||name==='chakraFocus'?T.AdditiveBlending:T.NormalBlending;
    mesh.material.opacity=1;
  }else mesh=new T.Mesh(fxGeo,new T.MeshBasicMaterial({color,transparent:true,opacity:.87}));
  mesh.position.copy(pos);mesh.scale.setScalar(sprite?size*2.6:size);actors.add(mesh);
  effects.push({mesh,ttl,left:ttl,size,sprite,pool});
}
function damage(bot,n,source=player){
  if(bot.dead)return;
  if(bot.kind){
    bot.hp-=n;
    if(bot.hp<=0){
      bot.dead=true;bot.ttl=0;
      if(mode==='training'&&bot.kind==='clone')dropSubstitutionLog(bot);
    }else playPose(bot,'hit1',.28);
    return;
  }
  if(bot.remote){
    if(source===player&&lan){
      lan.hit={target:bot.remote,damage:clamp(n,0,65)};
      visual(bot.pos,0xff9b44,16,.32,'hit');
    }
    return;
  }
  sound('taijutsu/Hit_1.wav',.26);
  bot.hp-=n;if(bot.hp>0)playPose(bot,bot.ground?'hit1':'air_hit1',.28);visual(bot.pos.clone().add(new T.Vector3(0,12,0)),0xff9b44,16,.32,'hit');
  if(bot.hp<=0){playPose(bot,bot.ground?'die_simple':'die_fall');bot.dead=now+3.2;bot.deaths++;source.kills++;if(source===player){score++;message('Победен бот');}}
}
function dropSubstitutionLog(actor){
  if(!kawarimiLog)return;
  const root=cloneSkeleton(kawarimiLog);
  root.animation=kawarimiLog.animation;
  root.scale.setScalar(world.traceSolid?1:2);
  root.position.copy(actor.pos);
  root.position.y=world.floorY(actor.pos)??actor.root.position.y;
  root.rotation.y=actor.root.rotation.y;
  actors.add(root);
  const log={root,until:now+10};
  playPose(log,'drop',10);
  substitutionLogs.push(log);
  if(substitutionLogs.length>8){
    const oldest=substitutionLogs.shift();
    oldest.mixer?.stopAllAction();actors.remove(oldest.root);
  }
  sound('jutsu/Kawarimi_Drop.wav',.3);
}
function aim(){
  return new T.Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.sin(yaw)*Math.cos(pitch));
}
function toggleTarget(){
  if(locked){locked=null;return;}
  const dir=aim(),options=opponents().filter(b=>{
    const delta=b.pos.clone().sub(player.pos),d=delta.length();
    return !b.dead&&enemies(player,b)&&d>0&&d<rules.sv_target_range&&delta.multiplyScalar(1/d).dot(dir)>.57&&visibleBetween(player.pos,b.pos);
  });
  options.sort((a,b)=>a.pos.distanceToSquared(player.pos)-b.pos.distanceToSquared(player.pos));
  locked=options[0]??null;lockLost=0;
}
function melee(range,amount,spread=.35){
  const dir=aim();
  for(const bot of opponents()){
    const d=bot.pos.clone().sub(player.pos),length=d.length();
    if(enemies(player,bot)&&length<range&&length>0&&d.multiplyScalar(1/length).dot(dir)>spread&&visibleBetween(player.pos,bot.pos))damage(bot,amount);
  }
}
function strikeTarget(strongAttack){
  const secondary=Boolean(strongAttack);
  const dir=aim();
  const hits=opponents().filter(bot=>{
    const delta=bot.pos.clone().sub(player.pos),distance=delta.length();
    return !bot.dead&&enemies(player,bot)&&distance>0&&distance<(secondary?108:98)&&delta.normalize().dot(dir)>.42&&visibleBetween(player.pos,bot.pos);
  }).sort((a,b)=>a.pos.distanceToSquared(player.pos)-b.pos.distanceToSquared(player.pos));
  const bot=hits[0];
  const next=now-lastHit<.87?(chain%5)+1:1;
  const kick=keys.has('KeyS')||keys.has('KeyA')||keys.has('KeyD');
  if(!secondary){
    player.swingIndex=now-player.lastSwing<.9?player.swingIndex%5+1:1;
    player.lastSwing=now;
    playPose(player,(!player.ground?'air_attack':kick?'kick':'punch')+player.swingIndex,.36);
  }
  if(!bot){sound('taijutsu/Miss_1.wav',.28);return;}
  chain=secondary?0:now-lastHit<.87?(chain%5)+1:1;lastHit=now;
  const hit=strike(rules,{secondary,airborne:!player.ground,chain,guarded:now<(bot.guard??0)});
  damage(bot,hit.damage);
  bot.stun=now+hit.stun;
  if(!bot.dead)playPose(bot,secondary?strongAttack+'_hit':bot.ground?'hit'+(next%3+1):'air_hit'+(next%3+1),.42);
  if(hit.knockback){
    bot.impulse.addScaledVector(dir,hit.knockback);
    if(secondary)bot.dy=Math.max(bot.dy,hit.knockback*.48);
  }
  if(chain===5)attackUntil=now+rules.sv_final_swing_delay;
  if(chain>1)message(chain+' удара');
}
function projectile(dir,color,damageAmount,owner=player,speed=660,radius=0,kind='bolt'){
  const prototype=weaponModels.get(kind);
  const flame=sprites.get(kind==='fire'?'fireball':kind==='volley'?'volley':'');
  const mesh=prototype?new T.Group():flame?
    new T.Sprite(new T.SpriteMaterial({map:flame.frames[0],transparent:true,depthWrite:false,blending:T.AdditiveBlending})):
    new T.Mesh(fxGeo,new T.MeshBasicMaterial({color}));
  const rasenshuriken=kind==='rasenshuriken';
  const thrown=rasenshuriken||weapons.some(weapon=>weapon.id===kind);
  let mixer;
  if(prototype){
    const model=rasenshuriken?cloneSkeleton(prototype):prototype.clone(true);
    mesh.add(model);
    if(rasenshuriken&&prototype.animations.length){
      mixer=new T.AnimationMixer(model);
      mixer.clipAction(prototype.animations[0]).play();
    }
    const visibleSize=rasenshuriken?48:kind==='shuriken'?17:kind==='kunai'||kind==='tagkunai'?19:12;
    mesh.scale.setScalar(visibleSize/prototype.userData.weaponSize);
  }
  else mesh.scale.setScalar(flame?(kind==='fire'?55:32):thrown?7:11);
  const grenade=kind==='smoke'||kind==='tag';
  const velocity=dir.clone().multiplyScalar(speed);
  if(grenade)velocity.y+=145;
  const actorScale=visualScale(owner.root);
  mesh.position.copy(owner.pos);
  const hand=thrown&&owner.root.sockets?.RHand;
  const launch=hand?hand.getWorldPosition(new T.Vector3()).addScaledVector(dir,13*actorScale):
    owner.pos.clone().addScaledVector(dir,28*actorScale).add(new T.Vector3(0,10*actorScale,0));
  if(visibleBetween(owner.pos,launch))mesh.position.copy(launch);
  if(prototype&&kind!=='shuriken'&&!rasenshuriken)mesh.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),dir);
  const shot={mesh,velocity,ttl:grenade?1.45:1.7,damage:damageAmount,owner,radius,kind,
    model:!!prototype,grenade,stuck:false,mixer,flame};
  if(thrown){
    shot.trail=new T.Mesh(rippleGeo,new T.MeshBasicMaterial({
      map:weaponTrailMap,color:grenade?0xffcd98:0xcbeaff,side:T.DoubleSide,
      transparent:true,depthWrite:false,blending:T.AdditiveBlending,opacity:.8
    }));
    shot.trail.userData.weaponTrail=true;
    actors.add(shot.trail);updateWeaponTrail(shot);
  }
  shots.push(shot);actors.add(mesh);
}
function updateWeaponTrail(shot){
  const trail=shot.trail;
  if(!trail)return;
  trail.visible=shot.ttl>0&&!shot.stuck&&shot.velocity.lengthSq()>25;
  if(!trail.visible)return;
  const length=clamp(shot.velocity.length()*.07,17,78);
  const axis=shot.velocity.clone().normalize();
  trail.position.copy(shot.mesh.position).addScaledVector(axis,-length*.56);
  const view=camera.position.clone().sub(trail.position).normalize();
  const across=new T.Vector3().crossVectors(view,axis);
  if(across.lengthSq()<.001)across.crossVectors(new T.Vector3(0,1,0),axis);
  if(across.lengthSq()<.001)across.set(0,0,1);
  across.normalize();
  trail.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(axis,across,new T.Vector3().crossVectors(axis,across)));
  trail.scale.set(length,shot.grenade?5:7,1);
}
function quickFire(){
  if(now<battleStarts)return;
  if(world.releaseSeal?.(player.pos)){message('Печатът се освобождава · 4 сек.');return;}
  if(now<attackUntil||charged||rush||heavy||pendingThrow||orioke)return;
  const weapon=weapons[weaponIndex];
  if(!unlimited()&&!player.ammo[weaponIndex]){message('Няма '+weapon.label);return;}
  if(!unlimited())player.ammo[weaponIndex]--;
  const pose={kunai:'ref_shoot_kunai',shuriken:'ref_shoot_shuriken2',tagkunai:'ref_shoot_explodingtag',
    smoke:'ref_shoot_smokebomb',tag:'ref_stick_explodingtag'}[weapon.id];
  const duration=player.root.animation(pose)?.duration??.35;
  attackUntil=now+duration;
  playPose(player,pose,duration);
  pendingThrow={weapon,at:now+duration*.35};
  updateHUD();
}
function releaseThrow(weapon){
  const dir=aim();
  if(weapon.id==='shuriken'){
    sound('weapons/Shuriken_Throw.wav');
    projectile(dir,0xbbc2c9,rules.sv_shuriken_dmg,player,rules.sv_shuriken_speed,0,'shuriken');
  }else if(weapon.id==='smoke'){
    sound('weapons/Smokebomb_Throw.wav');projectile(dir,0x8e9796,0,player,510,110,'smoke');
  }else if(weapon.id==='tag'||weapon.id==='tagkunai'){
    sound('weapons/Exploding_Tag.wav');projectile(dir,0xffa14e,rules.sv_exploding_tag_dmg,player,weapon.id==='tag'?360:rules.sv_kunai_speed,rules.sv_exploding_tag_dmg_radius,weapon.id);
  }else{
    sound('weapons/Kunai_Throw.wav');projectile(dir,0xd6e0dd,rules.sv_kunai_dmg,player,rules.sv_kunai_speed,0,'kunai');
  }
  updateHUD();
}
function clearRush(){
  rush=null;
  if(chargeClone){chargeClone.mixer?.stopAllAction();actors?.remove(chargeClone.root);chargeClone=null;}
  if(techniqueOrb){
    removeTechniqueOrb(techniqueOrb);techniqueOrb=null;
  }
}
function removeTechniqueOrb(orb){
  orb.effectMixer?.stopAllAction();orb.chargeMixer?.stopAllAction();
  actors?.remove(orb);orb.userData.aura?.material.dispose();orb.material?.dispose();
}
function makeTechniqueOrb(label){
  const rasengan=label==='Rasengan';
  const orb=rasengan?(rasenganModel?cloneSkeleton(rasenganModel):new T.Group()):new T.Mesh(fxGeo,new T.MeshBasicMaterial({
    color:label==='Rasengan'?0x9ee5ff:0xd8f4ff,transparent:true,
    blending:T.AdditiveBlending,depthWrite:false,opacity:.88
  }));
  if(label==='Rasengan'&&rasenganModel?.animations.length){
    orb.effectMixer=new T.AnimationMixer(orb);
    orb.effectMixer.clipAction(rasenganModel.animations[0]).play();
  }
  if(label==='Rasengan'){
    const core=new T.Mesh(rasenganCoreGeometry,rasenganCoreMaterial);
    core.renderOrder=2;orb.add(core);
  }
  if(label==='Rasengan'&&rasenganChargeModel&&charged){
    const shell=cloneSkeleton(rasenganChargeModel);
    shell.scale.setScalar(1.45);orb.add(shell);orb.chargeShell=shell;
    orb.chargeMixer=new T.AnimationMixer(shell);
    for(const clip of rasenganChargeModel.animations)orb.chargeMixer.clipAction(clip).play();
  }
  const energy=label==='Rasengan'?sprites.get('rasenBase'):null;
  if(energy){
    const aura=new T.Sprite(new T.SpriteMaterial({
      map:energy.frames[0],color:0x83ddff,transparent:true,
      blending:T.AdditiveBlending,depthWrite:false,opacity:touch?.52:.35
    }));
    aura.scale.setScalar(1.95);orb.add(aura);orb.userData.aura=aura;
  }
  actors.add(orb);return orb;
}
function positionTechniqueOrb(orb,actor,size,direction,dt){
  rasenganCoreMaterial.uniforms.time.value=now;
  const scale=visualScale(actor.root);
  const hand=actor.root.sockets?.RHand;
  if(hand)hand.getWorldPosition(orb.position);
  else orb.position.copy(actor.pos).addScaledVector(direction,24*scale);
  if(charged&&actor===player&&actor.root.sockets?.LHand){
    const left=actor.root.sockets.LHand.getWorldPosition(new T.Vector3());
    if(left.distanceToSquared(orb.position)<(32*scale)**2)orb.position.lerp(left,.32);
  }
  orb.position.addScaledVector(direction,(hand?7:12)*scale);
  orb.position.y+=(hand?2:5)*scale;
  const aura=orb.userData.aura,energy=sprites.get('rasenBase');
  if(aura&&energy)aura.material.map=energy.frames[Math.floor(now*22)%energy.frames.length];
  if(orb.effectMixer)orb.effectMixer.update(dt);
  else orb.rotation.set(0,now*12,now*8);
  if(orb.chargeShell){orb.chargeShell.visible=Boolean(charged);if(charged)orb.chargeMixer.update(dt);}
  orb.scale.setScalar(size*scale*(1+.025*Math.sin(now*44)));
}
function updateTechnique(dt){
  if(charged){
    const elapsed=now-charged.start,rasengan=charged.skill[0]==='Rasengan';
    if(rasengan&&elapsed>=.55&&!charged.ready){
      charged.ready=true;
      sound('jutsu/Rasengan_Ready.wav');
    }
    if(rasengan){
      if(!chargeClone){
        const root=cloneSkeleton(player.root);
        root.animation=player.root.animation;root.animations=player.root.animations;
        actors.add(root);chargeClone={root,animDt:0};
        playPose(chargeClone,'ref_rasengan_charge_bunshin');
        visual(player.pos.clone().addScaledVector(right,20*visualScale(player.root)),0xc7d5db,13,.3,'poof');
      }
      chargeClone.root.position.copy(player.root.position);
      const approach=elapsed<.24?20*(1-elapsed/.24):0;
      const position=player.pos.clone().addScaledVector(right,approach*visualScale(player.root));
      if(!world.solid(position))chargeClone.root.position.addScaledVector(right,approach*visualScale(player.root));
      chargeClone.root.rotation.copy(player.root.rotation);
      chargeClone.animDt+=dt;
      if(!touch||!chargeClone.mixer||chargeClone.animDt>=1/30){
        animate(chargeClone,'ref_rasengan_charge_bunshin',chargeClone.animDt);
        chargeClone.animDt=0;
      }
    }else if(chargeClone){
      actors.remove(chargeClone.root);chargeClone=null;
    }
    if(elapsed>=1.6||charged.releaseAt!==undefined&&now>=charged.releaseAt)releaseCharge(true);
  }
  if(!charged&&chargeClone){actors.remove(chargeClone.root);chargeClone.mixer?.stopAllAction();chargeClone=null;}
  if(!rush&&!charged){clearRush();return;}
  const label=rush?.label??charged.skill[0];
  if(!techniqueOrb)techniqueOrb=makeTechniqueOrb(label);
  const direction=rush?.direction??forward;
  positionTechniqueOrb(techniqueOrb,player,rush?24:10+Math.min(16,(now-charged.start)*23),direction,dt);
  if(label!=='Rasengan'&&now>=(player.jutsuFxAt??0)){
    player.jutsuFxAt=now+.09;
    visual(techniqueOrb.position,0xc3eaff,rush?20:15,.24,'chidoriBolts');
    if(sprites.has('chidoriCore'))visual(techniqueOrb.position,0xb7edff,12,.16,'chidoriCore');
  }
  if(!rush)return;
  for(const bot of opponents()){
    if(bot.dead||!enemies(player,bot)||rush.hit.has(bot)||
       techniqueOrb.position.distanceToSquared(bot.pos)>55**2||!visibleBetween(player.pos,bot.pos))continue;
    rush.hit.add(bot);damage(bot,rush.damage);
    if(label==='Rasengan'){
      sound('jutsu/Rasengan_Hit.wav');
      if(sprites.has('rasenShockwave'))visual(techniqueOrb.position,0xc0edff,24*visualScale(player.root),.38,'rasenShockwave');
      if(!bot.dead)playPose(bot,'ref_rasengan_knockback_hit',.85);
      bot.impulse.addScaledVector(direction,220);
    }else{
      sound('jutsu/Chidori_Hit.wav');
      if(!bot.dead)playPose(bot,'ref_chidori_stun_hit',.65);
    }
    visual(bot.pos,0x98deff,34,.45,label==='Rasengan'?'rasenganHit':'chidoriHit');
  }
}
function releaseCharge(force=false){
  if(!charged)return;
  const {skill,start}=charged;
  const windup=skill[0]==='Rasengan'?.64:.32;
  if(!force&&now<start+windup){charged.releaseAt=start+windup;return;}
  charged=null;
  const minimum=skill[0]==='Rasengan'?rules.sv_rasengan_charge_time:.15;
  const duration=clamp(now-start,minimum,Math.max(minimum,1.6));
  cast(skill,duration);attackUntil=now+.65;
}
function releaseHeavy(){
  const {direction}=heavy;heavy=null;
  secondaryUntil=now+rules.sv_secondary_cooldown;attackUntil=now+rules.sv_secondary_swing_delay;
  playPose(player,direction+'3',.48);
  if(direction==='forward_strong')player.impulse.addScaledVector(aim(),rules.sv_swing_forward_move);
  strikeTarget(direction);
}
function attack(secondary){
  if(now<battleStarts)return;
  if(charged||rush||heavy||pendingThrow||keys.has('KeyQ')||keys.has('MouseBlock'))return;
  if(now<attackUntil&&!prepared)return;
  if(prepared?.[2]==='rush'&&secondary){message(prepared[0]+' · ляв бутон или Enter');return;}
  if(secondary&&(now<secondaryUntil||!spendStamina(rules.sv_secondary_stamina_drain)))return;
  if(prepared){
    if(prepared[2]==='rush'){
      player.pose=null;
      charged={skill:prepared,start:now};sound(prepared[0]==='Rasengan'?'jutsu/Rasengan_Charge.wav':'jutsu/Chidori_Loop.wav');
      message(prepared[0]+(touch?' · пусни иконката за атака':' · пусни бутона за атака'));
    }else{cast(prepared,0,secondary);attackUntil=now+.5;}
    return;
  }
  if(secondary){
    const direction=keys.has('KeyW')?'forward_strong':'up_strong';
    heavy={direction,start:now};playPose(player,direction+'1',.4);
    return;
  }
  attackUntil=now+rules.sv_primary_swing_delay;
  strikeTarget(false);
}
function cast(skill,charge=0,secondary=false){
  const [label,,type]=skill;
  const costs={rasenshuriken:3600,fire:rules.sv_katon_gouk_chakra_consumption,volley:rules.sv_katon_housenka_chakra_consumption,
    heal:rules.sv_healing_chakra_consumption,stun:rules.sv_orioke_chakra_consumption,
    boost:secondary?rules.sv_focus_strength_kick_chakra_consumption:rules.sv_focus_strength_punch_chakra_consumption,summon:rules.sv_pakkun_chakra_consumption,
    clone:label==='Bunshin'?rules.sv_bunshin_chakra_consumption:rules.sv_kagebunshin_chakra_consumption,
    rush:Math.round(charge*1000*(label==='Rasengan'?rules.sv_rasengan_charge_chakra_consumption:rules.sv_chidori_charge_chakra_consumption))};
  const cost=costs[type];
  if(!unlimited()&&player.chakra<cost){message('Недостатъчно чакра');return;}
  if(!unlimited())player.chakra-=cost;
  prepared=null;message(label+'!');showJutsuCutIn(label);
  const pose={rasenshuriken:'ref_shoot_shuriken',fire:player.ground?'ref_gouk_shoot':'air_gouk_shoot',volley:'ref_hous_shoot',
    rush:label==='Rasengan'?'ref_rasengan_thrust':'ref_chidori_thrust',heal:'ref_seal_heal',boost:secondary?'ref_powerkick_start':'ref_powerpunch',
    summon:'ref_tsuiga',stun:'jutsu_seal_idle',clone:label==='Bunshin'?'jutsu_seal_idle':'ref_seal_kagebunshin'}[type];
  if(pose)playPose(player,pose);
  const dir=aim(),color=heroes[player.id].color;
  const sounds={fire:'Gouk_Shoot',volley:'Hous_Shoot',heal:'Heal_Loop',stun:'Orioke',boost:'Power_Punch',
    clone:'Kagebunshin_Spawn',summon:'Pakkun_Spawn',rush:label==='Rasengan'?'Rasengan_Spin':'Chidori_Loop'};
  if(sounds[type])sound('jutsu/'+sounds[type]+'.wav');
  if(type==='rasenshuriken'){
    sound('jutsu/Rasengan_Spin.wav');
    visual(player.pos.clone().addScaledVector(dir,26),0x9bdfff,16,.27,'rasenCharge');
    pendingRasenshuriken={at:now+.18,direction:dir};
  }else if(type==='fire'||type==='volley'){
    const burst=type==='volley';
    visual(player.pos.clone().addScaledVector(dir,38),0xff7133,26,.34,'fireStart');
    for(const offset of burst?[-.13,0,.13]:[0]){
      projectile(dir.clone().applyAxisAngle(new T.Vector3(0,1,0),offset),0xff6637,
        burst?rules.sv_katon_housenka_dmg:rules.sv_katon_gouk_dmg,player,
        burst?rules.sv_katon_housenka_speed:rules.sv_katon_gouk_speed,
        burst?rules.sv_katon_housenka_radius:rules.sv_katon_gouk_radius,burst?'volley':'fire');
    }
  }else if(type==='rush'){
    dir.y=0;dir.normalize();
    clearRush();
    if(label==='Rasengan')sound('player/naruto/Rasengan.wav');
    rush={direction:dir,speed:500+charge*210,end:now+.62,damage:18+charge*16,label,hit:new Set()};
  }else if(type==='heal'){
    healing={left:rules.sv_healing_recover_count,next:now};visual(player.pos,0x9af99b,25,.8,'heal');
    visual(player.pos.clone().add(new T.Vector3(0,42,0)),0x9af99b,16,.75,'healKanji');
  }else if(type==='stun'){
    if(orioke)endOrioke();
    const originalRoot=player.root;
    const transformed=cloneSkeleton(oriokeModel);
    transformed.animation=oriokeModel.animation;transformed.animations=oriokeModel.animations;
    transformed.position.copy(originalRoot.position);transformed.quaternion.copy(originalRoot.quaternion);
    actors.remove(originalRoot);actors.add(transformed);
    player.root=transformed;player.mixer=null;player.action=null;player.pose=null;
    const cloud=oriokeCloud&&cloneSkeleton(oriokeCloud);
    const cloudMixer=cloud&&new T.AnimationMixer(cloud),cloudMaterials=[];
    const duration=rules.sv_orioke_change_time;
    if(cloud){
      cloud.scale.setScalar(world.traceSolid?1:2);
      cloud.traverse(mesh=>{
        if(mesh.isSkinnedMesh){mesh.material=mesh.material.clone();cloudMaterials.push(mesh.material);}
      });
      cloudMixer.clipAction(oriokeCloud.animation('idle')).setLoop(T.LoopOnce,1).setDuration(duration).play();
      actors.add(cloud);
    }
    orioke={start:now,end:now+duration,originalRoot,cloud,cloudMixer,cloudMaterials,hit:new Set()};
    playPose(player,'ref_control_orioke',duration,true);
    visual(player.pos,0xf4e6df,26,.55,'poof');
  }else if(type==='boost'){
    visual(player.pos,0x83c8ff,22,.55,'boost');
    if(secondary){
      player.powerKickAt=now+.24;
    }else{
      melee(145,rules.sv_focus_strength_punch_damage,.2);
      visual(player.pos.clone().addScaledVector(dir,70),0xffb5a5,38,.7,'powerHit');
    }
  }else{
    const summon=type==='summon',original=summon&&pakkun?pakkun:player.root;
    if(summon)visual(player.root.position,0x333333,35,.65,'summon');
    const offsets=summon||label==='Bunshin'?[46]:[-46,46];
    const previous=allies.findIndex(ally=>ally.kind===type);
    if(previous!==-1){
      allies=allies.filter(ally=>{
        if(ally.kind!==type)return true;
        actors.remove(ally.mesh);ally.mixer?.stopAllAction();return false;
      });
    }
    for(const offset of offsets){
      const pos=player.pos.clone().addScaledVector(right,offset);
      if(world.solid(pos))pos.copy(player.pos).addScaledVector(forward,38);
      if(world.solid(pos))pos.copy(player.pos);
      const mesh=cloneSkeleton(original);mesh.animation=original.animation;mesh.animations=original.animations;
      const ally={mesh,root:mesh,pos,kind:type,team:player.team,hp:summon?30:10,dy:0,feetOffset:player.feetOffset,ttl:summon?rules.sv_pakkun_time_pakkunlives:10,
        next:now+.15,damage:summon?rules.sv_pakkun_dmg:rules.sv_kagebunshin_dmg,route:[],replan:0,scanAt:now+(offset>0?.08:0)};
      actors.add(mesh);allies.push(ally);face(ally,forward);
      visual(pos,color,24,.65,'poof');
    }
    if(label==='Kage Bunshin')sound('player/'+player.id+'/Kagebunshin.wav');
  }
  updateHUD();
}
function hurtPlayer(damage,source){
  if(source&&(keys.has('KeyQ')||keys.has('MouseBlock'))){
    const offset=source.pos.clone().sub(player.pos).normalize();
    if(offset.dot(aim())>.05&&spendStamina(damage*rules.sv_block_stamina_drain)){
      damage*=rules.sv_block_dmg_percent;sound('taijutsu/Block_1.wav');
    }
  }
  player.hp-=damage;
  if(damage>0){
    if(!orioke)playPose(player,player.ground?'hit1':'air_hit1',.24);
    if(source&&sprites.has('hit'))visual(player.pos,0xffffff,17*visualScale(player.root),.26,'hit');
  }
  if(player.hp<=0){
    pendingThrow=null;
    pendingRasenshuriken=null;
    player.deaths++;if(source&&!source.remote)source.kills++;
    spawn(player,player.spawn);player.chakra=maxChakra;player.stamina=100;heavy=null;
    player.ammo=weapons.map(w=>w.ammo);charged=null;prepared=null;healing=null;chain=0;locked=null;
    message('Връщаш се в арената');
  }
}
function visibleBetween(a,b,body=false){
  const delta=b.clone().sub(a), sample=a.clone(), steps=Math.ceil(delta.length()/22);
  if(steps>70)return false;
  for(let i=1;i<=steps;i++){
    sample.copy(a).addScaledVector(delta,i/steps);
    if(body?world.solid(sample):world.pointSolid(sample))return false;
  }
  return true;
}
const navStep=48;
function navCell(x,z,height){
  const p=new T.Vector3(x*navStep,height+20,z*navStep);
  if(world.solid(p)){p.y=height;if(world.solid(p))return null;}
  for(let i=0;i<14;i++){
    p.y-=4;
    if(world.solid(p)){p.y+=4;return p;}
  }
  return null;
}
function* findRoute(from,to){
  const sx=Math.round(from.x/navStep),sz=Math.round(from.z/navStep);
  const tx=Math.round(to.x/navStep),tz=Math.round(to.z/navStep);
  const heuristic=(x,z)=>Math.hypot(tx-x,tz-z);
  const start={x:sx,z:sz,p:from,g:0,h:heuristic(sx,sz),parent:null};
  const open=[start], bestCosts=new Map([[sx+':'+sz,0]]), cells=new Map();
  let best=start;
  for(let n=0;n<(touch?100:210)&&open.length;n++){
    yield;
    let index=0;
    for(let j=1;j<open.length;j++)if(open[j].g+open[j].h*1.18<open[index].g+open[index].h*1.18)index=j;
    const cur=open.splice(index,1)[0];
    if(cur.h<best.h)best=cur;
    if(cur.h<1.1&&Math.abs(cur.p.y-to.y)<40){best=cur;break;}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const x=cur.x+dx,z=cur.z+dz,h=heuristic(x,z),g=cur.g+Math.hypot(dx,dz),key=x+':'+z;
      if(g>=(bestCosts.get(key)??Infinity))continue;
      const cellKey=key+':'+cur.p.y;
      if(!cells.has(cellKey))cells.set(cellKey,navCell(x,z,cur.p.y));
      const p=cells.get(cellKey);
      if(!p||Math.abs(p.y-cur.p.y)>20||!visibleBetween(cur.p,p,true))continue;
      bestCosts.set(key,g);open.push({x,z,p,g,h,parent:cur});
    }
  }
  const path=[];
  for(let node=best;node.parent;node=node.parent)path.push(node.p);
  return path.reverse();
}
function advanceRoute(actor,target){
  if(!routeBudget||(!actor.routeSearch&&now<actor.replan))return;
  actor.routeSearch??=findRoute(actor.pos.clone(),target.clone());
  const steps=Math.min(routeBudget,touch?3:24);
  for(let i=0;i<steps;i++){
    routeBudget--;
    const result=actor.routeSearch.next();
    if(!result.done)continue;
    actor.route=result.value;actor.routeSearch=null;actor.replan=now+.85;
    break;
  }
}
function botRasengan(bot,enemy,dist,direction,dt){
  if(!bot.rasengan){
    if(bot.id!=='naruto'||now<(bot.rasenganAt??4)||now<bot.next||now<bot.stun||
       dist<95||dist>260||!visibleBetween(bot.pos,enemy.pos))return false;
    bot.rasengan={start:now,direction:direction.clone(),orb:makeTechniqueOrb('Rasengan')};
    bot.rasenganAt=now+11;
    playPose(bot,'ref_rasengan_charge',.58);sound('jutsu/Rasengan_Charge.wav',.25);
  }
  const skill=bot.rasengan,elapsed=now-skill.start;
  if(elapsed>=1.4||now<bot.stun){
    removeTechniqueOrb(skill.orb);bot.rasengan=null;
    playPose(bot,'ref_rasengan_end',.52);bot.next=now+1;
    return false;
  }
  if(elapsed>=.58&&!skill.ready){
    skill.ready=true;playPose(bot,'ref_rasengan_ready',.2);sound('jutsu/Rasengan_Ready.wav',.25);
  }
  if(elapsed>=.78&&!skill.thrust){
    skill.thrust=true;skill.direction.copy(direction);
    playPose(bot,'ref_rasengan_thrust',.62);sound('jutsu/Rasengan_Spin.wav',.25);
  }
  move(bot,skill.thrust?skill.direction.x*530*dt:0,skill.thrust?skill.direction.z*530*dt:0,dt);
  face(bot,skill.thrust?skill.direction:direction);animate(bot,'idle',dt);
  positionTechniqueOrb(skill.orb,bot,skill.thrust?21:6+elapsed*14,skill.direction,dt);
  if(skill.thrust&&!skill.hit&&skill.orb.position.distanceToSquared(enemy.pos)<66**2&&visibleBetween(bot.pos,enemy.pos)){
    skill.hit=true;
    if(enemy===player){
      hurtPlayer(24,bot);
      if(player.hp<100)playPose(player,'ref_rasengan_knockback_hit',.85);
    }else{
      damage(enemy,24,bot);
      if(!enemy.dead)playPose(enemy,'ref_rasengan_knockback_hit',.85);
    }
    sound('jutsu/Rasengan_Hit.wav',.34);visual(enemy.pos,0x98deff,34,.45,'rasenganHit');
  }
  return true;
}
function updateBot(bot,index,dt){
  if(bot.dead){if(bot.rasengan){removeTechniqueOrb(bot.rasengan.orb);bot.rasengan=null;}if(now>bot.dead){bot.dead=0;spawn(bot,botSpawn());bot.next=now+1.3;}else if(bot.pose&&now<bot.pose.until)animate(bot,'die_simple',dt);return;}
  let enemy=null,nearest=Infinity;
  for(const other of [player,...botList,...allies]){
    if(!alive(other)||!enemies(bot,other.kind?player:other))continue;
    const distance=other.pos.distanceToSquared(bot.pos);
    if(distance<nearest){nearest=distance;enemy=other;}
  }
  if(bot.swingAt&&bot.swingTarget){
    if(alive(bot.swingTarget))enemy=bot.swingTarget;
    else bot.swingAt=0;
  }
  if(!enemy){move(bot,0,0,dt);face(bot,new T.Vector3(1,0,0));animate(bot,'idle',dt);return;}
  const target=enemy.pos.clone().sub(bot.pos),dist=target.length();
  target.y=0;target.normalize();
  if(!bot.swingAt&&now>=bot.swing&&botRasengan(bot,enemy,dist,target,dt))return;
  const sees=dist<130&&visibleBetween(bot.pos,enemy.pos);
  const meleeRange=world.traceSolid?29:58;
  let moving=false,advanced=false;
  if(bot.swingAt&&now>=bot.swingAt){
    bot.swingAt=0;bot.swing=now+.26;
    if(bot.ranged&&dist<380&&visibleBetween(bot.pos,enemy.pos)&&now>=bot.stun){
      const direction=enemy.pos.clone().sub(bot.pos).normalize();
      sound('jutsu/Gouk_Shoot.wav',.3);
      if(sprites.has('fireStart'))visual(bot.pos.clone().addScaledVector(direction,12),0xff7133,11,.25,'fireStart');
      projectile(direction,0xff6637,11,bot,rules.sv_katon_gouk_speed,rules.sv_katon_gouk_radius,'fire');
    }else if(!bot.ranged&&sees&&dist<meleeRange+6&&now>=bot.stun){
      if(enemy===player)hurtPlayer(rules.sv_primary_dmg,bot);
      else damage(enemy,rules.sv_primary_dmg,bot);
    }
  }
  if(now>=bot.stun&&!bot.swingAt){
    if(sees&&dist<meleeRange&&now>=bot.next){
      bot.ranged=false;bot.swingAt=now+.22;bot.swing=now+.42;bot.next=now+rand(1.2,2);
      bot.swingTarget=enemy;
    }else if(bot.id==='sasuke'&&dist>115&&dist<320&&now>=bot.next&&now>=(bot.katonAt??0)&&visibleBetween(bot.pos,enemy.pos)){
      bot.ranged=true;bot.swingAt=now+.55;bot.next=now+rand(2.5,4);
      bot.swingTarget=enemy;
      bot.katonAt=now+8;
      playPose(bot,bot.ground?'ref_gouk_shoot':'air_gouk_shoot',.7);
    }else if(now>=bot.swing&&(!sees||dist>=meleeRange)){
      let desired=enemy.pos.clone().addScaledVector(target,-meleeRange*.59);
      if(dist<meleeRange*3){
        const flank=new T.Vector3(-target.z,0,target.x).multiplyScalar(meleeRange*.47);
        for(const sign of [index%2?1:-1,index%2?-1:1]){
          const slot=desired.clone().addScaledVector(flank,sign);
          if(botList.every(other=>other===bot||other.dead||other.pos.distanceToSquared(slot)>(meleeRange*.5)**2)&&
             visibleBetween(bot.pos,slot,true)){desired=slot;break;}
        }
      }
      const direct=visibleBetween(bot.pos,desired,true);
      if(direct){bot.route=[];bot.routeSearch=null;}
      else advanceRoute(bot,enemy.pos);
      while(bot.route.length&&bot.route[0].distanceTo(bot.pos)<(world.traceSolid?11:22))bot.route.shift();
      const destination=direct?desired:bot.route[0];
      const steer=destination?destination.clone().sub(bot.pos):new T.Vector3();
      steer.y=0;if(steer.length()>3)steer.normalize();else steer.set(0,0,0);
      for(const other of [player,...botList]){
        if(other===bot||other.dead||Math.abs(other.pos.y-bot.pos.y)>38)continue;
        const away=bot.pos.clone().sub(other.pos);away.y=0;
        const length=away.length(),spacing=other===enemy?meleeRange*.34:meleeRange*.68;
        if(length>0&&length<spacing)steer.addScaledVector(away,.85*(spacing-length)/(spacing*length));
      }
      if(steer.lengthSq()>.06){
        const before=bot.pos.clone();steer.normalize();
        const speed=world.traceSolid?128:160;
        move(bot,steer.x*speed*dt,steer.z*speed*dt,dt);advanced=true;
        moving=Math.hypot(bot.pos.x-before.x,bot.pos.z-before.z)>.08;
        if(!moving&&!direct)bot.replan=Math.min(bot.replan,now+.2);
      }
    }
  }
  if(!advanced)move(bot,0,0,dt);
  face(bot,target);
  animate(bot,now<bot.swing?'punch1':moving?'run':'idle',dt);
}
function cameraClearance(focus,offset,distance){
  const end=focus.clone().addScaledVector(offset,distance);
  const roof=world.roofDistance(focus,end,true);
  const wall=world.traceSolid?.(focus,end)??Infinity;
  distance=Math.min(distance,Math.max(0,Math.min(roof,wall)-7));
  if(world.traceSolid)return distance;
  for(let d=5;d<distance;d+=5){
    goal.copy(focus).addScaledVector(offset,d);
    if(world.pointSolid(goal))return Math.max(4,d-8);
  }
  return distance;
}
function updateWater(wasSwimming,walking){
  for(const mesh of world.waterMeshes){
    if(touch&&now<(mesh.userData.waterUpdateAt??0))continue;
    if(touch)mesh.userData.waterUpdateAt=now+.05;
    const map=mesh.material.normalMap;
    if(map)map.offset.set((now*.029)%1,(now*.017)%1);
    mesh.material.normalScale.set(.84+.11*Math.sin(now*1.6),.83);
  }
  if(!world.waterMeshes.length&&!wasSwimming&&!player.waterWalk)return;
  const swimming=world.water(player.pos);
  if(now<(player.rippleAt??0)||(!walking&&!player.waterWalk&&wasSwimming))return;
  const surface=world.waterline(player.pos,90,75);
  if(surface===null)return;
  const feet=world.traceSolid?(player.root.userData.nativeFeet??18):player.feetOffset;
  const shallow=(world.shallowWater||world.name==='storm_river')&&walking&&player.ground&&
    Math.abs(player.pos.y-feet-surface)<6;
  if(!swimming&&!player.waterWalk&&!shallow)return;
  player.rippleAt=now+.43;
  const p=player.pos.clone();
  p.y=surface+.9;
  if(p.y-player.pos.y>100)return;
  const ripple=sprites.get('ripple');
  if(ripple){
    const mesh=new T.Mesh(rippleGeo,new T.MeshBasicMaterial({
      map:ripple.frames[0],transparent:true,depthWrite:false,blending:T.AdditiveBlending
    }));
    mesh.rotation.x=-Math.PI/2;mesh.position.copy(p);mesh.scale.setScalar(25);
    actors.add(mesh);effects.push({mesh,ttl:.68,left:.68,sprite:ripple,ripple:true});
  }
  if(!wasSwimming&&!player.waterWalk)visual(p,0xc0edff,24,.48,'splash');
  sound('movement/Footstep_Water'+(Math.floor(now*9)%4+1)+'.wav',.3);
}
function recordPeer(peer,state,time){
  const stamp=state.time??time,history=peer.history;
  const last=history.at(-1);
  if(last&&stamp<=last.time)return;
  const pos=new T.Vector3(...state.position);
  const rotation=state.rotation?
    new T.Quaternion(...state.rotation).normalize():
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),state.yaw);
  if(last&&pos.distanceToSquared(last.pos)>180**2){
    history.length=0;
    peer.pos.copy(pos);
  }
  history.push({time:stamp,pos,rotation,offset:state.offset??18,pose:state.pose,
    action:state.action??0,once:state.once??false,hp:state.hp??100});
  if(history.length>8)history.shift();
}
function updateLan(dt){
  const match=lan;
  const target=match.clock+performance.now()-match.receivedAt-105;
  for(const peer of match.peers.values()){
    const history=peer.history;
    while(history.length>2&&history[1].time<=target)history.shift();
    const [before,after=before]=history;
    if(!before)continue;
    const blend=after===before?0:clamp((target-before.time)/(after.time-before.time),0,1);
    peer.pos.lerpVectors(before.pos,after.pos,blend);
    peer.root.position.copy(peer.pos);
    peer.root.position.y-=T.MathUtils.lerp(before.offset,after.offset,blend);
    peer.root.quaternion.slerpQuaternions(before.rotation,after.rotation,blend);
    const snapshot=blend===1?after:before;
    peer.hp=snapshot.hp;
    const pose=snapshot.once?{name:snapshot.pose,serial:snapshot.action,until:Infinity}:null;
    peer.pose=pose;
    peer.animDt+=dt;
    if(peer.pos.distanceToSquared(player.pos)<500**2||peer.animDt>=1/30){
      animate(peer,snapshot.pose,peer.animDt);
      peer.animDt=0;
    }
  }
}
function syncPeer(match,token,state,packetTime){
  const peer=match.peers.get(token);
  if(peer){
    if(peer.name!==state.name){peer.name=state.name;peer.nameplate.textContent=state.name;}
    recordPeer(peer,state,packetTime);
    return;
  }
  const current=match.loading.get(token);
  if(current?.state.hero===state.hero){
    current.state=state;current.time=packetTime;
    return;
  }
  const pending={state,time:packetTime};
  match.loading.set(token,pending);
  model(state.hero).then(root=>{
    if(lan!==match||match.loading.get(token)!==pending)return;
    const {state,time}=pending,pos=new T.Vector3(...state.position);
    const peer={id:state.hero,name:state.name,root,pos,history:[],animDt:0,
      hp:100,remote:token,kills:0,deaths:0,impulse:new T.Vector3()};
    setActorScale(root);
    recordPeer(peer,state,time);
    peer.nameplate=makeNameplate(state.name);
    actors.add(root);match.peers.set(token,peer);refreshOpponents();
  }).catch(error=>console.warn('LAN model',state.hero,error.message)).finally(()=>{
    if(match.loading.get(token)===pending)match.loading.delete(token);
  });
}
function pollLan(match){
  const sentAt=performance.now();
  if(lan!==match||busy||match.pending||sentAt<match.next)return;
  match.next=sentAt+(paused?500:50);match.pending=true;
  const hit=match.hit;match.hit=null;
  sendArena({room:world.name,token:match.token,hero:player.id,name:match.name,
      position:player.pos.toArray(),yaw,rotation:player.root.quaternion.toArray(),
      offset:clamp(player.pos.y-player.root.position.y,-128,128),hp:clamp(player.hp,0,100),
      pose:player.action?.getClip().name??'idle',action:player.actionVersion??0,once:!!player.playingPose,hit}).then(packet=>{
    if(lan!==match)return;
    const receivedAt=performance.now(),clock=packet.time??receivedAt;
    match.ping=Math.round(receivedAt-sentAt);
    match.clock=Math.max(clock,(match.clock??clock)+receivedAt-(match.receivedAt??receivedAt)-15);
    match.receivedAt=receivedAt;
    for(const [token,peer] of match.peers){
      if(!packet.players[token]||peer.id!==packet.players[token].hero){
        actors.remove(peer.root);peer.nameplate.remove();match.peers.delete(token);refreshOpponents();
        if(locked===peer)locked=null;
      }
    }
    for(const token of match.loading.keys())if(!packet.players[token])match.loading.delete(token);
    for(const [token,state] of Object.entries(packet.players))syncPeer(match,token,state,clock);
    for(const strike of packet.hits)hurtPlayer(strike.damage,match.peers.get(strike.from));
  }).catch(error=>{
    if(lan===match){message('LAN · '+error.message);match.next=performance.now()+500;}
  }).finally(()=>{match.pending=false;});
}
function update(dt){
  const mapEvent=world.updateMap?.(dt,player.pos);
  if(mapEvent?.growl)sound(mapEvent.growl.path,mapEvent.growl.gain);
  if(mapEvent?.shake)player.shakeUntil=now+mapEvent.shake;
  if(mapEvent?.push){
    player.impulse.x+=mapEvent.push.x;
    player.impulse.z+=mapEvent.push.z;
  }
  if(battleStarts){
    if(now<battleStarts){updateCamera(dt);return;}
    $('battle-ready').hidden=true;$('battle-go').hidden=false;
    if(now>=battleStarts+.63){$('battle-intro').hidden=true;battleStarts=0;}
  }
  if(cutInUntil&&now>=cutInUntil){$('jutsu-cut-in').hidden=true;cutInUntil=0;}
  if(unlimited()){player.stamina=100;player.chakra=maxChakra;}
  routeBudget=touch?9:72;
  const held=keys.has('ShiftLeft')||keys.has('ShiftRight');
  forward.set(Math.cos(yaw),0,-Math.sin(yaw));
  right.set(-forward.z,0,forward.x);
  motion.set(0,0,0);
  if(!held){
    if(keys.has('KeyW'))motion.add(forward);
    if(keys.has('KeyS'))motion.sub(forward);
    if(keys.has('KeyD'))motion.add(right);
    if(keys.has('KeyA'))motion.sub(right);
    motion.addScaledVector(forward,-stickY).addScaledVector(right,stickX);
  }
  const blocking=keys.has('KeyQ')||keys.has('MouseBlock');
  const walking=motion.lengthSq()>0;
  const slow=keys.has('ControlLeft')||keys.has('ControlRight');
  const swimming=world.water(player.pos)&&!player.waterWalk;
  const climbing=focusMode&&!swimming&&!player.backflip&&!rush&&now>=(player.wallLock??0);
  const priorWall=player.wall;
  player.wall=climbing&&(priorWall||!blocking&&!charged&&movingKey('KeyW')&&!player.ground)?
    wallContact(player.pos,priorWall?priorWall.normal.clone().negate():forward,!!priorWall):null;
  if(player.wall)player.wall.heading=priorWall?.heading??new T.Vector3(0,1,0);
  if(player.wall&&player.stamina<Math.max(.7,8*dt)){
    player.wall=null;player.wallLock=now+.65;
  }
  if(player.wall)spendStamina(8*dt);
  if(player.wall&&!priorWall){player.impulse.set(0,0,0);sound('movement/Wall_Jump.wav',.25);}
  if(priorWall&&!player.wall){
    const ledge=climbing&&priorWall.speed>0&&movingKey('KeyW')&&player.stamina>.7?
      stepOntoLedge(player.pos,priorWall):null;
    if(ledge){
      player.pos.copy(ledge);player.dy=0;player.ground=true;player.wallLock=now+.35;
    }else player.dy=priorWall.speed*.55;
  }
  const dashing=now<player.dashUntil&&movingKey('KeyW')&&!held&&!blocking&&!swimming&&!slow&&!player.wall&&!charged&&!rush;
  if(!dashing&&player.dashUntil){player.dashUntil=0;if(player.pose?.name==='dash')player.pose=null;}
  const runSpeed=world.traceSolid?235:355;
  motion.clampLength(0,1).multiplyScalar((blocking?runSpeed*.4:charged||heavy?runSpeed*.33:swimming?runSpeed*.54:slow?runSpeed*.44:dashing?runSpeed+rules.sv_dash_speed*.58:runSpeed)*dt);
  if(player.backflip)motion.copy(player.flipDirection).multiplyScalar(rules.sv_backflip_speed*dt);
  if(player.wall){
    const normal=player.wall.normal;
    const onWall=aim();onWall.addScaledVector(normal,-onWall.dot(normal));
    if(world.traceSolid||onWall.lengthSq()<.09)onWall.set(0,1,0).addScaledVector(normal,-normal.y);
    onWall.normalize();
    const tangent=new T.Vector3().crossVectors(normal,onWall);
    const longitudinal=Number(movingKey('KeyW'))-Number(movingKey('KeyS'));
    const lateral=Number(movingKey('KeyD'))-Number(movingKey('KeyA'));
    const wallSpeed=world.traceSolid?180:270;
    motion.copy(onWall).multiplyScalar(longitudinal).addScaledVector(tangent,lateral).clampLength(0,1);
    if(blocking||charged)motion.set(0,0,0);
    if(motion.lengthSq())player.wall.heading.copy(motion).normalize();
    player.dy=motion.y*wallSpeed;
    motion.setY(0).multiplyScalar(wallSpeed*dt);
    player.wall.speed=player.dy;
  }
  if(rush&&now>=rush.end){
    if(rush.label==='Rasengan')playPose(player,'ref_rasengan_end',.52);
    clearRush();
  }
  if(rush)motion.copy(rush.direction).multiplyScalar(rush.speed*dt);
  const airborne=!player.ground,oldX=player.pos.x,oldZ=player.pos.z;
  if(!focusMode||player.stamina<=0)player.waterWalk=false;
  if(orioke)motion.set(0,0,0);
  move(player,motion.x,motion.z,dt);
  if(walking&&motion.lengthSq()>0&&now>=(player.boundaryNoticeAt??0)&&world.skyBoundary&&
    Math.hypot(player.pos.x-oldX,player.pos.z-oldZ)<motion.length()*.2){
    const probe=player.pos.clone().addScaledVector(motion.clone().normalize(),12);
    if(world.skyBoundary(probe)){
      player.boundaryNoticeAt=now+3;message('Граница на картата');
    }
  }
  const surface=!world.shallowWater&&focusMode&&!player.wall&&player.stamina>0&&player.dy<=0?
    world.waterline(player.pos,12,66):null;
  const surfaceHeight=world.waterSurface?.max.y;
  const feetHeight=surface!==null&&surfaceHeight!==undefined&&Math.abs(surface-surfaceHeight)<20?surfaceHeight:surface;
  const feetOffset=world.traceSolid?(player.root.userData.nativeFeet??18):player.feetOffset;
  const waterHeight=feetHeight===null?null:feetHeight+feetOffset+.8;
  player.waterWalk=waterHeight!==null&&player.pos.y<=waterHeight+(player.waterWalk?6:2)&&player.pos.y>=waterHeight-22&&
    !world.solid(player.pos.clone().setY(waterHeight));
  if(player.waterWalk){player.pos.y=waterHeight;player.dy=0;player.ground=true;player.airJump=false;}
  if(now>=(player.hazardAt??0)){
    const hazard=world.hazards.find(zone=>zone.contains(player.pos));
    if(hazard){player.hazardAt=now+.5;hurtPlayer(hazard.damage*.5);}
  }
  if(dashing&&Math.hypot(player.pos.x-oldX,player.pos.z-oldZ)<motion.length()*.25){
    player.dashUntil=0;if(player.pose?.name==='dash')player.pose=null;
  }

  if(airborne&&player.ground&&player.backflip){
    player.backflip=false;playPose(player,'dodge_backflip_end',.27);sound('movement/Backflip_End.wav');
  }
  if(heavy&&now-heavy.start>.35&&!heavy.ready){heavy.ready=true;playPose(player,heavy.direction+'2',1.2);}
  if(heavy&&now-heavy.start>1.5)releaseHeavy();
  if(player.powerKickAt&&now>=player.powerKickAt){
    player.powerKickAt=0;playPose(player,'ref_powerkick',.55);sound('jutsu/Power_Kick.wav');
    melee(165,rules.sv_focus_strength_punch_damage,.1);
    visual(player.pos.clone().addScaledVector(aim(),80),0xffb5a5,38,.65,'hit');
  }
  face(player,player.backflip?player.flipFacing:forward);
  const backwards=movingKey('KeyS')&&!movingKey('KeyW');
  const advancing=walking&&(player.wall||Math.hypot(player.pos.x-oldX,player.pos.z-oldZ)>Math.max(.05,dt*8));
  const pose=charged?(charged.skill[0]==='Rasengan'?(now-charged.start>.55?'ref_rasengan_ready':'ref_rasengan_charge'):
    now-charged.start>.55?'ref_chidori_ready':'ref_chidori_charge'):
    held?'jutsu_seal_idle':blocking?'block':player.wall?(walking?'run':'idle'):swimming?(walking?(backwards?'swim_backward':'swim'):'swim_stationary'):!player.ground?(player.dy<0?'jump_fall':'jump'):
    advancing?(dashing?'dash':slow?(backwards?'walk_backward':'walk'):backwards?'run_backward':'run'):player.stamina<5?'fatigue':'idle';
  animate(player,orioke?'ref_control_orioke':pose,dt);
  if(pendingThrow&&now>=pendingThrow.at){
    const {weapon}=pendingThrow;pendingThrow=null;releaseThrow(weapon);
  }
  updateTechnique(dt);
  if(pendingRasenshuriken&&now>=pendingRasenshuriken.at){
    projectile(pendingRasenshuriken.direction,0xa4eaff,42,player,820,158,'rasenshuriken');
    pendingRasenshuriken=null;
  }
  updateWater(swimming,walking);
  updateFocusEffect();
  if(walking&&player.ground&&!swimming&&now>lastStride){lastStride=now+.31;sound('movement/Footstep'+(Math.floor(now*8)%4+1)+'.wav',.13);}
  if(focusMode&&player.stamina>0&&(player.waterWalk||player.chakra<maxChakra)){
    const drain=Math.min(player.stamina,(player.waterWalk?3:12)*dt);
    if(spendStamina(drain))player.chakra=Math.min(maxChakra,player.chakra+drain*rules.sv_chakra_convert_points*100);
  }
  if(now-player.staminaUsed>rules.sv_stamina_recoverdelay)player.stamina=Math.min(100,player.stamina+rules.sv_stamina_recover_points*dt);
  if(healing&&now>=healing.next){
    player.hp=Math.min(100,player.hp+rules.sv_healing_recover_amount);
    healing.left--;healing.next=now+rules.sv_healing_time;if(healing.left<=0)healing=null;
  }
  if(locked){
    if(locked.dead||locked.pos.distanceTo(player.pos)>rules.sv_target_range)locked=null;
    else if(visibleBetween(player.pos,locked.pos)){
      lockLost=0;
      const delta=locked.pos.clone().sub(player.pos),targetYaw=Math.atan2(-delta.z,delta.x);
      const correction=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
      yaw+=correction*Math.min(1,dt*9);
    }else if((lockLost+=dt)>rules.sv_target_memory)locked=null;
  }
  for(let i=0;i<botList.length;i++)updateBot(botList[i],i,dt);
  if(lan)updateLan(dt);
  for(const shot of shots){
    shot.mixer?.update(dt);
    if(shot.flame)shot.mesh.material.map=shot.flame.frames[Math.floor(now*24)%shot.flame.frames.length];
    if(shot.kind==='rasenshuriken'){
      shot.mesh.rotation.x=-.32;
      shot.mesh.rotation.y+=dt*19;
      if(now>=(shot.fxAt??0)){
        shot.fxAt=now+.12;
        visual(shot.mesh.position,0xa4eaff,19,.21,'rasenBase');
      }
    }
    if((shot.kind==='fire'||shot.kind==='volley')&&now>=(shot.fxAt??0)){
      shot.fxAt=now+.1;
      if(sprites.has('fireTrail'))visual(shot.mesh.position,0xff742c,12,.23,'fireTrail');
    }
    if(shot.grenade&&!shot.stuck)shot.velocity.y-=580*dt;
    if(shot.kind==='shuriken'||(shot.grenade&&!shot.stuck))shot.mesh.rotateY(dt*(shot.kind==='shuriken'?23:9));
    const steps=Math.max(1,Math.ceil(shot.velocity.length()*dt/12));
    for(let i=0;i<steps&&shot.ttl>0&&!shot.stuck;i++){
      const previous=shot.mesh.position.clone();
      shot.mesh.position.addScaledVector(shot.velocity,dt/steps);
      if(world.pointSolid(shot.mesh.position)||world.traceSolid?.(previous,shot.mesh.position)<Infinity||
        world.roofDistance(previous,shot.mesh.position)<Infinity){
        shot.mesh.position.copy(previous);
        if(shot.grenade){
          const up=previous.clone().add(new T.Vector3(0,-4,0));
          if(world.pointSolid(up)&&shot.velocity.y<0){shot.velocity.y*=-.38;shot.velocity.x*=.57;shot.velocity.z*=.57;}
          else shot.velocity.multiplyScalar(-.38);
          if(shot.velocity.length()<38)shot.stuck=true;
        }else if(shot.kind==='tagkunai'){shot.stuck=true;shot.ttl=.72;}
        else{
          if(shot.model){visual(previous,0xffdda7,12,.16,'sparks');sound('weapons/Metal_Clash1.wav',.24);}
          shot.ttl=0;
        }
        break;
      }
      if(shot.grenade)continue;
      const victim=[player,...opponents(),...allies].find(b=>!b.dead&&
        enemies(shot.owner,b.kind?player:b)&&shot.mesh.position.distanceToSquared(b.pos)<1070);
      if(victim){
        if(shot.kind==='tagkunai'){shot.stuck=true;shot.ttl=.72;break;}
        if(!shot.radius){
          if(shot.kind==='kunai'||shot.kind==='shuriken')sound('weapons/'+(shot.kind==='kunai'?'Kunai':'Shuriken')+'_Hit.wav',.3);
          if(victim===player)hurtPlayer(shot.damage,shot.owner);else damage(victim,shot.damage,shot.owner);
        }
        shot.ttl=0;
      }
    }
    shot.ttl-=dt;
    updateWeaponTrail(shot);
    if(shot.ttl<=0){
      if(shot.radius){
        if(shot.kind==='smoke'){
          sound('weapons/Smokebomb_Setoff.wav');visual(shot.mesh.position,0xa0a9a4,shot.radius*.6,3.6,'smoke');
        }else{
          if(shot.kind==='tag'||shot.kind==='tagkunai')sound('weapons/Explosion.wav');
          if(shot.kind==='rasenshuriken'){
            sound('jutsu/Rasengan_Hit.wav');
            visual(shot.mesh.position,0x9defff,shot.radius*.3,.65,'rasenganHit');
          }else if(shot.kind==='fire'||shot.kind==='volley'){
            sound('jutsu/'+(shot.kind==='fire'?'Gouk':'Hous')+'_Hit.wav',.42);
            const heading=shot.velocity.clone().normalize();
            for(let i=0;i<2;i++)visual(shot.mesh.position.clone().addScaledVector(heading,-i*16)
              .add(new T.Vector3(0,12+i*9,0)),0xff7d35,19-i*3,.34+i*.055,
              shot.kind==='fire'?'fireball':'volley',true);
          }else visual(shot.mesh.position,0xff823f,shot.radius*.42,.65,'explosion');
          for(const target of [player,...opponents(),...allies]){
            const distance=target.pos.distanceTo(shot.mesh.position);
            if(target.dead||!enemies(shot.owner,target.kind?player:target)||distance>=shot.radius||!visibleBetween(shot.mesh.position,target.pos))continue;
            const amount=shot.damage*(1-distance/shot.radius*.5);
            if(target===player)hurtPlayer(amount,shot.owner);else damage(target,amount,shot.owner);
          }
        }
      }
      shot.mixer?.stopAllAction();
      actors.remove(shot.mesh);if(!shot.model)shot.mesh.material.dispose();
      if(shot.trail){actors.remove(shot.trail);shot.trail.material.dispose();}
    }
  }
  shots=shots.filter(s=>s.ttl>0);
  if(orioke){
    const p=player.pos.clone().add(new T.Vector3(0,14,0));
    if(orioke.cloud){
      orioke.cloud.position.copy(player.pos);orioke.cloud.quaternion.copy(player.root.quaternion);orioke.cloudMixer.update(dt);
      const opacity=clamp(Math.min((now-orioke.start)/.16,(orioke.end-now)/.25),0,1);
      for(const material of orioke.cloudMaterials)material.opacity=opacity;
    }
    for(const bot of botList){
      if(bot.dead||orioke.hit.has(bot)||!enemies(player,bot)||bot.pos.distanceTo(player.pos)>245||!visibleBetween(player.pos,bot.pos))continue;
      orioke.hit.add(bot);
      bot.stun=now+rules.sv_orioke_stun_time;
      playPose(bot,'ref_orioke_stun_hit',rules.sv_orioke_stun_time);
      const away=bot.pos.clone().sub(player.pos).setY(0).normalize();
      bot.impulse.addScaledVector(away,rules.sv_orioke_knockback);
    }
    if(now>=orioke.end){
      endOrioke();visual(p,0xffffff,18,.4,'poof');
    }
  }
  for(const ally of allies){
    ally.ttl-=dt;
    if(ally.ttl<=0){
      ally.mixer?.stopAllAction();actors.remove(ally.mesh);
      visual(ally.pos,0xffffff,15,.38,'poof');continue;
    }
    if(now>=ally.scanAt){
      ally.scanAt=now+.16;
      let closest=560**2;
      ally.target=null;
      for(const opponent of opponents()){
        if(opponent.dead||!enemies(player,opponent))continue;
        const distance=opponent.pos.distanceToSquared(ally.pos);
        if(distance<closest){closest=distance;ally.target=opponent;}
      }
      ally.direct=ally.target&&visibleBetween(ally.pos,ally.target.pos,true);
    }
    const target=ally.target&&!ally.target.dead?ally.target:null;
    const direct=target&&ally.direct;
    if(target&&!direct)advanceRoute(ally,target.pos);
    else ally.routeSearch=null;
    while(ally.route.length&&ally.route[0].distanceTo(ally.pos)<28)ally.route.shift();
    const destination=direct?target.pos:target?ally.route[0]:player.pos;
    const direction=destination?destination.clone().sub(ally.pos).setY(0):new T.Vector3();
    const moving=direction.length()>(target?45:110);
    direction.normalize();
    move(ally,moving?direction.x*215*dt:0,moving?direction.z*215*dt:0,dt);
    if(direction.lengthSq())face(ally,direction);
    if(direct&&!moving&&now>ally.next&&visibleBetween(ally.pos,target.pos)){
      playPose(ally,ally.mesh.animation('stick')?'stick':'punch1',.48);
      damage(target,ally.damage);ally.next=now+.55;
    }
    animate(ally,moving?'run':'idle',dt);
  }
  allies=allies.filter(a=>a.ttl>0);
  substitutionLogs=substitutionLogs.filter(log=>{
    if(now<log.until){animate(log,'drop',dt);return true;}
    log.mixer?.stopAllAction();actors.remove(log.root);return false;
  });
  for(const f of effects){
    f.left-=dt;f.mesh.material.opacity=Math.max(0,f.left/f.ttl)*.85;
    if(f.sprite){
      const frames=f.sprite.frames;
      const index=Math.min(frames.length-1,Math.floor((1-f.left/f.ttl)*frames.length));
      f.mesh.material.map=frames[index];
      if(f.ripple)f.mesh.scale.setScalar(25+80*(1-f.left/f.ttl));
    }else f.mesh.scale.setScalar(f.size*(1+.65*(1-f.left/f.ttl)));
    if(f.left<=0)releaseVisual(f);
  }
  effects=effects.filter(f=>f.left>0);
  if(now>noticeUntil)$('notice').textContent=world.canReleaseSeal?.(player.pos)?
    (touch?'Оръжие':'E')+' · освободи печата':prepared&&!charged?prepared[0]+' · ляв бутон или Enter':'';
  updateCamera(dt);
  updateBotNames();
  if(now>=(player.hudAt??0)){player.hudAt=now+1/20;updateHUD();}
}
const namePosition=new T.Vector3(),nameProjection=new T.Vector3();
function makeNameplate(name,own=false){
  const plate=document.createElement('span');
  plate.className=own?'bot-name own-name':'bot-name';
  plate.textContent=name;plate.hidden=true;
  $('bot-names').append(plate);
  return plate;
}
function updateBotNames(){
  camera.updateMatrixWorld();
  const tracked=player.nameplate?[player,...opponents()]:opponents();
  for(const bot of tracked){
    namePosition.copy(bot.root.position);namePosition.y+=74*visualScale(bot.root);
    nameProjection.copy(namePosition).project(camera);
    const onScreen=!bot.dead&&nameProjection.z>=-1&&nameProjection.z<=1&&Math.abs(nameProjection.x)<1&&Math.abs(nameProjection.y)<1;
    if(bot!==player&&onScreen&&now>=(bot.nameCheckAt??0)){
      bot.nameCheckAt=now+.12;
      bot.nameOccluded=camera.position.distanceToSquared(namePosition)>900**2;
    }
    bot.nameplate.hidden=!onScreen||bot.nameOccluded||!bot.root.visible;
    if(!bot.nameplate.hidden){
      bot.nameplate.style.left=(50+50*nameProjection.x)+'%';
      bot.nameplate.style.top=(50-50*nameProjection.y)+'%';
    }
  }
}
function updateCamera(dt){
  const orbitPitch=world.name.startsWith('storm_')?clamp(pitch,-.63,.56):pitch;
  const dir=new T.Vector3(Math.cos(yaw)*Math.cos(orbitPitch),Math.sin(orbitPitch),-Math.sin(yaw)*Math.cos(orbitPitch));
  const scale=visualScale(player.root),zoom=cameraZoom*scale;
  const focus=player.root.position.clone().add(new T.Vector3(0,47*scale,0));
  const headClearance=Math.min(world.roofDistance(player.pos,focus),world.traceSolid?.(player.pos,focus)??Infinity);
  if(headClearance<Infinity)focus.y=player.pos.y+Math.max(0,headClearance-7);
  if(world.pointSolid(focus))focus.copy(player.pos);
  sun.target.position.set(Math.round(player.pos.x/24)*24,Math.round(player.pos.y/24)*24,Math.round(player.pos.z/24)*24);
  sun.position.copy(sun.target.position).addScaledVector(world.lighting.direction,200);
  const side=new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const remaining=Math.max(0,cinematicUntil-now);
  const cinematic=remaining>0?Math.sin(Math.PI*remaining/.85)*.82:0;
  const desired=focus.clone().addScaledVector(dir,-zoom*(1-cinematic*.48))
    .addScaledVector(side,24*scale+zoom*cinematic*.62);
  desired.y+=zoom*(.14+cinematic*.13);
  if(now<(player.shakeUntil??0)){
    const strength=(player.shakeUntil-now)/4*10;
    desired.y+=Math.sin(now*20*Math.PI)*strength;
    desired.addScaledVector(side,Math.cos(now*20*Math.PI)*strength*.45);
  }
  if(player.waterWalk){
    const feet=world.traceSolid?(player.root.userData.nativeFeet??18):player.feetOffset;
    desired.y=Math.max(desired.y,player.pos.y-feet+3);
  }
  const offset=desired.sub(focus),distance=offset.length();
  offset.divideScalar(distance);
  const clearance=cameraClearance(focus,offset,distance);
  cameraDistance=Math.min(clearance,T.MathUtils.damp(cameraDistance,clearance,10,dt));
  camera.position.copy(focus).addScaledVector(offset,cameraDistance);
  camera.lookAt(focus.clone().addScaledVector(dir,205*scale*(1-cinematic)));
  player.root.visible=cameraDistance>55*scale;
}
const perf=perfParams.has('perf')?$('_perf'):null;
const perfSamples=new Map();
const perfGpuTimer=perf&&renderer.getContext?.().getExtension('EXT_disjoint_timer_query_webgl2');
let perfWorld,perfReport='',perfRefresh=0,previousPerfFrame=null;
if(perf){
  perf.hidden=false;
  $('perf-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(perfReport);$('perf-copy').textContent='Копирано';}
    catch{$('perf-copy').textContent='Направи снимка';}
  };
}
function rasenganPhase(){
  if(chargeClone)return 'клонинг';
  if(charged?.skill[0]==='Rasengan')return 'зареждане';
  if(rush?.label==='Rasengan')return 'атака';
  if(botList.some(bot=>bot.rasengan))return 'бот';
  const hit=sprites.get('rasenganHit'),wave=sprites.get('rasenShockwave');
  if(effects.some(effect=>effect.sprite&&(effect.sprite===hit||effect.sprite===wave)))return 'ефект';
  return '';
}
function recordPerf(elapsed,{phase,updateMs,renderMs,scale,draws}){
  const key=phase?'Rasengan':'Движение';
  if(!perfSamples.has(key))perfSamples.set(key,{frames:[],maxDraws:0,index:0});
  const samples=perfSamples.get(key),index=samples.index++%1200;
  samples.frames[index]=[elapsed,updateMs,renderMs,scale,phase];
  samples.maxDraws=Math.max(samples.maxDraws,draws);
  if(performance.now()<perfRefresh)return;
  perfRefresh=performance.now()+600;
  const lines=[world.name+' · '+botList.length+' бота · '+renderScale.toFixed(2)+'× '+quality.value];
  const info=renderer.info;
  lines.push((perfGpuTimer?'има GPU таймер':'няма GPU таймер')+
    ' · textures '+(info?.memory.textures??'—')+' · programs '+(info?.programs?.length??'—')+
    ' · triangles '+(info?.render.triangles??'—'));
  for(const [label,{frames,maxDraws}] of perfSamples){
    const percentile=(values,q)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*q)].toFixed(1);
    const frameTimes=frames.map(frame=>frame[0]);
    const p95=i=>percentile(frames.map(frame=>frame[i]),.95)+' ('+frames.length+')';
    const slow=frames.filter(frame=>frame[0]>50).length;
    const scales=frames.map(frame=>frame[3]);
    if(frames.length<40)continue;
    lines.push(label+' · p50 '+percentile(frameTimes,.5)+' ms / p95 '+p95(0)+' ms · '+slow+'/'+frames.length+' >50 ms');
    lines.push('CPU '+p95(1)+' ms · render CPU '+p95(2)+' ms · '+maxDraws+' draws · '+Math.min(...scales).toFixed(2)+'–'+Math.max(...scales).toFixed(2)+'×');
    if(label==='Rasengan'){
      const details=[];
      for(const phase of ['клонинг','зареждане','атака','бот','ефект']){
        const times=frames.filter(frame=>frame[4]===phase).map(frame=>frame[0]);
        if(times.length>=40)details.push(phase+' '+percentile(times,.95)+'ms ('+times.length+')');
      }
      lines.push(details.join(' · '));
    }
  }
  perfReport=lines.join('\n');$('perf-text').textContent=perfReport;
}
const frameWindow={start:0,frames:0,slow:0,stalls:0,stableSince:0};
function adaptResolution(t,elapsed){
  if(!frameWindow.frames){
    frameWindow.start=t;frameWindow.slow=0;frameWindow.stalls=0;
  }
  frameWindow.frames++;
  if(elapsed>24.5)frameWindow.slow++;
  if(elapsed>50)frameWindow.stalls++;
  if(t-frameWindow.start<1100||frameWindow.frames<12)return;
  const [minimum,maximum]=resolutionRange();
  const stalls=frameWindow.stalls>=3&&frameWindow.stalls/frameWindow.frames>=.05;
  const sustained=frameWindow.slow/frameWindow.frames>=.35;
  if(stalls||sustained){
    frameWindow.stableSince=0;
    setResolution(Math.max(minimum,Math.min(maximum,renderScale*(stalls?.86:.93))));
  }else if(frameWindow.slow/frameWindow.frames<=.08&&frameWindow.stalls===0){
    frameWindow.stableSince||=t;
    if(t-frameWindow.stableSince>=10000){
      setResolution(Math.min(maximum,renderScale+.06));
      frameWindow.stableSince=t;
    }
  }else frameWindow.stableSince=0;
  frameWindow.frames=0;
}
let last=performance.now();
renderer.setAnimationLoop(t=>{
  const elapsed=t-last;last=t;
  const dt=Math.min(elapsed/1000,.045);
  if(touch&&innerHeight>innerWidth){previousPerfFrame=null;return;}
  if(world&&!paused&&!document.hidden&&elapsed>0&&elapsed<250)adaptResolution(t,elapsed);
  else {frameWindow.frames=0;frameWindow.stableSince=0;}
  const measure=perf&&world&&!paused&&elapsed>0&&!document.hidden;
  const start=measure?performance.now():0;
  if(world&&!paused){now+=Math.max(0,dt);update(Math.max(0,dt));}
  const updateEnd=measure?performance.now():0;
  renderer.render(scene,camera);
  if(measure){
    if(perfWorld!==world){perfWorld=world;perfSamples.clear();perfRefresh=0;previousPerfFrame=null;}
    const renderMs=performance.now()-updateEnd;
    if(previousPerfFrame)recordPerf(elapsed,previousPerfFrame);
    previousPerfFrame={phase:rasenganPhase(),updateMs:updateEnd-start,renderMs,scale:renderScale,draws:renderer.info?.render.calls??0};
  }else previousPerfFrame=null;
});
