let rawData=null;
let scope="recent";
let type="ALL";
const stockFilterParam = new URLSearchParams(location.search).get("stock");

const overlay=document.getElementById("loadingOverlay");
const table=document.getElementById("patternTable");
const statusEl=document.getElementById("status");
const searchEl=document.getElementById("search");
const typeEl=document.getElementById("patternType");
const directionEl=document.getElementById("direction");
const confidenceEl=document.getElementById("confidence");
const chartModal=document.getElementById("chartModal");
const chartBackdrop=document.getElementById("chartBackdrop");
const closeChartBtn=document.getElementById("closeChart");
const chartCanvasWrap=document.getElementById("chartCanvasWrap");
if(stockFilterParam) searchEl.value=stockFilterParam;

function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function money(v){return Number.isFinite(v)?`₹${v.toFixed(2)}`:"—";}
function pct(v){return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(2)}%`:"—";}
function date(v){if(!v)return"—"; const [y,m,d]=v.split("-"); return `${d}/${m}/${y}`;}
function dirClass(d){return d==="Bullish"?"bull":d==="Bearish"?"bear":"neutral";}

const icons={"Triangle":"△","Head & Shoulders":"♟","Inverse Head & Shoulders":"♟","Rising Wedge":"↗","Falling Wedge":"↘","Flag":"▰","Rising Channel":"╱","Falling Channel":"╲","Double Top":"M","Double Bottom":"W","Rounding Top":"⌒","Rounding Bottom":"⌣"};

function renderCards(){
  const counts={};
  for(const p of (rawData?.patterns||[])) counts[p.type]=(counts[p.type]||0)+1;
  const allTypes=rawData?.patternTypes||[];
  document.getElementById("patternCards").innerHTML=allTypes.map(t=>`
    <button class="pattern-card ${type===t?"selected":""}" data-type="${esc(t)}">
      <span class="icon">${icons[t]||"◆"}</span>
      <span class="card-title">${esc(t)}</span>
      <span class="card-desc">${counts[t]||0} ${scope==="recent"?"recent":"past"} candidate${counts[t]===1?"":"s"}</span>
    </button>`).join("");
  document.querySelectorAll(".pattern-card").forEach(b=>b.onclick=()=>{type=b.dataset.type;typeEl.value=type;render();});
}

function render(){
  if(!rawData)return;
  let rows=rawData.patterns||[];
  const q=searchEl.value.trim().toLowerCase();
  const d=directionEl.value;
  const c=Number(confidenceEl.value);
  if(q)rows=rows.filter(p=>p.symbol.toLowerCase().includes(q)||p.company.toLowerCase().includes(q));
  if(d!=="ALL")rows=rows.filter(p=>p.direction===d);
  if(c)rows=rows.filter(p=>p.confidence>=c);
  if(type!=="ALL")rows=rows.filter(p=>p.type===type);

  statusEl.textContent=`Showing ${rows.length} candidates · ${rawData.priceDataLoaded}/${rawData.constituentCount} Nifty 500 stocks with price data`;

  table.innerHTML=rows.map(p=>{
    return `<tr>
      <td class="stock"><b><a href="/stock?symbol=${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a></b><small>${esc(p.company)}</small></td>
      <td><span class="pattern-name">${esc(p.type)}</span></td>
      <td><span class="direction ${dirClass(p.direction)}">${esc(p.direction)}</span></td>
      <td><div class="pattern-thumb loading" data-symbol="${esc(p.symbol)}" data-type="${esc(p.type)}">Loading preview…</div></td>
      <td>${date(p.endDate)}<small>${p.ageTradingDays===0?"Latest":`${p.ageTradingDays} trading days ago`}</small></td>
      <td><div class="confidence"><span style="width:${p.confidence}%"></span></div><b>${p.confidence}%</b></td>
      <td>${money(p.currentPrice)}</td>
      <td class="${p.oneYearReturn>=0?"pos":"neg"}">${pct(p.oneYearReturn)}</td>
      <td class="note">${p.triggerPrice?`Trigger ₹${p.triggerPrice.toFixed(2)} · `:""}${esc(p.note)}</td>
      <td><button class="chart-btn" data-symbol="${esc(p.symbol)}" data-type="${esc(p.type)}">View 1Y Chart ↗</button></td>
    </tr>`;
  }).join("")||`<tr><td colspan="10" class="empty">No pattern candidates match the selected filters.</td></tr>`;
  loadVisibleThumbnails();
}

function escAttr(v){return esc(v).replaceAll("\n","");}

function patternThumbSvg(d){
  const rows=d.rows||[];
  if(rows.length<2)return null;
  const W=240,H=100,pad={l:5,r:5,t:7,b:7};
  const iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  const vals=rows.map(r=>Number.isFinite(r.close)?r.close:0).filter(Number.isFinite);
  const lo=Math.min(...vals),hi=Math.max(...vals),range=Math.max(.0001,hi-lo);
  const yMin=lo-range*.06,yMax=hi+range*.06;
  const x=i=>pad.l+i/(rows.length-1)*iw;
  const y=v=>pad.t+(yMax-v)/(yMax-yMin)*ih;
  const path=rows.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(r.close).toFixed(1)}`).join(' ');
  const ps=d.patternWindow?.start??0,pe=d.patternWindow?.end??rows.length-1;
  const bx=x(ps),bw=Math.max(1,x(pe)-bx);
  const overlays=(d.overlays||[]).map(o=>{
    if(o.kind==='hline')return `<line class="thumb-trigger" x1="${x(o.x0)}" y1="${y(o.y)}" x2="${x(o.x1)}" y2="${y(o.y)}"/>`;
    if(!o.points?.length)return '';
    const pts=o.points.map(q=>`${x(q.x).toFixed(1)},${y(q.y).toFixed(1)}`).join(' ');
    return `<polyline class="thumb-pattern" points="${pts}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const markers=(d.markers||[]).map(m=>`<circle class="thumb-marker" cx="${x(m.x)}" cy="${y(m.y)}" r="3" stroke-width="1.5"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${escAttr(d.symbol+' '+d.pattern+' preview')}">
    <rect x="${bx}" y="${pad.t}" width="${bw}" height="${ih}" fill="#f4f6f8" opacity=".8"/>
    <path d="${path}" fill="none" stroke="#263244" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${overlays}${markers}
  </svg>`;
}

const thumbObserver=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){loadThumb(e.target);thumbObserver.unobserve(e.target);}});
},{rootMargin:"300px"});

// Hovering a small pattern preview shows an enlarged version of the same 1Y chart.
let hoverPopup=null, hoverHideTimer=null;
const hoverChartCache=new Map();
function ensureHoverPopup(){
  if(hoverPopup)return hoverPopup;
  hoverPopup=document.createElement('div');
  hoverPopup.className='thumb-hover-chart';
  hoverPopup.innerHTML='<div class="hover-title"><span class="hover-name">Stock chart</span><span>1Y daily · pattern overlay</span></div><div class="hover-body"></div><div class="hover-hint">Click “View 1Y Chart” for the full interactive chart.</div>';
  document.body.appendChild(hoverPopup);
  return hoverPopup;
}
function positionHoverPopup(el){
  const pop=ensureHoverPopup(),r=el.getBoundingClientRect();
  const pw=Math.min(560,window.innerWidth-24),ph=250;
  let left=r.left;
  if(left+pw>window.innerWidth-12)left=window.innerWidth-pw-12;
  if(left<12)left=12;
  let top=r.bottom+10;
  if(top+ph>window.innerHeight-12)top=r.top-ph-10;
  if(top<12)top=12;
  pop.style.left=`${left}px`;pop.style.top=`${top}px`;
}
function showHoverChart(el){
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  clearTimeout(hoverHideTimer);
  const pop=ensureHoverPopup();
  positionHoverPopup(el);
  const symbol=el.dataset.symbol,typeName=el.dataset.type;
  pop.querySelector('.hover-name').textContent=`${symbol} · ${typeName}`;
  const body=pop.querySelector('.hover-body');
  body.innerHTML='<div class="chart-loading" style="height:190px">Loading chart…</div>';
  pop.classList.add('visible');
  const key=`${symbol}|${typeName}`;
  const cached=hoverChartCache.get(key);
  if(cached){
    body.innerHTML=cached;
    return;
  }
  fetch(`/api/pattern-chart?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(typeName)}`)
    .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.details||d.error||'Chart unavailable');return d;})
    .then(d=>{
      const svg=patternThumbSvg(d);
      if(!svg)throw new Error('Not enough data');
      const wrapped=svg.replace('<svg ','<svg class="hover-svg" ');
      hoverChartCache.set(key,wrapped);
      if(pop.classList.contains('visible'))body.innerHTML=wrapped;
    })
    .catch(e=>{if(pop.classList.contains('visible'))body.innerHTML=`<div class="chart-loading" style="height:190px;color:#b83232">${esc(e.message)}</div>`;});
}
function hideHoverChart(){
  clearTimeout(hoverHideTimer);
  hoverHideTimer=setTimeout(()=>{if(hoverPopup)hoverPopup.classList.remove('visible');},120);
}
function bindThumbnailHover(el){
  if(el.dataset.hoverBound)return;
  el.dataset.hoverBound='1';
  el.addEventListener('mouseenter',()=>showHoverChart(el));
  el.addEventListener('mouseleave',hideHoverChart);
}

function loadVisibleThumbnails(){
  document.querySelectorAll('.pattern-thumb.loading').forEach(el=>thumbObserver.observe(el));
  document.querySelectorAll('.pattern-thumb:not(.loading)').forEach(bindThumbnailHover);
}

async function loadThumb(el){
  const symbol=el.dataset.symbol,typeName=el.dataset.type;
  try{
    const r=await fetch(`/api/pattern-chart?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(typeName)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.details||d.error||'Preview unavailable');
    const svg=patternThumbSvg(d);
    if(!svg)throw new Error('Not enough data');
    el.classList.remove('loading');
    el.innerHTML=svg+`<span class="thumb-label">${esc(typeName)}</span>`;
    bindThumbnailHover(el);
  }catch(e){el.textContent='Preview unavailable';el.title=e.message;}
}

