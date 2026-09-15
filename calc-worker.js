
"use strict";

let TEAMS=[], SCORES=[], teamIndex={};
const SLOTS=["PG","SG","SF","PF","C","6TH"];
const ceilingCache=new Map();
const decisionCache=new Map();

function keyState(usedMask, slotsMask){ return `${usedMask}:${slotsMask}`; }

function hungarianMax(matrix){
  const n=matrix.length, m=matrix[0]?.length||0;
  if(!n) return 0;
  if(m<n) return -Infinity;
  let maxV=0;
  for(const row of matrix) for(const x of row) if(Number.isFinite(x)) maxV=Math.max(maxV,x);
  const BIG=1e8, INF=1e15;
  const cost=matrix.map(r=>r.map(x=>Number.isFinite(x)?maxV-x:BIG));
  const u=new Array(n+1).fill(0),v=new Array(m+1).fill(0),p=new Array(m+1).fill(0),way=new Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i; let j0=0;
    const minv=new Array(m+1).fill(INF), used=new Array(m+1).fill(false);
    do{
      used[j0]=true;
      const i0=p[j0]; let delta=INF,j1=0;
      for(let j=1;j<=m;j++){
        if(used[j])continue;
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<minv[j]){minv[j]=cur;way[j]=j0}
        if(minv[j]<delta){delta=minv[j];j1=j}
      }
      if(!Number.isFinite(delta)||delta>=INF/2)return -Infinity;
      for(let j=0;j<=m;j++){
        if(used[j]){u[p[j]]+=delta;v[j]-=delta}else minv[j]-=delta;
      }
      j0=j1;
    }while(p[j0]!==0);
    do{
      const j1=way[j0]; p[j0]=p[j1]; j0=j1;
    }while(j0!==0);
  }
  const a=new Array(n).fill(-1);
  for(let j=1;j<=m;j++) if(p[j]>0&&p[j]<=n)a[p[j]-1]=j-1;
  let sum=0;
  for(let i=0;i<n;i++){
    if(a[i]<0||!Number.isFinite(matrix[i][a[i]]))return -Infinity;
    sum+=matrix[i][a[i]];
  }
  return sum;
}

function remainingCeiling(usedMask,slotsMask){
  const k=keyState(usedMask,slotsMask);
  if(ceilingCache.has(k)) return ceilingCache.get(k);

  const open=[];
  for(let s=0;s<6;s++) if(!(slotsMask&(1<<s))) open.push(s);
  if(!open.length){ ceilingCache.set(k,0); return 0; }

  const avail=[];
  for(let t=0;t<TEAMS.length;t++) if(!(usedMask&(1<<t))) avail.push(t);
  const matrix=open.map(s=>avail.map(t=>SCORES[t][s]));
  const val=hungarianMax(matrix);
  ceilingCache.set(k,val);
  return val;
}

// Policy: for the drawn team, choose the slot/player that maximizes the exact
// post-pick potential ceiling. Tie-break: higher current FPTS.
function decision(drawnTeam,usedMask,slotsMask){
  const dk=`${drawnTeam}|${usedMask}|${slotsMask}`;
  if(decisionCache.has(dk)) return decisionCache.get(dk);
  if(usedMask&(1<<drawnTeam)) return null;

  let best=null;
  for(let s=0;s<6;s++){
    if(slotsMask&(1<<s))continue;
    const score=SCORES[drawnTeam][s];
    if(!Number.isFinite(score))continue;
    const nu=usedMask|(1<<drawnTeam), ns=slotsMask|(1<<s);
    const rem=remainingCeiling(nu,ns);
    const potential=score+(Number.isFinite(rem)?rem:0);
    const cand={slot:s,score,potential};
    if(!best || cand.potential>best.potential+1e-9 ||
       (Math.abs(cand.potential-best.potential)<1e-9 && cand.score>best.score)){
      best=cand;
    }
  }
  decisionCache.set(dk,best);
  return best;
}

