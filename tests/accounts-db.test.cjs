const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('account lifecycle against PostgreSQL in an isolated disposable schema', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'account_test_' + crypto.randomBytes(10).toString('hex');
  assert.match(schema, /^account_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL or packages/database/.env DATABASE_URL');
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let harness;
  const emails = [];
  let failDelivery = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query(fs.readFileSync('packages/database/prisma/migrations/20260707155819_init/migration.sql', 'utf8'));
    const migration = fs.readFileSync('packages/database/prisma/migrations/20260921000000_account_recovery/migration.sql', 'utf8');
    await t.test('migration refuses normalized email collisions without partially changing existing accounts', async () => {
      await admin.query(`INSERT INTO roles (id, name, permissions, "updatedAt") VALUES ('11111111-1111-4111-8111-111111111111', 'SuperAdmin', '[]', NOW());
        INSERT INTO tenants (id, name, "updatedAt") VALUES ('22222222-2222-4222-8222-222222222222', 'Legacy', NOW());
        INSERT INTO users (email, "passwordHash", "tenantId", "roleId", "updatedAt") VALUES
        ('ADMIN@example.test','unused','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111', NOW()),
        ('admin@example.test','unused','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111', NOW());`);
      await assert.rejects(() => admin.query(migration), /Duplicate normalized user emails/);
      await admin.query('ROLLBACK');
      assert.equal((await admin.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 2);
      await admin.query("DELETE FROM users WHERE email = 'admin@example.test'");
      const legacyToken = 'a'.repeat(64);
      await admin.query('INSERT INTO invitations (id,email,token,"roleId","tenantId","expiresAt") VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL \'1 day\')',
        [crypto.randomUUID(), ' LEGACY@example.test ', legacyToken, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
      await admin.query(migration);
      const migrated = (await admin.query('SELECT email,"emailVerifiedAt","sessionVersion" FROM users')).rows[0];
      assert.deepEqual(migrated, { email: 'admin@example.test', emailVerifiedAt: null, sessionVersion: 0 });
      assert.equal((await admin.query('SELECT token FROM invitations')).rows[0].token, crypto.createHash('sha256').update(legacyToken).digest('hex'));
      await admin.query('DELETE FROM invitations; DELETE FROM users; DELETE FROM tenants; DELETE FROM roles;');
    });

    process.env.NODE_ENV = 'test'; process.env.EMAIL_MODE = 'preview'; process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    harness = require('./account-harness.cjs')(prisma, async (email, purpose, token) => {
      if (failDelivery) throw new Error('simulated delivery failure');
      emails.push({ email, purpose, token });
    });
    const accounts = require('../apps/web/src/lib/accounts.ts');
    const actions = require('../apps/web/src/app/account-actions.ts');
    const { takeLimit } = require('../apps/web/src/lib/account-rate-limit.ts');
    const { requirePermission } = require('../apps/web/src/lib/authorization.ts');
    const form = (input) => { const data = new FormData(); for (const [key,value] of Object.entries(input)) data.set(key,value); return data; };
    const password = 'initial-password-123';
    let user, sessionToken;

    await t.test('registers without seed data, normalizes email, hashes tokens and denies unverified login', async () => {
      const result = await actions.registerWorkspaceAction(null, form({ name: ' Acme ', email: ' OWNER@Example.test ', password }));
      assert.equal(result.success, true);
      user = await prisma.user.findUnique({ where: { email: 'owner@example.test' } });
      assert.ok(user); assert.equal(user.emailVerifiedAt, null);
      assert.equal(await prisma.tenant.count(), 1); assert.equal(await prisma.role.count(), 1);
      const record = await prisma.accountToken.findFirst();
      assert.notEqual(record.tokenHash, emails.at(-1).token);
      assert.equal(record.tokenHash, accounts.hashToken(emails.at(-1).token));
      assert.equal(await harness.config.providers[0].authorize({ email: user.email, password }), null);
    });
    await t.test('verification is single-use under concurrent consumption', async () => {
      const token = emails.at(-1).token;
      const results = await Promise.allSettled([accounts.verifyAccount(token), accounts.verifyAccount(token)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      await assert.rejects(() => accounts.verifyAccount(token), /invalid|expired|used/);
      const loggedIn = await harness.config.providers[0].authorize({ email: ' OWNER@example.test ', password });
      assert.equal(loggedIn.id, user.id);
      sessionToken = await harness.config.callbacks.jwt({ token: {}, user: loggedIn });
      assert.equal(sessionToken.sessionVersion, 0);
    });
    await t.test('concurrent duplicate registration rolls back the losing tenant', async () => {
      const input = form({ name: 'Second workspace', email: 'second@example.test', password });
      const results = await Promise.all([actions.registerWorkspaceAction(null, input), actions.registerWorkspaceAction(null, input)]);
      assert.equal(results.filter((r) => r.success).length, 1);
      assert.equal(await prisma.tenant.count(), 2);
      assert.equal(await prisma.user.count(), 2);
    });
    await t.test('expired and wrong-purpose links do not alter account state', async () => {
      await accounts.issueAccountToken(user, 'reset');
      const token = emails.at(-1).token;
      await assert.rejects(() => accounts.verifyAccount(token), /invalid|expired/);
      await prisma.accountToken.update({ where: { tokenHash: accounts.hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(() => accounts.resetAccountPassword(token, 'replacement-password-123'), /invalid|expired/);
      assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).sessionVersion, 0);
    });
    await t.test('recovery tokens reset once and invalidate sibling links and old JWTs', async () => {
      await accounts.issueAccountToken(user, 'reset'); const first = emails.at(-1).token;
      await accounts.issueAccountToken(user, 'reset'); const second = emails.at(-1).token;
      const results = await Promise.allSettled([
        accounts.resetAccountPassword(first, 'replacement-password-123'),
        accounts.resetAccountPassword(second, 'replacement-password-123'),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      await assert.rejects(() => accounts.resetAccountPassword(first, password));
      assert.equal(await harness.config.callbacks.jwt({ token: sessionToken }), null);
      assert.equal(await harness.config.providers[0].authorize({ email: user.email, password }), null);
      assert.ok(await harness.config.providers[0].authorize({ email: user.email, password: 'replacement-password-123' }));
    });
    await t.test('change password checks current password and rejects stale sessions at protected boundaries', async () => {
      const freshUser = await harness.config.providers[0].authorize({ email: user.email, password: 'replacement-password-123' });
      harness.setSession({ user: freshUser });
      await requirePermission('workspace:read');
      const invalid = await actions.changePasswordAction(null, form({ currentPassword: 'incorrect', password: 'changed-password-123' }));
      assert.match(invalid.error, /current password/);
      const valid = await actions.changePasswordAction(null, form({ currentPassword: 'replacement-password-123', password: 'changed-password-123' }));
      assert.equal(valid.success, true);
      await assert.rejects(() => requirePermission('workspace:read'), /Access denied/);
      assert.ok((await actions.changePasswordAction(null, form({ currentPassword: 'changed-password-123', password }))).error);
      harness.setSession(null);
    });
    await t.test('database rate limits are atomic and reset after their window', async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => takeLimit('concurrent-test', 'one-client', 3)));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
      const key = crypto.createHash('sha256').update('concurrent-test:one-client').digest('hex');
      await prisma.authRateLimit.update({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await takeLimit('concurrent-test', 'one-client', 3);
      assert.equal((await prisma.authRateLimit.findUnique({ where: { key } })).count, 1);
    });
    await t.test('registration survives delivery failure and can resend verification', async () => {
      failDelivery = true;
      const result = await actions.registerWorkspaceAction(null, form({ name: 'Mail failure', email: 'retry@example.test', password }));
      assert.equal(result.success, true); assert.match(result.message, /could not send/);
      failDelivery = false;
      await actions.resendVerificationAction(null, form({ email: 'retry@example.test' }));
      assert.equal(emails.at(-1).email, 'retry@example.test');
      await accounts.verifyAccount(emails.at(-1).token);
    });
    await t.test('invitations preserve tenant and role and cannot be consumed twice', async () => {
      await accounts.inviteAccount('teammate@example.test', 'Member', user.tenantId);
      const token = emails.at(-1).token;
      const invitation = await prisma.invitation.findUnique({ where: { token: accounts.hashToken(token) } });
      assert.ok(invitation);
      const results = await Promise.allSettled([accounts.acceptInvitation(token, password), accounts.acceptInvitation(token, password)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const member = await prisma.user.findUnique({ where: { email: 'teammate@example.test' }, include: { role: true } });
      assert.equal(member.tenantId, user.tenantId); assert.equal(member.role.name, 'Member'); assert.ok(member.emailVerifiedAt);
      await assert.rejects(() => accounts.inviteAccount(member.email, 'Member', user.tenantId), /already exists/);
    });
    await t.test('failed invitation email leaves no usable invitation and can be retried', async () => {
      failDelivery = true;
      await assert.rejects(() => accounts.inviteAccount('retry-invite@example.test', 'Member', user.tenantId), /could not send/);
      assert.equal(await prisma.invitation.count({ where: { email: 'retry-invite@example.test' } }), 0);
      failDelivery = false;
      await accounts.inviteAccount('retry-invite@example.test', 'Member', user.tenantId);
      assert.equal(emails.at(-1).email, 'retry-invite@example.test');
    });
    await t.test('inactive accounts cannot use previously issued recovery tokens', async () => {
      const current = await prisma.user.findUnique({ where: { id: user.id } });
      await accounts.issueAccountToken(current, 'reset'); const token = emails.at(-1).token;
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await assert.rejects(() => accounts.resetAccountPassword(token, password), /invalid|expired/);
      assert.equal(await harness.config.providers[0].authorize({ email: user.email, password: 'changed-password-123' }), null);
    });
  } finally {
    harness?.restore();
    await prisma.$disconnect(); await pool.end();
    await admin.query('ROLLBACK');
    // This name is generated above, validated, and never points at an application schema.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
