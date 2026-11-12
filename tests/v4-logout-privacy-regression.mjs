import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const app=read('v2/app.js');
const css=read('v2/style.css');

test('signed-out login overlay is not an ordinary dismissible dialog',()=>{
 assert.match(app,/function canDismissAccountModal\(\)/);
 assert.match(app,/if\(d\.id==="account-modal"&&!canDismissAccountModal\(\)\)return/);
 assert.ok(app.includes('$$(".modal").forEach('),'click protection must bind to all dialogs');
 assert.match(app,/if\(!activeUser\)ev\.preventDefault\(\)/);
 assert.match(app,/if\(!canDismissAccountModal\(\)\)showModal\("account-modal"\)/);
});

test('only authenticated accounts can close the login gate',()=>{
 const source=app.match(/function canDismissAccountModal\(\)\{[\s\S]*?\n\}/);
 assert.ok(source);
 function check(authPhase,activeUser,preview,readOnly){
  const ctx={authPhase,activeUser,
   previewBackendUnavailable:()=>preview,
   document:{body:{classList:{contains:()=>readOnly}}}};
  return vm.runInNewContext(source[0]+'\ncanDismissAccountModal()',ctx);
 }
 assert.equal(check('signedOut',null,false,false),false);
 assert.equal(check('checking',null,false,false),false);
 assert.equal(check('error',{id:'test'},false,false),false);
 assert.equal(check('ready',{id:'test'},false,false),true);
 assert.equal(check('signedOut',null,true,false),false);
 assert.equal(check('signedOut',null,true,true),true);
});

test('private dashboards are hidden and never rerendered during logout',()=>{
 assert.match(app,/if\(!identified\)\{renderPreviewReadOnlyShell\(\);return\}\s*\/\/ Role preference checkboxes/);
 assert.match(app,/function renderPreviewReadOnlyShell\(\)\{\s*if\(!previewBackendUnavailable\(\)\|\|!document\.body\.classList\.contains\("preview-readonly"\)\)return;/);
 assert.match(app,/function enterPreviewReadOnly\(\)\{\s*if\(!previewBackendUnavailable\(\)\)return;/);
 for(const id of ['home-focus','metrics','money-reminder','student-today-content','student-calendar-grid','billing-summary']){
  assert.ok(app.includes('"'+id+'"'),'logout clears '+id);
 }
 for(const pane of ['sidebar','main-content','mobile-nav']){
  assert.ok(css.includes('.login-required .app-shell>.'+pane),'signed-out layout hides '+pane);
 }
 assert.match(css,/visibility:hidden;pointer-events:none;user-select:none/);
});
