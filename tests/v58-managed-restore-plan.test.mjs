// Does not connect to Production, restore data, inspect real SQL or use secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManagedAppRestorePlan} from '../scripts/release/v58-managed-restore-plan.mjs';

const synthetic=`; Synthetic pg_restore TOC. No DB or private content.
1; 2615 11 SCHEMA - auth postgres
2; 2615 12 SCHEMA - storage postgres
3; 2615 13 SCHEMA - supabase_migrations postgres
4; 2615 14 SCHEMA - tutor_private postgres
5; 3079 150 EXTENSION - pgcrypto postgres
6; 1259 20 TABLE public students postgres
7; 0 20 TABLE DATA public students postgres
8; 1259 21 TABLE auth users postgres
9; 0 21 TABLE DATA auth users postgres
10; 1259 22 TABLE storage objects postgres
11; 0 22 TABLE DATA storage objects postgres
12; 1259 23 TABLE supabase_migrations schema_migrations postgres
13; 0 23 TABLE DATA supabase_migrations schema_migrations postgres
14; 1259 24 TABLE tutor_private v5_team_lesson_fees postgres
15; 0 24 TABLE DATA tutor_private v5_team_lesson_fees postgres
16; 2620 25 TRIGGER public students_student_audit postgres
17; 3256 26 POLICY public students synthetic_only postgres
18; 0 0 ACL - SCHEMA auth postgres
19; 0 0 COMMENT - EXTENSION pgcrypto postgres
20; 2606 27 FK CONSTRAINT public students students_student_fk postgres
21; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres
`;

test('managed auth/storage/schema/migration/roles/extension never enter app-only -L',()=>{
 const r=buildManagedAppRestorePlan(synthetic);
 assert.equal(r.status,'APP_ONLY_RESTORE_PROPOSAL_NOT_EXECUTABLE');
 assert.equal(r.full_supabase_restore_verified,false);
 assert.equal(r.managed_auth_storage_data_restored,false);
 assert.equal(r.production_writes,0);
 assert.equal(r.selected_count,8);
 for(const forbidden of [
  /SCHEMA - auth/,/SCHEMA - storage/,/SCHEMA - supabase_migrations/,
  /TABLE DATA auth users/,/TABLE DATA storage objects/,
  /TABLE DATA supabase_migrations schema_migrations/,
  /EXTENSION - pgcrypto/,/ACL - SCHEMA auth/,/DEFAULT ACL /
 ]) assert.doesNotMatch(r.toc,forbidden);
 assert.match(r.toc,/TABLE DATA public students/);
 assert.match(r.toc,/SCHEMA - tutor_private/);
 assert.match(r.toc,/POLICY public students/);
 assert.match(r.toc,/FK CONSTRAINT public students/);
});
test('unreviewed application schema or TOC descriptor blocks proposal',()=>{
 assert.equal(buildManagedAppRestorePlan(synthetic+'22; 1259 30 TABLE mystery secret postgres\n').status,'BLOCKED_UNREVIEWED_TOC');
 assert.equal(buildManagedAppRestorePlan(synthetic+'22; 1259 30 EVENT TRIGGER public injected postgres\n').status,'BLOCKED_UNREVIEWED_TOC');
 assert.equal(buildManagedAppRestorePlan(synthetic.replace('4; 2615 14 SCHEMA - tutor_private postgres\n','')).status,'BLOCKED_UNREVIEWED_TOC');
 assert.equal(buildManagedAppRestorePlan('garbage').status,'BLOCKED_UNREVIEWED_TOC');
});
