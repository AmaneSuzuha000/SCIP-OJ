const {chromium}=require('playwright'), assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/config.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.SCIP_OJ_CONFIG={SUPABASE_URL:"https://fixture.invalid",SUPABASE_ANON_KEY:"fixture"};'}));
  await page.route('**/supabase.min.js',route=>route.fulfill({contentType:'text/javascript',body:`
   window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(resolve=>window.__restoreSession=resolve),onAuthStateChange(){} }})};`}));
  await page.route('**/js/python_runtime.js*',route=>route.fulfill({contentType:'text/javascript',body:`
   let phase='idle',finish,preparation;window.__preparations=0;window.__studies=[];
   window.__finishEnvironment=error=>{phase=error?'error':'ready';preparation=null;window.dispatchEvent(new Event('scip-runtime-state'));if(error)window.dispatchEvent(new Event('scip-runtime-reset'));finish(error);};
   window.ScipOJRuntime={ensureReady:async()=>{},getStatus:()=>({phase}),isReady:()=>phase==='ready',hideNotebook(){},detachNotebook(){},
    prewarm(){if(phase==='ready')return Promise.resolve();if(preparation)return preparation;window.__preparations++;phase='preparing';window.dispatchEvent(new Event('scip-runtime-state'));
     return preparation=new Promise((resolve,reject)=>finish=error=>error?reject(Error(error)):resolve());},
    openStudyNotebook:async path=>{window.__studies.push(path);await window.ScipOJRuntime.prewarm();if(window.__studyFailure)throw Error('fixture document failure');},
    runSolve:async()=>({objective:7})};`}));
  await page.goto((process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765')+'/index.html#P001');
  await page.locator('#title').filter({hasText:'P001'}).waitFor({timeout:20000});
  assert.equal(await page.evaluate(()=>__preparations),1,'Preparation starts on entry without clicking a test');
  assert.match(await page.locator('#runtime-label').innerText(),/准备中/);
  assert.equal(await page.locator('#btn-grade').isDisabled(),true);
  assert.equal(await page.locator('#btn-submit-formal').isDisabled(),true,'Session recovery does not block the local problem, but formal submission waits');
  await page.evaluate(()=>__finishEnvironment('fixture preparation failure'));
  await page.locator('#btn-retry-runtime').waitFor({state:'visible'});
  assert.equal(await page.locator('#report').innerText(),'','Environment failures stay outside test results');
  await page.locator('#btn-retry-runtime').click();
  assert.equal(await page.evaluate(()=>__preparations),2);
  await page.evaluate(()=>__finishEnvironment());
  await page.waitForFunction(()=>!document.getElementById('btn-run-testcase').disabled);
  await page.locator('#btn-run-testcase').click();
  await page.waitForFunction(()=>document.getElementById('report').textContent.includes('custom_test'));
  assert.doesNotMatch(await page.locator('#report').innerText(),/下载|内核|准备/);
  await page.evaluate(()=>__restoreSession({data:{session:null}}));
  await page.locator('#btn-signin').waitFor();
  // Retry must restore the selected document as well as its Python environment.
  const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765';
  await page.goto(origin+'/index.html#notebook/03_IE_Facility_Location_PySCIPOpt.ipynb');
  await page.waitForFunction(()=>window.__studies?.length===1);
  await page.evaluate(()=>__finishEnvironment('fixture notebook preparation failure'));
  await page.locator('#notebook-state button').waitFor();
  await page.locator('#btn-retry-runtime').click();
  await page.waitForFunction(()=>__studies.length===2);
  await page.evaluate(()=>__finishEnvironment());
  await page.waitForFunction(()=>document.getElementById('notebook-state').textContent==='');
  assert.equal(await page.locator('#workspace.study-mode .workspace-layout').evaluate(el=>el.classList.contains('notebook-mode')),true);
  assert.equal(await page.locator('.editor-container').isVisible(),false);
  assert.equal(await page.locator('#btn-back-to-list').getAttribute('href'),'#learn-notebooks');
  // A document error can be retried even while Python remains ready.
  await page.evaluate(()=>{window.__studyFailure=true;location.hash='#notebook/04_IE_Bin_Packing_PySCIPOpt.ipynb';});
  await page.locator('#notebook-state button').waitFor();
  assert.equal(await page.locator('#btn-retry-runtime').isVisible(),false);
  await page.evaluate(()=>window.__studyFailure=false);
  await page.locator('#notebook-state button').click();
  await page.waitForFunction(()=>document.getElementById('notebook-state').textContent==='');
  // Leaving during retry must not reopen a workspace or overwrite the new route.
  await page.evaluate(()=>__finishEnvironment('fixture reset'));
  await page.locator('#btn-retry-runtime').click();
  await page.evaluate(()=>location.hash='#learn');
  await page.locator('#workspace').waitFor({state:'hidden'});
  await page.evaluate(()=>__finishEnvironment());
  assert.equal(await page.locator('#workspace').isVisible(),false);
  assert.equal(await page.locator('#notebook-state button').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Entry preflight, document/environment retry, route cancellation and execution-only results: PASS');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
