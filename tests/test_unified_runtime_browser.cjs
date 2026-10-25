'use strict';
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  page.on('console',m=>{if(m.type()==='error') console.error('runtime console:',m.text());});
  page.on('pageerror',e=>console.error('runtime pageerror:',e.message));
  await page.goto((process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765')+'/index.html#P001');
  await page.locator('#workspace[aria-busy="false"]').waitFor();
  const nb=JSON.parse(fs.readFileSync('content/01_P001_knapsack_PySCIPOpt.ipynb','utf8'));
  const code=nb.cells.filter(c=>c.cell_type==='code').slice(0,2).map(c=>c.source.join('')).join('\n\n');
  const answer=await page.evaluate(async code=>{
    await window.ScipOJRuntime.ensureReady();
    return window.ScipOJRuntime.runSolve(code,{n:4,weights:[2,3,4,5],values:[3,4,5,6],capacity:8},30);
  },code);
  assert.equal(answer.objective,10);
  await page.evaluate(code=>{setCodeValue(code);},code);
  await page.locator('#btn-open-notebook').click();
  await page.locator('#btn-return-code').waitFor({state:'visible',timeout:120000});
  await page.screenshot({path:'ui-artifacts/10-unified-notebook.png',fullPage:true});
  const changed=code+'\n# notebook edit';
  await page.evaluate(async source=>{
    const app=document.querySelector('#notebook-host iframe').contentWindow.jupyterapp;
    const widget=await app.commands.execute('docmanager:open',{path:'SCIP_P001_assignment.ipynb',factory:'Notebook'});
    widget.content.model.cells.get(1).sharedModel.setSource(source);
    widget.content.model.cells.get(2).sharedModel.setSource("# retained experiment notes");
  },changed);
  assert.equal(await page.evaluate(()=>getCodeValue()),changed);
  assert.equal(await page.evaluate(()=>localStorage.getItem('scipoj:draft:P001')),changed);
  await page.locator('#btn-return-code').click();
  assert.equal(await page.locator('.editor-container').isVisible(),true);
  await page.locator('#btn-open-notebook').click();
  await page.locator('#btn-return-code').waitFor({state:'visible',timeout:120000});
  const notes=await page.evaluate(async()=>{
    const app=document.querySelector('#notebook-host iframe').contentWindow.jupyterapp;
    const widget=await app.commands.execute('docmanager:open',{path:'SCIP_P001_assignment.ipynb',factory:'Notebook'});
    return widget.content.model.cells.get(2).sharedModel.getSource();
  });
  assert.equal(notes,'# retained experiment notes');
  assert.equal(await page.evaluate(()=>getCodeValue()),changed);
  await page.locator('#btn-return-code').click();
  await assert.rejects(page.evaluate(()=>window.ScipOJRuntime.runSolve('def solve(instance):\n while True: pass',{},5)),/运行超时/);
  const next=await page.evaluate(()=>window.ScipOJRuntime.runSolve('def solve(instance): return {"objective":7}',{},30));
  assert.equal(next.objective,7);
  assert.equal(await page.evaluate(()=>getCodeValue()),changed);
  console.log('Real browser SCIP solve, notebook/editor draft sync, timeout termination and recovery: PASS');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
