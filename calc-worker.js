"use strict";

let TEAMS=[],CANDS=[],teamIndex={};
const ceilingCache=new Map(),decisionCache=new Map();

function sig(keys){return [...new Set(keys||[])].sort().join("\x1f")}
function stateKey(used,slots,keys){return `${used}:${slots}:${sig(keys)}`}

function hungarianMax(matrix){
  const n=matrix.length,m=matrix[0]?.length||0;
  if(!n)return {score:0,assignment:[]};
  if(m<n)return null;
  let maxV=0;
  for(const r of matrix)for(const x of r)if(Number.isFinite(x))maxV=Math.max(maxV,x);
  const BIG=1e8,INF=1e15;
  const cost=matrix.map(r=>r.map(x=>Number.isFinite(x)?maxV-x:BIG));
  const u=new Array(n+1).fill(0),v=new Array(m+1).fill(0),p=new Array(m+1).fill(0),way=new Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;
    const minv=new Array(m+1).fill(INF),used=new Array(m+1).fill(false);
    do{
      used[j0]=true;const i0=p[j0];let delta=INF,j1=0;
      for(let j=1;j<=m;j++){
        if(used[j])continue;
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<minv[j]){minv[j]=cur;way[j]=j0}
        if(minv[j]<delta){delta=minv[j];j1=j}
      }
      if(!Number.isFinite(delta)||delta>=INF/2)return null;
      for(let j=0;j<=m;j++){
        if(used[j]){u[p[j]]+=delta;v[j]-=delta}else minv[j]-=delta;
      }
      j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1}while(j0!==0);
  }
  const a=new Array(n).fill(-1);
  for(let j=1;j<=m;j++)if(p[j]>0&&p[j]<=n)a[p[j]-1]=j-1;
  let score=0;
  for(let i=0;i<n;i++){
    const j=a[i];
    if(j<0||!Number.isFinite(matrix[i][j]))return null;
    score+=matrix[i][j];
  }
  return {score,assignment:a};
}

function firstAllowed(t,s,banned,cellForbidden){
  for(const c of (CANDS?.[t]?.[s]||[])){
    if(!c?.key||!Number.isFinite(+c.score))continue;
    if(banned.has(c.key)||cellForbidden?.has(c.key))continue;
    return c;
  }
  return null;
}

function remaining(usedMask,slotsMask,usedKeys){
  const ck=stateKey(usedMask,slotsMask,usedKeys);
  if(ceilingCache.has(ck))return ceilingCache.get(ck);

  const open=[],avail=[];
  for(let s=0;s<6;s++)if(!(slotsMask&(1<<s)))open.push(s);
  if(!open.length){ceilingCache.set(ck,0);return 0}
  for(let t=0;t<TEAMS.length;t++)if(!(usedMask&(1<<t)))avail.push(t);
  if(avail.length<open.length){ceilingCache.set(ck,-Infinity);return -Infinity}

  const banned=new Set(usedKeys||[]);
  let best=-Infinity,nodes=0;
  const MAX_NODES=8000;

  function addForbid(map,cell,key){
    const n=new Map(map),s=new Set(map.get(cell)||[]);
    s.add(key);n.set(cell,s);return n;
  }

  function rec(forbids){
    if(++nodes>MAX_NODES)return;
    const selected=open.map(()=>avail.map(()=>null));
    const matrix=open.map((s,ri)=>avail.map((t,ci)=>{
      const c=firstAllowed(t,s,banned,forbids.get(`${s}:${t}`));
      selected[ri][ci]=c;return c?+c.score:-Infinity;
    }));
    const h=hungarianMax(matrix);
    if(!h||h.score<=best+1e-9)return;

    const assigned=open.map((s,ri)=>{
      const ci=h.assignment[ri],t=avail[ci],c=selected[ri][ci];
      return {s,t,c,key:c?.key||""};
    });
    if(assigned.some(x=>!x.c))return;

    const seen=new Map();let conflict=null;
    for(const a of assigned){
      if(seen.has(a.key)){conflict=[seen.get(a.key),a];break}
      seen.set(a.key,a);
    }
    if(!conflict){best=h.score;return}
    const [a,b]=conflict;
    rec(addForbid(forbids,`${a.s}:${a.t}`,a.key));
    rec(addForbid(forbids,`${b.s}:${b.t}`,b.key));
  }

  rec(new Map());
  ceilingCache.set(ck,best);
  return best;
}

