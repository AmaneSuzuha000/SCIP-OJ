import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
globalThis.window={};
const {sampleIE,referenceIE,gradeIE,runIE}=await import('../site/src/student/ie-des-practice.js');
const meta={id:'IE-DES-01',grader:'ie_des01',n_instances_l1:3,seed_base:20261028,pass_score:90};
const cases=[];
for(let i=0;i<5;i++) {
 const instance=sampleIE(meta.seed_base+i), good=referenceIE(instance);
 for(const result of [good,{...good,avgWait:good.avgWait+5},{...good,meanWip:-1},
   {...good,throughput:999}, {...good,utilization:1.1}, {...good,avgWait:null},
   {...good,completions:''}, {...good,avgWait:'0x1'}, {}, [], null]) {
  cases.push({instance,result,meta});
 }
}
const python=spawnSync('python3',['-c',`
import sys,json
from judge.common import grade_ie_des01
from judge.ie_des01_reference import reference_simulate,workload
out=[]
for case in json.load(sys.stdin):
    inst=case['instance']
    inst['optimal_value']=reference_simulate(workload(inst,inst['seed']),inst['servers'],inst['warmup'],inst['horizon'])
    out.append(grade_ie_des01(case['result'],inst,case['meta']))
json.dump(out,sys.stdout)
`],{input:JSON.stringify(cases),encoding:'utf8'});
assert.equal(python.status,0,python.stderr);
const trusted=JSON.parse(python.stdout);
cases.forEach((test,i)=>{
 const browser=gradeIE(test.result,test.instance,test.meta);
 for(const key of ['score','passed','breakdown']) assert.deepEqual(browser[key],trusted[i][key],`Case ${i}: ${key}`);
});
const report=await runIE(async instance=>{
 assert.equal(instance.optimal_value,undefined);
 const result=referenceIE(instance);instance.horizon=0;return result;
},meta);
assert.equal(report.score,100);assert.equal(report.instances.length,3);
const invalid=await runIE(async()=>{throw Error('broken code');},meta);
assert.equal(invalid.score,0);assert.match(invalid.instances[0].messages[0],/broken code/);
console.log('IE-DES browser scoring matches Python on 55 independent replay/adversarial cases: PASS');
