import * as T from 'three';

export function makeRadar(renderer,scene,canvas,world){
  const {spawns}=world;
  const bounds=new T.Box3().setFromPoints(spawns.map(spawn=>spawn.position));
  const center=bounds.getCenter(new T.Vector3());
  const size=bounds.getSize(new T.Vector3());
  const radius=Math.max(320,Math.max(size.x,size.z)*.62+140);
  if(!renderer.readRenderTargetPixels)return {center,radius};
  const camera=new T.OrthographicCamera(-radius,radius,radius,-radius,1,10000);
  camera.up.set(0,0,-1);
  camera.position.set(center.x,bounds.max.y+2000,center.z);
  camera.lookAt(center);
  const {width,height}=canvas;
  const target=new T.WebGLRenderTarget(width,height,{colorSpace:T.SRGBColorSpace});
  const previous=renderer.getRenderTarget();
  const background=scene.background;
  const fog=scene.fog;
  const shadows=renderer.shadowMap.enabled;
  const override=scene.overrideMaterial;
  const scenery=[];
  let fallback;
  try{
    world.group.traverse(mesh=>{
      if(mesh.visible&&mesh.userData.radarScenery){scenery.push(mesh);mesh.visible=false;}
    });
    scene.background=new T.Color(0x313d26);
    scene.fog=null;renderer.shadowMap.enabled=false;
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);
    const pixels=new Uint8Array(width*height*4);
    renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
    const isDark=()=>{
      let bright=0;
      for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>35)bright++;
      return bright<width*height*.08;
    };
    if(isDark()){
      // Unlit material keeps the layout readable when the top-down pass is
      // covered by dark roofs or the map lightmaps are unavailable.
      fallback=new T.MeshNormalMaterial({side:T.DoubleSide});
      scene.overrideMaterial=fallback;
      renderer.render(scene,camera);
      renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
      if(isDark())drawCollisionOverview(pixels,width,height,world,bounds,center,radius);
    }
    const flipped=new Uint8ClampedArray(pixels.length);
    for(let y=0;y<height;y++){
      const row=(height-1-y)*width*4;
      flipped.set(pixels.subarray(row,row+width*4),y*width*4);
    }
    canvas.getContext('2d').putImageData(new ImageData(flipped,width,height),0,0);
  }finally{
    for(const mesh of scenery)mesh.visible=true;
    scene.overrideMaterial=override;fallback?.dispose();
    renderer.setRenderTarget(previous);scene.background=background;scene.fog=fog;
    renderer.shadowMap.enabled=shadows;target.dispose();
  }
  return {center,radius};
}

function drawCollisionOverview(pixels,width,height,world,bounds,center,radius){
  const probe=new T.Vector3(),tile=4;
  for(let y=0;y<height;y+=tile)for(let x=0;x<width;x+=tile){
    probe.set(center.x+(x/width-.5)*2*radius,0,center.z+(.5-y/height)*2*radius);
    let openAbove=false,color=[34,42,30];
    for(let h=bounds.max.y+72;h>=bounds.min.y-144;h-=18){
      probe.y=h;
      if(world.water?.(probe)){color=[45,110,132];break;}
      if(!world.solid(probe)){openAbove=true;continue;}
      if(openAbove){
        const heightShade=Math.min(48,Math.max(0,(h-bounds.min.y)*.2));
        color=[86+heightShade,109+heightShade,62+heightShade];break;
      }
    }
    for(let dy=y;dy<Math.min(height,y+tile);dy++)for(let dx=x;dx<Math.min(width,x+tile);dx++){
      const at=(dy*width+dx)*4;
      pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];pixels[at+3]=255;
    }
  }
}
