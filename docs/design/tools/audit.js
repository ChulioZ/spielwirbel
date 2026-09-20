window.__audit = function(){
 const parse=(s)=>{ if(!s) return null; let m=s.match(/rgba?\(([^)]+)\)/); if(m){const p=m[1].split(/[ ,\/]+/).map(x=>parseFloat(x)).filter(x=>!isNaN(x)); return [p[0],p[1],p[2],p.length>3?p[3]:1];}
   m=s.match(/#([0-9a-f]{6})\b/i); if(m){const h=m[1];return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),1];}
   m=s.match(/#([0-9a-f]{3})\b/i); if(m){const h=m[1];return [parseInt(h[0]+h[0],16),parseInt(h[1]+h[1],16),parseInt(h[2]+h[2],16),1];} return null; };
 const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
 const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
 const blend=(fg,bg)=>{const a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1]};
 function layers(el){ const out=[]; let node=el;
   while(node && node!==document.documentElement){ const cs=getComputedStyle(node); const bi=cs.backgroundImage; const bc=parse(cs.backgroundColor);
     if(bi && bi!=='none'){ const stops=[...bi.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,6}\b/gi)].map(m=>parse(m[0])).filter(Boolean); if(/url\(/.test(bi)) out.push({img:true}); if(stops.length) out.push({stops}); if(stops.length && stops.every(s=>s[3]>=0.99) && !/url\(/.test(bi)) { return out; } }
     if(bc && bc[3]>0){ out.push({stops:[bc]}); if(bc[3]>=0.99) return out; }
     node=node.parentElement; }
   out.push({stops:[[255,255,255,1]]}); return out; }
 function candidates(el){ const ls=layers(el); let base=[255,255,255,1]; for(let i=ls.length-1;i>=0;i--){const l=ls[i]; if(l.stops){const s=l.stops.find(s=>s[3]>=0.99); if(s){base=s;break;}}}
   let out=[base], hasImg=false; for(let i=ls.length-1;i>=0;i--){const l=ls[i]; if(l.img){hasImg=true;continue;} if(!l.stops) continue; const next=[]; for(const s of l.stops){ for(const b of out){ next.push(s[3]>=0.99?s:blend(s,b)); } } out=next.slice(0,24);} return {cands:out,hasImg}; }
 const results=[], seen=new Set(); const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
 while((n=walker.nextNode())){ const t=n.textContent.replace(/\s+/g,' ').trim(); if(t.length<2) continue; const el=n.parentElement; if(!el) continue;
   const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue; if(parseFloat(cs.opacity)<0.99 && parseFloat(cs.opacity)>0) {} 
   const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue; const fg=parse(cs.color); if(!fg) continue;
   const size=parseFloat(cs.fontSize), weight=parseInt(cs.fontWeight)||400; const large=size>=24||(size>=18.66&&weight>=700); const floor=large?3:4.5;
   const {cands,hasImg}=candidates(el); let worst=Infinity, worstBg=null; for(const b of cands){ const f=fg[3]<0.99?blend(fg,b):fg; const c=cr(f,b); if(c<worst){worst=c;worstBg=b;} }
   if(worst<floor){ const lab=el.closest('[data-screen-label]'); const label=lab?lab.getAttribute('data-screen-label'):'?'; const key=label+'|'+t.slice(0,24)+'|'+cs.color; if(seen.has(key)) continue; seen.add(key);
     results.push({label,text:t.slice(0,36),fg:cs.color,bg:'rgb('+worstBg.slice(0,3).map(Math.round).join(',')+')',ratio:+worst.toFixed(2),floor,px:Math.round(size),w:weight,img:hasImg}); } }
 results.sort((a,b)=>a.ratio-b.ratio);
 const targets=[], tseen=new Set();
 for(const el of document.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]),select,[role=tab],[role=radio],[role=checkbox],[role=switch],[tabindex="0"]')){
   const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue; const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue;
   const lab=el.closest('[data-screen-label]'); const label=lab?lab.getAttribute('data-screen-label'):'?'; const inVote=/Wertung|Dock|Abstimmung ohne/i.test(label); const min=inVote?44:24;
   if(Math.min(r.width,r.height)<min){ const t=(el.innerText||el.getAttribute('aria-label')||el.tagName).replace(/\s+/g,' ').trim().slice(0,28); const k=label+'|'+t+'|'+Math.round(r.width)+'x'+Math.round(r.height); if(tseen.has(k)) continue; tseen.add(k); targets.push({label,t,w:Math.round(r.width),h:Math.round(r.height),min}); } }
 return JSON.stringify({textNodes:seen.size,contrastFails:results.length,contrast:results.slice(0,45),targetFails:targets.length,targets:targets.slice(0,30)});
};
