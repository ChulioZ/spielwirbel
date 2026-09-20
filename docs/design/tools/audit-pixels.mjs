// Pixel-exact contrast audit for a design package (docs/design/README.md step 2).
//
// Why this exists: tools/audit.js scores a gradient by its WORST stop, which is
// right for flat surfaces and badly over-reports on a design whose pages sit on
// full-height gradients (Ocean: 31 reported, 3 real). This one measures what was
// actually painted -- every glyph is set to `color: transparent`, ONE screenshot
// is taken per sheet, and each text node's own box is read out of that image.
//
//   mode = the most common colour in the box. This is the background the text
//          sits on, and it is the finding.
//   p10  = the 10th-percentile luminance. A mode-passes/p10-fails split means the
//          box straddles something (a gradient boundary, or a neighbouring
//          element that overlaps it -- e.g. an avatar's colour ring around its
//          initials). Judge those by eye; they are usually not findings.
//
// Serve the repo root first, then pass sheet filenames relative to the package:
//   python3 -m http.server 3211
//   node docs/design/tools/audit-pixels.mjs docs/design/ocean/Ocean-O1-Komponenten.dc.html ...
//
// Requires Google Chrome on the host. Not app code; ESLint ignores docs/design/**.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.AUDIT_PORT || 9339);
const BASE = process.env.AUDIT_BASE || 'http://localhost:3211/';
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-first-run',
 `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'dc-audit-'))}`,
 '--force-device-scale-factor=1','--window-size=1700,1300','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let wsu; for(let i=0;i<40;i++){ try{ wsu=(await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; break;}catch{await sleep(250);} }
const ws=new WebSocket(wsu); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={},s)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p,...(s?{sessionId:s}:{})}));});
const {result:{targetId}}=await send('Target.createTarget',{url:'about:blank'});
const {result:{sessionId}}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId); await send('Runtime.enable',{},sessionId);
function decode(b64){ const buf=Buffer.from(b64,'base64'); let off=8,w=0,h=0,bd=8,ct=6,idat=[];
  while(off<buf.length){ const len=buf.readUInt32BE(off), type=buf.toString('ascii',off+4,off+8), d=buf.subarray(off+8,off+8+len);
    if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];} else if(type==='IDAT') idat.push(d); else if(type==='IEND') break; off+=12+len; }
  const ch= ct===6?4: ct===2?3: ct===4?2:1; const raw=zlib.inflateSync(Buffer.concat(idat));
  const bpp=ch*(bd/8), stride=w*bpp; const out=Buffer.alloc(h*stride); let p=0;
  for(let y=0;y<h;y++){ const f=raw[p++]; const line=raw.subarray(p,p+stride); p+=stride;
    const cur=out.subarray(y*stride,(y+1)*stride), prev=y>0?out.subarray((y-1)*stride,y*stride):Buffer.alloc(stride);
    for(let x=0;x<stride;x++){ const a=x>=bpp?cur[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0; let v=line[x];
      if(f===1)v+=a; else if(f===2)v+=b; else if(f===3)v+=(a+b)>>1; else if(f===4){const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?b:c);} cur[x]=v&255; } }
  return {w,h,ch,stride,data:out};
}
const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for(const sheet of process.argv.slice(2)){
  await send('Page.navigate',{url:BASE+sheet},sessionId); await sleep(4800);
  const ev=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
    const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; const els=new Set();
    while((n=w.nextNode())){ const t=n.textContent.replace(/\\s+/g,' ').trim(); if(t.length<2) continue;
      const el=n.parentElement; if(!el||els.has(el)) continue; els.add(el);
      const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
      const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
      const lab=el.closest('[data-screen-label]');
      out.push({t:t.slice(0,46), color:cs.color, px:parseFloat(cs.fontSize), fw:parseInt(cs.fontWeight)||400,
        op:parseFloat(cs.opacity), lab:lab?lab.getAttribute('data-screen-label'):'?',
        x:r.left,y:r.top,w:r.width,h:r.height}); }
    document.querySelectorAll('*').forEach(e=>{ e.style.setProperty('color','transparent','important');
      e.style.setProperty('text-shadow','none','important'); e.style.setProperty('-webkit-text-stroke','0','important'); });
    const d=document.documentElement.getBoundingClientRect();
    return JSON.stringify({nodes:out, page:{w:Math.ceil(document.body.scrollWidth),h:Math.ceil(document.body.scrollHeight)}});
  })()`},sessionId);
  const {nodes,page}=JSON.parse(ev.result.result.value);
  const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:Math.min(page.w,16000),height:Math.min(page.h,16000),scale:1},captureBeyondViewport:true},sessionId);
  const im=decode(shot.result.data);
  const fails=[];
  for(const nd of nodes){
    const fg=nd.color.match(/[\d.]+/g).map(Number);
    if(fg.length>3 && fg[3]<0.5) continue;
    const x0=Math.max(0,Math.floor(nd.x)), y0=Math.max(0,Math.floor(nd.y));
    const x1=Math.min(im.w,Math.ceil(nd.x+nd.w)), y1=Math.min(im.h,Math.ceil(nd.y+nd.h));
    if(x1<=x0||y1<=y0) continue;
    const counts=new Map(); let lums=[];
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ const o=y*im.stride+x*im.ch; const p=[im.data[o],im.data[o+1],im.data[o+2]];
      const k=p.join(','); counts.set(k,(counts.get(k)||0)+1); lums.push([lum(p),p]); }
    if(!lums.length) continue;
    // MODE = the background the text actually sits on (neighbouring elements are a minority of the box)
    let mode=null,mc=-1; for(const [k,c] of counts){ if(c>mc){mc=c;mode=k.split(',').map(Number);} }
    // p10 by luminance = a real gradient's dark end, without one stray dark pixel deciding it
    lums.sort((a,b)=>a[0]-b[0]); const p10=lums[Math.floor(lums.length*0.10)][1];
    const modeShare = mc/lums.length;
    const large=nd.px>=24||(nd.px>=18.66&&nd.fw>=700); const floor=large?3:4.5;
    const rMode=cr(fg.slice(0,3),mode), rP10=cr(fg.slice(0,3),p10);
    if(rMode<floor||rP10<floor) fails.push({lab:nd.lab,t:nd.t,px:nd.px,fw:nd.fw,floor,
      ratio:+rMode.toFixed(2), p10:+rP10.toFixed(2), share:+modeShare.toFixed(2),
      fg:'rgb('+fg.slice(0,3).join(',')+')', bg:'rgb('+mode.join(',')+')', bg10:'rgb('+p10.join(',')+')'});
  }
  fails.sort((a,b)=>a.ratio-b.ratio);
  console.log('###',sheet,'| nodes',nodes.length,'| FAILS',fails.length);
  for(const f of fails) console.log('   mode',String(f.ratio).padStart(5),'p10',String(f.p10).padStart(5),'<',f.floor,'| share',f.share,'|',(f.px+'px/'+f.fw).padEnd(11),'|',f.lab.padEnd(26),'|',JSON.stringify(f.t).padEnd(42),'|',f.fg,'on',f.bg,'/',f.bg10);
}
ws.close(); chrome.kill(); process.exit(0);
