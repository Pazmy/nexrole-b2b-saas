const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('invitation lifecycle against PostgreSQL in an isolated disposable schema', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'invitation_test_' + crypto.randomBytes(10).toString('hex');
  assert.match(schema, /^invitation_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString);
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let harness, mailHook, onTenantLock, onTenantLocked;
  const emails = [];
  const database = new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return (callback, options) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, member) {
      if (member === '$queryRaw') return (strings, ...values) => {
        if (strings.join('').includes('FROM tenants')) {
          onTenantLock?.();
          return transaction.$queryRaw(strings, ...values).then(async (rows) => { await onTenantLocked?.(); return rows; });
        }
        return transaction.$queryRaw(strings, ...values);
      };
      const value = transaction[member]; return typeof value === 'function' ? value.bind(transaction) : value;
    } })), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    const migrations = 'packages/database/prisma/migrations';
    for (const directory of fs.readdirSync(migrations).sort()) {
      const filename = path.join(migrations, directory, 'migration.sql');
      if (!fs.existsSync(filename)) continue;
      if (directory === '20260927000000_unique_invitations') {
        await t.test('migration keeps the newest duplicate, preserves other tenants, and enforces uniqueness', async () => {
          const tenant = crypto.randomUUID(), other = crypto.randomUUID();
          const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
          for (let i = 0; i < 3; i++) await admin.query('INSERT INTO invitations (id,email,token,"roleId","tenantId","expiresAt","createdAt") VALUES ($1,$2,$3,$4,$5,NOW(),$6)', [ids[i], 'migration@example.test', 'token-' + i, 'unused', i === 2 ? other : tenant, new Date(2026, 0, i + 1)]);
          await admin.query(fs.readFileSync(filename, 'utf8'));
          const rows = (await admin.query('SELECT id FROM invitations')).rows.map((row) => row.id).sort();
          assert.deepEqual(rows, ids.slice(1).sort());
          await assert.rejects(() => admin.query('INSERT INTO invitations (email,token,"roleId","tenantId","expiresAt") VALUES ($1,$2,$3,$4,NOW())', ['migration@example.test', 'another', 'unused', tenant]), /unique/);
          await admin.query('DELETE FROM invitations');
        });
      } else await admin.query(fs.readFileSync(filename, 'utf8'));
    }
    process.env.NODE_ENV = 'test'; process.env.EMAIL_MODE = 'preview'; process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    harness = require('./account-harness.cjs')(database, async (email, purpose, token) => {
      const message = { email, purpose, token }; emails.push(message); await mailHook?.(message);
    });
    const service = require('../apps/web/src/lib/manage-invitation.ts');
    const accounts = require('../apps/web/src/lib/accounts.ts');
    const actions = require('../apps/web/src/app/(dashboard)/settings/invite-action.ts');
    const roles = {};
    for (const name of ['SuperAdmin', 'Member', 'Developer']) roles[name] = await prisma.role.create({ data: { name, permissions: [] } });
    const signIn = (user) => harness.setSession({ user: { id: user.id, tenantId: user.tenantId, sessionVersion: user.sessionVersion } });
    async function fixture(role = 'SuperAdmin') {
      const tenant = await prisma.tenant.create({ data: { name: 'Invitation fixture', subscriptionStatus: 'unpaid' } });
      const user = await prisma.user.create({ data: { tenantId: tenant.id, email: crypto.randomUUID() + '@example.test', roleId: roles[role].id, passwordHash: 'unused', emailVerifiedAt: new Date() } });
      signIn(user); return user;
    }
    const create = (email = crypto.randomUUID() + '@example.test', role = 'Member') => service.createInvitation({ email, role });
    const token = () => emails.at(-1).token;
    const accept = (value) => accounts.acceptInvitation(value, 'InvitedPassword123!');
    const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
    await t.test('normalized create, token-safe list, duplicates and existing accounts', async () => {
      const user = await fixture(); const invite = await create(' MIXED@Example.test ', 'Developer');
      const raw = token(); const row = await prisma.invitation.findUnique({ where: { id: invite.id } });
      assert.equal(row.email, 'mixed@example.test'); assert.equal(row.token, accounts.hashToken(raw));
      assert.ok(row.expiresAt > new Date(Date.now() + 23 * 3600000));
      const listed = await service.listInvitations();
      assert.equal(listed.length, 1); assert.equal(listed[0].role, 'Developer');
      assert.equal('token' in listed[0], false); assert.equal('tenantId' in listed[0], false);
      await assert.rejects(() => create('mixed@example.test'), { code: 'use_resend' });
      await prisma.invitation.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
      await assert.rejects(() => create('mixed@example.test'), { code: 'use_resend' });
      await assert.rejects(() => create(user.email), { code: 'account_exists' });
      const foreign = await fixture(); signIn(user);
      await assert.rejects(() => create(foreign.email), { code: 'account_exists' });
      await prisma.user.update({ where: { id: foreign.id }, data: { isActive: false } });
      await assert.rejects(() => create(foreign.email), { code: 'account_exists' });
      await assert.rejects(() => accept(raw), /invalid|expired/);
    });
    await t.test('all endpoints deny other roles, stale sessions and forged ownership', async () => {
      const owner = await fixture(); const invite = await create();
      for (const role of ['Member', 'Developer']) {
        await fixture(role);
        for (const operation of [service.listInvitations, () => create(), () => service.resendInvitation({ id: invite.id }), () => service.revokeInvitation({ id: invite.id })]) await assert.rejects(operation, /Access denied/);
      }
      await fixture(); assert.equal((await service.listInvitations()).length, 0);
      for (const operation of [service.resendInvitation, service.revokeInvitation]) {
        await assert.rejects(() => operation({ id: invite.id }), { code: 'not_found' });
        await assert.rejects(() => operation({ id: crypto.randomUUID() }), { code: 'not_found' });
      }
      signIn(owner);
      assert.equal((await actions.createInvitationAction(null, form({ email: 'bad', role: 'Owner' }))).code, 'invalid_input');
      assert.equal((await actions.revokeInvitationAction(null, form({ id: invite.id, tenantId: owner.tenantId }))).code, 'invalid_input');
      const duplicate = form({ id: invite.id }); duplicate.append('id', invite.id);
      assert.equal((await actions.revokeInvitationAction(null, duplicate)).code, 'invalid_input');
      await prisma.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
      assert.equal((await actions.revokeInvitationAction(null, form({ id: invite.id }))).code, 'access_denied');
    });
    await t.test('resend keeps role, rotates and extends expiry; revoked/used links cannot join', async () => {
      const owner = await fixture(); const invite = await create(undefined, 'Developer'); const old = token();
      await prisma.invitation.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
      assert.equal((await actions.resendInvitationAction(null, form({ id: invite.id }))).success, true); const next = token();
      assert.notEqual(old, next); await assert.rejects(() => accept(old), /invalid|expired/);
      const joined = await Promise.allSettled([accept(next), accept(next)]);
      assert.equal(joined.filter((result) => result.status === 'fulfilled').length, 1);
      const user = await prisma.user.findUnique({ where: { email: invite.email }, include: { role: true } });
      assert.equal(user.tenantId, owner.tenantId); assert.equal(user.role.name, 'Developer'); assert.ok(user.emailVerifiedAt);
      const revoked = await create(); const revokedToken = token();
      assert.equal((await actions.revokeInvitationAction(null, form({ id: revoked.id }))).success, true);
      await assert.rejects(() => accept(revokedToken), /invalid|expired/);
    });
    await t.test('concurrent creates send only one invitation', async () => {
      await fixture(); const email = crypto.randomUUID() + '@example.test'; const count = emails.length;
      const results = await Promise.allSettled([create(email), create(email)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'use_resend');
      assert.equal(emails.length - count, 1); assert.equal(await prisma.invitation.count({ where: { email } }), 1);
    });
    await t.test('failed delivery never activates tokens; create retries and resend retries work', async () => {
      await fixture(); const email = crypto.randomUUID() + '@example.test';
      mailHook = () => { throw new Error('private provider detail'); };
      const failed = await actions.createInvitationAction(null, form({ email, role: 'Member' }));
      assert.equal(failed.code, 'delivery_failed'); assert.equal(failed.error.includes('private'), false);
      assert.equal(await prisma.invitation.count({ where: { email } }), 0); await assert.rejects(() => accept(token()), /invalid|expired/);
      mailHook = null; const invite = await create(email); const old = token();
      mailHook = () => { throw new Error('delivery failed'); };
      await assert.rejects(() => service.resendInvitation({ id: invite.id }), { code: 'delivery_failed' }); const failedToken = token();
      for (const value of [old, failedToken]) await assert.rejects(() => accept(value), /invalid|expired/);
      assert.equal((await service.listInvitations())[0].expired, true);
      mailHook = null; await service.resendInvitation({ id: invite.id }); await accept(token());
    });
    await t.test('a failed older create cannot delete a successful newer resend', async () => {
      await fixture(); const started = deferred(), finish = deferred(); let first = true;
      mailHook = async () => { if (first) { first = false; started.resolve(); await finish.promise; throw new Error('late failure'); } };
      const pending = create().then(() => null, (error) => error);
      await started.promise; const row = (await service.listInvitations())[0];
      await assert.rejects(() => accept(token()), /invalid|expired/);
      await service.resendInvitation({ id: row.id }); const latest = token();
      finish.resolve(); assert.equal((await pending).code, 'delivery_failed'); mailHook = null;
      await accept(latest);
    });
    await t.test('overlapping resend completions cannot restore an older token', async () => {
      await fixture(); const invite = await create(); const started = deferred(), finish = deferred(); let first = true;
      mailHook = async () => { if (first) { first = false; started.resolve(); await finish.promise; } };
      const pending = service.resendInvitation({ id: invite.id }).then(() => null, (error) => error);
      await started.promise; const superseded = token();
      await service.resendInvitation({ id: invite.id }); const latest = token();
      finish.resolve(); assert.equal((await pending).code, 'changed'); mailHook = null;
      await assert.rejects(() => accept(superseded), /invalid|expired/); await accept(latest);
    });
    await t.test('revoke during delivery prevents late activation', async () => {
      await fixture(); const invite = await create(); const started = deferred(), finish = deferred();
      mailHook = async () => { started.resolve(); await finish.promise; };
      const pending = service.resendInvitation({ id: invite.id }).then(() => null, (error) => error);
      await started.promise; const raw = token(); await service.revokeInvitation({ id: invite.id });
      finish.resolve(); assert.equal((await pending).code, 'changed'); mailHook = null;
      await assert.rejects(() => accept(raw), /invalid|expired/);
    });
    await t.test('acceptance races with resend/revoke serialize without duplicate accounts', async () => {
      for (const operation of ['resendInvitation', 'revokeInvitation']) {
        await fixture(); const invite = await create(); const raw = token();
        const [accepted, managed] = await Promise.allSettled([accept(raw), service[operation]({ id: invite.id })]);
        assert.equal([accepted, managed].filter((result) => result.status === 'fulfilled').length, 1);
        const users = await prisma.user.count({ where: { email: invite.email } });
        assert.equal(users, accepted.status === 'fulfilled' ? 1 : 0);
        await assert.rejects(() => accept(raw), /invalid|expired/);
        if (operation === 'resendInvitation' && managed.status === 'fulfilled') await accept(token());
      }
    });
    await t.test('acceptance holding the tenant lock wins over queued resend and revoke', async () => {
      for (const operation of ['resendInvitation', 'revokeInvitation']) {
        await fixture(); const invite = await create(); const raw = token();
        const locked = deferred(), release = deferred(), attempted = deferred(); let first = true;
        onTenantLocked = async () => { if (first) { first = false; locked.resolve(); await release.promise; } };
        const accepted = accept(raw);
        try {
          await locked.promise;
          onTenantLock = () => attempted.resolve();
          const managed = service[operation]({ id: invite.id }).then(() => null, (error) => error);
          await attempted.promise; release.resolve(); await accepted;
          assert.equal((await managed).code, 'not_found');
          assert.equal(await prisma.user.count({ where: { email: invite.email } }), 1);
        } finally { release.resolve(); onTenantLock = null; onTenantLocked = null; }
      }
    });
    await t.test('actor is rechecked after tenant lock wait', async () => {
      const owner = await fixture(); const invite = await create(); const attempted = deferred();
      await admin.query('BEGIN'); await admin.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [owner.tenantId]);
      onTenantLock = () => attempted.resolve();
      const pending = service.revokeInvitation({ id: invite.id }).then(() => null, (error) => error);
      try {
        await attempted.promise;
        await admin.query('UPDATE users SET "isActive"=false, "sessionVersion"="sessionVersion"+1 WHERE id=$1', [owner.id]);
        await admin.query('COMMIT');
        assert.match((await pending).message, /Access denied/);
        assert.ok(await prisma.invitation.findUnique({ where: { id: invite.id } }));
      } finally { onTenantLock = null; await admin.query('ROLLBACK'); }
    });
    await t.test('create and resend share ten attempts; revoke remains available', async () => {
      await fixture(); const invite = await create();
      for (let i = 0; i < 9; i++) await service.resendInvitation({ id: invite.id });
      const result = await actions.resendInvitationAction(null, form({ id: invite.id }));
      assert.equal(result.code, 'rate_limited');
      await assert.rejects(() => create(), /Too many attempts/);
      await service.revokeInvitation({ id: invite.id });
    });
  } finally {
    harness?.restore(); await prisma.$disconnect(); await pool.end();
    await admin.query('ROLLBACK');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
