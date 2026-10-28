// Browser component integration with an explicit fixture backend. No real grades.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/config.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SCIP_OJ_CONFIG={SUPABASE_URL:"https://fixture.invalid",SUPABASE_ANON_KEY:"fixture"};'}));
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:`
   const profile={user_id:'teacher',role:'teacher',display_name:'Test teacher · 系统建模与仿真课程的长姓名教师测试'};
   const course={id:'course',name:'Fixture course',code:'TEST'};
   const enrollments=[{id:'enroll',course_id:'course',role:'teacher',courses:course}];
   const assignment={id:'assignment',course_id:'course',problem_id:'P001',pass_score:90,n_instances:3,score_policy:'highest',integrity_policy:'standard'};
   const rows=[{course_id:'course',assignment_id:'assignment',user_id:'student',enroll_role:'student',student_no:'TEST001',display_name:'Fixture student',problem_id:'P001',best_score:100,passed:true,pass_score:90,submission_count:1}];
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'teacher'},access_token:'fixture'}}}),onAuthStateChange:()=>{}},
    from(table){const data=table==='profiles'?profile:table==='enrollments'?enrollments:table==='assignments'?[assignment]:[];
     const q={};for(const m of ['select','eq','order','in','limit','not','range'])q[m]=()=>q;
     q.maybeSingle=q.single=async()=>({data:Array.isArray(data)?data[0]||null:data,error:null});
     q.then=(a,b)=>Promise.resolve({data,error:null}).then(a,b);return q;},
    rpc(name){const data=name==='get_teacher_gradebook'?rows:name==='get_course_invite_code'?'FIXTURE':[];
     const q={};q.order=q.range=()=>q;q.then=(a,b)=>Promise.resolve({data,error:null}).then(a,b);return q;}
   })};` }));
  await page.goto((process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765')+'/teacher.html');
  await page.locator('#teacher-panel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('metric-students').textContent==='1');
  assert.match(await page.locator('#roster-area').innerText(),/Fixture student/);
  await page.locator('#filter-keyword').fill('missing');
  await page.locator('#filter-keyword').dispatchEvent('input');
  assert.doesNotMatch(await page.locator('#roster-area').innerText(),/Fixture student/);
  await page.locator('.teacher-tabs [data-tab="assignments"]').click();
  await page.waitForFunction(()=>document.getElementById('course-assignments-area')?.textContent.includes('P001'));
  await page.locator('.teacher-tabs [data-tab="roster"]').click();
  await page.locator('#tab-roster').waitFor({state:'visible'});
  // F01: the account toolbar used to overlap the brand despite no page overflow.
  for(const width of [320,390,768,840,841,1024,1440]){
   await page.setViewportSize({width,height:1000});
   const bounds=await page.evaluate(()=>{
    const brand=document.querySelector('.brand-logo').getBoundingClientRect();
    const account=document.querySelector('#auth-area').getBoundingClientRect();
    return {right:brand.right,left:account.left,scroll:document.documentElement.scrollWidth,width:innerWidth};
   });
   assert.ok(bounds.right<=bounds.left,width+' account must not overlap the brand');
   assert.ok(bounds.scroll<=bounds.width+2,width+' teacher page must fit');
  }
  await page.setViewportSize({width:390,height:844});
  const toggle=page.locator('#account-menu-toggle');
  await toggle.focus();await page.keyboard.press('Enter');
  await page.locator('#account-panel').waitFor({state:'visible'});
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.account-menu').getAttribute('open'),null);
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
  await toggle.click();await page.locator('#btn-edit-profile').click();
  await page.locator('.modal-overlay:not([hidden])').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  await page.locator('.modal-overlay:not([hidden])').waitFor({state:'hidden'});
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true,'Closing a dialog returns focus to the account summary');
  assert.deepEqual(errors,[]);
  console.log('Teacher components, responsive account layout, keyboard dismissal and dialog focus restoration: PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
