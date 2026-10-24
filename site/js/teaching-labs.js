/* Course simulation case renderer: data is local only; no grading or authentication. */
(function() {
 "use strict";
 const model=document.body.dataset.lab;
 const isInventory=model==="inventory";
 const core=isInventory?window.IEInventory:window.IEFlow;
 const specs=isInventory?{
   key:"dailyCost",unit:"元/天",better:"lower",ci:"costDiffCI",diff:"costDifferences",
   label:"平均运营成本",precision:2,
   rows:[["dailyCost","平均运营成本","元/天",2],["fillRate","需求满足率","%",1,100],["stockoutRate","缺货天数占比","%",1,100],["avgOnHand","平均日末库存","件",2],["orderFrequency","日均下单次数","次/天",3],["unitsOrderedPerDay","日均订货量","件/天",2]],
   note:"缺货按 lost sales 处理，订单到期后在日初收货。无需求期间的满足率记为 100%；不包含每件采购成本或收入。若成本区间跨过 0，应报告证据不足。"
 }:{
   key:"throughput",unit:"件/小时",better:"higher",ci:"throughputDiffCI",diff:"throughputDifferences",
   label:"完工吞吐量",precision:2,
   rows:[["throughput","完工吞吐量","件/小时",2],["station1Util","工序一加工利用率","%",1,100],["station2Util","工序二加工利用率","%",1,100],["blockedRatio","工序一被阻塞时间占比","%",1,100],["starvationRatio","工序二闲置时间占比","%",1,100],["meanWip","平均在制品 WIP","件",2],["meanExternalQueue","工序一外等待队列","件",2],["meanBuffer","中间缓冲平均占用","件",2]],
   note:"阻塞时工序一持有已加工工件，阻塞不算加工利用率。工序二闲置率涵盖无任务等待；有限时域的产出不等于稳态。"
 };
 const form=document.getElementById("lab-form");
 const status=document.getElementById("run-status");
 const error=document.getElementById("lab-error");
 const exporter=document.getElementById("export-button");
 let last=null;
 function fmt(x,prec=2) {
   if(!Number.isFinite(x))return"—";
   return Number(x).toFixed(prec);
 }
 function value(row,key,scale=1,prec=2){return fmt(row[key]*scale,prec);}
 function itemMetric(label,num,unit,cls) {
   const el=document.createElement("div");
   el.className="metric"+(cls?" emphasis":"");
   const lab=document.createElement("span");lab.textContent=label;
   const strong=document.createElement("strong");strong.textContent=num;
   const sm=document.createElement("small");sm.textContent=unit;
   el.append(lab,strong,sm);
   return el;
 }
 function show(res) {
   const {baseline:a,alternative:b}=res,ci=res[specs.ci];
   const delta=b[specs.key]-a[specs.key],key=specs.key;
   const head=document.getElementById("headline-metrics");
   head.replaceChildren(itemMetric("方案 A · "+specs.label,fmt(a[key],2),specs.unit,false),
     itemMetric("方案 B · "+specs.label,fmt(b[key],2),specs.unit,true),
     itemMetric("方案差值 B − A",(delta>0?"+":"")+fmt(delta,2),specs.unit,false));
   document.getElementById("chart-title").textContent=specs.label;
   document.getElementById("bar-label-a").textContent=fmt(a[key],2);
   document.getElementById("bar-label-b").textContent=fmt(b[key],2);
   const maximum=Math.max(a[key],b[key],.000001);
   document.getElementById("bar-a").style.width=(100*a[key]/maximum).toFixed(2)+"%";
   document.getElementById("bar-b").style.width=(100*b[key]/maximum).toFixed(2)+"%";
   document.getElementById("ci-name").textContent=specs.label+"差值 B − A 的近似 95% 区间";
   document.getElementById("ci-value").textContent="["+fmt(ci.low)+", "+fmt(ci.high)+"] "+specs.unit;
   const body=document.getElementById("result-rows");
   const frag=document.createDocumentFragment();
   for(const [field,label,unit,precision,scale] of specs.rows) {
     const tr=document.createElement("tr");
     const th=document.createElement("th");th.scope="row";th.textContent=label+(unit?"（"+unit+"）":"");
     const va=document.createElement("td");va.textContent=value(a,field,scale||1,precision);
     const vb=document.createElement("td");vb.textContent=value(b,field,scale||1,precision);
     tr.append(th,va,vb);frag.append(tr);
   }
   body.replaceChildren(frag);
   const better=(specs.better==="lower"?ci.high<0:ci.low>0);
   const worse=(specs.better==="lower"?ci.low>0:ci.high<0);
   const judgment=better?"本组参数的配对区间支持方案 B 改善主指标。":
     worse?"本组参数的配对区间支持方案 B 恶化主指标。":
       "主指标的配对区间包含 0；此处不能断言方案 B 稳定更好。";
   document.getElementById("lab-caveat").textContent=judgment+" "+specs.note+
     " 这是教学数据下的统计判断，未调整多重比较，不构成真实产线优化承诺。";
   status.textContent="完成 "+res.params.replications+" 次独立重复。A/B 同次重复共用输入随机流，导出可逐次核对。";
   exporter.disabled=false;
 }
 function run() {
   error.hidden=true;
   status.textContent="正在生成随机样本并运行仿真…";
   try{
     const params=Object.fromEntries(new FormData(form).entries());
     const res=core.compare(params);
     last=res;show(res);
   }catch(e){
     last=null;exporter.disabled=true;
     error.textContent=e&&e.message?e.message:"仿真失败，请检查参数";
     error.hidden=false;
     status.textContent="输入无效或仿真未完成；请调整后重试。";
   } finally {document.getElementById("run-button").disabled=false;}
 }
 form.addEventListener("submit",function(e){
   e.preventDefault();document.getElementById("run-button").disabled=true;
   window.setTimeout(run,15);
 });
 form.addEventListener("input",()=>{
   if(last){
     last=null;exporter.disabled=true;
     status.textContent="参数已修改；当前展示的是上一次运行结果。请重新运行后再导出。";
   }
 });
 form.addEventListener("reset",function(){last=null;exporter.disabled=true;
   status.textContent="已重置输入；请重新运行并生成新结果。";
   error.hidden=true;
 });
 exporter.addEventListener("click",function(){
   if(!last) return;
   const meta=Object.entries(last.params).map(([k,v])=>["parameter:"+k,v]);
   const lines=[["case_id",isInventory?"IE-MC-02":"IE-DES-03"],...meta,
     ["metric","baseline","alternative","unit"]];
   for(const [field,label,unit,precision,scale] of specs.rows) {
     lines.push([label,last.baseline[field]*(scale||1),last.alternative[field]*(scale||1),unit]);
   }
   const ci=last[specs.ci];
   lines.push(["paired_difference","mean","low_95_normal","high_95_normal"]);
   lines.push([specs.label,ci.mean,ci.low,ci.high]);
   lines.push(["replicate_index","difference_B_minus_A"]);
   for(let i=0;i<last[specs.diff].length;i++) lines.push([i+1,last[specs.diff][i]]);
   function csvCell(c){const s=String(c);return '"'+s.replace(/"/g,'""')+'"';}
   const blob=new Blob(["\ufeff"+lines.map(r=>r.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
   const url=URL.createObjectURL(blob);
   const link=document.createElement("a");
   link.href=url;link.download=(isInventory?"IE-MC-02":"IE-DES-03")+"_paired_experiment.csv";
   document.body.appendChild(link);link.click();link.remove();
   window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 if(!core){status.textContent="模型代码未载入，请刷新页面。";document.getElementById("run-button").disabled=true;return;}
 form.requestSubmit();
})();
