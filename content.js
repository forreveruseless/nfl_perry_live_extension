
(() => {
  "use strict";
  if(window.__NFLP_LIVE_ASSISTANT__) return;
  window.__NFLP_LIVE_ASSISTANT__=true;

  const NBA=window.NFLPerryNBA;
  let players=[], model=null, source="loading";
  let roster={}, currentTeam="SAS", autoCapture=true;
  let pageSync=true, lastPageSignature="";
  let worker=null, workerReady=false, reqSeq=0, activeStateReq=0, activeCandReq=0;
  let stateAnalysis=null, candidateAnalysis=new Map();
  let root, panel, statusEl;

  const $=(q,el=document)=>el.querySelector(q);
  const $$=(q,el=document)=>[...el.querySelectorAll(q)];
  const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

  function toast(text){
    const d=document.createElement("div");
    d.className="nflp-toast"; d.textContent=text;
    document.documentElement.appendChild(d);
    setTimeout(()=>d.remove(),2600);
  }

  async function storageGet(){
    return new Promise(resolve=>chrome.storage.local.get(["nflpLiveRoster","nflpLiveTeam","nflpAutoCapture","nflpPageSync"],resolve));
  }
  async function storageSet(obj){ return new Promise(resolve=>chrome.storage.local.set(obj,resolve)); }

  const API_URL="https://api.nflperry.com/players/nba-fantasy?mode=bestSeason";

  async function getPlayers(force=false){
    try{
      if(!force){
        const cached=await new Promise(resolve=>chrome.storage.local.get(["nbaPlayersCache","nbaPlayersCacheAt"],resolve));
        if(Array.isArray(cached.nbaPlayersCache) && cached.nbaPlayersCache.length>1000){
          const age=Date.now()-(cached.nbaPlayersCacheAt||0);
          if(age<6*60*60*1000) return {players:cached.nbaPlayersCache,source:"cache"};
        }
      }

      try{
        const r=await fetch(API_URL,{cache:"no-store",credentials:"omit"});
        if(!r.ok) throw new Error(`NFLPerry API HTTP ${r.status}`);
        const data=await r.json();
        if(!Array.isArray(data)||data.length<1000) throw new Error("Некорректный ответ NFLPerry API");
        await storageSet({nbaPlayersCache:data,nbaPlayersCacheAt:Date.now()});
        return {players:data,source:"live"};
      }catch(apiErr){
        const fallback=await fetch(chrome.runtime.getURL("players.json"),{cache:"no-store"});
        if(!fallback.ok) throw new Error(`snapshot HTTP ${fallback.status}`);
        const data=await fallback.json();
        return {players:data,source:"snapshot",warning:String(apiErr?.message||apiErr)};
      }
    }catch(err){
      return {error:String(err?.message||err)};
    }
  }

  function createUI(){
    root=document.createElement("div");
    root.id="nflp-live-root";
    root.innerHTML=`
      <button id="nflp-live-toggle" title="NBA Live Assistant">🏀</button>
      <div id="nflp-live-panel">
        <div class="nflp-head">
          <div>
            <div class="nflp-title">NBA LIVE ASSISTANT</div>
            <div class="nflp-sub" id="nflp-source">Загрузка базы…</div>
          </div>
          <button class="nflp-iconbtn" id="nflp-refresh">↻ API</button>
          <button class="nflp-iconbtn" id="nflp-close">✕</button>
        </div>
        <div class="nflp-body">
          <div class="nflp-kpis">
            <div class="nflp-kpi big">
              <div class="label">Потенциальный максимум</div>
              <div class="value" id="nflp-potential">—</div>
              <div class="meta" id="nflp-potential-meta">точный математический потолок</div>
            </div>
            <div class="nflp-kpi">
              <div class="label">Expected итог</div>
              <div class="value" id="nflp-expected">—</div>
              <div class="meta" id="nflp-exp-meta">ожидание будущих дроу</div>
            </div>
            <div class="nflp-kpi">
              <div class="label">Шанс 295+</div>
              <div class="value" id="nflp-p295">—</div>
              <div class="meta" id="nflp-prob-meta">расчёт…</div>
            </div>
          </div>

          <div class="nflp-row">
            <div class="nflp-field">
              <label class="nflp-label">Текущая команда (читается со страницы)</label>
              <select id="nflp-team" class="nflp-select"></select>
            </div>
            <button class="nflp-btn" id="nflp-detect">Авто</button>
          </div>
          <div id="nflp-detect-status" class="nflp-status">Автоопределение включено как подсказка; при ошибке выбери команду вручную.</div>

          <div class="nflp-section">
            <div class="nflp-section-title">
              <span>Лучший пик сейчас</span>
              <button class="nflp-btn" id="nflp-analyze">Пересчитать</button>
            </div>
            <div class="nflp-strategy" id="nflp-strategy"></div>
            <div class="nflp-rec" id="nflp-rec"></div>
          </div>

          <div class="nflp-section">
            <div class="nflp-section-title">
              <span>Текущий состав</span>
              <button class="nflp-btn" id="nflp-reset">Очистить</button>
            </div>
            <div class="nflp-roster" id="nflp-roster"></div>
          </div>

          <div class="nflp-section">
            <label style="display:flex;gap:7px;align-items:center;font:800 10px system-ui;color:#9eacc0;cursor:pointer">
              <input type="checkbox" id="nflp-pagesync" checked> Синхронизировать состав и текущую команду прямо со страницы NFLPerry
            </label>
            <label style="display:flex;gap:7px;align-items:center;font:800 10px system-ui;color:#9eacc0;cursor:pointer;margin-top:7px">
              <input type="checkbox" id="nflp-autocap"> Дополнительная фиксация по клику на имя игрока
            </label>
            <div class="nflp-status" id="nflp-status"></div>
          </div>

          <div class="nflp-foot">
            <b>PAGE SYNC</b> — основной режим: NFLPerry сам является источником состава и текущего дроу.<br>
            POTENTIAL — минимальная потеря математического потолка.<br>
            EXPECTED — лучший средний итог по будущим случайным командам.<br>
            295+ — максимальная вероятность закончить не ниже 295.<br>
            На ранних пиках Expected/295+ считаются симуляцией; после 2 выбранных игроков — точным перебором оставшихся порядков.
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(root);
    panel=$("#nflp-live-panel",root);
    statusEl=$("#nflp-status",root);

    $("#nflp-live-toggle",root).onclick=()=>root.classList.add("open");
    $("#nflp-close",root).onclick=()=>root.classList.remove("open");
    $("#nflp-refresh",root).onclick=()=>reloadPlayers(true);
    $("#nflp-detect",root).onclick=()=>{ const t=detectTeamFromPage(true); if(!t) toast("Команда автоматически не найдена — выбери вручную."); };
    $("#nflp-team",root).onchange=e=>{ currentTeam=e.target.value; storageSet({nflpLiveTeam:currentTeam}); renderRecommendations(); analyzeCandidates(); };
    $("#nflp-reset",root).onclick=()=>{ roster={}; storageSet({nflpLiveRoster:roster}); renderAll(); analyzeState(); analyzeCandidates(); };
    $("#nflp-analyze",root).onclick=()=>{ analyzeState(); analyzeCandidates(); };
    $("#nflp-pagesync",root).onchange=e=>{
      pageSync=e.target.checked;
      storageSet({nflpPageSync:pageSync});
      if(pageSync) syncFromNFLPerryPage(true);
    };
    $("#nflp-autocap",root).onchange=e=>{ autoCapture=e.target.checked; storageSet({nflpAutoCapture:autoCapture}); };
  }

  function setStatus(msg,kind=""){
    statusEl.className=`nflp-status ${kind}`; statusEl.textContent=msg;
  }

  function initTeamOptions(){
    const sel=$("#nflp-team",root);
    sel.innerHTML=NBA.ACTIVE_TEAMS.map(t=>`<option value="${t}">${t} — ${NBA.TEAM_NAMES[t]}</option>`).join("");
    sel.value=currentTeam;
  }

  async function startWorker(){
    workerReady=false;
    try{
      const workerUrl=chrome.runtime.getURL("calc-worker.js");
      const r=await fetch(workerUrl,{cache:"no-store"});
      if(!r.ok) throw new Error(`worker HTTP ${r.status}`);
      const code=await r.text();
      const blobUrl=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));
      worker=new Worker(blobUrl);
      worker.onmessage=e=>{
        const m=e.data||{};
        if(m.type==="READY"){
          workerReady=true;
          setStatus(`База готова (${source}) · расчётный модуль готов`,"ok");
          analyzeState(); analyzeCandidates();
        }
        if(m.type==="STATE_RESULT" && m.requestId===activeStateReq){
          stateAnalysis=m.result; renderKPIs();
        }
        if(m.type==="CANDIDATE_RESULTS" && m.requestId===activeCandReq){
          candidateAnalysis.clear();
          for(const x of m.results) candidateAnalysis.set(x.index,x);
          renderRecommendations();
        }
      };
      worker.onerror=e=>{
        workerReady=false;
        setStatus(`Расчётный модуль: ${e.message||"ошибка Worker"}`,"bad");
      };
      const scores=NBA.ACTIVE_TEAMS.map((t,ti)=>NBA.SLOT_ORDER.map((s,si)=>{
        const p=model.best[ti][si]; return p ? +p.fpts : -Infinity;
      }));
      worker.postMessage({type:"INIT",teams:NBA.ACTIVE_TEAMS,scores});
    }catch(err){
      workerReady=false;
      setStatus(`Potential работает, но Expected/295+ недоступны: ${err.message}`,"bad");
      renderKPIs();
      renderRecommendations();
    }
  }

  function currentState(){
    const s=NBA.rosterMasks(roster,model.teamIndex);
    return {usedMask:s.usedMask,slotsMask:s.slotsMask,total:s.total};
  }

  function renderKPIs(){
    if(!model)return;
    const pot=NBA.exactCeiling(model,roster);
    $("#nflp-potential",root).textContent=pot.total.toFixed(1);
    const chosen=Object.values(roster).filter(Boolean).length;
    $("#nflp-potential-meta",root).textContent=`выбрано ${chosen}/6 · ${pot.lockedTotal.toFixed(1)} + ${pot.remainingTotal.toFixed(1)}`;

    if(stateAnalysis){
      $("#nflp-expected",root).textContent=stateAnalysis.expected.toFixed(1);
      $("#nflp-p295",root).textContent=(stateAnalysis.p295*100).toFixed(stateAnalysis.p295<0.001?4:2)+"%";
      const label=stateAnalysis.mode==="exact" ? `точно · ${stateAnalysis.samples.toLocaleString()} исходов` : `оценка · ${stateAnalysis.samples.toLocaleString()} симуляций`;
      $("#nflp-prob-meta",root).textContent=label;
      $("#nflp-exp-meta",root).textContent=stateAnalysis.mode==="exact" ? "точное среднее" : "симуляционное среднее";
    }else{
      $("#nflp-expected",root).textContent="…";
      $("#nflp-p295",root).textContent="…";
    }
  }

  function renderRoster(){
    const el=$("#nflp-roster",root);
    el.innerHTML=NBA.SLOT_ORDER.map(slot=>{
      const r=roster[slot];
      if(!r) return `<div class="nflp-roster-row"><div class="nflp-slot">${slot}</div><div class="nflp-empty">свободно</div><div></div><div></div></div>`;
      return `<div class="nflp-roster-row">
        <div class="nflp-slot">${slot}</div>
        <div><div class="nflp-rname">${esc(r.name)}</div><div class="nflp-rteam">${r.team}</div></div>
        <div class="nflp-score">${(+r.fpts).toFixed(1)}</div>
        <button class="nflp-x" data-remove="${slot}">✕</button>
      </div>`;
    }).join("");
    $$("[data-remove]",el).forEach(b=>b.onclick=()=>{
      delete roster[b.dataset.remove];
      storageSet({nflpLiveRoster:roster});
      stateAnalysis=null;candidateAnalysis.clear();
      renderAll(); analyzeState(); analyzeCandidates();
    });
  }

  function strategyNames(cands){
    if(!cands.length)return {};
    const pot=[...cands].sort((a,b)=>b.ceiling-a.ceiling||b.fpts-a.fpts)[0];
    let exp=null,p295=null;
    cands.forEach((c,i)=>{
      const a=candidateAnalysis.get(i);
      if(!a)return;
      if(!exp || a.expected>exp.a.expected) exp={c,a};
      if(!p295 || a.p295>p295.a.p295 || (Math.abs(a.p295-p295.a.p295)<1e-12 && a.expected>p295.a.expected)) p295={c,a};
    });
    return {pot,exp:exp?.c,p295:p295?.c};
  }

  function renderRecommendations(){
    if(!model)return;
    const cands=NBA.candidatesForTeam(model,currentTeam,roster);
    const rec=$("#nflp-rec",root), strat=$("#nflp-strategy",root);
    if(!cands.length){
      rec.innerHTML=`<div class="nflp-status">Для ${currentTeam} нет доступного пика: команда уже использована или все подходящие слоты заняты.</div>`;
      strat.innerHTML="";
      return;
    }
    const names=strategyNames(cands);
    strat.innerHTML=`
      <div><b>POTENTIAL</b><span>${names.pot?esc(NBA.fullName(names.pot.player))+" → "+names.pot.slot:"…"}</span></div>
      <div><b>EXPECTED</b><span>${names.exp?esc(NBA.fullName(names.exp.player))+" → "+names.exp.slot:"считаю…"}</span></div>
      <div><b>295+</b><span>${names.p295?esc(NBA.fullName(names.p295.player))+" → "+names.p295.slot:"считаю…"}</span></div>`;

    rec.innerHTML=cands.map((c,i)=>{
      const a=candidateAnalysis.get(i);
      const isPot=names.pot===c;
      const labels=[];
      if(names.pot===c)labels.push(`<span class="nflp-badge warn">POTENTIAL #1</span>`);
      if(names.exp===c)labels.push(`<span class="nflp-badge blue">EXPECTED #1</span>`);
      if(names.p295===c)labels.push(`<span class="nflp-badge good">295+ #1</span>`);
      labels.push(`<span class="nflp-badge">слот ${c.slot}</span>`);
      labels.push(`<span class="nflp-badge">потолок ${c.ceiling.toFixed(1)}</span>`);
      labels.push(`<span class="nflp-badge ${c.loss<=1?"good":c.loss<=7?"warn":""}">потеря −${c.loss.toFixed(1)}</span>`);
      if(a){
        labels.push(`<span class="nflp-badge blue">EV ${a.expected.toFixed(1)}</span>`);
        labels.push(`<span class="nflp-badge good">295+ ${(a.p295*100).toFixed(a.p295<.001?4:2)}%</span>`);
      }
      return `<div class="nflp-card ${isPot?"bestpot":""}">
        <div class="top">
          <div class="nflp-rank">${i+1}</div>
          <div class="nflp-player">${esc(NBA.fullName(c.player))}</div>
          <div class="nflp-score">${c.fpts.toFixed(1)}</div>
        </div>
        <div class="nflp-badges">${labels.join("")}</div>
        <div class="nflp-card-actions">
          <button class="nflp-btn primary" data-pick="${i}">Зафиксировать → ${c.slot}</button>
        </div>
      </div>`;
    }).join("");

    $$("[data-pick]",rec).forEach(btn=>btn.onclick=()=>{
      const c=cands[+btn.dataset.pick];
      recordPick(c);
    });
  }

  function recordPick(c){
    if(!c)return;
    if(roster[c.slot] && !confirm(`${c.slot} уже занят. Заменить игрока?`)) return;
    roster[c.slot]={
      id:c.player._id,
      name:NBA.fullName(c.player),
      team:c.team,
      fpts:c.fpts
    };
    currentTeam=c.team;
    storageSet({nflpLiveRoster:roster,nflpLiveTeam:currentTeam});
    stateAnalysis=null;candidateAnalysis.clear();
    toast(`✓ ${NBA.fullName(c.player)} → ${c.slot} · ${c.fpts.toFixed(1)}`);
    renderAll(); analyzeState(); analyzeCandidates();
  }

  function analyzeState(){
    if(!workerReady||!model)return;
    stateAnalysis=null; renderKPIs();
    activeStateReq=++reqSeq;
    worker.postMessage({type:"STATE",requestId:activeStateReq,state:currentState()});
  }

  function analyzeCandidates(){
    if(!workerReady||!model)return;
    const cands=NBA.candidatesForTeam(model,currentTeam,roster);
    candidateAnalysis.clear(); renderRecommendations();
    if(!cands.length)return;
    activeCandReq=++reqSeq;
    worker.postMessage({
      type:"CANDIDATES",requestId:activeCandReq,state:currentState(),
      candidates:cands.map(c=>({team:c.team,slotIndex:c.slotIndex,fpts:c.fpts}))
    });
  }

  function renderAll(){
    initTeamOptions();
    renderKPIs();
    renderRoster();
    renderRecommendations();
    $("#nflp-pagesync",root).checked=pageSync;
    $("#nflp-autocap",root).checked=autoCapture;
    $("#nflp-source",root).textContent=`База: ${source} · ${players.length} активных записей`;
  }

  function visible(el){
    const r=el.getBoundingClientRect();
    const st=getComputedStyle(el);
    return r.width>0&&r.height>0&&st.display!=="none"&&st.visibility!=="hidden";
  }

  function normText(s){
    return String(s||"").replace(/\u00a0/g," ").replace(/\r/g,"").trim();
  }

  function normName(s){
    return String(s||"")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/gi," ")
      .trim().toLowerCase().replace(/\s+/g," ");
  }

  // Read the actual NFLPerry page text while temporarily excluding our own overlay.
  function rawNFLPerryText(){
    if(!document.body) return "";
    const oldDisplay=root?.style?.display||"";
    if(root) root.style.display="none";
    const text=document.body.innerText||"";
    if(root) root.style.display=oldDisplay;
    return text;
  }

  function pageLines(){
    return rawNFLPerryText()
      .split(/\n+/)
      .map(x=>normText(x).replace(/[ \t]+/g," "))
      .filter(Boolean);
  }

  function findDraftInfo(lines){
    let draftIndex=-1,pick=null;
    for(let i=0;i<lines.length;i++){
      const m=lines[i].match(/Draft\s+Pick\s+(\d+)\s+of\s+6\s*:?\s*/i);
      if(m){draftIndex=i;pick=+m[1];break}
    }
    if(draftIndex<0)return null;

    // Team name should be immediately after the Draft Pick line, but logos/accessibility
    // text can add one or two lines, so scan a short window.
    for(let i=draftIndex+1;i<Math.min(lines.length,draftIndex+12);i++){
      const line=lines[i].toLowerCase();
      for(const t of NBA.ACTIVE_TEAMS){
        const full=NBA.TEAM_NAMES[t].toLowerCase();
        if(line===full || line.includes(full)){
          return {team:t,pick,draftIndex,teamLine:i};
        }
      }
    }
    return {team:null,pick,draftIndex,teamLine:-1};
  }

  // Find the ordered roster block PG -> SG -> SF -> PF -> C -> 6TH before Draft Pick.
  function locateRosterMarkers(lines,draftIndex){
    const max=draftIndex>=0?draftIndex:lines.length;
    const exact=(line,slot)=>line.toUpperCase()===slot;
    let best=null;

    for(let pg=0;pg<max;pg++){
      if(!exact(lines[pg],"PG"))continue;
      const idx=[pg];
      let pos=pg+1,ok=true;
      for(const slot of ["SG","SF","PF","C","6TH"]){
        let found=-1;
        for(let j=pos;j<Math.min(max,pos+20);j++){
          if(exact(lines[j],slot)){found=j;break}
        }
        if(found<0){ok=false;break}
        idx.push(found);pos=found+1;
      }
      if(ok && (!best || idx[5]>best[5])) best=idx;
    }
    return best;
  }

  function parsePageStateFromLines(lines){
    const draft=findDraftInfo(lines);
    const markers=locateRosterMarkers(lines,draft?.draftIndex??lines.length);
    const slots=NBA.SLOT_ORDER;
    const parsed={team:draft?.team||null,pick:draft?.pick||null,slots:{},debug:{draft,markers}};

    if(!markers)return parsed;

    for(let si=0;si<slots.length;si++){
      const slot=slots[si];
      const from=markers[si]+1;
      const to=si<slots.length-1?markers[si+1]:(draft?.draftIndex??Math.min(lines.length,from+20));
      const seg=lines.slice(from,to).filter(Boolean);

      if(seg.some(x=>new RegExp(`^\\+?\\s*Select\\s+${slot}\\b`,"i").test(x))){
        parsed.slots[slot]={empty:true,lines:seg};
        continue;
      }

      let scoreIndex=-1,score=null;
      for(let j=0;j<seg.length;j++){
        const m=seg[j].match(/(\d+(?:\.\d+)?)\s*P\/R\/A/i);
        if(m){scoreIndex=j;score=+m[1];break}
      }
      if(scoreIndex<0){
        parsed.slots[slot]={empty:true,lines:seg};
        continue;
      }

      const yearLine=seg.find(x=>/^\(?\d{4}\)?$/.test(x) || /\(\d{4}\)/.test(x));
      const ym=yearLine?.match(/(\d{4})/);
      const year=ym?+ym[1]:null;

      const nameParts=seg.slice(0,scoreIndex)
        .filter(x=>!/^[-+]?Select\b/i.test(x))
        .filter(x=>!NBA.ACTIVE_TEAMS.some(t=>x.toLowerCase().includes(NBA.TEAM_NAMES[t].toLowerCase())))
        .filter(x=>x.length<80);

      const name=normText(nameParts.join(" "));
      parsed.slots[slot]={empty:false,name,score,year,lines:seg};
    }
    return parsed;
  }

  function detectCurrentTeamFromDraftText(){
    const parsed=parsePageStateFromLines(pageLines());
    if(!parsed.team)return null;
    return {team:parsed.team,pick:parsed.pick};
  }

  function matchPagePlayer(info){
    if(!info || info.empty || !info.name)return null;
    const nn=normName(info.name);
    let matches=players.filter(p=>normName(NBA.fullName(p))===nn);

    // If line wrapping or extra text made the name slightly noisy, try containment.
    if(!matches.length){
      matches=players.filter(p=>{
        const pn=normName(NBA.fullName(p));
        return pn && (nn===pn || nn.includes(pn) || pn.includes(nn));
      });
    }

    if(info.year && matches.length>1){
      const exactYear=matches.filter(p=>+p.year===+info.year || +p.year===+info.year-1);
      if(exactYear.length) matches=exactYear;
    }

    if(matches.length>1){
      matches.sort((a,b)=>Math.abs((+a.fpts)-info.score)-Math.abs((+b.fpts)-info.score));
    }
    return matches[0]||null;
  }

  function readRosterFromPage(){
    if(!model)return {roster:{},matched:0,occupied:0,parsed:null};
    const parsed=parsePageStateFromLines(pageLines());
    const out={};
    let matched=0,occupied=0;

    for(const slot of NBA.SLOT_ORDER){
      const info=parsed.slots[slot];
      if(!info || info.empty)continue;
      occupied++;
      const p=matchPagePlayer(info);
      if(p){
        matched++;
        out[slot]={
          id:p._id,
          name:NBA.fullName(p),
          team:p.team,
          // Use the score shown by NFLPerry whenever available.
          fpts:Number.isFinite(+info.score)?+info.score:+p.fpts
        };
      }else{
        out[slot]={
          id:`page:${slot}:${info.name}`,
          name:info.name||"Не распознано",
          team:"?",
          fpts:Number.isFinite(+info.score)?+info.score:0,
          unmatched:true
        };
      }
    }
    return {roster:out,matched,occupied,parsed};
  }

  function cleanRosterForOptimizer(pageRoster){
    const clean={};
    for(const [slot,r] of Object.entries(pageRoster||{})){
      if(r && NBA.ACTIVE_TEAMS.includes(r.team)) clean[slot]=r;
    }
    return clean;
  }

  function syncFromNFLPerryPage(showToast=false){
    if(!pageSync || !model)return false;

    const page=readRosterFromPage();
    const parsed=page.parsed||{};
    const clean=cleanRosterForOptimizer(page.roster);

    const sig=JSON.stringify({
      t:parsed.team||null,
      p:parsed.pick||null,
      r:Object.fromEntries(Object.entries(page.roster).map(([s,r])=>[s,[r.name,r.team,r.fpts]]))
    });
    if(sig===lastPageSignature)return false;
    lastPageSignature=sig;

    let changed=false;
    if(parsed.team && parsed.team!==currentTeam){
      currentTeam=parsed.team;
      changed=true;
    }

    // NFLPerry page is authoritative. Pick 1 must have an empty roster.
    if(page.occupied>0 || parsed.pick===1){
      roster=clean;
      changed=true;
    }

    storageSet({nflpLiveRoster:roster,nflpLiveTeam:currentTeam});

    const ds=$("#nflp-detect-status",root);
    if(ds){
      const teamPart=parsed.team?`дроу ${parsed.pick||"?"}/6: ${parsed.team} — ${NBA.TEAM_NAMES[parsed.team]}`:"команда не распознана";
      ds.textContent=`PAGE SYNC · ${teamPart} · состав ${page.matched}/${page.occupied}`;
    }

    if(changed){
      stateAnalysis=null;candidateAnalysis.clear();
      renderAll();
      analyzeState();
      analyzeCandidates();
      if(showToast) toast(`PAGE SYNC · ${parsed.team||"?"} · состав ${page.matched}/${page.occupied}`);
    }
    return changed;
  }

  function detectTeamFromPage(show=false){
    const info=detectCurrentTeamFromDraftText();
    if(info?.team){
      if(info.team!==currentTeam){
        currentTeam=info.team;
        storageSet({nflpLiveTeam:currentTeam});
        if($("#nflp-team",root))$("#nflp-team",root).value=currentTeam;
        renderRecommendations(); analyzeCandidates();
      }
      $("#nflp-detect-status",root).textContent=`NFLPerry: Draft Pick ${info.pick}/6 · ${info.team} — ${NBA.TEAM_NAMES[info.team]}`;
      return info.team;
    }
    if(show)$("#nflp-detect-status",root).textContent="Не удалось прочитать текущую команду из строки Draft Pick.";
    return null;
  }

  function installClickCapture(){
    document.addEventListener("click",e=>{
      if(!autoCapture||!model||root.contains(e.target))return;
      const teamPlayers=model.byTeam.get(currentTeam)||[];
      let node=e.target, text="";
      for(let i=0;i<5&&node;i++,node=node.parentElement){
        const t=(node.innerText||node.textContent||"").trim();
        if(t.length>text.length && t.length<500)text=t;
      }
      if(!text)return;
      const matches=teamPlayers.filter(p=>{
        const n=NBA.fullName(p);
        return n.length>=5 && text.toLowerCase().includes(n.toLowerCase());
      }).sort((a,b)=>b.fpts-a.fpts);
      if(!matches.length)return;
      const p=matches[0];
      const cands=NBA.candidatesForTeam(model,currentTeam,roster).filter(c=>c.player._id===p._id);
      if(!cands.length)return;
      const best=cands.sort((a,b)=>b.ceiling-a.ceiling||b.fpts-a.fpts)[0];
      setTimeout(()=>recordPick(best),250);
    },true);
  }

  async function reloadPlayers(force=false){
    setStatus(force?"Обновляю live API…":"Загружаю базу…");
    const res=await getPlayers(force);
    if(res.error){
      setStatus(`Ошибка базы: ${res.error}`,"bad"); return;
    }
    source=res.source||"unknown";
    players=NBA.normalizePlayers(res.players);
    model=NBA.buildModel(players);
    setStatus(res.warning?`Snapshot готов: ${players.length} записей · ${res.warning}`:`База готова (${source}) · ${players.length} записей`,"ok");
    if(worker){worker.terminate();worker=null;workerReady=false}
    startWorker();
    renderAll();
    setTimeout(()=>syncFromNFLPerryPage(false),120);
  }

  async function init(){
    createUI();
    const saved=await storageGet();
    roster=saved.nflpLiveRoster && typeof saved.nflpLiveRoster==="object" ? saved.nflpLiveRoster : {};
    currentTeam=NBA.ACTIVE_TEAMS.includes(saved.nflpLiveTeam)?saved.nflpLiveTeam:"SAS";
    autoCapture=saved.nflpAutoCapture===true;
    pageSync=saved.nflpPageSync!==false;
    initTeamOptions();
    installClickCapture();
    await reloadPlayers(false);
    syncFromNFLPerryPage(false);

    let timer=null;
    const obs=new MutationObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>syncFromNFLPerryPage(false),220);
    });
    obs.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
    setInterval(()=>syncFromNFLPerryPage(false),1800);
  }

  init().catch(err=>{
    console.error("[NFLP Live Assistant]",err);
    try{setStatus(String(err?.message||err),"bad")}catch{}
  });
})();
