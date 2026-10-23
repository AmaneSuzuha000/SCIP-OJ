/*
 * IE-DES-03: two-stage tandem flow-line with finite intermediate buffer.
 * Blocking-after-service (BAS), FCFS, unlimited external waiting room.
 * Station 1 is blocked while holding its completed work when no downstream slot is free.
 * Synthetic teaching assumptions; no AGV, breakdowns, real production data or deadlines.
 */
(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.IEFlow=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  function range(value,name,lo,hi,integer) {
    const v=Number(value);
    if(!Number.isFinite(v)||v<lo||v>hi||(integer&&!Number.isInteger(v))) throw new RangeError(name+" 超出允许范围");
    return v;
  }
  function validate(raw) {
    const p={
      arrivalMean:range(raw.arrivalMean,"平均到达间隔",1,120),
      stage1Mean:range(raw.stage1Mean,"工序一平均处理时间",1,180),
      stage2Mean:range(raw.stage2Mean,"工序二平均处理时间",1,180),
      bufferA:range(raw.bufferA,"方案 A 缓冲容量",0,25,true),
      bufferB:range(raw.bufferB,"方案 B 缓冲容量",0,25,true),
      horizon:range(raw.horizon,"运行时长",120,10080,true),
      warmup:range(raw.warmup,"预热时长",0,9999,true),
      replications:range(raw.replications,"独立重复次数",5,100,true),
      seed:range(raw.seed,"随机种子",1,4294967295,true)
    };
    if(p.warmup>=p.horizon) throw new RangeError("预热必须小于运行时长");
    return p;
  }
  function random(seed) {
    let state=seed>>>0;
    return function(){state=(Math.imul(1664525,state)+1013904223)>>>0;return(state+.5)/4294967296;};
  }
  function workload(p,seed) {
    const rng=random(seed),jobs=[];
    let time=0;
    while(time<p.horizon) {
      time+=-p.arrivalMean*Math.log(rng());
      if(time>=p.horizon) break;
      if(jobs.length>=20000) throw new RangeError("事件量过大，请缩短运行时间");
      jobs.push({arrival:time,stage1:-p.stage1Mean*Math.log(rng()),stage2:-p.stage2Mean*Math.log(rng())});
    }
    return jobs;
  }
  function simulate(jobs,bufferCapacity,warmup,horizon) {
    let t=0,arrivalCursor=0,external=[],buffer=[],s1=null,s2=null;
    let done=0,entered=0,completed=0,areaWip=0,areaExternal=0,areaBuffer=0;
    let proc1=0,proc2=0,blocked=0,idle2=0,systemCount=0;
    function start1() {
      if(s1===null&&external.length) {
        const job=external.shift();
        s1={job,finish:t+job.stage1,blocked:false};
      }
    }
    function start2(job) {s2={job,finish:t+job.stage2};}
    function handoffAfter2() {
      // Stage 2 has just become free.
      if(buffer.length) {
        start2(buffer.shift());
        // A buffer vacancy immediately relieves a blocked stage 1.
        if(s1&&s1.blocked) {
          buffer.push(s1.job);s1=null;start1();
        }
      } else if(s1&&s1.blocked) {
        start2(s1.job);s1=null;start1();
      }
    }
    const maxEvents=jobs.length*3+10;
    for(let iter=0;iter<=maxEvents;iter++) {
      const at=arrivalCursor<jobs.length?jobs[arrivalCursor].arrival:Infinity;
      const one=s1&&!s1.blocked?s1.finish:Infinity;
      const two=s2?s2.finish:Infinity;
      const next=Math.min(at,one,two,horizon);
      const low=Math.max(t,warmup),high=Math.min(next,horizon),delta=Math.max(0,high-low);
      if(delta) {
        areaWip+=systemCount*delta;
        areaExternal+=external.length*delta;
        areaBuffer+=buffer.length*delta;
        if(s1) {if(s1.blocked) blocked+=delta;else proc1+=delta;}
        if(s2) proc2+=delta;else idle2+=delta;
      }
      t=next;
      if(t>=horizon||!Number.isFinite(t)) break;
      // Ties are handled deterministically: stage 2 finish, stage 1 finish, arrival.
      if(two<=one&&two<=at) {
        s2=null;systemCount--;done++;
        if(t>=warmup) completed++;
        handoffAfter2();
      } else if(one<=at) {
        if(s2===null&&buffer.length===0) {
          start2(s1.job);s1=null;start1();
        } else if(buffer.length<bufferCapacity) {
          buffer.push(s1.job);s1=null;start1();
        } else {
          s1.blocked=true;s1.finish=Infinity;
        }
      } else {
        external.push(jobs[arrivalCursor++]);entered++;systemCount++;start1();
      }
      if(systemCount<0||buffer.length>bufferCapacity||buffer.length<0)
        throw new Error("缓冲区/流量守恒不变量失败");
      if(iter===maxEvents) throw new Error("事件循环超限");
    }
    const measured=horizon-warmup;
    return {
      throughput:completed/measured*60,
      station1Util:proc1/measured,
      station2Util:proc2/measured,
      blockedRatio:blocked/measured,
      starvationRatio:idle2/measured,
      meanWip:areaWip/measured,
      meanExternalQueue:areaExternal/measured,
      meanBuffer:areaBuffer/measured,
      completions:completed,arrivals:entered,endingWip:systemCount,
      totalCompleted:done
    };
  }
  function mean(rows,key){return rows.reduce((s,r)=>s+r[key],0)/rows.length;}
  function pairedCI(ds) {
    const n=ds.length,avg=ds.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(ds.reduce((a,b)=>a+(b-avg)**2,0)/(n-1));
    const halfWidth=1.96*sd/Math.sqrt(n);
    return {mean:avg,low:avg-halfWidth,high:avg+halfWidth,halfWidth,replications:n,method:"normal_approx_95"};
  }
  function compare(raw) {
    const p=validate(raw),a=[],b=[],diff=[];
    for(let i=0;i<p.replications;i++) {
      const jobs=workload(p,(p.seed+Math.imul(i,2654435761))>>>0);
      const ra=simulate(jobs,p.bufferA,p.warmup,p.horizon);
      const rb=simulate(jobs,p.bufferB,p.warmup,p.horizon);
      a.push(ra);b.push(rb);diff.push(rb.throughput-ra.throughput);
    }
    const keys=["throughput","station1Util","station2Util","blockedRatio","starvationRatio","meanWip","meanExternalQueue","meanBuffer"];
    const aggregate=rows=>Object.fromEntries(keys.map(key=>[key,mean(rows,key)]));
    return {params:p,baseline:aggregate(a),alternative:aggregate(b),
      throughputDiffCI:pairedCI(diff),throughputDifferences:diff,
      notes:{blocking:"blocking after service at station 1; blocked unit occupies station 1",
        arrival:"Poisson; exponential independent processing; FIFO; infinite external queue",
        measurement:"time-average area metrics windowed; throughput counted only if completed in measurement window",
        paired:"same arrival and service realizations shared for each buffer policy"}};
  }
  return {validate,random,workload,simulate,compare};
});
