import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL(
 '../supabase/migrations/20261105192000_v5_2_team_governance_transfer.sql',
 import.meta.url),'utf8');
test('V4 workspace owner and personal lesson ownership never change',()=>{
 assert.doesNotMatch(sql,/update\s+public\.workspaces\s+set\s+owner_id/i);
 assert.doesNotMatch(sql,/update\s+public\.lesson_records\b/i);
 assert.doesNotMatch(sql,/delete\s+from\s+public\.lesson_records\b/i);
 assert.match(sql,/create table public\.v5_team_governance/);
 assert.match(sql,/create table public\.v5_team_roster/);
 assert.match(sql,/if v_actor<>v_owner then/);
});
test('governance has no direct client UPDATE/DELETE privilege',()=>{
 assert.match(sql,/revoke all on public\.v5_team_governance from public,anon,authenticated/);
 assert.match(sql,/grant select on public\.v5_team_governance to authenticated/);
 assert.doesNotMatch(sql,/grant\s+(?:update|delete|insert)[^(;]*\s+on public\.v5_team_governance\s+to authenticated/i);
 assert.match(sql,/alter table public\.v5_team_governance enable row level security/);
});
test('transfer is an authenticated two-party protocol with time and roster checks',()=>{
 assert.match(sql,/create function public\.v5_propose_team_manager\(/);
 assert.match(sql,/create function public\.v5_respond_team_manager\(/);
 assert.match(sql,/create function public\.v5_cancel_team_manager\(/);
 assert.match(sql,/v_transfer\.to_user_id<>v_actor/);
 assert.match(sql,/v_transfer\.expires_at<=now\(\)/);
 assert.match(sql,/from public\.v5_team_roster r/);
 assert.match(sql,/u\.email_confirmed_at is not null/);
 assert.match(sql,/where id=p_transfer_id and status='pending' for update/);
 assert.match(sql,/manager_user_id=v_actor,generation=generation\+1/);
 assert.match(sql,/create unique index v5_one_pending_manager_transfer/);
 assert.match(sql,/audit\(/i);
});
test('policies use separate manager source, not V4 personal owner',()=>{
 const names=['v5_project_owner_create','v5_project_owner_update',
  'v5_project_member_owner_assign','v5_team_invite_owner_create'];
 for(const name of names){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\  const at=sql.indexOf('create policy '+name+' ');
  assert.ok(at>=0,name+' missing');
  const p=sql.slice(at,sql.indexOf(';',at));');
  const match=new RegExp('create policy\\s+'+escaped+'\\s+[\\s\\S]*?;','i').exec(sql);
  assert.ok(match,name+' missing');
  const p=match[0];
  assert.match(p,/v5_team_governance/);
  assert.doesNotMatch(p,/w\.owner_id\s*=/,'Old V4 owner must not retain Team admin access');
 }
});
test('manager transfers and exits are audited without removing V4 owner rows',()=>{
 assert.match(sql,/v5_team_governance_audit/);
 assert.match(sql,/teacher_left/);
 assert.match(sql,/teacher_removed/);
 assert.match(sql,/delete from public\.v5_team_roster/);
 assert.match(sql,/delete from public\.v5_team_project_members/);
 assert.match(sql,/grant execute on function public\.v5_respond_team_manager\(uuid,boolean\)/);
});
