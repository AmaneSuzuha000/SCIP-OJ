const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765';
const out=path.resolve(process.env.SCIP_UI_SCREENSHOT_DIR||'ui-artifacts');fs.mkdirSync(out,{recursive:true});
async function fixture(browser,initial,mode='normal'){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/config.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.SCIP_OJ_CONFIG={SUPABASE_URL:"https://fixture.invalid",SUPABASE_ANON_KEY:"fixture"};'}));
 await context.route('**/supabase.min.js',route=>route.fulfill({contentType:'text/javascript',body:`
  const saved=localStorage.getItem('access-fixture-session');let who=saved===null?${JSON.stringify(initial)}:JSON.parse(saved);const listeners=[];
  const user=()=>who?{id:who,user_metadata:{user_name:'AmaneSuzuha000',provider_id:'177200341'}}:null;
  const session=()=>who?{user:user(),access_token:'fixture'}:null;
  window.__fixtureSwitch=value=>{who=value;localStorage.setItem('access-fixture-session',JSON.stringify(value));listeners.forEach(fn=>fn(value?'SIGNED_IN':'SIGNED_OUT',session()));};
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:session()}}),onAuthStateChange:fn=>listeners.push(fn),signInWithOAuth:async options=>{window.__oauthOptions=options;return {data:{},error:null};},signOut:async()=>{window.__fixtureSwitch(null);return {error:null};}},
   rpc:async name=>name==='check_site_access'?(${JSON.stringify(mode)}==='offline'?{error:{code:'NETWORK',message:'fixture offline'}}:{data:who==='owner'||who==='peng'}):{data:[]},
   from(table){const data=table==='profiles'?{user_id:who,role:'admin',display_name:'Fixture account'}:[];const query={};for(const key of ['select','eq','order','in','limit','range','not'])query[key]=()=>query;query.maybeSingle=query.single=async()=>({data,error:null});query.then=(a,b)=>Promise.resolve({data,error:null}).then(a,b);return query;}
  })};`}));
 return context;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const who of [null,'stranger']){
   const context=await fixture(browser,who);const page=await context.newPage();
   for(const url of ['index.html#P001','teacher.html','case-studio.html','inventory-lab.html','flow-lab.html','official-examples.html','doc.html?f=学生指南.md']){
    await page.goto(origin+'/'+url);await page.locator('#site-access-gate[data-state="'+(who?'denied':'login')+'"]').waitFor();
    assert.equal(await page.locator('.studio-rail').count(),0,'Protected DOM must remain inert');
    assert.equal(await page.locator('iframe').count(),0,'No kernel may launch before admission');
    assert.equal(await page.evaluate(()=>Boolean(window.ScipOJPlatform)),false,'Business scripts must not boot before admission');
   }
   await page.screenshot({path:path.join(out,who?'access-denied.png':'access-login.png')});
   if(!who){await page.locator('#site-access-signin').click();assert.equal((await page.evaluate(()=>__oauthOptions)).provider,'github');}
   await context.close();
  }
  for(const who of ['owner','peng']){
   const context=await fixture(browser,who);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/index.html#P001');await page.locator('#workspace[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('#site-access-gate').count(),0);
   assert.equal(await page.locator('.editor-container').isVisible(),true);
   await page.goto(origin+'/case-studio.html');await page.waitForFunction(()=>document.getElementById('run-status').textContent.includes('完成'));
   await page.goto(origin+'/doc.html?f=学生指南.md');await page.locator('#md h1').waitFor();
   assert.equal((await page.locator('.studio-rail [aria-current]').innerText()).trim(),'学生指南');
   await page.goto(origin+'/teacher.html');await page.locator('#teacher-panel').waitFor();
   await page.evaluate(()=>window.__fixtureSwitch('stranger'));
   await page.locator('#site-access-gate[data-state="denied"]').waitFor();
   assert.equal(await page.locator('#teacher-panel').count(),0,'Account changes discard all previous content');
   await page.locator('#site-access-signout').click();await page.locator('#site-access-gate[data-state="login"]').waitFor();
   assert.deepEqual(errors,[]);await context.close();
  }
  const context=await fixture(browser,'owner','offline');const page=await context.newPage();await page.goto(origin+'/index.html');await page.locator('#site-access-gate[data-state="error"]').waitFor();assert.equal(await page.locator('.studio-rail').count(),0);await context.close();
  console.log('All seven pages deny anonymous/strangers; both admitted users boot normally; logout, account switch, metadata spoof and outage stay closed: PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
