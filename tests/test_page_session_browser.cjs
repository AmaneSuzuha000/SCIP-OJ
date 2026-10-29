// Authenticated navigation uses a local SDK fixture; no production data is written.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const backend=require('./fixtures/interaction_backend.cjs');
const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.stack));
  await page.route('**/config.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SCIP_OJ_CONFIG={SUPABASE_URL:"https://fixture.invalid",SUPABASE_ANON_KEY:"fixture"};'}));
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:'('+backend.toString()+')();'+`
   const create=window.supabase.createClient;
   window.__sessionChecks=0;window.__accessChecks=0;window.__clients=0;
   window.supabase.createClient=(...args)=>{
    window.__clients++;const client=create(...args),rpc=client.rpc;
    client.auth.getSession=async()=>{window.__sessionChecks++;return {data:{session:{user:{id:'teacher'},access_token:'fixture'}}};};
    client.rpc=(name,...args)=>{if(name==='check_site_access'){window.__accessChecks++;return Promise.resolve({data:sessionStorage.getItem('deny-fixture')!=='yes',error:null});}return rpc(name,...args);};
    return client;
   };
  `}));
  let frames=0;
  await page.route('**/notebooks/lab/index.html*',r=>{frames++;return r.fulfill({contentType:'text/html',body:`<!doctype html><title>Local runtime fixture</title><script>
   window.addEventListener('message',event=>{const port=event.ports[0];if(!port)return;port.onmessage=({data})=>port.postMessage({version:1,type:'reply',id:data.id,result:data.method==='run'?{objective:8}:null});port.start();});
  </script>`});});
  await page.goto(origin+'/index.html#P001?mode=practice');
  const settled=()=>page.waitForFunction(()=>!window.ScipOJPageSession.mounting);
  await page.locator('#workspace[aria-busy="false"]').waitFor();
  await page.waitForFunction(()=>ScipOJRuntime.isReady());
  await page.evaluate(()=>{window.__documentMarker={};window.__savedMarker=window.__documentMarker;window.__savedFrame=document.querySelector('#notebook-host iframe').contentWindow;window.__savedClient=ScipOJAccess.getClient();});
  const initial=await page.evaluate(()=>({access:__accessChecks,session:__sessionChecks}));
  for(const path of ['doc.html?f=学生指南.md','inventory-lab.html','flow-lab.html','case-studio.html','official-examples.html','teacher.html?course=fixture-a&tab=assignments','index.html#P001?mode=practice']){
   assert.equal(await page.evaluate(path=>ScipOJJourney.go(path),path),true);await settled();
   assert.equal(await page.locator('#site-access-gate').count(),0,path+' must not display admission again');
   assert.equal(await page.evaluate(()=>__savedMarker===__documentMarker&&__savedClient===ScipOJAccess.getClient()),true);
   assert.equal(await page.evaluate(()=>__savedFrame===document.querySelector('#notebook-host iframe').contentWindow),true,path+' must retain Python');
  }
  assert.equal(frames,1,'Python iframe must be loaded only once across page switches');
  assert.deepEqual(await page.evaluate(()=>({access:__accessChecks,session:__sessionChecks})),initial);
  assert.equal(await page.evaluate(()=>__clients),1,'Keep one auth client and subscription');
  assert.equal((await page.evaluate(()=>ScipOJRuntime.runSolve('def solve(instance): return {}',{},10))).objective,8);
  // Browser history uses the same retained document, including teacher initialization.
  await page.goBack();await page.locator('#form-publish-assignment').waitFor();await settled();
  await page.locator('#assign-pass-score').fill('86');await page.locator('#assign-pass-score').dispatchEvent('input');
  await page.goForward();await page.locator('#workspace[aria-busy="false"]').waitFor();await settled();
  await page.goBack();await page.locator('#form-publish-assignment').waitFor();await settled();
  assert.equal(await page.locator('#assign-pass-score').inputValue(),'86');
  // A failed fetch must leave the old page and its URL intact.
  await page.route('**/doc.html?f=unavailable',r=>r.fulfill({status:503,body:'fixture outage'}));
  const previous=page.url();
  assert.match(await page.evaluate(()=>ScipOJJourney.go('doc.html?f=unavailable').catch(e=>e.message)),/页面加载失败/);
  assert.equal(page.url(),previous);assert.equal(await page.locator('#teacher-panel').isVisible(),true);
  // Revalidation stays in the background, but revocation still removes the session/runtime.
  await page.evaluate(()=>{sessionStorage.setItem('deny-fixture','yes');document.dispatchEvent(new Event('visibilitychange'));});
  await page.locator('#site-access-gate[data-state="denied"]').waitFor();
  assert.equal(await page.locator('#notebook-host iframe').count(),0);
  assert.deepEqual(errors,[]);
  console.log('One admission/client/runtime, cross-page history, drafts, failed navigation and revocation: PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
