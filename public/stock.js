let data=null,chart=null,range=new URLSearchParams(location.search).get("range")||"5y",searchTimer=null;const $=x=>document.getElementById(x);let symbol=new URLSearchParams(location.search).get("symbol")||"RELIANCE";function money(x){return Number.isFinite(x)?"₹"+x.toLocaleString("en-IN",{maximumFractionDigits:2}):"—"}function pct(x){return Number.isFinite(x)?(x>=0?"+":"")+x.toFixed(2)+"%":"—"}function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}function render(){
  const s=data.stats;
  $("name").textContent=data.symbol;
  $("company").textContent=data.company || data.symbol;
  $("meta").textContent=`${data.industry ? data.industry+" · " : ""}${data.exchange} · ${data.currency} · ${data.rows[0]?.date||""} to ${data.rows.at(-1)?.date||""}`;
  $("price").textContent=money(s.latest);
  ["r1","r3","r6","r12","r36","r60"].forEach((id,i)=>$(id).textContent=pct([s.change1m,s.change3m,s.change6m,s.change1y,s.change3y,s.change5y][i]));
  $("s20").textContent=money(s.sma20);$("s50").textContent=money(s.sma50);$("s200").textContent=money(s.sma200);
  $("hi").textContent=money(s.high52);$("lo").textContent=money(s.low52);
  $("vs").textContent=Number.isFinite(s.sma200)?pct((s.latest-s.sma200)/s.sma200*100):"—";
  $("chartInfo").textContent=`Daily data · ${data.rows.length} valid sessions · Maximum 5 years`;
  $("patterns").innerHTML=`<a href="/patterns?stock=${encodeURIComponent(data.symbol)}" style="font-size:12px">View ${esc(data.symbol)} in Chart Patterns</a>`;
}
function draw(){
  const n={"1m":21,"3m":63,"6m":126,"1y":252,"3y":756,"5y":1260}[range]||1260;
  const rows=data.rows.slice(-n);
  if(chart)chart.destroy();
  const closes=data.rows.map(x=>x.close);
  const sma=(period,i)=>{
    if(i<period-1)return null;
    const part=closes.slice(i-period+1,i+1);
    if(part.length<period||part.some(v=>!Number.isFinite(v)))return null;
    return part.reduce((a,b)=>a+b,0)/period;
  };
  const colors={20:"#2563eb",50:"#16a34a",100:"#d97706",200:"#dc2626"};
  const datasets=[
    {label:data.symbol,data:rows.map(x=>x.close),pointRadius:0,borderWidth:1.9,tension:.08,borderColor:"#172033"},
    ...[20,50,100,200].map(period=>({
      label:`SMA ${period}`,
      data:rows.map(x=>sma(period,data.rows.indexOf(x))),
      pointRadius:0,
      borderWidth:1.25,
      tension:.05,
      borderColor:colors[period],
      spanGaps:false
    }))
  ];
  chart=new Chart($("chart"),{
    type:"line",
    data:{labels:rows.map(x=>x.date),datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      resizeDelay:80,
      animation:false,
      interaction:{mode:"index",intersect:false},
      plugins:{
        legend:{display:true,position:"top",labels:{usePointStyle:true,boxWidth:8,padding:12,font:{size:11,weight:"700"}}},
        tooltip:{displayColors:true,callbacks:{title:items=>items?.[0]?.label||"",label:ctx=>{
          const v=ctx.parsed.y;
          return ` ${ctx.dataset.label}: ₹${Number(v).toLocaleString("en-IN",{maximumFractionDigits:2})}`;
        }}}
      },
      scales:{
        x:{ticks:{maxTicksLimit:10,maxRotation:0,autoSkip:true},grid:{color:"rgba(23,32,51,.07)"}},
        y:{beginAtZero:false,grace:"2%",ticks:{maxTicksLimit:8,callback:v=>"₹"+Number(v).toLocaleString("en-IN")},grid:{color:"rgba(23,32,51,.07)"}}
      }
    }
  });
}function renderSuggestions(items){
  const box=$("suggestions");
  if(!items.length){box.classList.add("hidden");box.innerHTML="";return;}
  box.innerHTML=items.map(x=>`<button class="suggestion" data-symbol="${esc(x.symbol)}"><b>${esc(x.symbol)}</b><span>${esc(x.company)}${x.industry?" · "+esc(x.industry):""}</span></button>`).join("");
  box.classList.remove("hidden");
  box.querySelectorAll(".suggestion").forEach(b=>b.onclick=()=>{symbol=b.dataset.symbol;$("symbol").value=symbol;box.classList.add("hidden");load();});
}
async function searchStocks(q){
  if(!q){renderSuggestions([]);return;}
  try{const r=await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);const items=await r.json();renderSuggestions(Array.isArray(items)?items:[]);}catch(_){renderSuggestions([]);}
}
async function load(){ window.showPageLoading?.("Loading Stock Chart…","Fetching up to 5 years of daily price history."); $("loading").classList.remove("hide");try{const r=await fetch("/api/stock/"+encodeURIComponent(symbol));const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to load stock");data=j;render();draw();$("symbol").value=data.symbol;history.replaceState({}, "", "/stock?symbol="+data.symbol+"&range="+range)}catch(e){$("name").textContent="Unable to load";$("meta").textContent=e.message}finally{$("loading").classList.add("hide");window.hidePageLoading?.();window.dispatchEvent(new Event("dashboard-loaded"));}}document.querySelectorAll("[data-r]").forEach(b=>b.classList.toggle("on",b.dataset.r===range));document.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{range=b.dataset.r;document.querySelectorAll("[data-r]").forEach(x=>x.classList.remove("on"));b.classList.add("on");if(data)draw()});$("go").onclick=()=>{const x=$("symbol").value.trim().toUpperCase();if(x){symbol=x;load()}};$("symbol").onkeydown=e=>{if(e.key==="Enter")$("go").click()};$("symbol").value=symbol;$("symbol").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchStocks($("symbol").value.trim()),180);});document.addEventListener("click",e=>{if(!e.target.closest(".stock-search"))$("suggestions").classList.add("hidden")});load();