function decision(team,usedMask,slotsMask,usedKeys){
  const dk=`${team}|${usedMask}|${slotsMask}|${sig(usedKeys)}`;
  if(decisionCache.has(dk))return decisionCache.get(dk);
  if(usedMask&(1<<team))return null;

  const banned=new Set(usedKeys||[]);
  let best=null;
  for(let s=0;s<6;s++){
    if(slotsMask&(1<<s))continue;
    const c=firstAllowed(team,s,banned,null);
    if(!c)continue;
    const nextKeys=[...(usedKeys||[]),c.key];
    const rem=remaining(usedMask|(1<<team),slotsMask|(1<<s),nextKeys);
    const potential=+c.score+(Number.isFinite(rem)?rem:0);
    const x={slot:s,score:+c.score,key:c.key,potential};
    if(!best||x.potential>best.potential+1e-9||
       (Math.abs(x.potential-best.potential)<1e-9&&x.score>best.score))best=x;
  }
  decisionCache.set(dk,best);
  return best;
}

function popcnt(n){n=n>>>0;let c=0;while(n){n&=n-1;c++}return c}
function rng(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function sampleOrder(unused,n,r){const a=unused.slice();for(let i=0;i<n;i++){const j=i+Math.floor(r()*(a.length-i));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,n)}

function simulate(state,samples=9000,seed=12345){
  const remain=6-popcnt(state.slotsMask);
  if(remain<=0){const v=state.total;return{mode:"exact",samples:1,expected:v,p295:v>=295?1:0,p300:v>=300?1:0}}
  const unused=[];for(let t=0;t<TEAMS.length;t++)if(!(state.usedMask&(1<<t)))unused.push(t);
  const r=rng(seed);let sum=0,a295=0,a300=0;
  for(let k=0;k<samples;k++){
    const order=sampleOrder(unused,remain,r);
    let used=state.usedMask,slots=state.slotsMask,total=state.total,keys=[...(state.usedKeys||[])];
    for(const t of order){
      const d=decision(t,used,slots,keys);if(!d)continue;
      total+=d.score;used|=(1<<t);slots|=(1<<d.slot);keys.push(d.key);
    }
    sum+=total;if(total>=295)a295++;if(total>=300)a300++;
  }
  return{mode:"simulation",samples,expected:sum/samples,p295:a295/samples,p300:a300/samples};
}

function enumerate(state){
  const remain=6-popcnt(state.slotsMask);
  const unused=[];for(let t=0;t<TEAMS.length;t++)if(!(state.usedMask&(1<<t)))unused.push(t);
  let leaves=0,sum=0,a295=0,a300=0;
  function rec(used,slots,total,keys,depth){
    if(depth===remain){leaves++;sum+=total;if(total>=295)a295++;if(total>=300)a300++;return}
    for(const t of unused){
      if(used&(1<<t))continue;
      const d=decision(t,used,slots,keys);if(!d)continue;
      rec(used|(1<<t),slots|(1<<d.slot),total+d.score,[...keys,d.key],depth+1);
    }
  }
  rec(state.usedMask,state.slotsMask,state.total,[...(state.usedKeys||[])],0);
  return{mode:"exact",samples:leaves,expected:leaves?sum/leaves:state.total,p295:leaves?a295/leaves:(state.total>=295?1:0),p300:leaves?a300/leaves:(state.total>=300?1:0)};
}

function analyzeCandidate(c,base,index){
  const ti=teamIndex[c.team];
  const state={
    usedMask:base.usedMask|(1<<ti),
    slotsMask:base.slotsMask|(1<<c.slotIndex),
    total:base.total+c.fpts,
    usedKeys:[...(base.usedKeys||[]),c.playerKey]
  };
  const remain=6-popcnt(state.slotsMask);
  const result=remain<=3?enumerate(state):simulate(state,5000,9001+index*977);
  return{...result,index};
}

self.onmessage=e=>{
  const m=e.data||{};
  if(m.type==="INIT"){
    TEAMS=m.teams||[];CANDS=m.candidates||[];
    teamIndex=Object.fromEntries(TEAMS.map((t,i)=>[t,i]));
    ceilingCache.clear();decisionCache.clear();self.postMessage({type:"READY"});return;
  }
  if(m.type==="STATE"){
    const remain=6-popcnt(m.state.slotsMask);
    const result=remain<=3?enumerate(m.state):simulate(m.state,10000,17713);
    self.postMessage({type:"STATE_RESULT",requestId:m.requestId,result});return;
  }
  if(m.type==="CANDIDATES"){
    self.postMessage({type:"CANDIDATE_RESULTS",requestId:m.requestId,results:(m.candidates||[]).map((c,i)=>analyzeCandidate(c,m.state,i))});
  }
};
