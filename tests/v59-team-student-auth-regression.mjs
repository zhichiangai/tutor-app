import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=source('supabase/candidates/20261123010000_v5_9_team_student_auth_links.sql');
const html=source('v2/index.html');
const app=source('v2/app.js');
const moduleSource=source('v2/v5-team-student-auth.js');
const css=source('v2/style.css');

test('RAP-49 stays a release candidate until authorized migration gate',()=>{
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url));
 assert.equal(migrations.length,56,'Immutable 56-file Production migration baseline');
 assert.equal(migrations.some(x=>x.includes('v5_9_team_student_auth_links')),false);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS tutor_private\.v5_team_student_auth_links/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS tutor_private\.v5_team_student_auth_invitations/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS tutor_private\.v5_team_student_auth_audit/);
 for(const name of ['invitations','links','audit']){
  assert.match(migration,new RegExp('ALTER TABLE tutor_private\\.v5_team_student_auth_'+name+' ENABLE ROW LEVEL SECURITY'));
  assert.match(migration,new RegExp('REVOKE ALL ON tutor_private\\.v5_team_student_auth_'+name+' FROM PUBLIC,anon,authenticated'));
 }
});
test('RAP-49 server-authorized invitation and revocation never trust frontend roles',()=>{
 for(const func of [
  'v5_invite_team_student','v5_my_team_student_invitations',
  'v5_accept_team_student_invitation','v5_my_team_student_links',
  'v5_my_team_student_lessons','v5_team_student_manager_overview',
  'v5_revoke_team_student_invitation','v5_revoke_team_student_link']){
  assert.match(migration,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+func+'\\('));
  assert.match(migration,new RegExp('REVOKE ALL ON FUNCTION public\\.'+func+'\\('));
  assert.match(migration,new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+func+'\\('));
 }
 assert.match(migration,/email_confirmed_at IS NOT NULL/);
 assert.match(migration,/l\.revoked_at IS NULL/);
 assert.match(migration,/g\.manager_user_id=v_actor/);
 assert.match(migration,/v_invite\.recipient_email<>v_email/);
 assert.match(migration,/IF v_actor IS NULL/);
 assert.doesNotMatch(migration,/\bTO anon\b/i);
});
test('RAP-49 never exposes Team lesson notes or financial fields in student RPC',()=>{
 const start=migration.indexOf('CREATE OR REPLACE FUNCTION public.v5_my_team_student_lessons');
 const end=migration.indexOf('CREATE OR REPLACE FUNCTION public.v5_team_student_manager_overview');
 const studentProjection=migration.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(studentProjection,/l\.subject/);
 assert.match(studentProjection,/l\.lesson_start/);
 assert.match(studentProjection,/a\.auth_user_id=v_actor AND a\.revoked_at IS NULL/);
 for(const forbidden of ['l.notes','hourly_rate_cents','amount_cents','v5_team_payment_reports','guardian_email']){
  assert.ok(!studentProjection.includes(forbidden),'Student projection included '+forbidden);
 }
});
test('RAP-49 UI integrates with role bootstrap without breaking V4 student portal',()=>{
 assert.match(app,/import \{ createV5TeamStudentAuthUI \}/);
 assert.match(app,/v5TeamStudentAuthUI\.readMyLinks\(\)/);
 assert.match(app,/const isTeamStudent=teamStudentLinks\.length>0/);
 assert.match(app,/if\(isTeamStudent&&!state\.enabledRoles\.includes\("student"\)\)/);
 assert.match(app,/v5TeamStudentAuthUI\.clear\(\)/);
 assert.match(app,/v5TeamStudentAuthUI\.handleClick/);
 assert.match(app,/v5TeamStudentAuthUI\.handleSubmit/);
 assert.match(app,/client\.rpc\("student_portal_data"\)/,
  'Existing V4 student portal stays in place');
 for(const element of [
  'v5-student-auth-card','v5-student-auth-admin-card',
  'v5-team-student-learning-card','v5-team-student-today-card',
  'v5-team-student-calendar-card'
 ])assert.match(html,new RegExp('id="'+element+'"'));
 assert.match(css,/@media \(max-width:390px\)/);
 assert.doesNotMatch(moduleSource,/from\('v5_team_lesson_fees'\)|from\('v5_team_payment_reports'\)/);
});
test('RAP-49 UI module compiles and only renders minimal student lesson data',async()=>{
 const code=moduleSource.replace(/^export function/m,'function');
 const documentElements=new Map();
 function create(tag){
  const node={tag,children:[],dataset:{},value:'',disabled:false,textContent:'',className:'',
   classList:{add(){},toggle(){}},
   append(...items){this.children.push(...items)},
   replaceChildren(){this.children=[]}
  };
  return node;
 }
 const document={
  getElementById(id){if(!documentElements.has(id))documentElements.set(id,create('div'));
   return documentElements.get(id)},
  createElement:create
 };
 const createUI=new Function('document','window',code+'\nreturn createV5TeamStudentAuthUI;')(
  document,{confirm:()=>true});
 const calls=[];
 const fakeData={
  v5_my_team_student_invitations:[],
  v5_my_team_student_links:[{id:'l1',student_name:'Synthetic D',team_name:'Team A'}],
  v5_my_team_student_lessons:[{
   id:'x1',subject:'Mathematics',project_name:'A Shared',status:'completed',
   lesson_start:'2026-11-18T02:00:00Z',lesson_end:'2026-11-18T03:30:00Z'
  }],
  v5_team_student_manager_overview:{students:[],pending:[],links:[]}
 };
 const user={id:'user-d'};
 const client={rpc:async name=>{calls.push(name);return {data:fakeData[name],error:null}}};
 const ui=createUI({
  getClient:()=>client,getUser:()=>user,
  getContext:()=>({role:'student',view:'student-learning',workspaceMode:'personal',teamSection:'settings'}),
  isReady:()=>true,notify:()=>{}
 });
 await ui.refresh();
 assert.equal(calls.length,4);
 const text=JSON.stringify(document.getElementById('v5-team-student-lesson-list').children);
 assert.match(text,/Mathematics/);
 assert.match(text,/A Shared/);
 assert.doesNotMatch(text,/amount_cents|hourly_rate|notes|payment|refund/);
 ui.clear();
 assert.equal(document.getElementById('v5-team-student-lesson-list').children.length,0);
});
