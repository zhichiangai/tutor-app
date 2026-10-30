// The only maintained application is v2/. The retired GitHub Pages V1 must
// never be selected as a fallback. No Production network/database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const match=html.match(/<script>([\s\S]*?)<\/script>/);
if(!match)throw new Error('Root fallback script is missing');

function redirect(from){
 const loc=new URL(from);
 let redirected='';
 const window={location:{hostname:loc.hostname,href:loc.href,search:loc.search,hash:loc.hash,replace:url=>{redirected=url}}};
 vm.runInNewContext(match[1],{window,URL});
 return redirected;
}

test('Vercel fallback always opens maintained V4/V3 app',()=>{
 assert.equal(redirect('https://preview.example.vercel.app/'),'https://preview.example.vercel.app/v2/index.html');
 assert.equal(redirect('https://tutor.rapid4grad.com/'),'https://tutor.rapid4grad.com/v2/index.html');
 assert.deepEqual(vercel.rewrites.find(x=>x.source==='/'),{source:'/',destination:'/v2/index.html'});
});

test('Vercel invitation and OAuth callback state are preserved across fallback',()=>{
 assert.equal(redirect('https://preview.example.vercel.app/?v4invite=opaque#access_token=synthetic'),
 'https://preview.example.vercel.app/v2/index.html?v4invite=opaque#access_token=synthetic');
});

test('retired GitHub Pages redirects to canonical site, never the old V1 timer',()=>{
 assert.equal(redirect('https://zhichiangai.github.io/tutor-app/'),'https://tutor.rapid4grad.com/');
 assert.equal(redirect('https://zhichiangai.github.io/tutor-app/?v4invite=opaque#access_token=synthetic'),'https://tutor.rapid4grad.com/',
 'Never forward authentication fragments across origins on retired host');
 assert.doesNotMatch(html,/frontend\//i);
});
