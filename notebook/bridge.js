/* Versioned, restricted runtime interface; never expose arbitrary commands. */
(()=>{
 'use strict';let port,context=null;const engine=window.ScipOJRuntime;
 const send=value=>port?.postMessage({version:1,...value});
 window.addEventListener('scip-runtime-reset',event=>send({type:'reset',message:event.message}));
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.origin!==location.origin||event.data?.channel!=='scip-oj-notebook'||event.data.version!==1||!event.ports[0]||port)return;
  port=event.ports[0];port.onmessage=async({data})=>{
   if(data?.version!==1||typeof data.id!=='string')return;
   const {id,method,args=[]}=data;
   const progress=message=>send({type:'progress',id,message});
   try{
    let result=null;
    if(method==='ready')await engine.ensureReady(progress);
    else if(method==='run'){
     if(typeof args[0]!=='string'||args[0].length>200000)throw Error('代码格式或长度无效');
     result=await engine.runSolve(args[0],args[1],args[2],progress);
    }else if(method==='open'){
     if(!/^[A-Z0-9_-]{1,32}$/.test(args[0])||typeof args[1]!=='string')throw Error('作业参数无效');
     context=id;
     await engine.openNotebook(...args,(code,error)=>{if(context===id)send({type:'source',context:id,code,error:error?.message||null});});
    }else if(method==='detach'){context=null;engine.detachNotebook();}
    else throw Error('不支持的运行环境命令');
    send({type:'reply',id,result});
   }catch(error){send({type:'reply',id,error:{message:error.message,code:error.code}});}
  };port.start();
 });
})();