function openChart(symbol,patternType){
  chartModal.classList.remove("hidden");chartModal.setAttribute("aria-hidden","false");chartCanvasWrap.innerHTML='<div class="chart-loading">Loading chart and pattern overlay…</div>';
  fetch(`/api/pattern-chart?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(patternType)}`).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.details||d.error||"Chart request failed");return d;}).then(renderPatternChart).catch(err=>{chartCanvasWrap.innerHTML=`<div class="chart-loading" style="color:#b83232">${esc(err.message)}</div>`;});
}
function closeChart(){chartModal.classList.add("hidden");chartModal.setAttribute("aria-hidden","true");}

function renderPatternChart(d){
  document.getElementById("chartTitle").textContent=`${d.symbol} · ${d.pattern}`;
  document.getElementById("chartSubtitle").textContent=`${d.company||""} · ${date(d.startDate)} → ${date(d.endDate)} · ${d.direction}`;
  document.getElementById("chartMeta").innerHTML=`<span class="chart-chip"><strong>Confidence:</strong> ${d.confidence}%</span><span class="chart-chip"><strong>Pattern start:</strong> ${date(d.startDate)}</span><span class="chart-chip"><strong>Pattern end:</strong> ${date(d.endDate)}</span>${Number.isFinite(d.triggerPrice)?`<span class="chart-chip"><strong>Trigger:</strong> ₹${d.triggerPrice.toFixed(2)}</span>`:""}`;
  document.getElementById("chartNote").textContent=d.note||"Pattern guide is algorithmic and should be visually confirmed.";
  const rows=d.rows||[]; if(rows.length<2){chartCanvasWrap.innerHTML='<div class="chart-loading">Not enough price history to draw this chart.</div>';return;}
  const W=1100,H=480,pad={l:58,r:22,t:24,b:42},innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b;
  const allHigh=Math.max(...rows.map(x=>Number.isFinite(x.high)?x.high:x.close)),allLow=Math.min(...rows.map(x=>Number.isFinite(x.low)?x.low:x.close)),range=Math.max(.01,allHigh-allLow),yMin=allLow-range*.08,yMax=allHigh+range*.08;
  const x=i=>pad.l+i/(rows.length-1)*innerW,y=v=>pad.t+(yMax-v)/(yMax-yMin)*innerH;
  const pricePath=rows.map((r,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(r.close).toFixed(1)}`).join(' ');
  const grid=[];for(let i=0;i<=5;i++){const value=yMax-(yMax-yMin)*(i/5),yy=y(value);grid.push(`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="#e9edf2"/><text x="${pad.l-8}" y="${yy+3}" text-anchor="end" font-size="10" fill="#8490a0">₹${value.toFixed(0)}</text>`);}
  const xLabels=[],step=Math.max(1,Math.floor((rows.length-1)/6));for(let i=0;i<rows.length;i+=step)xLabels.push(`<text x="${x(i)}" y="${H-15}" text-anchor="middle" font-size="9" fill="#8a95a4">${date(rows[i].date)}</text>`);
  const ps=d.patternWindow?.start??0,pe=d.patternWindow?.end??rows.length-1,bx=x(ps),bw=Math.max(2,x(pe)-bx);
  const overlaySvg=(d.overlays||[]).map(o=>{if(o.kind==='hline')return `<line x1="${x(o.x0)}" y1="${y(o.y)}" x2="${x(o.x1)}" y2="${y(o.y)}" stroke="#d93025" stroke-width="2" stroke-dasharray="7 5"/>`;if(!o.points?.length)return '';const pts=o.points.map(p=>`${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');return `<polyline points="${pts}" fill="none" stroke="#d93025" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"/>`;}).join('');
  const markerSvg=(d.markers||[]).map(m=>`<circle cx="${x(m.x)}" cy="${y(m.y)}" r="5" fill="#fff" stroke="#d93025" stroke-width="2"/><text x="${x(m.x)+8}" y="${y(m.y)-8}" font-size="9" font-weight="700" fill="#b4232b">${escAttr(m.label)}</text>`).join('');
  chartCanvasWrap.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(d.symbol+' '+d.pattern+' price chart')}"><rect x="${bx}" y="${pad.t}" width="${bw}" height="${innerH}" fill="#eef4fb" opacity=".65"/>${grid.join('')}<line x1="${pad.l}" y1="${pad.t+innerH}" x2="${W-pad.r}" y2="${pad.t+innerH}" stroke="#dce2e9"/>${xLabels.join('')}<path d="${pricePath}" fill="none" stroke="#172033" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${overlaySvg}${markerSvg}<text x="${bx+8}" y="${pad.t+16}" font-size="10" font-weight="800" fill="#5e82b4">PATTERN WINDOW</text></svg>`;
}


async function load(force=false){
  overlay.classList.remove("hidden");table.innerHTML=`<tr><td colspan="10" class="loading-row">Scanning Nifty 500… please wait.</td></tr>`;statusEl.textContent="Scanning…";
  try{const r=await fetch(`/api/patterns?scope=${scope}&type=ALL${force?"&refresh=1":""}`),data=await r.json();if(!r.ok)throw new Error(data.details||data.error||"Pattern scan failed");rawData=data;document.getElementById("updated").textContent=`Updated ${new Date(data.updatedAt).toLocaleString()}`;document.getElementById("updatedBottom").textContent=`Updated ${new Date(data.updatedAt).toLocaleString()}`;typeEl.innerHTML=`<option value="ALL">All patterns</option>`+(data.patternTypes||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");renderCards();render();}catch(e){statusEl.textContent=`Error: ${e.message}`;table.innerHTML=`<tr><td colspan="10" class="empty error">${esc(e.message)}</td></tr>`;}finally{overlay.classList.add("hidden");}
}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");scope=b.dataset.scope;load(false);});
[searchEl,typeEl,directionEl,confidenceEl].forEach(x=>x.addEventListener("input",()=>{if(x===typeEl)type=typeEl.value;render();}));
document.getElementById("refresh").onclick=()=>load(true);

table.addEventListener("click",event=>{
  const button=event.target.closest(".chart-btn");
  if(!button)return;
  event.stopPropagation();
  openChart(button.dataset.symbol,button.dataset.type);
});
closeChartBtn.addEventListener("click",closeChart);chartBackdrop.addEventListener("click",closeChart);document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChart();});
load(false);

window.addEventListener('scroll',()=>{if(hoverPopup?.classList.contains('visible'))hideHoverChart();},{passive:true});
window.addEventListener('resize',()=>{if(hoverPopup?.classList.contains('visible'))hoverPopup.classList.remove('visible');});
