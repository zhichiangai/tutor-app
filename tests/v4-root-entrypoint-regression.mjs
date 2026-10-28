// Root entry fallback must not reopen the legacy timer when Vercel serves a physical index.html.
// This test only verifies the client-side fallback; browser/Preview behavior still needs E2E.
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
      href: loc.href,
      search: loc.search,
      hash: loc.hash,
      replace: url => { redirected = url; }
    }
  };
  vm.runInNewContext(match[1], {window, URL});
  return redirected;
}

test('physical root entry fallback enters V4 instead of legacy timer', () => {
  assert.equal(redirect('https://preview.example.vercel.app/'), 'https://preview.example.vercel.app/v2/index.html');
  assert.doesNotMatch(html, /frontend\/index\.html|家教計時器/);
  assert.deepEqual(vercel.rewrites.find(x => x.source === '/'), {source:'/',destination:'/v2/index.html'});
});

test('invitation token and OAuth hash are preserved across fallback', () => {
  const url = redirect('https://preview.example.vercel.app/?v4invite=testopaque#access_token=synthetic');
  assert.equal(url, 'https://preview.example.vercel.app/v2/index.html?v4invite=testopaque#access_token=synthetic');
});

test('GitHub Pages subpath keeps a relative V4 route', () => {
  assert.equal(redirect('https://example.github.io/tutor-app/?v4invite=abc'), 'https://example.github.io/tutor-app/v2/index.html?v4invite=abc');
});
