import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

function setup(result) {
  const fields = {
    '#email-login-email': { value: '  QA@example.com  ' },
    '#email-login-password': { value: 'temporary-test-password' },
    '#email-login-error': { hidden: true, textContent: '' },
    '#email-login-submit': { disabled: false }
  };
  const calls = [];
  const ctx = {
    authPhase: 'signedOut',
    signOutRequested: true,
    oauthCallbackIssue: 'prior google error',
    activeUser: null,
    state: { mode: 'live' },
    MODE_STORAGE: 'mode',
    $: key => fields[key],
    ensureClient: async () => ({ auth: { signInWithPassword: async values => { calls.push(values); return result; } } }),
    allowGoogleLogin: () => calls.push('unlock'),
    renderAuthUI: () => {},
    initializeLive: async () => calls.push('initialize'),
    localStorage: { setItem: (key,value) => calls.push(['storage', key,value]) },
    markLogout: () => calls.push('locked'),
    clearUserSessionState: () => calls.push('clear'),
    render: () => calls.push('render'),
    showModal: () => calls.push('modal')
  };
  const start = app.indexOf('// Existing-account Email/password sign-in.');
  const end = app.indexOf('async function googleLogin(){', start);
  assert.ok(start >= 0 && end > start, 'password login module should have a stable boundary');
  vm.createContext(ctx);
  vm.runInContext(app.slice(start,end), ctx, { timeout: 2000 });
  return { fields, calls, ctx, submit: async () => vm.runInContext('emailPasswordLogin({preventDefault(){}})', ctx) };
}

test('password UI requires existing account; Google OAuth remains available', () => {
  assert.match(html, /id="google-login"/);
  assert.match(html, /id="email-login-form"/);
  assert.match(html, /id="email-login-email"[^>]*type="email"[^>]*autocomplete="username"/);
  assert.match(html, /id="email-login-password"[^>]*type="password"[^>]*autocomplete="current-password"/);
  assert.doesNotMatch(html, /id="email-signup-form"/);
  assert.match(app, /auth\.signInWithOAuth\(\{provider:"google"/);
  assert.match(app, /auth\.signInWithPassword\(\{email,password\}\)/);
  assert.match(app, /email-login-form"\)\.addEventListener\("submit",emailPasswordLogin\)/);
});

test('successful password sign-in reuses normal live bootstrap and clears password input', async () => {
  const x = setup({ data: { session: { user: { id: 'qa-a' } } }, error: null });
  await x.submit();
  assert.equal(x.fields['#email-login-password'].value, '');
  assert.equal(x.fields['#email-login-error'].hidden, true);
  assert.equal(x.fields['#email-login-submit'].disabled, false);
  assert.equal(x.ctx.signOutRequested, false);
  assert.equal(x.ctx.oauthCallbackIssue, '');
  assert.equal(x.calls.filter(x => x === 'initialize').length, 1);
  const login = x.calls.find(x => typeof x === 'object' && !Array.isArray(x));
  assert.equal(login.email, 'qa@example.com');
  assert.equal(login.password, 'temporary-test-password');
});

test('failed sign-in does not expose credentials and re-locks signed-out UI', async () => {
  const x = setup({ data: { session: null }, error: new Error('invalid login') });
  await x.submit();
  assert.equal(x.fields['#email-login-password'].value, '');
  assert.equal(x.fields['#email-login-error'].hidden, false);
  assert.doesNotMatch(x.fields['#email-login-error'].textContent, /qa@example\.com|temporary-test-password/);
  assert.ok(x.calls.includes('locked'));
  assert.ok(!x.calls.includes('initialize'));
  assert.equal(x.ctx.authPhase, 'signedOut');
});

test('local QA role/password file is ignored from Git source control', () => {
  assert.match(ignore, /^\/TEST_ACCOUNT_ROLES\.md$/m);
  assert.match(ignore, /^\/QA_ACCOUNT_SECRETS\.md$/m);
  assert.match(ignore, /^\/\.qa-secrets\/$/m);
});
