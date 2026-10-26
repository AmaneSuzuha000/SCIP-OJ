// Executes real migrations and failure scenarios, not source-string assertions.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const native = Boolean(process.env.TEST_DATABASE_URL);
const db = native ? new pg.Client({connectionString:process.env.TEST_DATABASE_URL}) : new PGlite();
if (native) await db.connect();
const exec = sql => native ? db.query(sql) : db.exec(sql);
const query = (sql,params=[]) => db.query(sql,params);
const scalar = async(sql,params=[]) => Object.values((await query(sql,params)).rows[0])[0];
try {
  await exec(await readFile(new URL('./fixtures/auth.sql',import.meta.url),'utf8'));
  for (const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    await exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  }
  console.log('All application migrations loaded');
  const student=randomUUID(),teacher=randomUUID(),stranger=randomUUID(),course=randomUUID(),assignment=randomUUID();
  await query(`INSERT INTO auth.users(id,email) VALUES($1,'s@test.invalid'),($2,'t@test.invalid'),($3,'x@test.invalid')`,[student,teacher,stranger]);
  await query(`UPDATE public.profiles SET student_no='TEST-STUDENT' WHERE user_id=$1`,[student]);
  await query(`INSERT INTO public.courses(id,name,code) VALUES($1,'Isolated tests','TEST')`,[course]);
  await query(`INSERT INTO public.enrollments(course_id,user_id,role) VALUES($1,$2,'student'),($1,$3,'teacher')`,[course,student,teacher]);
  await query(`INSERT INTO public.assignments(id,course_id,problem_id,n_instances,pass_score) VALUES($1,$2,'P001',2,90)`,[assignment,course]);
  const ref='a'.repeat(40),key=randomUUID(),source='def solve(instance): return {}';
  const enqueue = (actor=student,request=key,sub=null,code=source,revision=ref,connection=db) => connection.query(
    `SELECT public.enqueue_grading($1,$2,$3,$4,$5,$6,'{}','test') AS receipt`,
    [actor,assignment,sub,code,request,revision]).then(r=>r.rows[0].receipt);
  // Outbox write failure must roll back submission AND grading, including quota.
  await exec(`CREATE FUNCTION public.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END; $$;
    CREATE TRIGGER fail_outbox BEFORE INSERT ON public.grading_dispatches FOR EACH ROW EXECUTE FUNCTION public.inject_failure();`);
  await assert.rejects(enqueue(),/injected outbox failure/);
  assert.equal(await scalar('SELECT count(*)::int FROM submissions'),0);
  assert.equal(await scalar('SELECT count(*)::int FROM gradings'),0);
  await exec('DROP TRIGGER fail_outbox ON public.grading_dispatches; DROP FUNCTION public.inject_failure();');
  const accepted=await enqueue();
  assert.equal(accepted.attempt_no,1);
  assert.equal((await enqueue()).submission_id,accepted.submission_id); // no cooldown on replay
  assert.equal((await enqueue(student,key,null,source,null)).submission_id,accepted.submission_id); // replay during GitHub outage
  await query("UPDATE assignments SET integrity_policy='exam_block' WHERE id=$1",[assignment]);
  await assert.rejects(enqueue(student,randomUUID()),/IDENTITY_VERIFICATION_REQUIRED/);
  assert.equal((await enqueue()).submission_id,accepted.submission_id); // original receipt survives changed policy
  await query("UPDATE assignments SET integrity_policy='standard' WHERE id=$1",[assignment]);
  await assert.rejects(enqueue(student,key,null,'different'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(enqueue(student,randomUUID()),/SUBMISSION_RATE_LIMIT_COOLDOWN/);
  await assert.rejects(enqueue(stranger,randomUUID()),/NOT_ENROLLED/);
  const leased=(await query('SELECT * FROM lease_grading_dispatches(25)')).rows;
  assert.equal(leased.length,1);
  assert.equal((await query('SELECT * FROM lease_grading_dispatches(25)')).rows.length,0);
  await query('SELECT finish_grading_dispatch($1,$2,NULL)',[accepted.grading_id,randomUUID()]);
  assert.ok(await scalar('SELECT lease_token IS NOT NULL FROM grading_dispatches'));
  await query('SELECT finish_grading_dispatch($1,$2,NULL)',[accepted.grading_id,leased[0].lease_token]);
  await query('UPDATE assignments SET pass_score=70,n_instances=5 WHERE id=$1',[assignment]);
  const claimed=await scalar(`SELECT claim_grading($1,$2,'run_1_1')`,[accepted.grading_id,accepted.submission_id]);
  assert.equal(claimed.config.pass_score,90);
  assert.equal(claimed.config.n_instances,2);
  assert.equal(claimed.config.grader_ref,ref);
  assert.ok(claimed.instance_seed);
  assert.equal(await scalar(`SELECT claim_grading($1,$2,'run_1_2')`,[accepted.grading_id,accepted.submission_id]),null);
  const complete=(id,runner,score=80,status='done')=>scalar(`SELECT complete_grading($1,$2,$3,$4,$5,true,'{}',NULL)`,[id,accepted.submission_id,runner,status,score]);
  await assert.rejects(complete(accepted.grading_id,'run_2_1'),/RUNNER_MISMATCH/);
  await complete(accepted.grading_id,'run_1_1');
  assert.equal(await scalar('SELECT passed FROM gradings WHERE id=$1',[accepted.grading_id]),false);
  assert.equal((await complete(accepted.grading_id,'run_1_1')).duplicate,true);
  await assert.rejects(complete(accepted.grading_id,'run_1_1',100),/CALLBACK_CONFLICT/);
  const rekey=randomUUID();
  const regrade=await enqueue(teacher,rekey,accepted.submission_id,null);
  assert.equal((await enqueue(teacher,rekey,accepted.submission_id,null)).grading_id,regrade.grading_id);
  assert.equal(await scalar('SELECT old_score FROM grade_audits WHERE grading_id=$1',[regrade.grading_id]),80);
  await scalar(`SELECT claim_grading($1,$2,'run_3_1')`,[regrade.grading_id,accepted.submission_id]);
  await complete(regrade.grading_id,'run_3_1',null,'system_error');
  assert.equal(await scalar('SELECT score FROM gradings WHERE id=$1',[regrade.grading_id]),null);
  assert.equal(await scalar('SELECT best_score FROM course_gradebook WHERE user_id=$1',[student]),80);
  const recovered=await scalar('SELECT recover_grading_jobs()');
  assert.equal(recovered.retried,1);
  assert.equal((await scalar('SELECT recover_grading_jobs()')).retried,0);
  const child=(await query('SELECT * FROM gradings WHERE retry_of=$1',[regrade.grading_id])).rows[0];
  assert.deepEqual(child.config_snapshot,await scalar('SELECT config_snapshot FROM gradings WHERE id=$1',[regrade.grading_id]));
  assert.equal(await scalar('SELECT count(DISTINCT instance_seed)::int FROM grading_dispatches WHERE grading_id=ANY($1::uuid[])',[[regrade.grading_id,child.id]]),1);
  await scalar(`SELECT claim_grading($1,$2,'run_4_1')`,[child.id,accepted.submission_id]);
  await complete(child.id,'run_4_1',60);
  assert.equal(await scalar('SELECT best_score FROM course_gradebook WHERE user_id=$1',[student]),60); // lower regrade replaces old 80
  assert.equal(await scalar('SELECT new_score FROM grade_audits WHERE grading_id=$1',[regrade.grading_id]),60);
  assert.equal(await scalar('SELECT count(*)::int FROM submissions'),1); // retries never charge quota
  // Audit failure rolls back the new regrade and its outbox.
  await exec(`CREATE FUNCTION public.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$;
    CREATE TRIGGER fail_audit BEFORE INSERT ON public.grade_audits FOR EACH ROW EXECUTE FUNCTION public.inject_failure();`);
  const before=await scalar('SELECT count(*)::int FROM gradings');
  await assert.rejects(enqueue(teacher,randomUUID(),accepted.submission_id,null),/injected audit failure/);
  assert.equal(await scalar('SELECT count(*)::int FROM gradings'),before);
  await exec('DROP TRIGGER fail_audit ON public.grade_audits; DROP FUNCTION public.inject_failure();');
  // Browser roles cannot call internal functions, inspect seeds, or bypass enqueue.
  for (const role of ['anon','authenticated']) {
    await exec(`SET ROLE ${role}`);
    await assert.rejects(query('SELECT * FROM grading_dispatches'),/permission denied/);
    await assert.rejects(query('SELECT recover_grading_jobs()'),/permission denied/);
    await assert.rejects(enqueue(),/permission denied/);
    await exec('RESET ROLE');
  }
  await exec('SET ROLE authenticated');
  await assert.rejects(query('INSERT INTO submissions(user_id,assignment_id,code_text,code_hash) VALUES($1,$2,$3,$4)',[student,assignment,source,'hash']),/permission denied/);
  await exec('RESET ROLE');
  // Queued delivery exhaustion and a lost runner are bounded, recoverable,
  // and never turn infrastructure failures into zero-point student results.
  const exhausted=await enqueue(teacher,randomUUID(),accepted.submission_id,null);
  await query("UPDATE grading_dispatches SET attempts=5,next_attempt_at=clock_timestamp()-interval '1 minute' WHERE grading_id=$1",[exhausted.grading_id]);
  assert.equal((await scalar('SELECT recover_grading_jobs()')).retried,1);
  const retry1=(await query('SELECT * FROM gradings WHERE retry_of=$1',[exhausted.grading_id])).rows[0];
  await scalar(`SELECT claim_grading($1,$2,'run_5_1')`,[retry1.id,accepted.submission_id]);
  await query("UPDATE gradings SET started_at=clock_timestamp()-interval '21 minutes' WHERE id=$1",[retry1.id]);
  assert.equal((await scalar('SELECT recover_grading_jobs()')).retried,1);
  const retry2=(await query('SELECT * FROM gradings WHERE retry_of=$1',[retry1.id])).rows[0];
  await scalar(`SELECT claim_grading($1,$2,'run_6_1')`,[retry2.id,accepted.submission_id]);
  await complete(retry2.id,'run_6_1',null,'system_error');
  assert.equal((await scalar('SELECT recover_grading_jobs()')).retried,0);
  assert.equal(await scalar('SELECT best_score FROM course_gradebook WHERE user_id=$1',[student]),60);
  await exec('SET ROLE service_role');
  assert.equal((await enqueue()).submission_id,accepted.submission_id);
  await exec('RESET ROLE');
  // Native PostgreSQL CI uses independent sessions to prove the lock/lease races.
  if (native) {
    const clients=await Promise.all(Array.from({length:8},async()=>{const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();return c;}));
    try {
      const concurrent=await Promise.all(clients.map(c=>enqueue(teacher,randomUUID(),accepted.submission_id,null,ref,c)));
      const k=randomUUID();
      const receipts=await Promise.all(clients.map(c=>enqueue(teacher,k,accepted.submission_id,null,ref,c)));
      assert.equal(new Set(receipts.map(r=>r.grading_id)).size,1);
      const deliveries=(await Promise.all(clients.map(c=>c.query('SELECT * FROM lease_grading_dispatches(25)')))).flatMap(r=>r.rows);
      assert.equal(new Set(deliveries.map(j=>j.grading_id)).size,deliveries.length);
      assert.ok(deliveries.length>=concurrent.length);
      console.log('Independent PostgreSQL sessions: idempotency and lease races passed');
    } finally {await Promise.all(clients.map(c=>c.end()));}
  }
  console.log('Atomic rollback, idempotency, quota, ownership, frozen settings, regrade, recovery and ACL checks passed');
} finally {if(native) await db.end(); else await db.close();}
