// V4 Production dependency survey is metadata-only and cannot grant release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../supabase/diagnostics/v4_forward_dependency_readonly.sql',import.meta.url),'utf8');
const q=s.split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n');
test('V4 forward dependency survey cannot mutate or read sensitive business records',()=>{
 assert.match(s,/READ ONLY/);
 assert.doesNotMatch(q,/\b(insert|update|delete|alter|drop|truncate|grant|revoke|create|copy|call|execute|perform)\b/i);
 assert.doesNotMatch(q,/\bfrom\s+(?:public|auth)\.(?:students|lesson_records|payment_batches|payment_batch_items|users)\b/i);
 assert.match(q,/information_schema\.columns/);
 assert.match(q,/pg_catalog\.pg_policies/);
 assert.match(q,/supabase_migrations\.schema_migrations/);
});
test('survey reports missing foundation, partial V4 install, and RLS security gap',()=>{
 for(const key of ['missing_relations','missing_columns','foundation_functions','guardian_rls_enabled',
 'v4_tables_present','target_payment_policies','active_link_guarded_payment_policies']){
   assert.match(q,new RegExp('\\b'+key+'\\b'));
 }
 for(const stage of ['BASELINE_MISSING_DEPENDENCIES','PARTIAL_V4_SCHEMA_STOP','V4_NOT_INSTALLED',
 'V4_TABLES_PRESENT_REVIEW','NO_GO_UNTIL_BACKUP_RESTORE_AND_FORWARD_TEST']){
   assert.match(s,new RegExp(stage));
 }
});
