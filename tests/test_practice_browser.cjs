'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  // Explicit deferred runtime fixture: exercise UI lifecycle without downloading WASM.
  await page.route('**/js/python_runtime.js*',route=>route.fulfill({contentType:'text/javascript',body:`
   window.__runs=[];window.__resets=0;
   window.ScipOJRuntime={ensureReady:async()=>{},hideNotebook(){},detachNotebook(){},
    reset(){window.__resets++;window.dispatchEvent(new Event('scip-runtime-reset'));},
    runSolve(code,instance,seconds,progress){progress('正在启动 Python 内核…');
     return new Promise((resolve,reject)=>window.__runs.push({code,instance,progress,resolve,reject}));}
   };`}));
  const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765';
  await page.goto(origin+'/index.html#P001');
  await page.locator('#workspace[aria-busy="false"]').waitFor();
  const clickRun=()=>page.locator('#btn-run-testcase').click();
  await clickRun();
  assert.match(await page.locator('#report').innerText(),/启动 Python/);
  assert.equal(await page.locator('#btn-grade').isDisabled(),true);
  assert.equal(await page.locator('#btn-clear-console').isDisabled(),true);
  await page.locator('#btn-stop-run').click();
  assert.match(await page.locator('#status').innerText(),/已停止/);
  assert.equal(await page.locator('#btn-grade').isEnabled(),true);
  // The result of a stopped task cannot replace the next task's result.
  await page.locator('#tab-testcase').click();await clickRun();
  await page.evaluate(()=>{__runs[1].resolve({objective:8});__runs[0].resolve({objective:999});});
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('完成'));
  assert.equal(JSON.parse(await page.locator('#report').innerText()).result.objective,8);
  // Exceptions must show an error and release the shared run lock.
  await page.locator('#tab-testcase').click();await clickRun();
  await page.evaluate(()=>__runs[2].reject(new Error('invalid student code')));
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('失败'));
  assert.match(await page.locator('#report').innerText(),/invalid student code/);
  assert.equal(await page.locator('#btn-run-testcase').isEnabled(),true);
  // Changing problems terminates the old run and ignores late progress/results.
  await page.locator('#tab-testcase').click();await clickRun();
  await page.locator('#btn-next-problem').click();
  await page.locator('#title').filter({hasText:'P002'}).waitFor({timeout:15000});
  await page.locator('#workspace[aria-busy="false"]').waitFor();
  await page.evaluate(()=>{__runs[3].progress('stale progress');__runs[3].resolve({objective:999});});
  assert.equal(await page.locator('#report').innerText(),'');
  assert.equal(await page.locator('#btn-grade').isEnabled(),true);
  // New IE-DES questions must receive simulation inputs, not a knapsack instance.
  await page.goto(origin+'/index.html#IE-DES-01');
  await page.locator('#workspace[aria-busy="false"]').waitFor();
  const instance=JSON.parse(await page.locator('#testcase-input').inputValue());
  assert.ok(instance.arrivalMean&&instance.servers);assert.equal(instance.weights,undefined);
  assert.equal(instance.optimal_value,undefined);
  const first=await page.evaluate(()=>__runs.length);
  await page.locator('#btn-grade').click();
  for(let i=0;i<3;i++) {
   await page.waitForFunction(index=>__runs.length>index,first+i,{timeout:15000});
   await page.evaluate(index=>{
    const {instance,resolve}=__runs[index];
    resolve(window.IESimLab.simulate(window.IESimLab.workload(instance,instance.seed),instance.servers,instance.warmup,instance.horizon));
   },first+i);
  }
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('100 分'));
  assert.equal(JSON.parse(await page.locator('#report').innerText()).score,100);
  assert.deepEqual(errors,[]);
  console.log('Run-button progress, stop/retry, stale result isolation and IE-DES sample: PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
