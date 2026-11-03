import { useEffect, useRef, useState } from "react";
import type { Locale } from "@chronoeon/domain";
import { Icon } from "./Icon";
import { solarPosition, SOLAR_BODIES, type SolarBody } from "./solarOrbits";

/** Small cached sprites and eight Kepler solves at 30 fps; mounted only in space view. */
export function SolarSystem({ locale, onEarth }: { locale:Locale; onEarth:()=>void }) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const [paused,setPaused]=useState(false);
  const zh=locale==="zh";
  const pausedRef=useRef(paused);pausedRef.current=paused;
  const resumeRef=useRef(()=>{});
  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas) return;
    const context=canvas.getContext("2d");
    if(!context) return;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
    const epoch=Date.now();
    let width=0,height=0,dpr=1,frame=0,last=0,days=0,dirty=true;
    let backdrop:HTMLCanvasElement,orbits:HTMLCanvasElement;
    const sprites=new Map<string,HTMLCanvasElement>();
    const random=(n:number)=>{const value=Math.sin(n*127.1+311.7)*43758.5453;return value-Math.floor(value);};
    const makeSprite=(body:SolarBody)=>{
      const image=document.createElement("canvas");image.width=image.height=100;
      const ctx=image.getContext("2d")!;const r=body.id==="saturn"?23:35;
      if(body.id==="saturn") {ctx.save();ctx.translate(50,50);ctx.rotate(-.35);ctx.strokeStyle="#b6a57a99";ctx.lineWidth=10;ctx.beginPath();ctx.ellipse(0,0,43,13,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
      ctx.save();ctx.beginPath();ctx.arc(50,50,r,0,Math.PI*2);ctx.clip();
      const shade=ctx.createRadialGradient(38,36,1,52,52,r*1.25);shade.addColorStop(0,body.color);shade.addColorStop(.45,body.color);shade.addColorStop(1,"#080e20");ctx.fillStyle=shade;ctx.fillRect(0,0,100,100);
      if(body.id==="jupiter"||body.id==="saturn") {for(let band=0;band<10;band++){ctx.fillStyle=band%2?"#70544744":"#e8dcc344";ctx.fillRect(10,20+band*6,80,3);}}
      if(body.id==="earth") {ctx.fillStyle="#72b58d";ctx.beginPath();ctx.moveTo(35,32);ctx.lineTo(53,24);ctx.lineTo(58,40);ctx.lineTo(47,51);ctx.lineTo(48,69);ctx.lineTo(39,59);ctx.lineTo(35,43);ctx.fill();ctx.fillStyle="#d8eff388";ctx.fillRect(19,20,62,4);}
      if(body.id==="mercury"||body.id==="mars") {ctx.fillStyle="#332a2a33";for(let crater=0;crater<9;crater++){ctx.beginPath();ctx.arc(25+random(crater*3)*50,25+random(crater*3+1)*50,2+random(crater*3+2)*4,0,Math.PI*2);ctx.fill();}}
      ctx.restore();return image;
    };
    for(const body of SOLAR_BODIES) sprites.set(body.id,makeSprite(body));
    const layout=()=>({x:width*.53,y:height*.53,scale:Math.max(40,Math.min(width*.42,(height-95)/1.42))});
    const project=(body:SolarBody,position:ReturnType<typeof solarPosition>)=>{const view=layout();return {x:view.x+position.x/position.a*body.orbit*view.scale,y:view.y-position.y/position.a*body.orbit*view.scale*.66-position.z/position.a*body.orbit*view.scale*.3};};
    const resize=()=>{
      const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(window.devicePixelRatio||1,1.75);
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);
      backdrop=document.createElement("canvas");backdrop.width=canvas.width;backdrop.height=canvas.height;
      const stars=backdrop.getContext("2d")!;stars.scale(dpr,dpr);
      for(let index=0;index<230;index++){stars.fillStyle=`rgba(200,216,246,${.18+random(index+700)*.55})`;stars.beginPath();stars.arc(random(index*2)*width,random(index*2+1)*height,.35+random(index+333)*.65,0,Math.PI*2);stars.fill();}
      orbits=document.createElement("canvas");orbits.width=canvas.width;orbits.height=canvas.height;
      const lines=orbits.getContext("2d")!;lines.scale(dpr,dpr);lines.lineWidth=.65;
      for(const body of SOLAR_BODIES){lines.strokeStyle=body.id==="earth"?"#82c6e64d":"#9bb3d126";lines.beginPath();for(let index=0;index<=128;index++){const p=project(body,solarPosition(body,epoch,index/128*Math.PI*2));if(index)lines.lineTo(p.x,p.y);else lines.moveTo(p.x,p.y);}lines.closePath();lines.stroke();}
      const view=layout();lines.fillStyle="#b6a88b33";for(let index=0;index<190;index++){const angle=random(index+1500)*Math.PI*2,r=(.49+random(index+2200)*.06)*view.scale;lines.fillRect(view.x+Math.cos(angle)*r,view.y+Math.sin(angle)*r*.66,1,1);}
      dirty=true;
    };
    const draw=()=>{
      if(!width||!height)return;
      context.clearRect(0,0,width,height);context.drawImage(backdrop,0,0,width,height);context.drawImage(orbits,0,0,width,height);
      const view=layout();const sunRadius=Math.max(9,Math.min(18,view.scale*.075));
      const glow=context.createRadialGradient(view.x,view.y,0,view.x,view.y,sunRadius*4);glow.addColorStop(0,"#fff3ba");glow.addColorStop(.23,"#ffd269");glow.addColorStop(.35,"#efae3f88");glow.addColorStop(1,"#efae3f00");context.fillStyle=glow;context.fillRect(view.x-sunRadius*4,view.y-sunRadius*4,sunRadius*8,sunRadius*8);
      const labels:Array<{x:number;y:number;width:number}>=[];
      context.font=`11px system-ui, sans-serif`;context.textAlign="center";context.fillStyle="#ead8b4";context.fillText(zh?"太阳":"Sun",view.x,view.y+sunRadius+16);
      const date=epoch+days*86400000;
      const points=SOLAR_BODIES.map(body=>({body,point:project(body,solarPosition(body,date))})).sort((a,b)=>a.point.y-b.point.y);
      for(const {body,point} of points){
        const size=Math.max(3,body.size*Math.min(1,view.scale/190));const box=size*(body.id==="saturn"?3.8:2.8);
        context.drawImage(sprites.get(body.id)!,point.x-box/2,point.y-box/2,box,box);
        if(body.id==="earth"){
          const angle=(date/86400000)%27.3217/27.3217*Math.PI*2;const mx=point.x+Math.cos(angle)*(size+10),my=point.y+Math.sin(angle)*(size+10)*.6;
          context.strokeStyle="#c3d2df33";context.beginPath();context.ellipse(point.x,point.y,size+10,(size+10)*.6,0,0,Math.PI*2);context.stroke();
          context.fillStyle="#d6d7ce";context.beginPath();context.arc(mx,my,2,0,Math.PI*2);context.fill();
        }
        const text=zh?body.zh:body.en,tw=context.measureText(text).width;
        const x=Math.max(tw/2+5,Math.min(width-tw/2-5,point.x));let y=point.y+size+14;
        for(let pass=0;pass<4;pass++) if(labels.some(other=>Math.abs(other.x-x)<(other.width+tw)/2+7&&Math.abs(other.y-y)<13)) y+=13;
        if(y>height-45)y=point.y-size-9;
        labels.push({x,y,width:tw});context.fillStyle=body.id==="earth"?"#adddf0":"#c9d4df";context.fillText(text,x,y);
      }
      dirty=false;
    };
    const tick=(now:number)=>{
      frame=0;
      if(document.hidden)return;
      if(last && now-last<31 && !pausedRef.current && !reduced.matches){frame=requestAnimationFrame(tick);return;}
      if(!pausedRef.current&&!reduced.matches){if(last)days+=Math.min(.1,(now-last)/1000)*4;dirty=true;}
      if(dirty)draw();
      last=now;
      if(!pausedRef.current&&!reduced.matches)frame=requestAnimationFrame(tick);
    };
    const resume=()=>{cancelAnimationFrame(frame);last=0;if(!document.hidden)frame=requestAnimationFrame(tick);};
    resumeRef.current=resume;
    const observer=new ResizeObserver(()=>{resize();resume();});observer.observe(canvas);
    document.addEventListener("visibilitychange",resume);reduced.addEventListener("change",resume);resize();resume();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener("visibilitychange",resume);reduced.removeEventListener("change",resume);};
  },[locale,zh]);
  useEffect(()=>{resumeRef.current();},[paused]);
  return <div className="solar-system"><canvas ref={canvasRef} aria-label={zh?"简化太阳系：太阳、八大行星、月球与小行星带":"Simplified solar system: Sun, eight planets, Moon and asteroid belt"}/>
    <div className="solar-system-caption"><strong>{zh?"太阳系":"Solar system"}</strong><span>{zh?"轨道、尺寸压缩示意 · 1 秒约 4 天":"Compressed orbits and sizes · about 4 days per second"}</span></div>
    <div className="solar-system-controls"><button type="button" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}><Icon name={paused?"play":"pause"} size={12}/>{zh?(paused?"继续":"暂停"):(paused?"Resume":"Pause")}</button><button type="button" onClick={onEarth}><Icon name="target" size={12}/>{zh?"进入地球":"Explore Earth"}</button></div>
  </div>;
}
