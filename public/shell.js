(()=>{
const D=document,R=D.documentElement,$=s=>D.querySelector(s);
const P={
home:'<path d="M4 11l8-7 8 7M6 10v9h12v-9"/>',
dl:'<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
pdf:'<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5"/>',
img:'<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4.500-4.500 3 3 2-2L19 17"/>',
vid:'<rect x="4" y="6" width="12" height="12" rx="3"/><path d="M16 11l4-2.500v7L16 13"/>',
qr:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2M14 19h2"/>',
txt:'<path d="M5 6h14M12 6v13M9 19h6"/>'};
const TOOLS=[
{n:'GlassGrab',p:'/grab',d:'Download videos from any link',i:'dl',live:1},
{n:'GlassQR',p:'/qr',d:'Create QR codes for links, Wi-Fi, and more',i:'qr',live:1},];
const ico=k=>`<span class="ico"><svg viewBox="0 0 24 24">${P[k]}</svg></span>`;
window.GlassKit={TOOLS,ico,cards(el){el.innerHTML=TOOLS.map((t,i)=>{const tag=t.live?'a':'div',h=t.live?` href="${t.p}"`:'';
 return `<${tag} class="glass card ${t.live?'live':'soon'}"${h} style="--n:${i}">${ico(t.i)}<b>${t.n}</b><p>${t.d}</p><span class="chip">${t.live?'Open':'Coming soon'}</span></${tag}>`}).join('')}};
const TC={light:['#f5f5f5','#7b7b7b'],dark:['#0a0a0a','#050505']};
const tcolor=()=>{const m=$('meta[name=theme-color]');if(!m)return;const b=D.body.classList;m.content=TC[R.dataset.theme==='dark'?'dark':'light'][(b.contains('menu')||b.contains('dim'))?1:0]};
GlassKit.dim=v=>{D.body.classList.toggle('dim',!!v);tcolor()};
const here=location.pathname.replace(/\/$/,'').replace(/\.html$/,'')||'/';
const item=(t,cur)=>{const live=t.live||t.home,tag=live?'a':'div';
 return `<${tag} class="di${cur?' cur':''}${live?'':' soon'}"${live?` href="${t.p}"`:' aria-disabled="true"'}${cur?' aria-current="page"':''}>${ico(t.i)}<span class="tx"><b>${t.n}</b><small>${t.d}</small></span>${live?'':'<span class="chip">Soon</span>'}</${tag}>`};
function mount(){
 const mb=$('#mb');if(!mb)return;
 const sc=D.createElement('div'),dr=D.createElement('nav');
 sc.className='scrim';dr.className='drawer';dr.id='dr';dr.setAttribute('aria-label','Tools');dr.inert=true;
 dr.innerHTML='<div class="dh"><b>GlassKit</b><button class="x" aria-label="Close menu"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
  +[{n:'Home',p:'/',d:'All tools',i:'home',home:1},...TOOLS].map(t=>item(t,t.p===here)).join('')+'<p class="dc">Made by <b translate="no">Joel G. Thompson</b> &middot; <a class="lk" href="/legal">Privacy &amp; Terms</a></p>';
 D.body.append(sc,dr);
 const mq=matchMedia('(min-width:1280px)'),side=()=>{if(mq.matches)D.body.classList.remove('menu');dr.inert=mq.matches?false:!D.body.classList.contains('menu')};mq.addEventListener('change',side);side();
 const set=v=>{D.body.classList.toggle('menu',v);tcolor();mb.setAttribute('aria-expanded',v);dr.inert=!v;(v?dr.querySelector('.x'):mb).focus({preventScroll:true})};
 mb.onclick=()=>{set(true)};sc.onclick=()=>{set(false)};dr.querySelector('.x').onclick=()=>{set(false)};
 dr.onclick=e=>{if(e.target.closest('a'))set(false)};
 D.addEventListener('keydown',e=>e.key==='Escape'&&D.body.classList.contains('menu')&&set(false));
}
function themeInit(){
 const tsw=$('#tsw');if(!tsw||D.body.hasAttribute('data-own-theme'))return;
 const dark=()=>R.dataset.theme==='dark',st=v=>{try{localStorage.setItem('theme',v)}catch(e){}};
 const sync=()=>{tsw.classList.toggle('on',dark());tsw.setAttribute('aria-checked',dark());$('meta[name=theme-color]').content=dark()?'#0a0a0a':'#f5f5f5'};
 const set=v=>{R.dataset.theme=v?'dark':'light';st(R.dataset.theme);sync()};
 let id=null,x0=0,p0=0,trv=0,mv=false;
 tsw.addEventListener('pointerdown',e=>{if(e.button)return;id=e.pointerId;tsw.setPointerCapture(id);tsw.querySelector('.kn').getAnimations().forEach(a=>a.cancel());x0=e.clientX;trv=tsw.offsetWidth-44;p0=dark()?trv:0;mv=false;clearTimeout(tsw._t);tsw.classList.add('press')});
 tsw.addEventListener('pointermove',e=>{if(e.pointerId!==id)return;const dx=e.clientX-x0;if(!mv&&Math.abs(dx)<4)return;mv=true;tsw.classList.add('drag');{const x=p0+dx,q=o=>5*(1-Math.exp(-o/30));tsw.style.setProperty('--x',(x<0?-q(-x):x>trv?trv+q(x-trv):x)+'px')}});
 const end=(e,ok)=>{if(e.pointerId!==id)return;id=null;let v=dark();if(ok)v=mv?parseFloat(tsw.style.getPropertyValue('--x'))>trv/2:!v;tsw.classList.remove('drag');tsw.style.removeProperty('--x');clearTimeout(tsw._t);if(v!==dark()){tsw._t=setTimeout(()=>tsw.classList.remove('press'),180);set(v)}else{tsw.classList.remove('press');if(mv)GlassKit.jelly(tsw.querySelector('.kn'),.7,dark()?'right':'left')}};
 tsw.addEventListener('pointerup',e=>end(e,true));tsw.addEventListener('pointercancel',e=>end(e,false));
 tsw.addEventListener('click',e=>{if(e.detail===0)set(!dark())});
 sync();requestAnimationFrame(()=>requestAnimationFrame(()=>R.classList.add('ready')));
}
const go=()=>{mount();themeInit();const c=$('#cards');if(c)GlassKit.cards(c)};
D.readyState==='loading'?D.addEventListener('DOMContentLoaded',go):go();
})();

