import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL(
 '../supabase/migrations/20261105201500_v5_3_team_data_boundaries.sql',
 import.meta.url),'utf8');

test('V5.3 does not modify V4 student, lesson, payment or guardian records',()=>{
 assert.doesNotMatch(sql,/\b(?:update|delete\s+from|truncate|insert\s+into|alter\s+table)\s+public\.(?:students|lesson_records|payment_batches|payment_batch_items|student_guardians)\b/i);
 assert.doesNotMatch(sql,/\bupdate\s+public\.workspaces\s+set\s+owner_id\b/i);
 assert.doesNotMatch(sql,/\bgrant\s+.*\bpayment_batches\b/i);
 assert.match(sql,/create table public\.v5_teams/);
 assert.match(sql,/create table public\.v5_team_students/);
 assert.match(sql,/create table public\.v5_team_lessons/);
});

test('all exposed Team tables have RLS and no anonymous privileges',()=>{
 for(const table of ['v5_teams','v5_team_students','v5_team_enrollments','v5_team_lessons']){
  assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security','i'));
  assert.match(sql,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated','i'));
 }
 assert.doesNotMatch(sql,/\bgrant\s+(?:all|select|insert|update|delete)\b.*\bto\s+anon\b/i);
});

test('composite foreign keys enforce Team/project/student consistency',()=>{
 assert.match(sql,/unique\(id,team_id\)/);
 assert.match(sql,/foreign key\(student_id,team_id\) references\s+public\.v5_team_students\(id,team_id\)/);
 assert.match(sql,/foreign key\(project_id,team_id\) references\s+public\.v5_team_projects\(id,team_id\)/);
 assert.match(sql,/foreign key\(student_id,project_id,team_id\)\s+references public\.v5_team_enrollments/);
 assert.match(sql,/v5_attach_project_to_team/);
});

test('Team records are governed by current manager and project roster, not personal V4 owner',()=>{
 for(const name of ['v5_team_student_manager_or_assigned_select','v5_team_student_manager_insert',
  'v5_team_enrollment_manager_or_assigned_select','v5_team_enrollment_manager_insert',
  'v5_team_lesson_manager_or_assigned_select','v5_team_lesson_teacher_or_manager_insert']){
  const policy=new RegExp('create policy '+name+'\\s+[\\s\\S]*?;','i').exec(sql)?.[0];
  assert.ok(policy,name+' missing');
  assert.doesNotMatch(policy,/\bw\.owner_id\b/,'No implicit V4 owner Team access');
  assert.match(policy,/v5_team_governance|v5_team_project_members/);
 }
});

test('lifetime seats are private, serialized, and survive archive',()=>{
 assert.match(sql,/create table tutor_private\.v5_team_student_seat_ledger/);
 assert.match(sql,/for update;/);
 assert.match(sql,/v_used>=100\+v_bonus/);
 assert.match(sql,/create trigger v5_team_student_quota_guard/);
 assert.match(sql,/grant update\(display_name,is_archived\)/);
 assert.doesNotMatch(sql,/\bgrant delete on public\.v5_team_students\b/i);
 assert.doesNotMatch(sql,/\bgrant update\s*\(\s*teacher_user_id\s*[,)]/i);
});
