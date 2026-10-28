const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const parent={},events={},messages=[],listeners=[];let ready=0;
 const window={parent,addEventListener:(name,fn)=>events[name]=fn,ScipOJRuntime:{
  ensureReady:async progress=>{ready++;progress('loading');},
  runSolve:async(code,instance,seconds,progress)=>{progress('executing');return {objective:7};},
  openNotebook:async(id,code,instance,changed)=>{listeners.push(changed);changed(code,null);},detachNotebook:()=>{},
 }};
 vm.runInNewContext(fs.readFileSync('notebook/bridge.js','utf8'),{window,location:{origin:'https://course.test'}});
 const port={postMessage:value=>messages.push(value),start(){}};
 const handshake={source:parent,origin:'https://course.test',data:{channel:'scip-oj-notebook',version:1},ports:[port]};
 events.message({...handshake,origin:'https://other.test'});assert.equal(port.onmessage,undefined);
 events.message({...handshake,source:{}});assert.equal(port.onmessage,undefined);
 events.message(handshake);
 const call=(id,method,args=[])=>port.onmessage({data:{version:1,id,method,args}});
 await call('1','ready');assert.equal(ready,1);
 assert.ok(messages.some(message=>message.type==='progress'&&message.id==='1'&&message.message==='loading'));
 await call('2','run',['source',{},1]);assert.equal(messages.at(-1).result.objective,7);
 assert.ok(messages.some(message=>message.type==='progress'&&message.id==='2'&&message.message==='executing'));
 await call('3','open',['P001','code',{}]);assert.equal(messages.at(-2).context,'3');
 await call('4','detach');const before=messages.length;listeners[0]('stale',null);assert.equal(messages.length,before);
 await call('5','application:arbitrary-command');assert.ok(messages.at(-1).error);
 await call('6','open',['../bad','source',{}]);assert.ok(messages.at(-1).error);
 console.log('Notebook bridge origin, source, command allowlist and stale event tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
