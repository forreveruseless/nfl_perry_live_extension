
(() => {
  "use strict";

  const TEAM_NAMES = {
    ATL:"Atlanta Hawks",BKN:"Brooklyn Nets",BOS:"Boston Celtics",CHA:"Charlotte Hornets",
    CHI:"Chicago Bulls",CLE:"Cleveland Cavaliers",DAL:"Dallas Mavericks",DEN:"Denver Nuggets",
    DET:"Detroit Pistons",GSW:"Golden State Warriors",HOU:"Houston Rockets",IND:"Indiana Pacers",
    LAC:"LA Clippers",LAL:"Los Angeles Lakers",MEM:"Memphis Grizzlies",MIA:"Miami Heat",
    MIL:"Milwaukee Bucks",MIN:"Minnesota Timberwolves",NOP:"New Orleans Pelicans",
    NYK:"New York Knicks",OKC:"Oklahoma City Thunder",ORL:"Orlando Magic",
    PHI:"Philadelphia 76ers",PHX:"Phoenix Suns",POR:"Portland Trail Blazers",
    SAC:"Sacramento Kings",SAS:"San Antonio Spurs",TOR:"Toronto Raptors",
    UTA:"Utah Jazz",WAS:"Washington Wizards"
  };
  const ACTIVE_TEAMS = Object.keys(TEAM_NAMES);
  const SLOT_ORDER = ["PG","SG","SF","PF","C","6TH"];

  function positions(p){
    const arr = Array.isArray(p.positions) && p.positions.length ? p.positions : [p.position];
    return arr.filter(Boolean).map(x => String(x).toUpperCase());
  }
  function eligible(p, slot){
    if(slot === "6TH") return true;
    const ps = positions(p);
    if(slot === "PG") return ps.includes("PG") || ps.includes("G");
    if(slot === "SG") return ps.includes("SG") || ps.includes("G");
    if(slot === "SF") return ps.includes("SF") || ps.includes("F");
    if(slot === "PF") return ps.includes("PF") || ps.includes("F");
    if(slot === "C") return ps.includes("C");
    return false;
  }
  function fullName(p){
    return `${p.firstName || ""} ${p.lastName || ""}`.trim();
  }
  function playerKey(value){
    const name = typeof value === "string" ? value : fullName(value || {});
    return String(name)
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^\p{L}\p{N}]+/gu," ")
      .trim().toLowerCase().replace(/\s+/g," ");
  }
  function normalizePlayers(raw){
    return (Array.isArray(raw) ? raw : [])
      .filter(p => p && ACTIVE_TEAMS.includes(p.team) && Number.isFinite(+p.fpts))
      .map(p => ({
        _id: p._id || `${p.team}|${fullName(p)}`,
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        team: p.team,
        position: p.position || "",
        positions: Array.isArray(p.positions) ? p.positions : [p.position].filter(Boolean),
        fpts: +p.fpts,
        year: p.year ?? null,
        pts: p.pts ?? null,
        reb: p.reb ?? null,
        ast: p.ast ?? null,
        games: p.games ?? null
      }));
  }

  function buildModel(players){
    const byTeam = new Map();
    for(const t of ACTIVE_TEAMS) byTeam.set(t, []);
    for(const p of players){
      if(byTeam.has(p.team)) byTeam.get(p.team).push(p);
    }

    const teamIndex = Object.fromEntries(ACTIVE_TEAMS.map((t,i)=>[t,i]));
    const best = ACTIVE_TEAMS.map(()=>SLOT_ORDER.map(()=>null));
    const cellCandidates = ACTIVE_TEAMS.map(()=>SLOT_ORDER.map(()=>[]));

    for(const t of ACTIVE_TEAMS){
      const ti = teamIndex[t];
      for(let si=0;si<SLOT_ORDER.length;si++){
        const slot=SLOT_ORDER[si];
        const byIdentity=new Map();
        for(const p of byTeam.get(t)){
          if(!eligible(p,slot))continue;
          const key=playerKey(p);
          if(!key)continue;
          const prev=byIdentity.get(key);
          if(!prev || p.fpts>prev.fpts)byIdentity.set(key,p);
        }
        const arr=[...byIdentity.values()].sort((a,b)=>b.fpts-a.fpts);
        cellCandidates[ti][si]=arr;
        best[ti][si]=arr[0]||null;
      }
    }
    return {byTeam,teamIndex,best,cellCandidates};
  }

  function rosterMasks(roster, teamIndex){
    let usedMask=0,slotsMask=0,total=0;
    const usedPlayerKeys=[];
    for(let si=0;si<SLOT_ORDER.length;si++){
      const r=roster?.[SLOT_ORDER[si]];
      if(!r)continue;
      const ti=teamIndex[r.team];
      if(Number.isInteger(ti))usedMask|=(1<<ti);
      slotsMask|=(1<<si);
      total+=+r.fpts||0;
      const pk=playerKey(r.name||"");
      if(pk&&!usedPlayerKeys.includes(pk))usedPlayerKeys.push(pk);
    }
    return {usedMask,slotsMask,total,usedPlayerKeys};
  }

  function hungarianMax(matrix){
    const n = matrix.length;
    const m = matrix[0]?.length || 0;
    if(!n) return {score:0, assignment:[]};
    if(m < n) return null;

    let maxV = 0;
    for(const row of matrix) for(const v of row) if(Number.isFinite(v)) maxV = Math.max(maxV, v);
    const BIG = 1e8;
    const cost = matrix.map(row => row.map(v => Number.isFinite(v) ? maxV - v : BIG));

    const u = new Array(n+1).fill(0), v = new Array(m+1).fill(0),
          p = new Array(m+1).fill(0), way = new Array(m+1).fill(0);
    const INF = 1e15;

    for(let i=1;i<=n;i++){
      p[0]=i;
      let j0=0;
      const minv=new Array(m+1).fill(INF);
      const used=new Array(m+1).fill(false);
      do{
        used[j0]=true;
        const i0=p[j0];
        let delta=INF, j1=0;
        for(let j=1;j<=m;j++){
          if(used[j]) continue;
          const cur=cost[i0-1][j-1]-u[i0]-v[j];
          if(cur<minv[j]){ minv[j]=cur; way[j]=j0; }
          if(minv[j]<delta){ delta=minv[j]; j1=j; }
        }
        if(!Number.isFinite(delta) || delta>=INF/2) return null;
        for(let j=0;j<=m;j++){
          if(used[j]){ u[p[j]]+=delta; v[j]-=delta; }
          else minv[j]-=delta;
        }
        j0=j1;
      }while(p[j0]!==0);

      do{
        const j1=way[j0];
        p[j0]=p[j1];
        j0=j1;
      }while(j0!==0);
    }

    const assignment=new Array(n).fill(-1);
    for(let j=1;j<=m;j++) if(p[j]>0 && p[j]<=n) assignment[p[j]-1]=j-1;

    let score=0;
    for(let i=0;i<n;i++){
      const j=assignment[i];
      if(j<0 || !Number.isFinite(matrix[i][j])) return null;
      score += matrix[i][j];
    }
    return {score, assignment};
  }

  function firstAllowed(model,ti,si,globalBanned,cellForbidden){
    const arr=model.cellCandidates?.[ti]?.[si]||[];
    for(const p of arr){
      const pk=playerKey(p);
      if(globalBanned.has(pk))continue;
      if(cellForbidden?.has(pk))continue;
      return p;
    }
    return null;
  }

  function exactRemaining(model, usedMask, slotsMask, bannedPlayerKeys=[]){
    const openSlots=[];
    for(let si=0;si<6;si++)if(!(slotsMask&(1<<si)))openSlots.push(si);
    if(!openSlots.length)return {score:0,picks:[]};

    const avail=[];
    for(let ti=0;ti<ACTIVE_TEAMS.length;ti++)if(!(usedMask&(1<<ti)))avail.push(ti);
    if(avail.length<openSlots.length)return {score:-Infinity,picks:[]};

    const banned=new Set((bannedPlayerKeys||[]).filter(Boolean));
    let bestSolution=null,nodes=0;
    const MAX_NODES=12000;

    function addForbid(forbids,cell,key){
      const next=new Map(forbids);
      const set=new Set(forbids.get(cell)||[]);
      set.add(key); next.set(cell,set);
      return next;
    }

    function solve(forbids){
      if(++nodes>MAX_NODES)return;
      const selected=openSlots.map(()=>avail.map(()=>null));
      const matrix=openSlots.map((si,ri)=>avail.map((ti,ci)=>{
        const p=firstAllowed(model,ti,si,banned,forbids.get(`${si}:${ti}`));
        selected[ri][ci]=p;
        return p?+p.fpts:-Infinity;
      }));

      const h=hungarianMax(matrix);
      if(!h)return;
      if(bestSolution&&h.score<=bestSolution.score+1e-9)return;

      const assigned=openSlots.map((si,ri)=>{
        const ci=h.assignment[ri],ti=avail[ci],p=selected[ri][ci];
        return {si,ti,p,pk:p?playerKey(p):""};
      });
      if(assigned.some(x=>!x.p))return;

      const seen=new Map();
      let conflict=null;
      for(const a of assigned){
        if(seen.has(a.pk)){conflict=[seen.get(a.pk),a];break}
        seen.set(a.pk,a);
      }

      if(!conflict){
        bestSolution={
          score:h.score,
          picks:assigned.map(a=>({
            slot:SLOT_ORDER[a.si],team:ACTIVE_TEAMS[a.ti],
            player:a.p,fpts:+a.p.fpts,playerKey:a.pk
          }))
        };
        return;
      }

      const [a,b]=conflict;
      solve(addForbid(forbids,`${a.si}:${a.ti}`,a.pk));
      solve(addForbid(forbids,`${b.si}:${b.ti}`,b.pk));
    }

    solve(new Map());
    return bestSolution||{score:-Infinity,picks:[]};
  }

  function exactCeiling(model, roster){
    const {usedMask,slotsMask,total,usedPlayerKeys}=rosterMasks(roster,model.teamIndex);
    const rem=exactRemaining(model,usedMask,slotsMask,usedPlayerKeys);
    return {
      total:total+(Number.isFinite(rem.score)?rem.score:0),
      lockedTotal:total,
      remainingTotal:Number.isFinite(rem.score)?rem.score:0,
      future:rem.picks
    };
  }

  function candidatesForTeam(model,team,roster){
    const ti=model.teamIndex[team];
    if(!Number.isInteger(ti))return [];
    const {usedMask,slotsMask,total,usedPlayerKeys}=rosterMasks(roster,model.teamIndex);
    if(usedMask&(1<<ti))return [];

    const banned=new Set(usedPlayerKeys);
    const current=exactCeiling(model,roster).total;
    const out=[];

    for(let si=0;si<6;si++){
      if(slotsMask&(1<<si))continue;
      const p=firstAllowed(model,ti,si,banned,null);
      if(!p)continue;
      const pk=playerKey(p);
      const rem=exactRemaining(
        model,
        usedMask|(1<<ti),
        slotsMask|(1<<si),
        [...usedPlayerKeys,pk]
      );
      const ceiling=total+p.fpts+(Number.isFinite(rem.score)?rem.score:0);
      out.push({
        team,slot:SLOT_ORDER[si],slotIndex:si,
        player:p,playerKey:pk,fpts:+p.fpts,ceiling,
        loss:current-ceiling
      });
    }

    out.sort((a,b)=>b.ceiling-a.ceiling||b.fpts-a.fpts||a.slotIndex-b.slotIndex);
    return out;
  }

  window.NFLPerryNBA = {
    TEAM_NAMES, ACTIVE_TEAMS, SLOT_ORDER,
    normalizePlayers, buildModel, rosterMasks,
    exactRemaining, exactCeiling, candidatesForTeam,
    fullName, playerKey, eligible
  };
})();
