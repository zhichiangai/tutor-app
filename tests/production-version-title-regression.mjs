import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');

test('Production document title is version-neutral across releases',()=>{
 const title=html.split('<title>')[1]?.split('</title>')[0];
 assert.equal(title,'好好上課 · 家教課程管理');
 assert.ok(!title.includes('V4.0.0-dev.2'));
});

test('Signed-in teacher retains the personal / Team workspace selector in Settings',()=>{
 for(const label of ['id="workspace-mode-card"',
   'data-workspace-mode="personal"','data-workspace-mode="team"'])
  assert.ok(html.includes(label),label);
 assert.ok(app.includes('const eligible=state.role==="teacher"&&!!activeUser&&authPhase==="ready";'));
 assert.ok(app.includes('$("#workspace-mode-card").classList.toggle("hidden",!eligible);'));
});