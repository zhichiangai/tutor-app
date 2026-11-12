// Security contract for the isolated V5 public RPC catalog gate.
// Does not connect to Supabase or read any secret; CI executes the catalog
// audit against local disposable PostgreSQL after V5 migration replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const gate=readFileSync(new URL('tests/local/v5-clean-bootstrap-gate.mjs',root),'utf8');
const oldHistory=readFileSync(new URL('.github/workflows/v5-real43-history-replay.yml',root),'utf8');
const browser=readFileSync(new URL('.github/workflows/v4-browser-e2e.yml',root),'utf8');

test('V5 public RPC catalog is enumerated dynamically after disposable migration replay',()=>{
 assert.match(gate,/v5RpcSurface=JSON\.parse\(db\(/);
 assert.match(gate,/pg_proc p join pg_namespace n/);
 assert.match(gate,/p\.proname ~ '\^\(v5_\|v56_\)'/);
 assert.match(gate,/v5RpcSurface\.length>=25/);
 assert.match(gate,/scope:'disposable-local-only'/);
 assert.match(oldHistory,/tests\/local\/v5-clean-bootstrap-gate\.mjs/);
 assert.match(oldHistory,/node tests\/local\/v5-clean-bootstrap-gate\.mjs/);
 assert.match(browser,/node tests\/local\/v5-clean-bootstrap-gate\.mjs/);
});

test('V5 privileged RPC grants deny anonymous execution and pin SECURITY DEFINER search_path',()=>{
 assert.match(gate,/has_function_privilege\('anon',p\.oid,'EXECUTE'\)/);
 assert.match(gate,/v5RpcSurface\.filter\(r=>r\.anon_execute\)/);
 assert.match(gate,/v5RpcSurface\.filter\(r=>r\.security_definer&&!r\.pinned_search_path\)/);
 assert.match(gate,/V5 SECURITY DEFINER RPC missing fixed search_path/);
 assert.match(gate,/V5 admin-only RPC became callable by authenticated users/);
});

test('Authenticated V5 SQL views may not bypass RLS or expose data under definer privileges',()=>{
 assert.match(gate,/c\.relkind='v'/);
 assert.match(gate,/security_invoker=true/);
 assert.match(gate,/has_table_privilege\('authenticated',c\.oid,'SELECT'\)/);
 assert.match(gate,/assert\.deepEqual\(unsafeV5Views,\[\]/);
});
