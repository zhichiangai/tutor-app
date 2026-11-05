// Guards against RLS shadowing, recursive entitlements and widening V4 access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261105181500_v5_2_team_projects_invitations.sql',import.meta.url),'utf8');
const policies=new Map();
for(const match of sql.matchAll(/create policy\s+([a-z_0-9]+)[\s\S]*?;/g)){
 const name=match[1];
 assert.ok(!policies.has(name),'No duplicate policy: '+name);
 policies.set(name,match[0]);
}
test('all workspace policy predicates are explicitly outer-qualified',()=>{
 for(const [name,policy] of policies){
  assert.doesNotMatch(policy,/\bw\.id\s*=\s*workspace_id\b/,
   'Unqualified workspace id may be shadowed in '+name);
  assert.doesNotMatch(policy,/\bp\.workspace_id\s*=\s*workspace_id\b/,
   'Unqualified project workspace id may be shadowed in '+name);
 }
 assert.match(policies.get('v5_project_owner_or_assigned_read')||'',
  /public\.v5_team_projects\.workspace_id/);
});
test('legacy membership RLS does not query V5 entitlements recursively',()=>{
 for(const name of ['v5_owner_read_team_members','v5_owner_remove_team_teacher']){
  const p=policies.get(name);
  assert.ok(p);
  assert.doesNotMatch(p,/v5_workspace_entitlements/,
   'Membership->entitlements->membership cycle blocks V4 login');
  assert.match(p,/w\.owner_id\s*=\s*\(select auth\.uid\(\)\)/);
 }
});
test('V4 students, lessons and payment RLS are not altered by Team migration',()=>{
 assert.doesNotMatch(sql,/alter\s+policy[\s\S]*?(students|lesson_records|payment_batches)/i);
 for(const table of ['students','lesson_records','payment_batches']){
  assert.doesNotMatch(sql,new RegExp('create policy\\\\s+\\\\w+\\\\s+on\\\\s+public\\\\.'+table+'\\\\b','i'));
 }
});
test('invites require verified Auth identity and project assignments enforce composite FKs',()=>{
 assert.match(sql,/email_confirmed_at\s+is\s+not\s+null/i);
 assert.match(sql,/grant execute on function public\.v5_accept_team_invitation\(uuid\) to authenticated/);
 assert.match(sql,/foreign key\(workspace_id,user_id\) references public\.workspace_members/);
 assert.match(sql,/foreign key\(project_id,workspace_id\) references public\.v5_team_projects/);
 assert.match(sql,/on delete cascade/);
});
