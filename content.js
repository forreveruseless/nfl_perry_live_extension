
(() => {
  "use strict";
  if(window.__NFLP_LIVE_ASSISTANT__) return;
  window.__NFLP_LIVE_ASSISTANT__=true;

  const NBA=window.NFLPerryNBA;
  let players=[], model=null, source="loading";
  let roster={}, currentTeam="SAS", autoCapture=true;
  let pageSync=true, lastPageSignature="";
  let autoDraft=false, autoStrategy="potential", autoDelay=900;
  let autoRestart=false, restartBusy=false;
  let minPotentialValue="", useSiteHighScore=false, thresholdRestartBusy=false;
  let autoBusy=false, autoTimer=null, autoPendingKey="", autoRunToken=0;
  let gameHistory=[], lastRecordedGameSig="";
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
    return new Promise(resolve=>chrome.storage.local.get([
      "nflpLiveRoster","nflpLiveTeam","nflpAutoCapture","nflpPageSync",
      "nflpAutoDraft","nflpAutoStrategy","nflpAutoDelay","nflpAutoRestart",
      "nflpMinPotentialValue","nflpUseSiteHighScore","nflpGameHistory"
    ],resolve));
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

        <div class="nflp-tabs">
          <button class="nflp-tab active" data-tab="assistant">Ассистент</button>
          <button class="nflp-tab" data-tab="stats">Статистика</button>
        </div>

        <div class="nflp-body">
          <div id="nflp-tab-assistant">
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
            <div id="nflp-detect-status" class="nflp-status">PAGE SYNC включён.</div>

            <div class="nflp-section nflp-auto-box">
              <div class="nflp-section-title">
                <span>Auto Draft</span>
                <button class="nflp-btn nflp-auto-toggle" id="nflp-autodraft-toggle">AUTO OFF</button>
              </div>

              <div class="nflp-row" style="margin-top:8px">
                <div class="nflp-field">
                  <label class="nflp-label" style="margin-top:0">Стратегия</label>
                  <select id="nflp-autostrategy" class="nflp-select">
                    <option value="potential">POTENTIAL — потолок</option>
                    <option value="expected">EXPECTED — средний итог</option>
                    <option value="p295">295+ — шанс ≥295</option>
                  </select>
                </div>
                <div class="nflp-field" style="max-width:112px">
                  <label class="nflp-label" style="margin-top:0">Задержка</label>
                  <select id="nflp-autodelay" class="nflp-select">
                    <option value="500">0.5 сек</option>
                    <option value="900">0.9 сек</option>
                    <option value="1500">1.5 сек</option>
                    <option value="2500">2.5 сек</option>
                  </select>
                </div>
              </div>

              <label class="nflp-check">
                <input type="checkbox" id="nflp-autorestart">
                После 6/6 автоматически начать новую игру
              </label>

              <div class="nflp-threshold-box">
                <div class="nflp-threshold-title">Минимальный потенциальный максимум</div>
                <div class="nflp-threshold-row">
                  <input id="nflp-min-potential" class="nflp-number" type="number" min="0" max="400" step="0.1" placeholder="например 295.0">
                  <span class="nflp-threshold-unit">FPTS</span>
                </div>
                <label class="nflp-check" style="margin-top:7px">
                  <input type="checkbox" id="nflp-use-highscore">
                  Использовать мой HIGH SCORE с NFLPerry:
                  <b id="nflp-highscore-value">—</b>
                </label>
                <div class="nflp-status" id="nflp-threshold-status">
                  Если лучший достижимый Potential опустится ниже порога, текущая попытка будет сразу перезапущена.
                </div>
              </div>

              <div class="nflp-status" id="nflp-auto-status">Auto Draft выключен.</div>
              <div class="nflp-status" id="nflp-restart-status"></div>
            </div>

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
              <label class="nflp-check">
                <input type="checkbox" id="nflp-pagesync" checked>
                Синхронизировать состав и текущую команду со страницы NFLPerry
              </label>
              <label class="nflp-check" style="margin-top:7px">
                <input type="checkbox" id="nflp-autocap">
                Дополнительная фиксация по клику на имя игрока
              </label>
              <div class="nflp-status" id="nflp-status"></div>
            </div>

            <div class="nflp-foot">
              <b>AUTO DRAFT</b> сам открывает слот, ищет игрока и подтверждает выбор по странице.<br>
              <b>PAGE SYNC</b> использует NFLPerry как источник истины.<br>
              POTENTIAL — максимальный потолок; EXPECTED — средний итог; 295+ — шанс закончить ≥295.
            </div>
          </div>

          <div id="nflp-tab-stats" hidden>
            <div class="nflp-stats-kpis">
              <div><b id="nflp-games-count">0</b><span>игр</span></div>
              <div><b id="nflp-games-best">—</b><span>лучший</span></div>
              <div><b id="nflp-games-avg">—</b><span>средний</span></div>
            </div>

            <div class="nflp-section">
              <div class="nflp-section-title">
                <span>Top 10 результатов</span>
                <button class="nflp-btn" id="nflp-clear-history">Очистить</button>
              </div>
              <div class="nflp-history" id="nflp-history"></div>
            </div>

            <div class="nflp-foot">
              История сохраняется локально в Firefox. Хранятся все завершённые игры; здесь показываются 10 лучших результатов и их составы.
            </div>
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
    $("#nflp-team",root).onchange=e=>{
      currentTeam=e.target.value;
      storageSet({nflpLiveTeam:currentTeam});
      stopAutoDraft("Команда изменена вручную.");
      renderRecommendations(); analyzeCandidates();
      if(autoDraft)setTimeout(()=>maybeScheduleAutoDraft(),180);
    };
    $("#nflp-reset",root).onclick=()=>{
      stopAutoDraft("Состав очищен.");
      roster={}; storageSet({nflpLiveRoster:roster});
      renderAll(); analyzeState(); analyzeCandidates();
    };
    $("#nflp-analyze",root).onclick=()=>{ analyzeState(); analyzeCandidates(); };
    $("#nflp-pagesync",root).onchange=e=>{
      pageSync=e.target.checked;
      storageSet({nflpPageSync:pageSync});
      if(pageSync) syncFromNFLPerryPage(true);
    };
    $("#nflp-autocap",root).onchange=e=>{ autoCapture=e.target.checked; storageSet({nflpAutoCapture:autoCapture}); };

    $("#nflp-autodraft-toggle",root).onclick=()=>{
      autoDraft=!autoDraft;
      storageSet({nflpAutoDraft:autoDraft});
      if(!autoDraft) stopAutoDraft("Auto Draft выключен.");
      renderAutoControls();
      if(autoDraft) maybeScheduleAutoDraft();
    };
    $("#nflp-autostrategy",root).onchange=e=>{
      autoStrategy=e.target.value;
      storageSet({nflpAutoStrategy:autoStrategy});
      stopAutoDraft("Стратегия изменена — пересчитываю.");
      renderAutoControls();
      analyzeCandidates();
      setTimeout(()=>maybeScheduleAutoDraft(),150);
    };
    $("#nflp-autodelay",root).onchange=e=>{
      autoDelay=Math.max(300,+e.target.value||900);
      storageSet({nflpAutoDelay:autoDelay});
      renderAutoControls();
    };
    $("#nflp-autorestart",root).onchange=e=>{
      autoRestart=e.target.checked;
      storageSet({nflpAutoRestart:autoRestart});
      renderAutoControls();
    };

    $("#nflp-min-potential",root).oninput=e=>{
      minPotentialValue=e.target.value;
      storageSet({nflpMinPotentialValue:minPotentialValue});
      renderThresholdControls();
      if(autoDraft)setTimeout(()=>maybeScheduleAutoDraft(),80);
      setTimeout(()=>enforcePotentialFloor("setting"),80);
    };
    $("#nflp-use-highscore",root).onchange=e=>{
      useSiteHighScore=e.target.checked;
      storageSet({nflpUseSiteHighScore:useSiteHighScore});
      renderThresholdControls();
      if(autoDraft)setTimeout(()=>maybeScheduleAutoDraft(),80);
      setTimeout(()=>enforcePotentialFloor("setting"),80);
    };

    $$("[data-tab]",root).forEach(btn=>btn.onclick=()=>{
      $$("[data-tab]",root).forEach(x=>x.classList.toggle("active",x===btn));
      const tab=btn.dataset.tab;
      $("#nflp-tab-assistant",root).hidden=tab!=="assistant";
      $("#nflp-tab-stats",root).hidden=tab!=="stats";
      if(tab==="stats")renderStats();
    });

    $("#nflp-clear-history",root).onclick=()=>{
      if(!confirm("Очистить всю локальную историю игр?"))return;
      gameHistory=[];
      lastRecordedGameSig="";
      storageSet({nflpGameHistory:gameHistory});
      renderStats();
    };
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
          maybeScheduleAutoDraft();
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


  function setAutoStatus(msg,kind=""){
    const el=$("#nflp-auto-status",root);
    if(!el)return;
    el.className=`nflp-status ${kind}`;
    el.textContent=msg;
  }


  function siteHighScoreFromPage(){
    const lines=pageLines();
    for(const line of lines){
      const m=line.match(/HIGH\s+SCORE\s*:\s*(\d+(?:\.\d+)?)/i);
      if(m)return +m[1];
    }
    return null;
  }

  function localBestScore(){
    const vals=gameHistory.map(g=>+g.score).filter(Number.isFinite);
    return vals.length?Math.max(...vals):null;
  }

  function resolvedHighScore(){
    const page=siteHighScoreFromPage();
    if(Number.isFinite(page))return {value:page,source:"NFLPerry"};
    const local=localBestScore();
    if(Number.isFinite(local))return {value:local,source:"локальная история"};
    return {value:null,source:"не найден"};
  }

  function numericMinPotential(){
    const v=Number.parseFloat(String(minPotentialValue).replace(",","."));
    return Number.isFinite(v)&&v>0?v:null;
  }

  function effectivePotentialFloor(){
    if(useSiteHighScore){
      const hs=resolvedHighScore();
      return Number.isFinite(hs.value)?hs.value:null;
    }
    return numericMinPotential();
  }

  function thresholdEnabled(){
    return Number.isFinite(effectivePotentialFloor());
  }

  function renderThresholdControls(){
    const input=$("#nflp-min-potential",root);
    const check=$("#nflp-use-highscore",root);
    const hsEl=$("#nflp-highscore-value",root);
    const status=$("#nflp-threshold-status",root);
    if(input){
      input.value=minPotentialValue;
      input.disabled=useSiteHighScore;
    }
    if(check)check.checked=useSiteHighScore;

    const hs=resolvedHighScore();
    if(hsEl)hsEl.textContent=Number.isFinite(hs.value)?`${hs.value.toFixed(1)} (${hs.source})`:"—";

    const floor=effectivePotentialFloor();
    if(status){
      if(Number.isFinite(floor)){
        status.className="nflp-status ok";
        status.textContent=`Активный порог: ${floor.toFixed(1)} FPTS. Если текущий/следующий лучший Potential < ${floor.toFixed(1)}, попытка перезапустится.`;
      }else{
        status.className="nflp-status";
        status.textContent="Порог выключен: введи число или включи HIGH SCORE.";
      }
    }
  }

  function currentExactPotential(){
    if(!model)return null;
    try{return NBA.exactCeiling(model,roster).total}catch{return null}
  }

  function renderAutoControls(){
    const btn=$("#nflp-autodraft-toggle",root);
    const strategy=$("#nflp-autostrategy",root);
    const delay=$("#nflp-autodelay",root);
    if(btn){
      btn.textContent=autoDraft?"■ AUTO ON":"▶ AUTO OFF";
      btn.classList.toggle("green",autoDraft);
    }
    if(strategy)strategy.value=autoStrategy;
    if(delay)delay.value=String(autoDelay);
    const ar=$("#nflp-autorestart",root);
    if(ar)ar.checked=autoRestart;
    renderThresholdControls();
  }

  function stopAutoDraft(message="Остановлено."){
    autoRunToken++;
    autoBusy=false;
    autoPendingKey="";
    if(autoTimer){clearTimeout(autoTimer);autoTimer=null}
    setAutoStatus(message,autoDraft?"":"");
  }

  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

  function currentPageSnapshot(){
    const page=readRosterFromPage();
    return {
      page,
      parsed:page.parsed||{},
      occupied:page.occupied||0,
      matched:page.matched||0
    };
  }

  function chosenCandidateForStrategy(){
    if(!model)return null;
    const cands=NBA.candidatesForTeam(model,currentTeam,roster);
    if(!cands.length)return null;
    const names=strategyNames(cands);

    if(autoStrategy==="potential") return names.pot||null;
    if(autoStrategy==="expected") return names.exp||null;
    if(autoStrategy==="p295") return names.p295||null;
    return names.pot||null;
  }

  function strategyLabel(){
    return autoStrategy==="potential"?"POTENTIAL":
           autoStrategy==="expected"?"EXPECTED":"295+";
  }

  function clickableAncestor(el,maxDepth=7){
    let cur=el;
    for(let i=0;i<maxDepth && cur;i++,cur=cur.parentElement){
      if(root?.contains(cur))return null;
      const tag=cur.tagName;
      const role=cur.getAttribute?.("role");
      const tab=cur.getAttribute?.("tabindex");
      const cursor=getComputedStyle(cur).cursor;
      if(tag==="BUTTON"||tag==="A"||role==="button"||tab==="0"||cursor==="pointer")return cur;
    }
    return el;
  }

  function findSlotSelectTarget(slot){
    const want=`select ${slot}`.toLowerCase();
    const els=[...document.querySelectorAll("button,a,[role='button'],div,span,p")]
      .filter(el=>!root.contains(el)&&visible(el));
    const scored=[];
    for(const el of els){
      const txt=normText(el.innerText||el.textContent||"").toLowerCase();
      if(!txt.includes(want))continue;
      const r=el.getBoundingClientRect();
      if(r.width<20||r.height<10||r.width>900||r.height>240)continue;
      let score=0;
      if(txt===`+ ${want}`||txt===want)score+=100;
      if(txt.startsWith("+ select"))score+=40;
      score-=Math.min(txt.length,300)/20;
      score-=Math.min(r.width*r.height,200000)/100000;
      scored.push({score,el});
    }
    scored.sort((a,b)=>b.score-a.score);
    return scored.length?clickableAncestor(scored[0].el):null;
  }

  function findSearchInput(slot){
    const inputs=[...document.querySelectorAll("input")].filter(el=>!root.contains(el)&&visible(el));
    const exact=inputs.find(i=>normText(i.placeholder).toLowerCase()===`search ${slot.toLowerCase()}...`);
    return exact||inputs.find(i=>normText(i.placeholder).toLowerCase().includes(`search ${slot.toLowerCase()}`))||
           inputs.find(i=>normText(i.placeholder).toLowerCase().startsWith("search"));
  }

  function setNativeInputValue(input,value){
    const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
    if(desc?.set)desc.set.call(input,value); else input.value=value;
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true,key:"a"}));
  }

  function findPlayerChoiceTarget(playerName){
    const target=normName(playerName);
    const els=[...document.querySelectorAll("button,a,[role='button'],li,div,span,p")]
      .filter(el=>!root.contains(el)&&visible(el));
    const scored=[];

    for(const el of els){
      const raw=normText(el.innerText||el.textContent||"");
      if(!raw||raw.length>240)continue;
      const nt=normName(raw);
      if(!nt.includes(target))continue;
      const r=el.getBoundingClientRect();
      if(r.width<20||r.height<10||r.height>180||r.width>800)continue;

      let score=0;
      if(nt===target)score+=120;
      else if(nt.startsWith(target+" "))score+=95;
      else score+=55;
      if(/\((PG|SG|SF|PF|C|G|F)\)/i.test(raw))score+=15;
      score-=raw.length/25;
      score-=Math.min(r.width*r.height,150000)/100000;
      scored.push({score,el,raw});
    }
    scored.sort((a,b)=>b.score-a.score);
    if(!scored.length)return null;

    // Prefer a compact clickable row around the exact name, but do not climb into the whole modal.
    let cur=scored[0].el;
    const baseText=target;
    for(let i=0;i<5&&cur;i++,cur=cur.parentElement){
      if(root.contains(cur))break;
      const txt=normName(cur.innerText||cur.textContent||"");
      const r=cur.getBoundingClientRect();
      if(txt.includes(baseText) && r.height<=110 && r.width<=650){
        const role=cur.getAttribute?.("role");
        const tag=cur.tagName;
        const cursor=getComputedStyle(cur).cursor;
        if(tag==="BUTTON"||tag==="A"||role==="button"||cursor==="pointer")return cur;
      }
    }
    return clickableAncestor(scored[0].el,4)||scored[0].el;
  }

  async function waitFor(fn,timeout=3000,step=70){
    const end=Date.now()+timeout;
    while(Date.now()<end){
      try{
        const v=fn();
        if(v)return v;
      }catch{}
      await sleep(step);
    }
    return null;
  }

  function siteRosterContains(slot,playerName){
    const page=readRosterFromPage();
    const r=page.roster?.[slot];
    if(!r)return false;
    return normName(r.name)===normName(playerName);
  }

  async function executeAutoPick(candidate,token,expectedPick){
    const playerName=NBA.fullName(candidate.player);
    const label=`${playerName} → ${candidate.slot}`;

    setAutoStatus(`${strategyLabel()}: открываю ${candidate.slot} для ${playerName}…`);

    const selectTarget=findSlotSelectTarget(candidate.slot);
    if(!selectTarget)throw new Error(`не нашёл кнопку "+ Select ${candidate.slot}"`);
    selectTarget.scrollIntoView({block:"center",behavior:"auto"});
    await sleep(120);
    selectTarget.click();

    const search=await waitFor(()=>findSearchInput(candidate.slot),2800,70);
    if(!search)throw new Error(`не открылось окно выбора ${candidate.slot}`);

    if(token!==autoRunToken||!autoDraft)throw new Error("остановлено");

    search.focus();
    setNativeInputValue(search,playerName);
    await sleep(220);

    const playerTarget=await waitFor(()=>findPlayerChoiceTarget(playerName),2600,80);
    if(!playerTarget)throw new Error(`не нашёл ${playerName} в списке NFLPerry`);

    setAutoStatus(`${strategyLabel()}: выбираю ${label}…`,"ok");
    playerTarget.scrollIntoView({block:"nearest",behavior:"auto"});
    await sleep(100);
    playerTarget.click();

    const confirmed=await waitFor(()=>{
      if(siteRosterContains(candidate.slot,playerName))return true;
      const info=detectCurrentTeamFromDraftText();
      return info?.pick && expectedPick && info.pick>expectedPick ? true:false;
    },4200,110);

    if(!confirmed)throw new Error(`NFLPerry не подтвердил выбор ${playerName}`);

    syncFromNFLPerryPage(false);
    toast(`AUTO ✓ ${label}`);
    setAutoStatus(`✓ ${label}. Жду следующий дроу…`,"ok");
  }

  function maybeScheduleAutoDraft(){
    if(!autoDraft||autoBusy||!model||!pageSync)return;

    const snap=currentPageSnapshot();
    const parsed=snap.parsed;
    if(!parsed.team||!parsed.pick)return;
    if(parsed.team!==currentTeam)return;

    // All already occupied rows must be recognized before clicking anything.
    if(snap.occupied!==snap.matched){
      setAutoStatus(`Пауза: распознано ${snap.matched}/${snap.occupied} выбранных игроков.`,"bad");
      return;
    }

    const chosen=chosenCandidateForStrategy();
    if(!chosen){
      if(autoStrategy!=="potential" && candidateAnalysis.size===0){
        setAutoStatus(`${strategyLabel()}: жду расчёт рекомендаций…`);
      }else{
        setAutoStatus("Нет безопасного автоматического выбора.","bad");
      }
      return;
    }

    const floor=effectivePotentialFloor();
    if(Number.isFinite(floor) && Number.isFinite(chosen.ceiling) && chosen.ceiling < floor-1e-9){
      setAutoStatus(`Лучший пик оставит Potential ${chosen.ceiling.toFixed(1)} < ${floor.toFixed(1)}. Перезапуск…`,"bad");
      startNewAttempt(`Лучший доступный Potential ${chosen.ceiling.toFixed(1)} < минимум ${floor.toFixed(1)}`,{allowReloadFallback:true});
      return;
    }

    const key=`${parsed.pick}|${parsed.team}|${autoStrategy}|${chosen.player._id}|${chosen.slot}`;
    if(autoPendingKey===key)return;

    // Ensure the target slot is still empty on the actual NFLPerry page.
    const slotInfo=parsed.slots?.[chosen.slot];
    if(slotInfo && slotInfo.empty===false){
      setAutoStatus(`Пауза: ${chosen.slot} уже занят на странице.`,"bad");
      return;
    }

    autoPendingKey=key;
    const token=++autoRunToken;
    setAutoStatus(`${strategyLabel()}: ${NBA.fullName(chosen.player)} → ${chosen.slot} через ${(autoDelay/1000).toFixed(1)} сек.`,"ok");

    autoTimer=setTimeout(async()=>{
      if(!autoDraft||token!==autoRunToken)return;
      autoBusy=true;
      try{
        // Re-validate immediately before click.
        syncFromNFLPerryPage(false);
        const again=currentPageSnapshot();
        if(again.parsed?.pick!==parsed.pick || again.parsed?.team!==parsed.team){
          throw new Error("дроу уже изменился");
        }
        const latest=chosenCandidateForStrategy();
        if(!latest || latest.player._id!==chosen.player._id || latest.slot!==chosen.slot){
          throw new Error("рекомендация успела измениться");
        }
        await executeAutoPick(chosen,token,parsed.pick);
      }catch(err){
        if(String(err?.message||err)!=="остановлено"){
          autoDraft=false;
          storageSet({nflpAutoDraft:false});
          renderAutoControls();
          setAutoStatus(`AUTO STOP: ${err?.message||err}`,"bad");
          toast(`Auto Draft остановлен: ${err?.message||err}`);
        }
      }finally{
        autoBusy=false;
        autoPendingKey="";
        autoTimer=null;
        if(autoDraft){
          setTimeout(()=>{syncFromNFLPerryPage(false);maybeScheduleAutoDraft()},500);
        }
      }
    },autoDelay);
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
    renderAutoControls();
    renderThresholdControls();
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

  // IMPORTANT: our overlay is appended to <html>, not <body>.
  // Reading document.body therefore already excludes the extension UI.
  // Never hide/toggle the panel here: Firefox closes an open <select>
  // when one of its ancestors becomes display:none.
  function rawNFLPerryText(){
    return document.body?.innerText || "";
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


  function scoreFromPage(){
    const lines=pageLines();
    for(const line of lines){
      const m=line.match(/YOUR\s+SCORE\s*:\s*(\d+(?:\.\d+)?)/i);
      if(m)return +m[1];
    }
    return null;
  }

  function completedGameFromPage(page){
    if(!page || page.occupied!==6 || page.matched!==6)return null;
    const score=scoreFromPage();
    if(!Number.isFinite(score))return null;

    const lineup=NBA.SLOT_ORDER.map(slot=>{
      const r=page.roster?.[slot];
      return r ? {
        slot,
        id:r.id||"",
        name:r.name,
        team:r.team,
        fpts:+r.fpts||0
      } : null;
    }).filter(Boolean);

    if(lineup.length!==6)return null;
    const sig=`${score.toFixed(1)}|`+lineup.map(x=>`${x.slot}:${x.id||x.name}:${x.team}:${x.fpts}`).join("|");
    return {sig,score,lineup,finishedAt:Date.now()};
  }

  function maybeRecordCompletedGame(page){
    const game=completedGameFromPage(page);
    if(!game || game.sig===lastRecordedGameSig)return false;
    if(gameHistory.some(g=>g.sig===game.sig)){
      lastRecordedGameSig=game.sig;
      return false;
    }

    lastRecordedGameSig=game.sig;
    gameHistory.push(game);
    // Keep a generous local archive but avoid unlimited growth.
    if(gameHistory.length>1000)gameHistory=gameHistory.slice(-1000);
    storageSet({nflpGameHistory:gameHistory});
    renderStats();
    toast(`Игра сохранена: ${game.score.toFixed(1)} · место в истории #${gameHistory.length}`);
    return true;
  }

  function renderStats(){
    const count=$("#nflp-games-count",root);
    if(!count)return;

    const scores=gameHistory.map(g=>+g.score).filter(Number.isFinite);
    count.textContent=String(gameHistory.length);
    $("#nflp-games-best",root).textContent=scores.length?Math.max(...scores).toFixed(1):"—";
    $("#nflp-games-avg",root).textContent=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1):"—";

    const top=[...gameHistory]
      .sort((a,b)=>(+b.score)-(+a.score) || (+b.finishedAt)-(+a.finishedAt))
      .slice(0,10);

    const el=$("#nflp-history",root);
    if(!top.length){
      el.innerHTML=`<div class="nflp-status">Пока нет завершённых игр. После состава 6/6 результат сохранится автоматически.</div>`;
      return;
    }

    el.innerHTML=top.map((g,i)=>`
      <details class="nflp-history-game" ${i===0?"open":""}>
        <summary>
          <span class="nflp-history-rank">#${i+1}</span>
          <b>${(+g.score).toFixed(1)}</b>
          <span>${new Date(g.finishedAt||Date.now()).toLocaleString()}</span>
        </summary>
        <div class="nflp-history-lineup">
          ${(g.lineup||[]).map(x=>`
            <div>
              <strong>${esc(x.slot)}</strong>
              <span>${esc(x.name)} <small>${esc(x.team)}</small></span>
              <b>${(+x.fpts).toFixed(1)}</b>
            </div>`).join("")}
        </div>
      </details>`).join("");
  }

  function restartButtonCandidates(){
    const exact=[
      "play again","restart","restart game","new game","start new game",
      "new draft","draft again","try again","play another game"
    ];
    const nodes=[...document.querySelectorAll("button,a,[role='button']")]
      .filter(el=>!root.contains(el)&&visible(el));

    return nodes.map(el=>{
      const text=normText(el.innerText||el.textContent||"").toLowerCase();
      const compact=text.replace(/[!?.]+$/,"").trim();
      let score=-1;
      const idx=exact.indexOf(compact);
      if(idx>=0)score=100-idx;
      else if(/play\s+again|restart\s+game|new\s+game|new\s+draft/i.test(compact))score=50;
      return {el,text,score};
    }).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
  }


  function restartStateSignature(){
    const page=readRosterFromPage();
    const parsed=page.parsed||{};
    return JSON.stringify({
      pick:parsed.pick||null,
      team:parsed.team||null,
      roster:Object.fromEntries(Object.entries(page.roster||{}).map(([s,r])=>[s,[r.name,r.team,r.fpts]]))
    });
  }

  async function startNewAttempt(reason,{allowReloadFallback=true}={}){
    if(restartBusy||thresholdRestartBusy)return false;
    thresholdRestartBusy=true;
    restartBusy=true;
    autoRunToken++;
    autoBusy=false;
    autoPendingKey="";
    if(autoTimer){clearTimeout(autoTimer);autoTimer=null}

    const status=$("#nflp-restart-status",root);
    const thresholdStatus=$("#nflp-threshold-status",root);
    if(status)status.textContent=`Перезапуск: ${reason}`;
    if(thresholdStatus && reason.includes("Potential"))thresholdStatus.textContent=`${reason}. Перезапускаю попытку…`;

    try{
      // Prefer a real restart/new-game button when one exists.
      const list=restartButtonCandidates();
      const candidate=list.length===1 ? list[0] :
        (list.length>1 && list[0].score>list[1].score ? list[0] : null);

      if(candidate){
        await sleep(220);
        candidate.el.scrollIntoView({block:"center",behavior:"auto"});
        candidate.el.click();
        if(status)status.textContent=`Нажал "${candidate.text}". Жду новую игру…`;

        const started=await waitFor(()=>{
          const parsed=parsePageStateFromLines(pageLines());
          const p=readRosterFromPage();
          return parsed.pick===1 && p.occupied===0;
        },6000,160);

        if(started){
          lastPageSignature="";
          autoPendingKey="";
          try{sessionStorage.removeItem("__nflp_floor_reload__")}catch{}
          if(status)status.textContent="Новая попытка запущена ✓";
          syncFromNFLPerryPage(false);
          if(autoDraft)setTimeout(()=>maybeScheduleAutoDraft(),450);
          return true;
        }
      }

      if(!allowReloadFallback){
        if(status)status.textContent="Кнопка перезапуска не найдена.";
        return false;
      }

      // Mid-draft NFLPerry may not expose a dedicated restart button.
      // A hard reload is the safe fallback used only once per identical state.
      const sig=restartStateSignature();
      let prev=null;
      try{prev=JSON.parse(sessionStorage.getItem("__nflp_floor_reload__")||"null")}catch{}
      const now=Date.now();
      if(prev && prev.sig===sig && now-(prev.at||0)<12000){
        if(status)status.textContent="Reload не изменил игру. Автоповтор остановлен, чтобы не попасть в цикл.";
        autoDraft=false;
        storageSet({nflpAutoDraft:false});
        renderAutoControls();
        return false;
      }

      try{sessionStorage.setItem("__nflp_floor_reload__",JSON.stringify({sig,at:now,reason}))}catch{}
      if(status)status.textContent="Кнопка не найдена — перезагружаю NBA Game Mode…";
      await storageSet({
        nflpAutoDraft:autoDraft,
        nflpMinPotentialValue:minPotentialValue,
        nflpUseSiteHighScore:useSiteHighScore
      });
      location.reload();
      return true;
    }catch(err){
      if(status)status.textContent=`Перезапуск: ${err?.message||err}`;
      return false;
    }finally{
      // If location.reload() succeeds this context is destroyed.
      // Otherwise unlock after a short delay.
      setTimeout(()=>{restartBusy=false;thresholdRestartBusy=false},1000);
    }
  }

  async function enforcePotentialFloor(origin="sync"){
    const floor=effectivePotentialFloor();
    if(!Number.isFinite(floor)||!model||thresholdRestartBusy)return false;

    const page=readRosterFromPage();
    const parsed=page.parsed||{};
    // Do not judge an uninitialized/non-game page.
    if(!parsed.pick && page.occupied===0)return false;

    const current=currentExactPotential();
    if(Number.isFinite(current) && current < floor-1e-9){
      const msg=`Potential ${current.toFixed(1)} < минимум ${floor.toFixed(1)}`;
      toast(`${msg} — новая попытка`);
      await startNewAttempt(msg,{allowReloadFallback:true});
      return true;
    }
    return false;
  }

  async function maybeAutoRestart(page){
    if(!autoRestart || restartBusy)return;
    const game=completedGameFromPage(page);
    if(!game)return;
    await startNewAttempt("6/6 завершено",{allowReloadFallback:true});
  }

  function syncFromNFLPerryPage(showToast=false){
    if(!pageSync || !model)return false;

    const page=readRosterFromPage();
    const parsed=page.parsed||{};
    const clean=cleanRosterForOptimizer(page.roster);

    renderThresholdControls();

    if(page.occupied===6 && page.matched===6){
      maybeRecordCompletedGame(page);
      setTimeout(()=>maybeAutoRestart(page),100);
    }

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
      setTimeout(()=>enforcePotentialFloor("sync"),80);
      setTimeout(()=>maybeScheduleAutoDraft(),180);
    }else{
      setTimeout(()=>enforcePotentialFloor("poll"),80);
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
    autoRestart=saved.nflpAutoRestart===true;
    minPotentialValue=saved.nflpMinPotentialValue??"";
    useSiteHighScore=saved.nflpUseSiteHighScore===true;

    const savedFloor=(()=>{
      if(useSiteHighScore)return true;
      const v=Number.parseFloat(String(minPotentialValue).replace(",","."));
      return Number.isFinite(v)&&v>0;
    })();

    // Preserve Auto Draft across automatic restarts/reloads only when the user
    // explicitly enabled continuous behavior (auto restart or potential floor).
    autoDraft=(autoRestart||savedFloor) && saved.nflpAutoDraft===true;
    if(!(autoRestart||savedFloor))storageSet({nflpAutoDraft:false});

    autoStrategy=["potential","expected","p295"].includes(saved.nflpAutoStrategy)?saved.nflpAutoStrategy:"potential";
    autoDelay=[500,900,1500,2500].includes(+saved.nflpAutoDelay)?+saved.nflpAutoDelay:900;
    gameHistory=Array.isArray(saved.nflpGameHistory)?saved.nflpGameHistory:[];
    initTeamOptions();
    installClickCapture();
    await reloadPlayers(false);
    renderStats();
    syncFromNFLPerryPage(false);
    try{
      const p=readRosterFromPage();
      const parsed=p.parsed||{};
      if(parsed.pick===1 && p.occupied===0)sessionStorage.removeItem("__nflp_floor_reload__");
    }catch{}

    let timer=null;
    const obs=new MutationObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>syncFromNFLPerryPage(false),220);
    });
    // The extension panel is a direct child of <html>, while NFLPerry lives in <body>.
    // Observe only the site so changing our own controls never triggers a sync/re-render.
    if(document.body)obs.observe(document.body,{subtree:true,childList:true,characterData:true});
    setInterval(()=>syncFromNFLPerryPage(false),1800);
  }

  init().catch(err=>{
    console.error("[NFLP Live Assistant]",err);
    try{setStatus(String(err?.message||err),"bad")}catch{}
  });
})();
