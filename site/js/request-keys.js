/* Retry identity survives response loss and refresh without storing source. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ScipOJRequestKeys=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function create(storage,cryptoApi){
    const memory=new Map();
    const read=key=>{try{return JSON.parse(storage.getItem(key)||'null')||memory.get(key);}catch{return memory.get(key);}};
    return {
      async get(scope,payload){
        const digest=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
        const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
        const name='scip-oj-request:'+scope;
        const previous=read(name);
        if(previous?.hash===hash&&typeof previous.key==='string') return previous.key;
        const record={hash,key:cryptoApi.randomUUID()};
        memory.set(name,record);
        try{storage.setItem(name,JSON.stringify(record));}catch{/* Session memory remains usable. */}
        return record.key;
      },
      acknowledge(scope,key){
        const name='scip-oj-request:'+scope;
        if(read(name)?.key!==key) return; // An old response must not erase newer work.
        memory.delete(name);
        try{storage.removeItem(name);}catch{/* Storage may be disabled. */}
      },
    };
  }
  return {create};
});
