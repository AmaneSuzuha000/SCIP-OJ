"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const inv=require("../site/js/inventory-core.js");
const flow=require("../site/js/flow-core.js");
const queue=require("../site/js/simulation-core.js");

const ip={meanDemand:3,targetA:8,targetB:14,leadDays:2,reviewDays:1,
  holdingCost:1,lostCost:9,orderCost:6,days:365,warmup:60,replications:30,seed:20261023};
const ir=inv.compare(ip);
assert.deepEqual(ir,inv.compare(ip),"Inventory must be reproducible with same seeds");
assert.equal(ir.costDifferences.length,ip.replications);
assert(ir.baseline.fillRate>=0&&ir.baseline.fillRate<=1);
assert(ir.alternative.fillRate>=0&&ir.alternative.fillRate<=1);
assert(Math.abs(ir.costDiffCI.mean-(ir.alternative.dailyCost-ir.baseline.dailyCost))<1e-9);
const isame=inv.compare({...ip,targetB:ip.targetA});
assert(isame.costDifferences.every(x=>x===0));
assert.equal(isame.costDiffCI.halfWidth,0);
const noDemand=inv.simulate(Array(30).fill(0),inv.validate({...ip,warmup:0,days:30}),3);
assert.equal(noDemand.dailyCost,3);
assert.equal(noDemand.fillRate,1);
assert.equal(noDemand.orderFrequency,0);
const constant=inv.simulate(Array(30).fill(3),inv.validate({...ip,leadDays:1,reviewDays:1,warmup:0,days:30,orderCost:12}),3);
assert.equal(constant.fillRate,1);
assert.equal(constant.dailyCost,12,"One order each day, no leftover inventory/stockouts");
assert.equal(constant.demand,constant.served+constant.lost);
const neverStock=inv.simulate(Array(30).fill(3),inv.validate({...ip,warmup:0,days:30}),0);
assert.equal(neverStock.fillRate,0);
assert.equal(neverStock.lost,90);
assert(neverStock.avgOnHand===0);
for(const bad of [{...ip,leadDays:0},{...ip,warmup:365},{...ip,replications:1},{...ip,meanDemand:Infinity}])
  assert.throws(()=>inv.compare(bad),RangeError);

const fp={arrivalMean:4,stage1Mean:3,stage2Mean:5,bufferA:0,bufferB:3,
  horizon:960,warmup:180,replications:30,seed:20261023};
const fr=flow.compare(fp);
assert.deepEqual(fr,flow.compare(fp),"Flow line must be reproducible with same seeds");
assert.equal(fr.throughputDifferences.length,30);
assert(Math.abs(fr.throughputDiffCI.mean-(fr.alternative.throughput-fr.baseline.throughput))<1e-9);
const fsame=flow.compare({...fp,bufferB:fp.bufferA});
assert(fsame.throughputDifferences.every(x=>x===0));
assert.equal(fsame.throughputDiffCI.halfWidth,0);
const jobs=[{arrival:0,stage1:1,stage2:5},{arrival:.1,stage1:1,stage2:5},{arrival:.2,stage1:1,stage2:5}];
const blocked=flow.simulate(jobs,0,0,18), buffered=flow.simulate(jobs,2,0,18);
assert.equal(blocked.totalCompleted,3);
assert.equal(buffered.totalCompleted,3);
assert.equal(blocked.arrivals-blocked.totalCompleted,blocked.endingWip);
assert.equal(buffered.arrivals-buffered.totalCompleted,buffered.endingWip);
assert(blocked.blockedRatio>0);
assert.equal(buffered.blockedRatio,0);
assert(buffered.meanBuffer>0);
assert(buffered.meanExternalQueue<blocked.meanExternalQueue);
assert(Math.abs(buffered.station2Util+buffered.starvationRatio-1)<1e-9,
  "Single machine 2 must be either processing or idle");
for(const cap of [0,1,2,10]){
 const sample=flow.workload(flow.validate(fp),1234567);
 const result=flow.simulate(sample,cap,fp.warmup,fp.horizon);
 assert.equal(result.arrivals-result.totalCompleted,result.endingWip,
   "Event flow conservation must hold across buffer capacities");
 assert(result.station1Util>=0&&result.station1Util<=1);
 assert(result.station2Util>=0&&result.station2Util<=1);
 assert(result.blockedRatio>=0&&result.blockedRatio<=1);
 assert(result.station1Util+result.blockedRatio<=1+1e-9);
 assert(Math.abs(result.station2Util+result.starvationRatio-1)<1e-8);
}
for(const bad of [{...fp,bufferB:-1},{...fp,stage1Mean:0},{...fp,warmup:960}])
 assert.throws(()=>flow.compare(bad),RangeError);

// Independent stationary Erlang-C cross-check for the existing M/M/c case.
// Steady-state theory is NOT the same as finite-horizon simulation; use tolerance.
function erlangCWait(arrivalMean,serviceMean,c){
 const a=serviceMean/arrivalMean,rho=a/c;
 if(rho>=1)throw new RangeError("No finite steady-state mean when rho >= 1");
 let factorial=1,sum=0;
 for(let k=0;k<c;k++){if(k>0)factorial*=k;sum+=Math.pow(a,k)/factorial;}
 const tail=Math.pow(a,c)/(factorial*c*(1-rho));
 return (tail/(sum+tail))/(c/serviceMean-1/arrivalMean);
}
const qp={arrivalMean:8,serviceMean:12,serversA:2,serversB:3,
  horizon:8000,warmup:1500,replications:100,seed:78341};
const qr=queue.compare(qp);
const theoryA=erlangCWait(8,12,2),theoryB=erlangCWait(8,12,3);
assert(Math.abs(qr.baseline.avgWait/theoryA-1)<.20,"M/M/2 Monte Carlo and analytic steady-state disagree");
assert(Math.abs(qr.alternative.avgWait/theoryB-1)<.20,"M/M/3 Monte Carlo and analytic steady-state disagree");
assert(Math.abs(qr.baseline.meanWip-qr.baseline.meanQueue-qr.baseline.utilization*2)<1e-8,
  "Time-average WIP must equal queue plus in-service jobs");

for(const [name,js,html,app] of [
 ["inventory","site/js/inventory-core.js","site/inventory-lab.html","root.IEInventory"],
 ["flow","site/js/flow-core.js","site/flow-lab.html","root.IEFlow"]
]){
 const doc=fs.readFileSync(html,"utf8");
 assert(doc.includes(js.replace("site/","")),name+" model script missing");
 assert(doc.includes('data-lab="'+name+'"'));
 assert(doc.includes("js/teaching-labs.js"));
 assert(doc.includes("非正式课程成绩"));
 assert(!doc.includes("service_role"));
 const script=fs.readFileSync(js,"utf8");assert(script.includes(app));
}
const external=fs.readFileSync("site/official-examples.html","utf8");
assert(external.includes("scipopt/PySCIPOpt"));
assert(external.includes("Gurobi/modeling-examples"));
assert(external.includes("noopener noreferrer"));
assert(fs.readFileSync("site/case-studio.html","utf8").includes("inventory-lab.html"));
assert(fs.readFileSync("site/case-studio.html","utf8").includes("flow-lab.html"));
assert(fs.readFileSync("site/index.html","utf8").includes("official-examples.html"));
console.log("IE inventory, flow-line, Erlang-C, invariants, references and page contracts passed");
