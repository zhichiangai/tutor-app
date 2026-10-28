// Physical root fallback should serve V4 on Tutor Vercel, preserving legacy GitHub Pages V1.
// This tests browser redirect code, not the live Preview routing or login environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('Root fallback script is missing');

function redirect(from) {
  const loc = new URL(from);
  let redirected = '';
  const window = {
    location: {
      hostname: loc.hostname,
      href: loc.href,
      search: loc.search,
      hash: loc.hash,
      replace: url => { redirected = url; }
    }
  };
  vm.runInNewContext(match[1], {window, URL});
  return redirected;
}

test('Tutor Vercel root fallback opens V4, not the old timer', () => {
  assert.equal(redirect('https://preview.example.vercel.app/'), 'https://preview.example.vercel.app/v2/index.html');
  assert.equal(redirect('https://tutor.rapid4grad.com/'), 'https://tutor.rapid4grad.com/v2/index.html');
  assert.deepEqual(vercel.rewrites.find(x => x.source === '/'), {source:'/',destination:'/v2/index.html'});
});

test('invitation URL and OAuth hash are preserved across fallback', () => {
  assert.equal(redirect('https://preview.example.vercel.app/?v4invite=testopaque#access_token=synthetic'),
    'https://preview.example.vercel.app/v2/index.html?v4invite=testopaque#access_token=synthetic');
});

test('GitHub Pages still points at historical V1 instead of V4', () => {
  assert.ok(html.includes('frontend/index.html'));
  assert.equal(redirect('https://example.github.io/tutor-app/'), 'https://example.github.io/tutor-app/frontend/index.html');
});
