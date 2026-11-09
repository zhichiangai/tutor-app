// Fail fast in Node CI if a Playwright E2E spec is syntactically invalid.
// Chromium's disposable Supabase setup is much more expensive than node --check.
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

for(const spec of [
 "v4-browser.spec.mjs",
 "v4-correction.spec.mjs",
 "v5-plan.spec.mjs",
 "v5-team.spec.mjs",
 "v5-workspace-mode.spec.mjs"
]){
 test("Playwright E2E source parses before disposable DB startup: "+spec,()=>{
  const file=fileURLToPath(new URL("./e2e/"+spec,import.meta.url));
  const result=spawnSync(process.execPath,["--check",file],{
   encoding:"utf8",timeout:15000
  });
  assert.equal(result.status,0, (result.stderr||result.error?.message||"Syntax check failed").slice(0,2000));
 });
}
