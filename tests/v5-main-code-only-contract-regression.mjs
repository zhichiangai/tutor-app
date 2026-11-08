// Main code-only integration: V5 schema may not yet exist in Production.
// Regression protects V4 sign-in and individual tutoring when the V5 RPCs
// are absent; this test does not authorize Production Migration or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Production auth config stays bound to V4 production project, not Preview',()=>{
 const cfg=read('api/v4-config.js');
 assert.match(cfg,/const PRODUCTION_HOST = "tutor\.rapid4grad\.com"/);
 assert.match(cfg,/const PRODUCTION_REF = "vctisuglfoxyuwlvyjee"/);
 assert.match(cfg,/process\.env\.VERCEL_ENV === "production"/);
 assert.match(cfg,/if \(environment === "preview" && projectRef === PRODUCTION_REF\) return null/);
});
test('V5 missing RPC is a visible unavailable state, never fake membership or quota',()=>{
 const plan=read('v2/v5-plans.js');
 const teams=read('v2/v5-team.js');
 assert.match(plan,/v5_my_plan/);
 assert.match(plan,/status='unavailable'/);
 assert.match(plan,/現有課程與帳務可繼續使用/);
 assert.match(plan,/if\(status!=='ready'\|\|!data\|\|owner!==getUser\(\)\.id\)return true/);
 assert.match(teams,/Team 資料庫尚未啟用/);
 assert.match(teams,/const failure=r\.find\(x=>x\.error\)/);
});
test('Production deployment of V5 code never silently applies SQL',()=>{
 const manifest=read('docs/v5/catalog/V5_A1_NINE_MIGRATION_SOURCE_LOCK_20261108.json');
 const meta=JSON.parse(manifest);
 assert.equal(meta.approved_release,'NO_GO');
 assert.equal(meta.gate.production_migration_authorized,false);
 const ops=read('v2/v5-billing.js');
 assert.match(ops,/client\.rpc\('v5_team_operations_overview'/);
 assert.doesNotMatch(ops,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
