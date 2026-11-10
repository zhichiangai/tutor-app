// CI-only: prove an already-populated V4 database survives all nineteen V5 SQLs.
// No hosted credentials, Production data, or real-world payment operations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const phase=process.argv[2];
assert.ok(['before','after'].includes(phase),'Explicit populated upgrade phase required');
assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
const root=new URL('../../',import.meta.url);
assert.match(readFileSync(new URL('supabase/config.toml',root),'utf8'),
 /^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(new URL('supabase/.temp/project-ref',root)),false);
assert.ok(process.env.RUNNER_TEMP?.startsWith('/home/runner/'));
const marker=join(process.env.RUNNER_TEMP,'v5-populated-upgrade-before.json');
const tables=[
 'auth.users','public.workspaces','public.workspace_members','public.profiles',
 'public.students','public.student_guardians','public.lesson_records',
 'public.recurring_schedules','public.schedule_exceptions',
 'public.payment_batches','public.payment_batch_items'
];
function db(query){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query],
 {encoding:'utf8',timeout:30000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
}
const count=table=>Number(db('select count(*) from '+table));
const fingerprint=table=>JSON.parse(db(
 "select jsonb_build_object('rows',count(*),'md5',"+
 "md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))"+
 ' from '+table+' r'
));
const snapshot=()=>Object.fromEntries(tables.map(t=>[t,fingerprint(t)]));
if(phase==='before'){
 assert.ok(process.env.V4_E2E_FIXTURE_FILE?.startsWith('/'));
 const f=JSON.parse(readFileSync(process.env.V4_E2E_FIXTURE_FILE,'utf8'));
 const id=randomUUID();
 const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
 for(const val of [id,f.ids.student,f.ids.lesson,f.actors.teacher.id,
   f.actors.parent.id])assert.match(val,uuid);
 assert.match(f.day,/^\d{4}-\d{2}-\d{2}$/);
 // A historical pending payment, not a verified bank receipt.
 db("begin; "+
  "insert into public.payment_batches"+
  "(id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,note,status) values ("+
  "'"+id+"','"+f.actors.teacher.id+"','"+f.ids.student+"','"+f.actors.parent.id+
  "','"+f.day+"','"+f.day+"','"+f.day+"',500,'CI pre-V5 synthetic pending','pending'); "+
  "insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values ("+
  "'"+id+"','"+f.ids.lesson+"',500); commit;");
 assert.ok(count('auth.users')>=4);
 assert.ok(count('public.students')>=2);
 assert.ok(count('public.lesson_records')>=2);
 assert.equal(count('public.payment_batches'),1);
 assert.equal(count('public.payment_batch_items'),1);
 assert.equal(count('supabase_migrations.schema_migrations'),43);
 writeFileSync(marker,JSON.stringify(snapshot()),{mode:0o600,flag:'wx'});
 console.log('PASS: populated synthetic pre-V5 snapshot; 43 versions, V4 student, course and pending payment');
}else{
 const baseline=JSON.parse(readFileSync(marker,'utf8'));
 assert.equal(count('supabase_migrations.schema_migrations'),62);
 for(const table of tables){
  assert.deepEqual(fingerprint(table),baseline[table],
   'Preexisting synthetic V4 or Auth rows changed during V5 upgrade: '+table);
 }
 assert.equal(count('public.v5_workspace_entitlements'),count('public.workspaces'));
 assert.equal(count('tutor_private.v5_student_seat_ledger'),count('public.students'));
 assert.equal(Number(db(
  'select count(*) from public.students s left join tutor_private.v5_student_seat_ledger l '+
  'on l.student_id=s.id and l.workspace_id=s.workspace_id where l.student_id is null'
 )),0,'V5 entitlement migration missed an existing V4 student');
 assert.equal(Number(db(
  'select count(*) from public.workspaces w left join public.v5_workspace_entitlements e '+
  'on e.workspace_id=w.id where e.workspace_id is null'
 )),0,'V5 entitlement migration missed an existing V4 workspace');
 unlinkSync(marker);
 console.log('PASS: populated 43-to-62 upgrade preserved all existing V4/Auth rows; seats backfilled');
}