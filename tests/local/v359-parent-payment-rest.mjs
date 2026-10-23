// Opt-in integration test. Run only after `supabase db reset --local --no-seed`.
// Uses locally issued GoTrue tokens and localhost PostgREST; never reads cloud keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: root, encoding: 'utf8' }));
assert.equal(status.API_URL, 'http://127.0.0.1:54321');
assert.match(status.DB_URL, /^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:54322\/postgres$/);
assert.equal(process.env.V359_LOCAL_RLS_TEST, '1', 'Explicit localhost test opt-in required');
const migration = readFileSync(new URL('../../supabase/migrations/20261023163138_v359_parent_payment_link_rls.sql', import.meta.url), 'utf8');
const container = 'supabase_db_tutor_v4_isolated';
function sql(query) {
  return execFileSync('docker', ['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At', '-c', query], { encoding: 'utf8' }).trim();
}
const preapplied = process.env.V359_RLS_PREAPPLIED === '1';
assert.equal(sql("select count(*) from pg_policies where schemaname='public' and tablename='payment_batches' and policyname='batch_read_by_teacher_or_parent' and qual like '%student_guardians%'"), preapplied ? '1' : '0', 'Policy must match the selected test phase');
const actors = {};
for (const label of ['teacherA', 'teacherB', 'parentA', 'parentB', 'studentA', 'studentB', 'studentC']) {
  const email = `qa-${label.toLowerCase()}-${randomUUID()}@local.invalid`;
  const password = randomBytes(24).toString('base64url') + 'aA1';
  const res = await fetch(status.API_URL + '/auth/v1/signup', {
    method: 'POST', headers: { apikey: status.ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json();
  assert.equal(res.status, 200, `${label} local signup: ${body.message ?? res.status}`);
  assert.ok(body.access_token, `${label} must have an actual GoTrue access token`);
  actors[label] = { id: body.user.id, email, jwt: body.access_token };
}
const ids = Object.fromEntries(['studentA','studentB','studentC','inviteA','inviteB','inviteC','lessonA','lessonB','lessonC','batchA','batchB','batchC','requestA','requestB'].map(key => [key, randomUUID()]));
const a = actors, f = ids;
sql(`begin;
insert into public.workspaces(owner_id) values ('${a.teacherA.id}'),('${a.teacherB.id}');
insert into public.students(id,teacher_id,name) values
 ('${f.studentA}','${a.teacherA.id}','Local A'),('${f.studentB}','${a.teacherB.id}','Local B'),('${f.studentC}','${a.teacherA.id}','Local C');
insert into public.guardian_invites(id,teacher_id,student_id,email) values
 ('${f.inviteA}','${a.teacherA.id}','${f.studentA}','${a.parentA.email}'),
 ('${f.inviteB}','${a.teacherB.id}','${f.studentB}','${a.parentA.email}'),
 ('${f.inviteC}','${a.teacherA.id}','${f.studentC}','${a.parentB.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id) values
 ('${a.teacherA.id}','${f.studentA}','${a.parentA.id}','${f.inviteA}'),
 ('${a.teacherB.id}','${f.studentB}','${a.parentA.id}','${f.inviteB}'),
 ('${a.teacherA.id}','${f.studentC}','${a.parentB.id}','${f.inviteC}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status,received_date) values
 ('${f.lessonA}','${a.teacherA.id}','${f.studentA}','2026-09-01','lesson',2,500,1000,'老師已收到','2026-09-03'),
 ('${f.lessonB}','${a.teacherB.id}','${f.studentB}','2026-09-01','lesson',2,500,1000,'老師已收到','2026-09-03'),
 ('${f.lessonC}','${a.teacherA.id}','${f.studentC}','2026-09-02','lesson',2,500,1000,'老師已收到','2026-09-03');
insert into public.payment_batches(id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at) values
 ('${f.batchA}','${a.teacherA.id}','${f.studentA}','${a.parentA.id}','2026-09-01','2026-09-01','2026-09-03',1000,'confirmed','2026-09-03',now()),
 ('${f.batchB}','${a.teacherB.id}','${f.studentB}','${a.parentA.id}','2026-09-01','2026-09-01','2026-09-03',1000,'confirmed','2026-09-03',now()),
 ('${f.batchC}','${a.teacherA.id}','${f.studentC}','${a.parentB.id}','2026-09-02','2026-09-02','2026-09-03',1000,'confirmed','2026-09-03',now());
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values
 ('${f.batchA}','${f.lessonA}',1000),('${f.batchB}','${f.lessonB}',1000),('${f.batchC}','${f.lessonC}',1000);
insert into public.family_requests(id,teacher_id,student_id,lesson_id,parent_id,kind,status,note) values
 ('${f.requestA}','${a.teacherA.id}','${f.studentA}','${f.lessonA}','${a.parentA.id}','payment','approved','local'),
 ('${f.requestB}','${a.teacherB.id}','${f.studentB}','${f.lessonB}','${a.parentA.id}','payment','approved','local');
commit;`);
let assertions = 0;
async function get(who, path, expected) {
  const res = await fetch(status.API_URL + '/rest/v1/' + path, {
    headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + a[who].jwt }
  });
  const rows = await res.json();
  assert.equal(res.status, 200, `${who} GET ${path}: ${JSON.stringify(rows)}`);
  assert.equal(rows.length, expected, `${who} GET ${path}`);
  assertions += 2;
}
if (!preapplied) {
  await get('parentA', `payment_batches?select=id&id=eq.${f.batchA}`, 1);
  await get('parentA', `payment_batch_items?select=batch_id&batch_id=eq.${f.batchA}`, 1);
  await get('parentA', `family_requests?select=id&id=eq.${f.requestA}`, 1);
}
const del = await fetch(status.API_URL + `/rest/v1/student_guardians?student_id=eq.${f.studentA}&guardian_id=eq.${a.parentA.id}`, {
  method: 'DELETE', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + a.teacherA.jwt, Prefer: 'return=representation' }
});
assert.equal(del.status, 200);
assert.equal((await del.json()).length, 1);
assertions += 2;
if (!preapplied) {
  await get('parentA', `payment_batches?select=id&id=eq.${f.batchA}`, 1);
  await get('parentA', `payment_batch_items?select=batch_id&batch_id=eq.${f.batchA}`, 1);
  await get('parentA', `family_requests?select=id&id=eq.${f.requestA}`, 1);
  sql('begin;' + migration + 'commit;');
}
for (const [table, column, id] of [
  ['payment_batches','id',f.batchA],['payment_batch_items','batch_id',f.batchA],['family_requests','id',f.requestA]
]) await get('parentA', `${table}?select=${column}&${column}=eq.${id}`, 0);
await get('parentA', `payment_batches?select=id&id=eq.${f.batchB}`, 1);
await get('parentA', `payment_batch_items?select=batch_id&batch_id=eq.${f.batchB}`, 1);
await get('parentB', `payment_batches?select=id&id=eq.${f.batchC}`, 1);
await get('teacherA', 'payment_batches?select=id', 2);
await get('teacherB', 'payment_batches?select=id', 1);
await get('teacherA', 'payment_batch_items?select=batch_id', 2);
await get('teacherA', 'family_requests?select=id', 1);
for (const who of ['parentB','teacherB','studentA','studentB','studentC']) {
  await get(who, `payment_batches?select=id&id=eq.${f.batchA}`, 0);
  await get(who, `payment_batch_items?select=batch_id&batch_id=eq.${f.batchA}`, 0);
}
for (const [who, rpc, args, fragment] of [
  ['parentA','submit_range_payment',{p_teacher_id:a.teacherA.id,p_student_id:f.studentA,p_period_start:'2026-09-01',p_period_end:'2026-09-01',p_paid_on:'2026-09-03',p_paid_amount:100,p_note:'local'},'Not authorized'],
  ['parentB','submit_range_payment',{p_teacher_id:a.teacherA.id,p_student_id:f.studentA,p_period_start:'2026-09-01',p_period_end:'2026-09-01',p_paid_on:'2026-09-03',p_paid_amount:100,p_note:'local'},'Not authorized'],
  ['teacherB','review_range_payment',{p_batch_id:f.batchA,p_confirm:false,p_received_on:null},'not authorized'],
  ['parentA','review_range_payment',{p_batch_id:f.batchA,p_confirm:false,p_received_on:null},'not authorized'],
  ['parentA','review_family_request',{p_request_id:f.requestA,p_approve:false},'permission denied']
]) {
  const res = await fetch(status.API_URL + '/rest/v1/rpc/' + rpc, {
    method:'POST', headers:{ apikey: status.ANON_KEY, Authorization:'Bearer '+a[who].jwt, 'Content-Type':'application/json' },
    body:JSON.stringify(args)
  });
  const result = await res.json();
  assert.equal(res.status, 400, `${who} ${rpc}`);
  assert.match(result.message, new RegExp(fragment, 'i'));
  assertions += 2;
}
console.log(JSON.stringify({result:'PASS',phase:preapplied?'replay':'before_after',authUsers:7,realLocalJWT:7,assertions,productionWrites:0}));
