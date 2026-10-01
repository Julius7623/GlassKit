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
{n:'GlassPDF',p:'/pdf',d:'Merge, split, and compress PDF files',i:'pdf'},
{n:'GlassQR',p:'/qr',d:'Create QR codes for links, WiFi, and more',i:'qr'},];
const ico=k=>`<span class="ico"><svg viewBox="0 0 24 24">${P[k]}</svg></span>`;
window.GlassKit={TOOLS,ico,cards(el){el.innerHTML=TOOLS.map((t,i)=>{const tag=t.live?'a':'div',h=t.live?` href="${t.p}"`:'';
 return `<${tag} class="glass card ${t.live?'live':'soon'}"${h} style="--n:${i}">${ico(t.i)}<b>${t.n}</b><p>${t.d}</p><span class="chip">${t.live?'Open':'Coming soon'}</span></${tag}>`}).join('')}};
const here=location.pathname.replace(/\/$/,'').replace(/\.html$/,'')||'/';
const item=(t,cur)=>{const live=t.live||t.home,tag=live?'a':'div';
 return `<${tag} class="di${cur?' cur':''}${live?'':' soon'}"${live?` href="${t.p}"`:' aria-disabled="true"'}${cur?' aria-current="page"':''}>${ico(t.i)}<span class="tx"><b>${t.n}</b><small>${t.d}</small></span>${live?'':'<span class="chip">Soon</span>'}</${tag}>`};
function mount(){
 const mb=$('#mb');if(!mb)return;
 const sc=D.createElement('div'),dr=D.createElement('nav');
 sc.className='scrim';dr.className='drawer';dr.id='dr';dr.setAttribute('aria-label','Tools');dr.inert=true;
 dr.innerHTML='<div class="dh"><b>GlassKit</b><button class="x" aria-label="Close menu"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
  +[{n:'Home',p:'/',d:'All tools',i:'home',home:1},...TOOLS].map(t=>item(t,t.p===here)).join('')+'<p class="dc">Made by <b translate="no">Joel G. Thompson</b></p>';
 D.body.append(sc,dr);
 const set=v=>{D.body.classList.toggle('menu',v);mb.setAttribute('aria-expanded',v);dr.inert=!v;(v?dr.querySelector('.x'):mb).focus({preventScroll:true})};
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
 tsw.addEventListener('pointerdown',e=>{if(e.button)return;id=e.pointerId;tsw.setPointerCapture(id);x0=e.clientX;trv=tsw.offsetWidth-44;p0=dark()?trv:0;mv=false;clearTimeout(tsw._t);tsw.classList.add('press')});
 tsw.addEventListener('pointermove',e=>{if(e.pointerId!==id)return;const dx=e.clientX-x0;if(!mv&&Math.abs(dx)<4)return;mv=true;tsw.classList.add('drag');tsw.style.setProperty('--x',Math.max(0,Math.min(trv,p0+dx))+'px')});
 const end=(e,ok)=>{if(e.pointerId!==id)return;id=null;let v=dark();if(ok)v=mv?parseFloat(tsw.style.getPropertyValue('--x'))>trv/2:!v;tsw.classList.remove('drag');tsw.style.removeProperty('--x');clearTimeout(tsw._t);if(v!==dark()){tsw._t=setTimeout(()=>tsw.classList.remove('press'),180);set(v)}else tsw.classList.remove('press')};
 tsw.addEventListener('pointerup',e=>end(e,true));tsw.addEventListener('pointercancel',e=>end(e,false));
 tsw.addEventListener('click',e=>{if(e.detail===0)set(!dark())});
 sync();requestAnimationFrame(()=>requestAnimationFrame(()=>R.classList.add('ready')));
}
const go=()=>{mount();themeInit();const c=$('#cards');if(c)GlassKit.cards(c)};
D.readyState==='loading'?D.addEventListener('DOMContentLoaded',go):go();
})();
