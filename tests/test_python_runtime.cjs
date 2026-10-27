'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('notebook/engine.js','utf8');
(async()=>{
 let frames=[], shutdown=0, pending=false;
 const reply={content:{status:'ok',user_expressions:{result:{status:'ok',data:{'text/plain':"'eyJvYmplY3RpdmUiOjd9'"}}}}};
 const kernel={requestExecute:()=>({done:pending?new Promise(()=>{}):Promise.resolve(reply)}),shutdown:async()=>{shutdown++}};
 const app={started:Promise.resolve(),serviceManager:{ready:Promise.resolve(),kernelspecs:{refreshSpecs:async()=>{},specs:{default:'xpython',kernelspecs:{xpython:{}}}},kernels:{startNew:async()=>kernel}}};
 const window={dispatchEvent:()=>{},jupyterapp:app};
 const document={currentScript:{src:'https://example.test/SCIP-OJ/js/python_runtime.js'},getElementById:()=>({appendChild:f=>frames.push(f)}),createElement:()=>({style:{},contentWindow:{jupyterapp:app,dispatchEvent:()=>{}},remove(){this.removed=true;}})};
 vm.runInNewContext(source,{window,document,URL,Event,TextEncoder,TextDecoder,Uint8Array,btoa,atob,setTimeout,clearTimeout});
 const runtime=window.ScipOJRuntime;
 assert.equal((await runtime.runSolve('code',{},1)).objective,7);

 assert.equal(shutdown,1);
 pending=true;
 await assert.rejects(runtime.runSolve('loop',{},.01),/运行超时/);

 pending=false;
 assert.equal((await runtime.runSolve('code',{},1)).objective,7);

 // An error from a discarded initialization must not reset its successor.
 runtime.reset();
 let rejectStale, markWaiting, calls=0;
 const initializing=new Promise(resolve=>{markWaiting=resolve;});
 app.serviceManager.kernelspecs.refreshSpecs=async()=>{
   if(++calls===1) {markWaiting();await new Promise((_,reject)=>{rejectStale=reject;});}
 };
 const staleReady=assert.rejects(runtime.ensureReady(),/stale initialization/);
 await initializing;
 runtime.reset();await runtime.ensureReady();

 rejectStale(new Error('stale initialization'));await staleReady;

 assert.equal(runtime.isReady(),true);
 app.serviceManager.kernelspecs.refreshSpecs=async()=>{};
 // Delay an old notebook read while the user starts another assignment.
 const files=new Map(), events=[];
 let release, entered;
 const waiting=new Promise(resolve=>{entered=resolve;});
 app.shell={};
 app.serviceManager.contents={
   get:async path=>{
     if(path.includes('P001')) {entered();await new Promise(resolve=>{release=resolve;});}
     const error=new Error('missing');error.response={status:404};throw error;
   },
   save:async(path,value)=>files.set(path,value.content),
 };
 app.commands={execute:async(_,args)=>({context:{ready:Promise.resolve(),save:async()=>{}},
   dispose(){this.isDisposed=true;},content:{model:{toJSON:()=>files.get(args.path),
     contentChanged:{connect(){},disconnect(){}}}}})};
 const old=runtime.openNotebook('P001','old source',{},()=>events.push('old'));
 const cancelled=assert.rejects(old,/已取消/);
 await waiting;
 const nextOpen=runtime.openNotebook('P002','new source',{},()=>events.push('new'));
 release();await cancelled;await nextOpen;
 assert.deepEqual(events,['new']);
 assert.equal(runtime.readCode(),'new source');
 assert.equal(files.has('SCIP_P001_assignment.ipynb'),false);
 runtime.detachNotebook();
 assert.throws(()=>runtime.readCode(),/唯一/);
 console.log('Notebook stale-open cancellation and serialized file access: PASS');
 console.log('Unified runtime contract, disposal and recovery: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
