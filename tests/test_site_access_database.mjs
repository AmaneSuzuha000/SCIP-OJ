import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 await db.exec(await readFile('tests/fixtures/auth.sql','utf8'));
 await db.exec('CREATE SCHEMA graphql_public; GRANT USAGE ON SCHEMA graphql_public TO PUBLIC');
 for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 // Supabase's existing authenticated read grants are not defaults in bare PGlite.
 // This is fixture setup only; the access migration adds no table privileges.
 await db.exec('GRANT SELECT ON public.profiles,public.enrollments TO authenticated');
 // Every admitted GitHub provider ID, plus the three ways admission must fail:
 // an unlisted ID, a listed ID under the wrong provider, and no identity at all.
 const cases=[
  {provider:'github',provider_id:'177200341',allowed:true,label:'AmaneSuzuha000'},
  {provider:'github',provider_id:'30373542',allowed:true,label:'pengguo318'},
  {provider:'github',provider_id:'346142220',allowed:true,label:'lvliyu7'},
  {provider:'github',provider_id:'99999999',allowed:false,label:'unlisted id'},
  {provider:'email',provider_id:'177200341',allowed:false,label:'listed id under another provider'},
  {provider:null,provider_id:null,allowed:false,label:'no identity'},
 ];
 const ids=cases.map(()=>randomUUID());
 for(const [i,id] of ids.entries()) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[id,`access-${i}@test.invalid`,JSON.stringify({user_name:'AmaneSuzuha000',provider_id:'177200341'})]);
 for(const [i,c] of cases.entries()) if(c.provider) await db.query('INSERT INTO auth.identities(user_id,provider,provider_id) VALUES($1,$2,$3)',[ids[i],c.provider,c.provider_id]);
 await db.query("INSERT INTO courses(id,name,code) VALUES($1,'Access fixture','ACCESS')",[randomUUID()]);
 const scalar=async sql=>Object.values((await db.query(sql)).rows[0])[0];
 const asUser=async(id,role='authenticated')=>{
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[id||'',role,JSON.stringify({sub:id,role})]);
  await db.exec('SET ROLE '+role);
 };
 for(const [i,id] of ids.entries()){
  const allowed=cases[i].allowed;
  await asUser(id);
  assert.equal(await scalar('SELECT check_site_access()'),allowed,'Only immutable GitHub provider IDs may enter: '+cases[i].label);
  assert.equal(await scalar('SELECT count(*)::int FROM courses'),allowed?1:0,'Restrictive policy must block even generally visible course data: '+cases[i].label);
  assert.equal(await scalar('SELECT count(*)::int FROM profiles WHERE user_id=auth.uid()'),allowed?1:0,'Own-row policy must not override site denial: '+cases[i].label);
  if(allowed) await db.query('SELECT require_site_access()');
  else await assert.rejects(db.query('SELECT require_site_access()'),/SITE_ACCESS_DENIED/,'require_site_access must reject: '+cases[i].label);
  await assert.rejects(db.query('SELECT check_site_user_access($1)',[ids[0]]),/permission denied/,'Browser cannot choose another user for its permission check');
 }
 await asUser(null,'anon');
 await assert.rejects(db.query('SELECT require_site_access()'),/SITE_ACCESS_DENIED/);
 await asUser(null,'service_role');
 await db.query('SELECT require_site_access()');
 for(const [i,id] of ids.entries()) assert.equal((await db.query('SELECT check_site_user_access($1) AS allowed',[id])).rows[0].allowed,cases[i].allowed,'service role sees the same list: '+cases[i].label);
 await db.exec('RESET ROLE');
 // Bare PGlite owns this schema. Supabase-owned grants may remain in production;
 // the live GraphQL gateway is independently verified to run the admission hook.
 assert.equal(await scalar("SELECT has_schema_privilege('authenticated','graphql_public','USAGE')"),false);
 assert.equal(await scalar("SELECT has_schema_privilege('service_role','graphql_public','USAGE')"),true);
 const policies=await scalar("SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND policyname='site_access_only' AND permissive='RESTRICTIVE'");
 assert.equal(policies,12);
 console.log('Real SQL: all three GitHub IDs allowed; strangers, metadata spoofing, wrong provider and anonymous denied; RLS, RPC ACL and service workers preserved: PASS');
}catch(error){console.error({message:error.message,query:error.query});process.exitCode=1;}
finally{await db.close();}
