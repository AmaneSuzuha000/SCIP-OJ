module.exports=()=>{
 const courses=[{id:'fixture-a',name:'审计班级 A',code:'AUDIT-A'},{id:'fixture-b',name:'审计班级 B',code:'AUDIT-B'}];
 const enrollments=courses.map((c,i)=>({id:'e'+i,user_id:'teacher',course_id:c.id,role:'teacher',courses:c}));
 const assignments=courses.map((c,i)=>({id:'a'+i,course_id:c.id,problem_id:'P001',pass_score:i?97:61,n_instances:3,score_policy:'highest',integrity_policy:'standard',created_at:`2026-10-${i?25:20}T00:00:00Z`}));
 const submissions=courses.map((c,i)=>({id:'sub-'+i,user_id:'teacher',assignment_id:'a'+i,attempt_no:1,created_at:'2026-10-26T00:00:00Z',public_code:'LOCAL-'+i,metadata:{},assignments:{course_id:c.id,problem_id:'P001',pass_score:i?97:61,courses:c},gradings:[{id:'grade-'+i,status:'done',score:100,passed:true,created_at:'2026-10-26T00:00:01Z',report_json:{fixture:true}}]}));
 window.__auditCalls=[];
 function query(table){
  let data=table==='profiles'?[{user_id:'teacher',role:'teacher',display_name:'本地交互审计教师'}]:table==='enrollments'?enrollments.slice():table==='assignments'?assignments.slice():table==='submissions'?submissions.slice():[];
  const q={};
  q.select=()=>q;q.eq=(k,v)=>{data=data.filter(x=>k.split('.').reduce((value,key)=>value?.[key],x)===v);return q};q.in=(k,vs)=>{data=data.filter(x=>vs.includes(x[k]));return q};q.order=(k,o)=>{data.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o?.ascending===false?-1:1));return q};q.limit=n=>{data=data.slice(0,n);return q};q.range=(a,b)=>{data=data.slice(a,b+1);return q};q.not=()=>q;
  const finish=single=>{window.__auditCalls.push({table,ids:data.map(x=>x.id)});const result={data:single?(data[0]||null):data,error:null};const delay=window.__auditLag?.[table+':'+(data[0]?.course_id||'')]||0;return delay?new Promise(resolve=>setTimeout(()=>resolve(result),delay)):Promise.resolve(result)};
  q.maybeSingle=q.single=()=>finish(true);q.then=(a,b)=>finish(false).then(a,b);return q;
 }
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'teacher'},access_token:'fixture'}}}),onAuthStateChange:()=>{}},from:query,
  rpc(name,args){let data=name==='get_course_invite_code'?'LOCAL-FIXTURE':[];if(name==='get_teacher_gradebook')data=[{course_id:args.p_course_id,assignment_id:args.p_course_id==='fixture-a'?'a0':'a1',user_id:'teacher',best_submission_id:args.p_course_id==='fixture-a'?'sub-0':'sub-1',enroll_role:'student',student_no:'FIXTURE',display_name:'本地夹具学生',problem_id:'P001',best_score:100,passed:true,pass_score:90,submission_count:1}];
  const q={order:()=>q,range:()=>q,then:(a,b)=>Promise.resolve({data,error:null}).then(a,b)};return q;}
 })};
};
