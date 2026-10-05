const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
let user = null;
const harness = require('./account-harness.cjs')({
  user: { findUnique: async () => user },
  $queryRaw: async () => [{ count: 1 }],
  accountToken: { create: async () => { throw new Error('simulated database failure'); } },
});
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'preview';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
const validation = require('../apps/web/src/lib/account-validation.ts');
const { emailConfig } = require('../apps/web/src/lib/email-config.ts');
const { sendAccountEmail } = require('../apps/web/src/lib/email.ts');
const actions = require('../apps/web/src/app/account-actions.ts');
const originalFetch = global.fetch;
after(() => { harness.restore(); global.fetch = originalFetch; });

test('email normalization and password byte limits are shared across forms', () => {
  assert.equal(validation.emailSchema.parse('  ADMIN@Example.COM '), 'admin@example.com');
  assert.equal(validation.registrationSchema.safeParse({ name: 'Acme', email: 'bad', password: 'long-password-123' }).success, false);
  assert.equal(validation.newPasswordSchema.safeParse('short').success, false);
  assert.equal(validation.newPasswordSchema.safeParse('é'.repeat(37)).success, false);
  assert.equal(validation.newPasswordSchema.safeParse('a'.repeat(72)).success, true);
  assert.equal(validation.loginSchema.safeParse({ email: 'admin@example.com', password: 'old123' }).success, true);
  assert.equal(validation.tokenSchema.safeParse('../bad-token').success, false);
});

test('production rejects previews, missing keys, and insecure or malformed app URLs', () => {
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(emailConfig, /preview/);
    process.env.EMAIL_MODE = 'resend';
    assert.throws(emailConfig, /HTTPS/);
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    delete process.env.RESEND_API_KEY;
    assert.throws(emailConfig, /RESEND_API_KEY/);
    process.env.RESEND_API_KEY = 're_test_key'; process.env.EMAIL_FROM = 'NexRole <noreply@example.com>';
    assert.equal(emailConfig().baseUrl, 'https://app.example.com');
    for (const url of ['https://user:password@app.example.com', 'https://app.example.com/path', 'https://app.example.com?x=1']) {
      process.env.NEXT_PUBLIC_APP_URL = url; assert.throws(emailConfig);
    }
  } finally { process.env = saved; }
});

test('preview email contains the configured link and never calls the email provider', async () => {
  global.fetch = () => { throw new Error('Preview must not use network'); };
  const dir = path.resolve('.email-previews');
  const before = new Set(await fs.readdir(dir).catch(() => []));
  await sendAccountEmail('reader@example.test', 'verify', 'a'.repeat(64));
  const files = (await fs.readdir(dir)).filter((file) => !before.has(file));
  assert.equal(files.length, 1);
  try {
    const preview = await fs.readFile(path.join(dir, files[0]), 'utf8');
    assert.match(preview, /To: reader@example.test/);
    assert.ok(preview.includes('http://localhost:3000/verify-email?token=' + 'a'.repeat(64)));
  } finally { await fs.unlink(path.join(dir, files[0])); }
});

test('Resend transport sends server-side credentials and handles rejected delivery without leaking response details', async () => {
  process.env.EMAIL_MODE = 'resend'; process.env.RESEND_API_KEY = 're_test_key'; process.env.EMAIL_FROM = 'NexRole <onboarding@resend.dev>';
  try {
    let request;
    global.fetch = async (url, init) => { request = { url, init }; return { ok: true }; };
    await sendAccountEmail('reader@example.test', 'reset', 'b'.repeat(64));
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.init.headers.Authorization, 'Bearer re_test_key');
    assert.deepEqual(JSON.parse(request.init.body).to, ['reader@example.test']);
    assert.match(JSON.parse(request.init.body).text, /reset-password\?token=/);
    global.fetch = async () => ({ ok: false });
    await assert.rejects(() => sendAccountEmail('reader@example.test', 'reset', 'b'.repeat(64)), /Email delivery failed/);
  } finally { process.env.EMAIL_MODE = 'preview'; }
});

test('recovery responses conceal absent, inactive accounts and token/email delivery errors', async () => {
  const form = new FormData(); form.set('email', 'reader@example.test');
  const absent = await actions.forgotPasswordAction(null, form);
  user = { isActive: false };
  assert.deepEqual(await actions.forgotPasswordAction(null, form), absent);
  user = { id: 'user', email: 'reader@example.test', isActive: true, sessionVersion: 0 };
  assert.deepEqual(await actions.forgotPasswordAction(null, form), absent);
  assert.equal(absent.success, true);
});

test('anonymous password changes fail at the server action boundary', async () => {
  const form = new FormData(); form.set('password', 'new-long-password'); form.set('currentPassword', 'old-password');
  assert.ok((await actions.changePasswordAction(null, form)).error);
});
