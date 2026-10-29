// Actual-page regressions for navigation context and responsive component layout.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const origin=process.env.SCIP_UI_TEST_ORIGIN || 'http://127.0.0.1:8765';
const out=path.resolve(process.env.SCIP_UI_SCREENSHOT_DIR || 'ui-artifacts');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  fs.mkdirSync(out,{recursive:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cases=[
   ['case-studio.html','仿真案例','检修排队'],
   ['inventory-lab.html','仿真案例','库存仿真'],
   ['flow-lab.html','仿真案例','生产线仿真'],
   ['official-examples.html','官方建模示例','官方示例'],
   ['doc.html?f=学生指南.md','学生指南','学生指南'],
   ['doc.html?path=docs/教师指南.md','教师指南','教师指南'],
   ['doc.html?f=拓展学习指南.md&space=learn','拓展学习指南',null],
  ];
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});
   for(const [url,sidebar,secondary] of cases){
    await page.goto(origin+'/'+url,{waitUntil:'domcontentloaded'});
    const selected=page.locator('.studio-rail [aria-current]');
    await selected.first().waitFor({state:'attached'});
    if(width===390 && !(await selected.first().isVisible())) await page.locator('#btn-course-menu').click();
    await selected.first().waitFor({state:'visible'});
    assert.equal(await selected.count(),1,url+' must identify one sidebar destination');
    assert.equal((await selected.innerText()).trim(),sidebar);
    if(secondary) assert.equal((await page.locator('.section-navigation [aria-current="page"]').innerText()).trim(),secondary);
    else assert.equal(await page.locator('.section-navigation').isVisible(),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),url+' overflow');
    if(width===390 && url.includes('space=learn')){
     if(await page.locator('#btn-course-menu').getAttribute('aria-expanded')!=='true') await page.locator('#btn-course-menu').click();
     await page.locator('.studio-rail [aria-current="page"]').waitFor({state:'visible'});
     assert.equal(await page.locator('#btn-course-menu').getAttribute('aria-expanded'),'true');
    }
   }
   await page.goto(origin+'/index.html#submissions');
   await page.locator('#submissions-host #btn-refresh-submissions').waitFor({state:'visible'});
   const rect=await page.locator('#btn-refresh-submissions').boundingBox();
   assert.ok(rect.height>= (width===390?44:32) && rect.height<=48,'Refresh button must not stretch with its heading');
   await page.screenshot({path:path.join(out,'submissions-'+width+'.png'),fullPage:true});
   await page.goto(origin+'/index.html#course');
   await page.locator('#problem-list .problem-card').first().waitFor({state:'attached'});
   const rail=await page.locator('.studio-rail').boundingBox();
   const header=await page.locator('.shared-topbar').boundingBox();
   if(width===390) assert.ok(rail.y>=header.y+header.height,'Mobile navigation cannot sit behind the fixed header');
   await page.locator('[data-route="course-labs"]').click();
   await page.reload();
   assert.equal((await page.locator('.studio-rail [aria-current="page"]').innerText()).trim(),'课程实验');
   await page.goto(origin+'/index.html#notebook/03_IE_Facility_Location_PySCIPOpt.ipynb');
   await page.locator('#workspace.study-mode').waitFor();
   await page.evaluate(()=>location.hash='#P001');
   await page.locator('#workspace[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('.editor-container').isVisible(),true);
   await page.goBack();await page.locator('#workspace.study-mode').waitFor();
   assert.equal(await page.locator('#btn-back-to-list').getAttribute('href'),'#learn-notebooks');
   await page.goForward();await page.locator('#workspace[aria-busy="false"]').waitFor();
   await page.locator('.editor-container').waitFor({state:'visible'});
   assert.equal(await page.locator('.editor-container').isVisible(),true);
  }
  assert.deepEqual(errors,[]);
  console.log('Navigation current states, document parameters, mobile menu, history, header placement and fixed-height actions: PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
