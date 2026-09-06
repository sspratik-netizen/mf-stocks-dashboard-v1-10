let mwData=null;
const $=id=>document.getElementById(id);
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function pct(v){return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(2)}%`:"—";}
function pp(v){return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(2)} pp`:"—";}
function statusHtml(s){
  if(s==="WATCH") return '<span class="mw-signal watch">🔵 Watch</span>';
  if(s==="MONITOR") return '<span class="mw-signal monitor">🟡 Monitor</span>';
  return '<span class="mw-signal neutral">—</span>';
}
function rowMetrics(r, cat){
  const current = (r.funds||[]).filter(f=>!cat || f.category===cat);
  const tracked = (r.trackedFunds||r.funds||[]).filter(f=>!cat || f.category===cat);
  const holding = current.length;
  const avg = Number.isFinite(r.avgAllocation) ? r.avgAllocation : (current.length ? current.reduce((a,f)=>a+(Number(f.allocation)||0),0)/current.length : null);
  const delta = Number.isFinite(r.deltaAllocation) ? r.deltaAllocation : null;
  return {
    funds: current,
    tracked,
    holding,
    avg,
    delta,
    inc: Number(r.fundsIncreasing)||0,
    dec: Number(r.fundsDecreasing)||0,
    stable: Number(r.fundsUnchanged)||0,
    newly: Number(r.newFunds)||0,
    exited: Number(r.fundsExited)||0
  };
}
function flowHtml(m){
  const parts=[];
  if(m.inc) parts.push(`<span class="flow-up">${m.inc} ↑</span>`);
  if(m.dec) parts.push(`<span class="flow-down">${m.dec} ↓</span>`);
  if(m.stable) parts.push(`<span class="flow-flat">${m.stable} →</span>`);
  if(m.newly) parts.push(`<span class="flow-new">${m.newly} new</span>`);
  if(m.exited) parts.push(`<span class="flow-exit">${m.exited} sold</span>`);
  return parts.join(' · ') || '—';
}
function flowTitle(m){
  const detail=[];
  if(m.inc) detail.push(`${m.inc} increased`);
  if(m.dec) detail.push(`${m.dec} decreased`);
  if(m.stable) detail.push(`${m.stable} unchanged`);
  if(m.newly) detail.push(`${m.newly} new`);
  if(m.exited) detail.push(`${m.exited} exited/sold`);
  return detail.length ? detail.join(' · ') : 'No month-on-month allocation change available';
}
function renderFunds(){
  const selected=$("mwCategory").value;
  const cats=[selected];
  $("mwFundCards").innerHTML=cats.map(cat=>{
    const funds=mwData?.topFunds?.[cat]||[];
    return `<div class="mw-fund-card"><div class="eyebrow">${esc(cat)}</div><h3>Top ${funds.length||5}</h3>
      ${funds.map(f=>`<div class="fund-line"><span>${esc(f.fund)}</span><b>#${f.rank}</b></div>`).join("")}</div>`;
  }).join("");
}
function render(){
  if(!mwData)return;
  renderFunds();
  const cat=$("mwCategory").value;
  const min=Number($("mwMinFunds").value);
  const q=$("mwSearch").value.trim().toLowerCase();
  const trend=$("mwTrend")?.value || "ALL";
  const sort=$("mwSort")?.value || "funds-desc";
  let rows=(mwData.rows||[]).filter(r=>{
    const m=rowMetrics(r,cat);
    const categoryMatch=(r.category===cat) || (r.categories||[]).includes(cat);
    const trendMatch = trend === "ALL" || (trend === "UP" && m.delta > 0.005) || (trend === "DOWN" && m.delta < -0.005) || (trend === "FLAT" && Math.abs(m.delta||0) <= 0.005);
    return categoryMatch && m.holding>=min && trendMatch && (!q||r.stock.toLowerCase().includes(q)||r.company.toLowerCase().includes(q));
  });
  rows.sort((a,b)=>{
    const ma=rowMetrics(a,cat), mb=rowMetrics(b,cat);
    const val=(m,key)=> key==='funds'?m.holding:key==='avg'?m.avg:key==='delta'?m.delta:null;
    if(sort.startsWith('funds-')) return (sort.endsWith('desc')?-1:1)*(val(mb,'funds')-val(ma,'funds'));
    if(sort.startsWith('avg-')) return (sort.endsWith('desc')?-1:1)*((val(mb,'avg')||-Infinity)-(val(ma,'avg')||-Infinity));
    if(sort.startsWith('delta-')) return (sort.endsWith('desc')?-1:1)*((val(mb,'delta')||-Infinity)-(val(ma,'delta')||-Infinity));
    if(sort.startsWith('correction-')) {
      const av=Number.isFinite(a.correction)?a.correction:null, bv=Number.isFinite(b.correction)?b.correction:null;
      if(av===null&&bv===null)return 0; if(av===null)return 1; if(bv===null)return -1;
      return sort.endsWith('asc') ? av-bv : bv-av;
    }
    return 0;
  });
  $("mwTable").innerHTML=rows.length?rows.map(r=>{
    const m=rowMetrics(r,cat);
    const universeFunds=mwData.topFunds?.[cat]||[];
    const coverage=mwData.providerCoverage?.[cat]||{selected:universeFunds.length,loaded:universeFunds.length,failed:0};
    const denominator=coverage.selected || universeFunds.length || 10;
    const categoryLabel = `<span class="category-pill">${esc(cat)}</span>`;
    const detailId=`mw-details-${String(r.stock).replace(/[^a-zA-Z0-9_-]/g,'-')}`;
    const trackedByFund=new Map((m.tracked||[]).map(f=>[f.fund,f]));
    const detailRows=universeFunds.map(f=>{
      const name=f.fund;
      const x=trackedByFund.get(name);
      if(!x){
        const providerErr=(mwData.providerErrors||[]).find(e=>e.fund===name);
        const msg=providerErr ? `Source unavailable: ${providerErr.error}` : 'Not held / no prior holding data';
        return `<div class="mw-fund-detail-row"><span class="mw-detail-fund">${esc(name)}</span><span class="mw-detail-muted">${esc(msg)}</span></div>`;
      }
      const cur=Number(x.allocation)||0;
      const prev=Number.isFinite(x.previousAllocation)?x.previousAllocation:null;
      const d=prev!==null?cur-prev:null;
      let action='No change';
      if(x.changeType && /new/i.test(x.changeType)) action='New';
      else if(prev!==null && prev>0.001 && cur<=0.001) action='Sold / exited';
      else if(d!==null && d>0.01) action='Increased';
      else if(d!==null && d<-0.01) action='Decreased';
      const cls=action==='Increased'?'flow-up':action==='Decreased'?'flow-down':action==='Sold / exited'?'flow-exit':action==='New'?'flow-new':'flow-flat';
      return `<div class="mw-fund-detail-row"><span class="mw-detail-fund">${esc(name)}</span><span>${prev!==null?prev.toFixed(2)+'%':'—'} → <b>${cur.toFixed(2)}%</b></span><span class="${cls}">${esc(action)}</span></div>`;
    }).join('');
    return `<tr>
      <td class="fund-name">
        <div class="stock-title"><a href="/stock?symbol=${encodeURIComponent(r.stock)}" target="_blank" rel="noopener">${esc(r.stock)}</a></div>
        <small>${esc(r.company)}</small>
        <a class="mw-chart-btn" href="/stock?symbol=${encodeURIComponent(r.stock)}&range=5y" target="_blank" rel="noopener">View 5Y chart ↗</a>
      </td>
      <td class="category-cell">${categoryLabel}</td>
      <td title="Current holders: ${m.funds.map(f=>f.fund).join(' • ')} · Holdings sources loaded: ${coverage.loaded}/${coverage.selected}"><b>${m.holding}/${denominator}</b><small class="mw-coverage">${coverage.loaded}/${coverage.selected} sources loaded</small><button type="button" class="mw-details-btn" data-details="${esc(detailId)}" aria-expanded="false">Fund details</button></td>
      <td>${Number.isFinite(m.avg)?m.avg.toFixed(2)+"%":"—"}</td>
      <td class="${m.delta>0?'positive':m.delta<0?'negative':'neutral'}">${pp(m.delta)}</td>
      <td title="${esc(flowTitle(m))}">${flowHtml(m)}</td>
      <td class="${r.correction<=-10?'negative':r.correction<=-5?'neutral':''}">${pct(r.correction)}</td>
      <td><b class="mw-sma">${esc(r.smaUp ? `Above SMA${r.smaUp}` : "Below SMA200")}</b><small class="mw-sma-note">${esc(r.smaUp ? "Longer SMA levels implied" : "Price is below all 20/50/100/200 SMAs")}</small></td>
      <td>${statusHtml(r.status)}</td>
    </tr>
    <tr id="${esc(detailId)}" class="mw-details-row" hidden><td colspan="9"><div class="mw-details-panel"><div class="mw-details-heading"><strong>Fund-by-fund allocation</strong><span>${m.holding}/${denominator} currently holding</span></div>${detailRows}</div></td></tr>`;
  }).join(""):`<tr><td colspan="9" class="empty">${mwData.providerStatus==="NOT_CONFIGURED"?"No portfolio holdings have been loaded yet. The 5+5 fund universe is ready; connect the monthly holdings provider to populate stocks.":"No stocks match the filters."}</td></tr>`;
  const cov=mwData.providerCoverage?.[cat]||{selected:(mwData.topFunds?.[cat]||[]).length||10,loaded:0,failed:0};
  const universe=`${cov.selected} ${cat} funds · holdings sources ${cov.loaded}/${cov.selected} loaded`;
  const asOfDates=rows.map(r=>r.holdingsAsOf).filter(Boolean).sort();
  const asOf=asOfDates.length ? asOfDates[asOfDates.length-1] : null;
  const asOfText=asOf ? ` · Holdings as of ${new Date(asOf+"T00:00:00").toLocaleDateString("en-IN")}` : "";
  $("mwStatus").textContent=`${universe} fund universe · Minimum consensus ${min}+ funds · ${rows.length} stocks shown · ${mwData.providerStatus==="OK"?"Monthly holdings loaded":"Holdings source unavailable"}${asOfText}`;
  $("mwUpdated").textContent=`Updated ${new Date(mwData.updatedAt).toLocaleString()}`;
  const errs=mwData.providerErrors||[];
  $("mwErrors").classList.toggle("hidden",!errs.length);
  $("mwErrorList").innerHTML=errs.map(e=>`<div class="error-item"><strong>${esc(e.fund)}</strong> — ${esc(e.error)}</div>`).join("");
}
async function load(refresh=false){ window.showPageLoading?.("Loading Momentum Stock Watch…","Loading holdings, allocation changes and price signals.");
  $("mwRefresh").disabled=true;
  $("mwLoadingOverlay")?.classList.remove("hidden");
  $("mwStatus").textContent="Loading top 10 funds for the selected category…";
  try{
    const r=await fetch(refresh?"/api/momentum-watch?refresh=1":"/api/momentum-watch");
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    mwData=await r.json();
    render();
  }catch(e){$("mwStatus").textContent=`Error: ${e.message}`;}
  finally{
    $("mwLoadingOverlay")?.classList.add("hidden"); window.hidePageLoading?.(); window.dispatchEvent(new Event("dashboard-loaded"));
    $("mwRefresh").disabled=false;
  }
}
$("mwCategory").addEventListener("change",render);
$("mwMinFunds").addEventListener("change",render);
$("mwSearch").addEventListener("input",render);
$("mwTrend").addEventListener("change",render);
$("mwSort").addEventListener("change",render);
$("mwRefresh").addEventListener("click",()=>load(true));
$("mwTable").addEventListener("click",e=>{
  const btn=e.target.closest('.mw-details-btn');
  if(!btn)return;
  const row=document.getElementById(btn.dataset.details);
  if(!row)return;
  const open=row.hasAttribute('hidden');
  if(open) row.removeAttribute('hidden'); else row.setAttribute('hidden','');
  btn.setAttribute('aria-expanded',String(open));
  btn.textContent=open?'Hide details':'Fund details';
});
load();