function mulberry32(seed){
  return function(){
    let t=seed+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  }
}
function sampleOrder(unused,n,rnd){
  const a=unused.slice();
  for(let i=0;i<n;i++){
    const j=i+Math.floor(rnd()*(a.length-i));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a.slice(0,n);
}

function simulateState(state,samples=12000,seed=12345){
  const remaining=6-popcnt(state.slotsMask);
  if(remaining<=0){
    const val=state.total;
    return {mode:"exact",samples:1,expected:val,p295:val>=295?1:0,p300:val>=300?1:0};
  }
  const unused=[];
  for(let t=0;t<TEAMS.length;t++) if(!(state.usedMask&(1<<t))) unused.push(t);
  const rnd=mulberry32(seed);
  let sum=0, ok295=0,ok300=0;
  for(let k=0;k<samples;k++){
    const order=sampleOrder(unused,remaining,rnd);
    let used=state.usedMask, slots=state.slotsMask, total=state.total;
    for(const t of order){
      const d=decision(t,used,slots);
      if(!d)continue;
      total+=d.score;
      used|=(1<<t);
      slots|=(1<<d.slot);
    }
    sum+=total;
    if(total>=295)ok295++;
    if(total>=300)ok300++;
  }
  return {mode:"simulation",samples,expected:sum/samples,p295:ok295/samples,p300:ok300/samples};
}

function exactEnumerate(state){
  const remaining=6-popcnt(state.slotsMask);
  const unused=[];
  for(let t=0;t<TEAMS.length;t++) if(!(state.usedMask&(1<<t))) unused.push(t);

  let leaves=0,sum=0,ok295=0,ok300=0;
  function rec(used,slots,total,depth){
    if(depth===remaining){
      leaves++; sum+=total;
      if(total>=295)ok295++;
      if(total>=300)ok300++;
      return;
    }
    for(const t of unused){
      if(used&(1<<t))continue;
      const d=decision(t,used,slots);
      if(!d)continue;
      rec(used|(1<<t),slots|(1<<d.slot),total+d.score,depth+1);
    }
  }
  rec(state.usedMask,state.slotsMask,state.total,0);
  return {
    mode:"exact",samples:leaves,
    expected:leaves?sum/leaves:state.total,
    p295:leaves?ok295/leaves:(state.total>=295?1:0),
    p300:leaves?ok300/leaves:(state.total>=300?1:0)
  };
}

function popcnt(n){
  n=n>>>0; let c=0;
  while(n){n&=n-1;c++}
  return c;
}

function analyzeCandidate(c,baseState,index){
  const ti=teamIndex[c.team];
  const state={
    usedMask:baseState.usedMask|(1<<ti),
    slotsMask:baseState.slotsMask|(1<<c.slotIndex),
    total:baseState.total+c.fpts
  };
  const remain=6-popcnt(state.slotsMask);
  let result;
  // Exact enumeration becomes practical after two total picks (<=4 unknown future draws).
  if(remain<=4) result=exactEnumerate(state);
  else result=simulateState(state, 5000, 9001+index*977);
  return {...result,index};
}

self.onmessage=(ev)=>{
  const msg=ev.data||{};
  if(msg.type==="INIT"){
    TEAMS=msg.teams;
    SCORES=msg.scores;
    teamIndex=Object.fromEntries(TEAMS.map((t,i)=>[t,i]));
    ceilingCache.clear(); decisionCache.clear();
    self.postMessage({type:"READY"});
    return;
  }
  if(msg.type==="STATE"){
    const remain=6-popcnt(msg.state.slotsMask);
    const result=remain<=4 ? exactEnumerate(msg.state) : simulateState(msg.state, 12000, 17713);
    self.postMessage({type:"STATE_RESULT",requestId:msg.requestId,result});
    return;
  }
  if(msg.type==="CANDIDATES"){
    const results=msg.candidates.map((c,i)=>analyzeCandidate(c,msg.state,i));
    self.postMessage({type:"CANDIDATE_RESULTS",requestId:msg.requestId,results});
  }
};