(()=>{ // tahan / tap / scroll / keyboard. Pakai Web Animations supaya animasi masuk (CSS) tidak ikut terulang
const D=document,SEL='button,a.card,a.di,.rc',RM=matchMedia('(prefers-reduced-motion:reduce)'),E='cubic-bezier(.4,0,.2,1)',S='cubic-bezier(.34,1.56,.64,1)';
let el=null,x0=0,y0=0,t1,t2,quiet=0,ls=0,touch=0;const A=new WeakMap();
const go=(e,k,o)=>{if(RM.matches)return;const a=e.animate(k,o);A.set(e,[...(A.get(e)||[]),a])};
const swap=(e,k,o)=>{const old=A.get(e)||[];A.delete(e);if(k)go(e,k,o);old.forEach(a=>a.cancel())};
const hold=e=>{e.classList.add('holding');go(e,[{scale:1,opacity:1},{scale:.965,opacity:.88}],{duration:180,easing:E,fill:'forwards'})};
const arm=e=>{e.classList.add('armed');go(e,[{scale:.965,opacity:.88},{scale:.94,opacity:.76}],{duration:380,easing:S,fill:'forwards'})};
const TAP=[{scale:.94,opacity:.8},{scale:1.035,opacity:1,offset:.5},{scale:1,opacity:1}];
const end=c=>{if(!el)return;clearTimeout(t1);clearTimeout(t2);const e=el,seen=e.classList.contains('holding'),q=quiet;el=null;e.classList.remove('holding','armed');
 if(c==='cancel'&&!seen||q&&c==='tapped')return swap(e);
 if(c==='tapped')swap(e,TAP,{duration:450,easing:S});
 else swap(e,[{scale:.95,opacity:.8},{scale:1,opacity:1}],{duration:400,easing:E})};
D.addEventListener('scroll',()=>{ls=Date.now();end('cancel')},true);
D.addEventListener('pointerdown',ev=>{end();if(ev.button>0)return;const b=ev.target.closest(SEL);
 if(!b||b.disabled||b.getAttribute('aria-disabled')==='true'||b.closest('.sw,.seg'))return;el=b;x0=ev.clientX;y0=ev.clientY;touch=ev.pointerType!=='mouse';
 quiet=Date.now()-ls<250?1:0; // layar masih bergulir: sentuhan ini hanya menghentikan scroll
 if(quiet)return;
 t1=setTimeout(()=>el&&hold(el),touch?130:40);t2=setTimeout(()=>el&&arm(el),touch?600:450)});
D.addEventListener('pointermove',ev=>{if(!el)return;
 if(Math.hypot(ev.clientX-x0,ev.clientY-y0)>(touch?6:10)||(!touch&&!el.contains(ev.target)))end('cancel')});
D.addEventListener('pointerup',ev=>{if(el)end(el.contains(ev.target)?'tapped':'cancel')});
['pointercancel','contextmenu','blur'].forEach(n=>addEventListener(n,()=>end('cancel')));
const pick=ev=>{const b=ev.target.closest&&ev.target.closest(SEL);return b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&!b.closest('.sw,.seg')?b:null};
D.addEventListener('keydown',ev=>{if(ev.repeat||ev.key!=='Enter'&&ev.key!==' ')return;const b=pick(ev);if(b)hold(b)});
D.addEventListener('keyup',ev=>{const b=pick(ev);if(b&&b.classList.contains('holding')&&!el){b.classList.remove('holding','armed');swap(b,TAP,{duration:450,easing:S})}});
})();

