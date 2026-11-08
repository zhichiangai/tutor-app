import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');

test('Production browser title does not falsely label current Main as V4 dev',()=>{
 const title=html.match(/<title>([^<]+)<\\/title>/)?.[1]||'';
 assert.equal(title,'好好上課 · 家教課程管理');
 assert.doesNotMatch(title,/V\\d+(?:\\.\\d+)*(?:-dev\\.\\d+)?/i);
});

test('Teacher Settings retains a visible personal / Team entry point',()=>{
 assert.match(html,/id="workspace-mode-card"/);
 assert.match(html,/data-workspace-mode="personal"/);
 assert.match(html,/data-workspace-mode="team"/);
 assert.match(app,/const eligible=state\\.role==="teacher"&&!!activeUser&&authPhase==="ready"/);
 assert.match(app,/\\$\\("#workspace-mode-card"\\)\\.classList\\.toggle\\("hidden",!eligible\\)/);
});
