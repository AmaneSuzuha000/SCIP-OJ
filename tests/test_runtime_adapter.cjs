const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 let frame, parentPort, sent=[],timeouts=[];
 const window={dispatchEvent(){}};
 class Channel {
  constructor(){
   this.port1={postMessage:message=>sent.push(message),start(){},close(){}};
   parentPort=this.port1;this.port2={};
  }
 }
 const document={currentScript:{src:'https://course.test/js/python_runtime.js'},
  createElement:()=>({style:{},addEventListener(name,fn){this[name]=fn;},contentWindow:{postMessage(){}},remove(){this.removed=true;}}),
  getElementById:()=>({appendChild:value=>{frame=value;queueMicrotask(()=>frame.load());}})};
 vm.runInNewContext(fs.readFileSync('site/js/python_runtime.js','utf8'),{
  window,document,URL,Event,MessageChannel:Channel,
  setTimeout(fn,ms){const timer={fn,ms};timeouts.push(timer);return timer;},clearTimeout(){},
 });
 const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const reply=(request,extra)=>parentPort.onmessage({data:{version:1,id:request.id,...extra}});
 const runtime=window.ScipOJRuntime,progress=[];
 const running=runtime.runSolve('source',{},1,message=>progress.push(message));
 await flush();
 const ready=sent.at(-1);assert.equal(ready.method,'prepare');
 assert.ok(timeouts.at(-1).ms>=240000,'Page preparation covers application and kernel readiness');
 reply(ready,{type:'progress',message:'loading'});reply(ready,{type:'reply',result:null});
 await flush();
 const run=sent.at(-1);assert.equal(run.method,'run');
 assert.equal(timeouts.at(-1).ms,6000,'Execution uses the already prepared kernel');
 reply(run,{type:'progress',message:'executing'});
 reply({id:'stale'},{type:'progress',message:'old task'});
 reply(run,{type:'reply',result:{objective:7}});
 assert.equal((await running).objective,7);
 assert.ok(!progress.includes('loading'));assert.ok(progress.includes('executing'));assert.ok(!progress.includes('old task'));
 assert.equal(sent.at(-1).method,'prepare','Replenish with a fresh kernel after execution');
 const failed=assert.rejects(runtime.runSolve('source',{},1),/内核启动超时/);
 await flush();parentPort.onmessage({data:{version:1,type:'reset',message:'Python 内核启动超时'}});
 await failed;assert.equal(frame.removed,true);assert.equal(runtime.isReady(),false);
 console.log('Portal progress correlation, startup deadline and reset propagation: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
