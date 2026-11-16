// CI-only source guard: V5.8 parent project finance candidate must retain the
// latest V5.6 parent RPC exactly, including append-only manual refund payout states.
// Never accesses a database, Production, credentials, or real payment records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('supabase/migrations/20261110090000_v5_6_allocated_manual_payout_history.sql');
const candidate=read('supabase/candidates/20261116100000_v5_8_parent_project_scoped_receivables.sql');

function parentRpc(sql){
 const first=sql.indexOf('create or replace function public.v56_team_parent_finance_overview(');
 assert.notEqual(first,-1,'Missing parent finance RPC definition');
 const end=sql.indexOf('end;$$;',first);
 assert.notEqual(end,-1,'RPC has no closing body');
 return sql.slice(first,end+'end;$$;'.length);
}

test('project candidate extends latest V5.6 parent finance RPC by precisely two scoped additions',()=>{
 const latest=parentRpc(source);
 const label="'lesson_id',f.lesson_id,'subject',f.subject,'lesson_start',f.lesson_start,";
 const row=' into v_rows from tutor_private.v5_team_lesson_fees f\n';
 assert.equal(latest.split(label).length,2);
 assert.equal(latest.split(row).length,2);
 const expected=latest.replace(label,
  "'lesson_id',f.lesson_id,'project_id',f.project_id,'project_name',pr.name,\n  'subject',f.subject,'lesson_start',f.lesson_start,")
  .replace(row,row+' left join public.v5_team_projects pr on pr.id=f.project_id and pr.team_id=f.team_id\n');
 assert.equal(parentRpc(candidate),expected,'Candidate drifted from last authoritative parent RPC');
});

test('candidate preserves both manual payout states, current guardian consent guards and execute ACLs',()=>{
 for(const fragment of [
  "where m.source='direct' and m.request_id=r.id",
  "where m.source='applied_credit' and m.request_id=q.id",
  "manual_paid_not_bank_verified",
  "p.team_id=p_team_id and p.team_student_id=p_team_student_id",
  "sg.guardian_id=v_actor",
  "e.plan_code='team'",
  "search_path=''",
  "'bank_verified',false",
  "left join public.v5_team_projects pr on pr.id=f.project_id and pr.team_id=f.team_id",
  "revoke all on function public.v56_team_parent_finance_overview(uuid,uuid,date)",
  "from public,anon,authenticated;",
  "grant execute on function public.v56_team_parent_finance_overview(uuid,uuid,date)",
  "to authenticated;"
 ])assert.ok(candidate.includes(fragment),'Missing security or history requirement: '+fragment);
});
