/* Portal adapter: no Jupyter objects, models or services cross this boundary. */
(()=>{
 'use strict';
 const url=new URL('../notebooks/lab/index.html',document.currentScript.src);
 url.searchParams.set('scip-runtime','progress2');
 let frame,port,connection,ready=false,busy=false,sequence=0,active=null,source=null,invalid=null;
 const pending=new Map();
 let rejectConnection,connectionTimer;
 function cancelled(){const e=Error('Notebook 打开已取消');e.code='NOTEBOOK_CANCELLED';return e;}
 function detachNotebook(){active=null;source=null;invalid=null;if(port)rpc('detach',[],5000).promise.catch(()=>{});}
 function reset(reason=Error('运行环境已重置')){
  active=null;source=null;invalid=null;ready=false;
  clearTimeout(connectionTimer);rejectConnection?.(reason);rejectConnection=null;
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(reason);}
  pending.clear();port?.close();port=null;frame?.remove();frame=null;connection=null;
  window.dispatchEvent(new Event('scip-runtime-reset'));
 }
 function rpc(method,args=[],timeout=120000,progress){
  const id=String(++sequence);
  const promise=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);const e=Error(method==='run'?'运行超时，环境已重置；作业代码已保留。':'建模环境加载超时，请检查网络后重试。');reset(e);reject(e);},timeout);
   pending.set(id,{resolve,reject,timer,progress});port.postMessage({version:1,id,method,args});
  });return {id,promise};
 }
 function connect(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
   const owned=document.createElement('iframe');frame=owned;
   owned.title='课程建模实验';owned.style.cssText='width:100%;height:650px;border:0';owned.hidden=true;
   rejectConnection=reject;
   connectionTimer=setTimeout(()=>{if(frame===owned)reset();reject(Error('建模环境加载超时'));},120000);
   owned.addEventListener('load',()=>{
    if(frame!==owned)return;clearTimeout(connectionTimer);rejectConnection=null;
    const channel=new MessageChannel();port=channel.port1;
    port.onmessage=({data})=>{
     if(frame!==owned||data?.version!==1)return;
     if(data.type==='reset'){reset(Error(data.message||'运行超时，环境已重置；作业代码已保留。'));return;}
     if(data.type==='progress'){if(typeof data.message==='string')pending.get(data.id)?.progress?.(data.message);return;}
     if(data.type==='source'){
      if(!active||data.context!==active.id)return;
      invalid=data.error?Error(data.error):null;
      if(!invalid&&typeof data.code==='string')source=data.code;
      active.changed(source,invalid);return;
     }
     if(data.type!=='reply')return;
     const item=pending.get(data.id);if(!item)return;
     pending.delete(data.id);clearTimeout(item.timer);
     if(data.error){const e=Error(data.error.message);e.code=data.error.code;item.reject(e);}else item.resolve(data.result);
    };port.start();
    owned.contentWindow.postMessage({channel:'scip-oj-notebook',version:1},url.origin,[channel.port2]);resolve();
   },{once:true});
   owned.src=url.href;document.getElementById('notebook-host').appendChild(owned);
  });return connection;
 }
 async function ensureReady(progress){
  if(ready){progress?.('建模环境已就绪');return;}
  progress?.('正在加载建模环境，首次使用需要下载…');await connect();await rpc('ready',[],120000,progress).promise;
  ready=true;progress?.('建模环境已就绪');
 }
 async function runSolve(code,instance,seconds=15,progress){
  if(busy)throw Error('请等待当前运行结束');busy=true;
  try{await ensureReady(progress);return await rpc('run',[code,instance,seconds],(120+Math.min(Math.max(Number(seconds)||15,.01),60)+5)*1000,progress).promise;}
  finally{busy=false;}
 }
 async function openNotebook(id,code,instance,onChange){
  detachNotebook();const marker={id:null,changed:onChange};active=marker;
  await ensureReady();if(active!==marker)throw cancelled();
  const request=rpc('open',[id,code,instance]);marker.id=request.id;
  await request.promise;if(active!==marker)throw cancelled();frame.hidden=false;
 }
 function readCode(){if(invalid)throw invalid;if(source===null)throw Error('请保留唯一的作业代码单元（submission）');return source;}
 function hideNotebook(){if(frame)frame.hidden=true;}
 window.ScipOJRuntime={ensureReady,runSolve,openNotebook,readCode,detachNotebook,hideNotebook,reset,isReady:()=>ready};
})();