(()=>{ // morph: kotak tumbuh/menyusut mengikuti isi baru dan isi baru memudar masuk. Maknanya "isi berubah"; elemen di bawahnya ikut bergeser mulus
const RM=matchMedia('(prefers-reduced-motion:reduce)'),E='cubic-bezier(.32,.72,0,1)';
GlassKit.morph=(el,fn,o={})=>{
 if(!el||RM.matches||!el.animate)return fn();
 const h0=el.offsetHeight;if(el._m)el._m.cancel();
 fn();
 const h1=el.offsetHeight;
 if(o.fade!==false)[...el.children].forEach((c,i)=>c.animate([{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0'}],{duration:380,delay:Math.min(i,6)*45,easing:E,fill:'backwards'}));
 if(Math.abs(h1-h0)<2)return;
 if(el._ov===undefined)el._ov=el.style.overflow;el.style.overflow='hidden';
 const a=el._m=el.animate([{height:h0+'px'},{height:h1+'px'}],{duration:Math.min(620,300+Math.abs(h1-h0)*1.2),easing:E});
 const end=()=>{if(el._m===a){el._m=null;el.style.overflow=el._ov;el._ov=undefined}};a.onfinish=end;a.oncancel=end;
}})();

(()=>{ // blend: teks lama memudar keluar sambil teks baru memudar masuk (dengan blur tipis), tinggi kotak ikut berubah mulus. Maknanya "pesan ini berganti", bukan kedip
const RM=matchMedia('(prefers-reduced-motion:reduce)'),E='cubic-bezier(.32,.72,0,1)';
GlassKit.blend=(el,txt,on=true)=>{
 if(!el)return;const cur=el._bt!==undefined?el._bt:el.textContent;
 if(cur===txt&&el.childElementCount<=1&&el.textContent.trim()===txt.trim())return;
 el.querySelectorAll('[data-g]').forEach(g=>g.remove());
 const now=performance.now(),fast=now-(el._ts||0)<260;el._ts=now;
 if(!on||fast||RM.matches||!el.animate||!cur){if(el._m)el._m.cancel();el._bt=txt;el.textContent=txt;return}
 const pos=getComputedStyle(el).position;el._bt=txt;
 GlassKit.morph(el,()=>{
  const g=document.createElement('span'),n=document.createElement('span');
  g.dataset.g='';g.setAttribute('aria-hidden','true');g.textContent=cur;g.style.cssText='position:absolute;inset:0;pointer-events:none';
  n.textContent=txt;if(pos==='static')el.style.position='relative';
  el.replaceChildren(n,g);
  n.style.display='block';n.animate([{opacity:0,filter:'blur(3px)',translate:'0 5px'},{opacity:1,filter:'blur(0)',translate:'0 0'}],{duration:320,delay:60,easing:E,fill:'backwards'});
  g.animate([{opacity:1,filter:'blur(0)',translate:'0 0'},{opacity:0,filter:'blur(3px)',translate:'0 -4px'}],{duration:170,easing:'ease-out',fill:'forwards'}).onfinish=()=>{g.remove();if(pos==='static')el.style.position=''};
 },{fade:false});
}})();

(()=>{ // jelly: kaca memanjang searah gerak lalu memantul dan mengendap, seperti benda cair yang berhenti. Maknanya "sudah mendarat di pilihan ini"
const RM=matchMedia('(prefers-reduced-motion:reduce)');
GlassKit.jelly=(el,d,o='center')=>{if(!el||!el.animate||RM.matches)return;const A=Math.min(.16+.1*d,.4)*(o==='center'?1:.55),f=x=>x.toFixed(3),e='cubic-bezier(.4,0,.3,1)',S=(x,y,t)=>({transform:`scale(${f(x)},${f(y)})`,offset:t,easing:e});
 el.style.transformOrigin=o+' center';   // di ujung, kaca bertumpu pada dinding track: melar ke dalam, tidak keluar
 const a=el.animate([S(1,1,0),S(1+A,1-A*.55,.2),S(1-A*.5,1+A*.35,.42),S(1+A*.22,1-A*.12,.62),S(1-A*.08,1+A*.05,.8),S(1,1,1)],{duration:950});a.onfinish=a.oncancel=()=>{el.style.transformOrigin=''}};
new MutationObserver(()=>{const k=document.querySelector('.sw .kn'),H=document.documentElement;if(k&&H.classList.contains('ready'))GlassKit.jelly(k,.5,H.dataset.theme==='dark'?'right':'left')}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
})();
