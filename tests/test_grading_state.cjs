const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {normalizeSubmission}=require('../site/js/grading-state.js');
const {create}=require('../site/js/request-keys.js');

(async()=>{
  const success={id:'a',created_at:'2026-10-20T01:00:00Z',status:'done',score:90,passed:true};
  const failed={id:'b',created_at:'2026-10-21T01:00:00Z',status:'system_error',score:null};
  const pending={id:'c',created_at:'2026-10-22T01:00:00Z',status:'queued',score:null};
  const raw={assignments:{pass_score:90},gradings:[success,pending,failed]};
  const normalized=normalizeSubmission(raw);
  assert.equal(normalized.latestAttempt.id,'c');
  assert.equal(normalized.effectiveGrade.score,90);
  assert.deepEqual(raw.gradings,[success,pending,failed]);
  const lower={id:'d',created_at:'2026-10-23T01:00:00Z',status:'done',score:60,passed:false};
  assert.equal(normalizeSubmission({...raw,gradings:[lower,...raw.gradings]}).effectiveGrade.score,60);
  assert.equal(normalizeSubmission({gradings:[failed,pending]}).effectiveGrade,null);
  assert.equal(normalizeSubmission({gradings:null}).latestAttempt,null);
  assert.equal(normalizeSubmission({assignments:[{pass_score:50}],gradings:[lower]}).effectiveGrade.passed,true);
  assert.equal(normalizeSubmission({gradings:[{...success,score:NaN}]}).effectiveGrade,null);
  const values=new Map();
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  let requests=create(storage,webcrypto);
  const key=await requests.get('student:assignment',{code:'original'});
  // Server accepted but response lost; refresh must replay the same request.
  requests=create(storage,webcrypto);
  assert.equal(await requests.get('student:assignment',{code:'original'}),key);
  const next=await requests.get('student:assignment',{code:'edited'});
  assert.notEqual(next,key);
  requests.acknowledge('student:assignment',key); // stale response
  assert.equal(await requests.get('student:assignment',{code:'edited'}),next);
  requests.acknowledge('student:assignment',next);
  assert.notEqual(await requests.get('student:assignment',{code:'edited'}),next); // intentional new submission
  assert.notEqual(await requests.get('other-user:assignment',{code:'edited'}),next);
  assert.ok(![...values.values()].join('').includes('original'));
  const denied={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
  const temporary=create(denied,webcrypto);
  assert.equal(await temporary.get('scope','x'),await temporary.get('scope','x'));
  console.log('Shared grading state, lower regrades, response loss, refresh and stale-response checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
