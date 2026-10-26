const assert=require('node:assert/strict');
const {webcrypto:crypto}=require('node:crypto');
const {create}=require('../site/js/grading-api.js');
const {create:createKeys}=require('../site/js/request-keys.js');
(async()=>{
 const memory=new Map();
 const storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 let user='student',lost=true;
 const accepted=new Map(),calls=[];
 const context=async()=>({session:{access_token:'test-session'},user:{id:user},cfg:{SUPABASE_URL:'https://example.invalid'}});
 const fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  const result=url.endsWith('regrade-batch')?{ok:true,total:body.submission_ids.length,success_count:body.submission_ids.length,results:body.submission_ids.map(id=>({id,success:true}))}:{ok:true,submission_id:'saved',grading_id:'grade'};
  accepted.set(body.request_key,result);
  if(lost && (!url.endsWith('regrade-batch')||body.submission_ids.includes('050'))){lost=false;throw new TypeError('response lost after acceptance');}
  return {ok:true,status:200,json:async()=>result};
 };
 const client=()=>create({context,keys:createKeys(storage,crypto),fetch,crypto});
 await assert.rejects(client().submitAssignment('assignment','source'),/response lost/);
 await client().submitAssignment('assignment','source');
 assert.equal(calls[0].body.request_key,calls[1].body.request_key);
 assert.equal(accepted.size,1);
 calls.length=0;accepted.clear();lost=true;
 const ids=Array.from({length:51},(_,i)=>String(i).padStart(3,'0'));
 await assert.rejects(client().requestBatchRegrade(ids,'review'),/response lost/);
 await client().requestBatchRegrade([...ids].reverse(),'review');
 assert.equal(accepted.size,2); // two chunks, even after response loss and reload
 assert.equal(calls[0].body.request_key,calls[2].body.request_key);
 assert.equal(calls[1].body.request_key,calls[3].body.request_key);
 assert.ok(calls.every(c=>c.url.endsWith('regrade-batch')));
 user='teacher';await client().requestRegrade('saved','review');
 assert.equal(calls.at(-1).body.submission_id,'saved');
 const rejected=create({context,keys:createKeys(storage,crypto),crypto,fetch:async()=>({ok:false,status:403,json:async()=>({code:'NOT_ENROLLED'})})});
 await assert.rejects(rejected.submitAssignment('assignment','source'),/未选修/);
 console.log('Grading API: lost responses, reload, 51-item batch replay, account context and authorization failures passed');
})().catch(e=>{console.error(e);process.exit(1);});
