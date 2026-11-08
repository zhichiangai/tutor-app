// V5: public plan labels differ from stable backend plan identifiers.
// No database connection, network access, or credentials are needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Free/Plus/Team UI labels preserve existing plan codes and prices',()=>{
 const plans=read('v2/v5-plans.js');
 const index=read('v2/index.html');
 const admin=read('v2/v5-admin.html');
 const adminUi=read('v2/v5-admin-ui.js');
 assert.match(plans,/free:\{name:'Free',price:'免費',student:3,teacher:1\}/);
 assert.match(plans,/pro:\{name:'Plus',price:'NT\$99／月',student:30,teacher:1\}/);
 assert.match(plans,/team:\{name:'Team',price:'NT\$399／月',student:100,teacher:10\}/);
 assert.match(plans,/Plus／Team 正式金流尚未開放/);
 assert.match(index,/Free 開放使用；Plus 與 Team/);
 assert.match(admin,/<option value="pro">Plus｜30 位累計學生、1 位老師<\/option>/);
 assert.match(adminUi,/pro:'Plus'/);
 assert.match(adminUi,/code==='pro'\?'PLUS'/);
});

test('database and operator API still authorize only free/pro/team codes',()=>{
 const sql=read('supabase/migrations/20261104131300_v5_1_entitlements_student_seats.sql');
 const api=read('api/v5-admin.js');
 assert.match(sql,/plan_code in \('free','pro','team'\)/);
 assert.match(sql,/when 'pro' then 99/);
 assert.match(api,/\['free','pro','team'\]\.includes\(input.plan\)/);
 assert.match(api,/legacyPhrase='SET PRO '/);
});
