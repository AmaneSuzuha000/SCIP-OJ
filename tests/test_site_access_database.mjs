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
 const ids=Array.from({length:4},()=>randomUUID());
 for(const [i,id] of ids.entries()) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[id,`access-${i}@test.invalid`,JSON.stringify({user_name:'AmaneSuzuha000',provider_id:'177200341'})]);
 for(const [i,provider,provider_id] of [[0,'github','177200341'],[1,'github','30373542'],[2,'github','99999999'],[3,'email','177200341']]) await db.query('INSERT INTO auth.identities(user_id,provider,provider_id) VALUES($1,$2,$3)',[ids[i],provider,provider_id]);
 await db.query("INSERT INTO courses(id,name,code) VALUES($1,'Access fixture','ACCESS')",[randomUUID()]);
 const scalar=async sql=>Object.values((await db.query(sql)).rows[0])[0];
 const asUser=async(id,role='authenticated')=>{
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[id||'',role,JSON.stringify({sub:id,role})]);
  await db.exec('SET ROLE '+role);
 };
 for(const [i,id] of ids.entries()){
  await asUser(id);
  assert.equal(await scalar('SELECT check_site_access()'),i<2,'Only immutable GitHub provider IDs may enter');
  assert.equal(await scalar('SELECT count(*)::int FROM courses'),i<2?1:0,'Restrictive policy must block even generally visible course data');
  assert.equal(await scalar('SELECT count(*)::int FROM profiles WHERE user_id=auth.uid()'),i<2?1:0,'Own-row policy must not override site denial');
  if(i<2) await db.query('SELECT require_site_access()');
  else await assert.rejects(db.query('SELECT require_site_access()'),/SITE_ACCESS_DENIED/);
  await assert.rejects(db.query('SELECT check_site_user_access($1)',[ids[0]]),/permission denied/,'Browser cannot choose another user for its permission check');
 }
 await asUser(null,'anon');
 await assert.rejects(db.query('SELECT require_site_access()'),/SITE_ACCESS_DENIED/);
 await asUser(null,'service_role');
 await db.query('SELECT require_site_access()');
 for(const [i,id] of ids.entries()) assert.equal((await db.query('SELECT check_site_user_access($1) AS allowed',[id])).rows[0].allowed,i<2);
 await db.exec('RESET ROLE');
 // Bare PGlite owns this schema. Supabase-owned grants may remain in production;
 // the live GraphQL gateway is independently verified to run the admission hook.
 assert.equal(await scalar("SELECT has_schema_privilege('authenticated','graphql_public','USAGE')"),false);
 assert.equal(await scalar("SELECT has_schema_privilege('service_role','graphql_public','USAGE')"),true);
 const policies=await scalar("SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND policyname='site_access_only' AND permissive='RESTRICTIVE'");
 assert.equal(policies,12);
 console.log('Real SQL: both GitHub IDs allowed; strangers, metadata spoofing, wrong provider and anonymous denied; RLS, RPC ACL and service workers preserved: PASS');
}catch(error){console.error({message:error.message,query:error.query});process.exitCode=1;}
finally{await db.close();}
