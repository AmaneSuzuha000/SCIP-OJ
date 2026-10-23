/*
 * IE-MC-02: periodic-review base-stock inventory with lost sales.
 * Synthetic teaching model; deterministic seed; common random demand for policy comparison.
 * Daily sequence: receive due orders -> sell / lose demand -> place replenishment order.
 * No backorders, no unit procurement cost. Costs are running operational costs per day.
 */
(function(root,factory) {
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.IEInventory=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  function range(x,name,lo,hi,int) {
    const v=Number(x);
    if(!Number.isFinite(v)||v<lo||v>hi||(int&&!Number.isInteger(v))) throw new RangeError(name+" 超出允许范围");
    return v;
  }
  function validate(p) {
    const v={
      meanDemand:range(p.meanDemand,"日均需求",0,30),
      targetA:range(p.targetA,"方案 A 库存上限",0,300,true),
      targetB:range(p.targetB,"方案 B 库存上限",0,300,true),
      leadDays:range(p.leadDays,"补货提前期",1,14,true),
      reviewDays:range(p.reviewDays,"定期检查间隔",1,14,true),
      holdingCost:range(p.holdingCost,"单位日持有成本",0,1000),
      lostCost:range(p.lostCost,"单位缺货损失",0,1000),
      orderCost:range(p.orderCost,"固定订货成本",0,1000),
      days:range(p.days,"模拟天数",30,1500,true),
      warmup:range(p.warmup,"预热天数",0,1000,true),
      replications:range(p.replications,"重复次数",5,100,true),
      seed:range(p.seed,"随机种子",1,4294967295,true)
    };
    if(v.warmup>=v.days) throw new RangeError("预热天数必须小于模拟天数");
    return v;
  }
  function random(seed) {
    let state=seed>>>0;
    return function() {state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+0.5)/4294967296;};
  }
  function poisson(lambda,rng) {
    if(lambda===0) return 0;
    const threshold=Math.exp(-lambda);
    let count=0,product=1;
    do {product*=rng();count++;} while(product>threshold);
    return count-1;
  }
  function demands(days,mean,seed) {
    const rng=random(seed);
    return Array.from({length:days},()=>poisson(mean,rng));
  }
  function simulate(series,p,target) {
    let onHand=target, pipeline=[],sumDemand=0,sumServed=0,sumLost=0;
    let stockoutDays=0,inventoryArea=0,cost=0,orders=0,orderUnits=0;
    const n=series.length;
    for(let day=0;day<n;day++) {
      // Planned receipts at start of day; never delete unreceived orders.
      const arriving=pipeline.filter(o=>o.due===day);
      for(const order of arriving) onHand+=order.qty;
      pipeline=pipeline.filter(o=>o.due!==day);
      const demand=series[day];
      if(!Number.isInteger(demand)||demand<0) throw new RangeError("需求序列须为非负整数");
      const served=Math.min(onHand,demand);
      const lost=demand-served;
      onHand-=served;
      let placed=0;
      if(day%p.reviewDays===0) {
        const position=onHand+pipeline.reduce((s,o)=>s+o.qty,0);
        placed=Math.max(0,target-position);
        if(placed>0) pipeline.push({due:day+p.leadDays,qty:placed});
      }
      if(day>=p.warmup) {
        sumDemand+=demand;sumServed+=served;sumLost+=lost;
        stockoutDays+=Number(lost>0);
        inventoryArea+=onHand;
        cost+=onHand*p.holdingCost+lost*p.lostCost+Number(placed>0)*p.orderCost;
        orders+=Number(placed>0);
        orderUnits+=placed;
      }
      if(onHand<0||!Number.isFinite(onHand)) throw new Error("库存守恒不变量失败");
    }
    const measured=n-p.warmup;
    return {
      fillRate:sumDemand?sumServed/sumDemand:1,
      stockoutRate:stockoutDays/measured,
      avgOnHand:inventoryArea/measured,
      dailyCost:cost/measured,
      orderFrequency:orders/measured,
      unitsOrderedPerDay:orderUnits/measured,
      demand:sumDemand,served:sumServed,lost:sumLost,
      endingOnHand:onHand
    };
  }
  function stats(deltas) {
    const n=deltas.length,mean=deltas.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(deltas.reduce((a,b)=>a+(b-mean)**2,0)/(n-1));
    const halfWidth=1.96*sd/Math.sqrt(n);
    return {mean,low:mean-halfWidth,high:mean+halfWidth,halfWidth,replications:n,method:"normal_approx_95"};
  }
  function mean(rows,key) {return rows.reduce((s,r)=>s+r[key],0)/rows.length;}
  function compare(raw) {
    const p=validate(raw),a=[],b=[],deltas=[];
    for(let i=0;i<p.replications;i++) {
      const sample=demands(p.days,p.meanDemand,(p.seed+Math.imul(i,2654435761))>>>0);
      const ra=simulate(sample,p,p.targetA),rb=simulate(sample,p,p.targetB);
      a.push(ra);b.push(rb);deltas.push(rb.dailyCost-ra.dailyCost);
    }
    const keys=["fillRate","stockoutRate","avgOnHand","dailyCost","orderFrequency","unitsOrderedPerDay"];
    const aggregate=rows=>Object.fromEntries(keys.map(key=>[key,mean(rows,key)]));
    return {params:p,baseline:aggregate(a),alternative:aggregate(b),
      costDiffCI:stats(deltas),costDifferences:deltas,
      notes:{policy:"order-up-to at end of each review day; lost sales; fixed deterministic lead time",
        measurement:"cost and fill rate evaluated after warmup; ratio per replication then averaged",
        pairing:"Both strategies receive identical daily demands within each independent replication"}};
  }
  return {validate,random,poisson,demands,simulate,compare};
});
