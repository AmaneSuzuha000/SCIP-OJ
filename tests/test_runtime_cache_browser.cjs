// Use real WASM/package files. Admission is tested separately on gated HTML.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8766';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  // Local audits can reuse a published runtime with the repository's new config.
  if(process.env.SCIP_TEST_CACHE_CONFIG){
   const config=require('../jupyter-lite.json')['jupyter-config-data'];
   await page.route('**/notebooks/jupyter-lite.json',async route=>{
    const response=await route.fetch(),body=await response.json();
    Object.assign(body['jupyter-config-data'],config);
    await route.fulfill({response,json:body});
   });
  }
  await page.goto(origin+'/index.html#course');
  await page.waitForFunction(()=>window.ScipOJRuntime?.isReady(),null,{timeout:245000});
  const frame=page.frames().find(frame=>frame.url().includes('/notebooks/lab/'));
  const cache=await frame.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready;
   const response=await caches.match(new URL('../xeus/xeus-kernel/bin/xpython.wasm',location.href));
   return {worker:registration.active.scriptURL,bytes:response?(await response.arrayBuffer()).byteLength:0};
  });
  assert.match(cache.worker,/enableCache=true/,'Python assets must use the enabled persistent cache');
  assert.ok(cache.bytes>1000000,'The real Python WASM must be saved in browser storage');
  // Bypass the network entirely: a cached WASM response must remain readable.
  await context.setOffline(true);
  const bytes=await frame.evaluate(async()=>{
   const response=await fetch('../xeus/xeus-kernel/bin/xpython.wasm');
   if(!response.ok)throw Error('Cached Python file unavailable offline');
   return (await response.arrayBuffer()).byteLength;
  });
  assert.equal(bytes,cache.bytes);
  const result=await page.evaluate(()=>ScipOJRuntime.runSolve('def solve(instance): return {"objective":17}',{},30));
  assert.equal(result.objective,17);
  const next=await page.evaluate(()=>ScipOJRuntime.runSolve('def solve(instance): return {"objective":18}',{},30));
  assert.equal(next.objective,18,'A new isolated kernel must also start from cached packages offline');
  console.log('Real Python WASM persisted and reused with the network offline: PASS ('+bytes+' bytes)');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
