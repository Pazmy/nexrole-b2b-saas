const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('transaction creation against PostgreSQL in an isolated disposable schema', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'transaction_test_' + crypto.randomBytes(10).toString('hex');
  assert.match(schema, /^transaction_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL or packages/database/.env DATABASE_URL');
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let harness;
  let onTenantLock;
  // A notification at the real lock boundary makes race tests deterministic;
  // all database reads, locks, transactions, and writes still execute on PostgreSQL.
  const database = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') return (callback, options) => target.$transaction(async (tx) => callback(new Proxy(tx, {
        get(transaction, member) {
          if (member === '$queryRaw') return (strings, ...values) => {
            if (strings.join('').includes('FROM tenants')) onTenantLock?.();
            return transaction.$queryRaw(strings, ...values);
          };
          const value = transaction[member];
          return typeof value === 'function' ? value.bind(transaction) : value;
        },
      })), options);
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    const migrations = 'packages/database/prisma/migrations';
    for (const directory of fs.readdirSync(migrations).sort()) {
      const filename = path.join(migrations, directory, 'migration.sql');
      if (fs.existsSync(filename)) await admin.query(fs.readFileSync(filename, 'utf8'));
    }
    process.env.NODE_ENV = 'test'; process.env.EMAIL_MODE = 'preview';
    harness = require('./account-harness.cjs')(database);
    const { createTransactionAction } = require('../apps/web/src/app/(dashboard)/transactions/create-action.ts');
    const { createTransaction } = require('../apps/web/src/lib/create-transaction.ts');
    const { updateTransactionStatusAction: updateStatus } = require('../apps/web/src/app/(dashboard)/transactions/status-action.ts');
    const { getTransactionDetail } = require('../apps/web/src/lib/transaction-detail.ts');
    const { checkTenantBillingStatus } = require('../apps/web/src/lib/billing-guard.ts');
    const roles = {};
    for (const name of ['SuperAdmin', 'Member', 'Developer', 'CustomAdmin']) {
      roles[name] = await prisma.role.create({ data: { name, permissions: [] } });
    }
    async function fixture(status = 'free') {
      const tenant = await prisma.tenant.create({ data: { name: 'Transaction test', subscriptionStatus: status } });
      const user = await prisma.user.create({ data: {
        email: `${crypto.randomUUID()}@example.test`, passwordHash: 'not-used-by-session-tests',
        tenantId: tenant.id, roleId: roles.SuperAdmin.id, emailVerifiedAt: new Date(),
      } });
      return { tenant, user };
    }
    function signIn(user) {
      harness.setSession({ user: { id: user.id, tenantId: user.tenantId, sessionVersion: user.sessionVersion, role: 'SuperAdmin' } });
    }
    function form(overrides = {}) {
      const data = new FormData();
      for (const [key, value] of Object.entries({ description: ' Consulting ', amount: '12.50', ...overrides })) data.set(key, value);
      return data;
    }
    async function seedTransactions(user, count) {
      await prisma.transaction.createMany({ data: Array.from({ length: count }, (_, index) => ({
        description: 'Existing transaction', amount: '1.00', status: ['pending', 'completed', 'failed'][index % 3],
        tenantId: user.tenantId, userId: user.id,
      })) });
    }

    await t.test('creation derives tenant and actor from verified membership and returns only the new ID', async () => {
      const { user } = await fixture(); signIn(user);
      const result = await createTransactionAction(null, form({ amount: '00012.5' }));
      assert.equal(result.success, true);
      assert.deepEqual(Object.keys(result).sort(), ['message', 'success', 'transactionId']);
      const row = await prisma.transaction.findUnique({ where: { id: result.transactionId } });
      assert.equal(row.tenantId, user.tenantId); assert.equal(row.userId, user.id);
      assert.equal(row.status, 'pending'); assert.equal(row.amount.toFixed(2), '12.50');
      assert.equal(row.description, 'Consulting');
    });

    await t.test('malformed input, forged owner fields, and repeated form fields create no rows', async () => {
      const { user } = await fixture(); const foreign = await fixture(); signIn(user);
      for (const input of [{ amount: '0' }, { amount: '1.999' }, { description: ' ' }, { tenantId: foreign.tenant.id }, { userId: foreign.user.id }, { status: 'completed' }, { currency: 'EUR' }]) {
        const result = await createTransactionAction(null, form(input));
        assert.equal(result.code, 'invalid_input');
      }
      const duplicate = form(); duplicate.append('amount', '5');
      assert.equal((await createTransactionAction(null, duplicate)).code, 'invalid_input');
      assert.equal(await prisma.transaction.count({ where: { tenantId: { in: [user.tenantId, foreign.tenant.id] } } }), 0);
    });

    await t.test('anonymous, inactive, unverified, stale, cross-tenant and insufficient-role sessions cannot write', async () => {
      const { user } = await fixture(); const foreign = await fixture();
      harness.setSession(null);
      assert.equal((await createTransactionAction(null, form())).code, 'access_denied');
      harness.setSession({ user: { id: user.id, tenantId: foreign.tenant.id, sessionVersion: 0 } });
      assert.equal((await createTransactionAction(null, form())).code, 'access_denied');
      signIn(user);
      for (const changes of [{ isActive: false }, { emailVerifiedAt: null }, { sessionVersion: 1 }, ...['Member', 'Developer', 'CustomAdmin'].map((role) => ({ roleId: roles[role].id }))]) {
        await prisma.user.update({ where: { id: user.id }, data: changes });
        assert.equal((await createTransactionAction(null, form())).code, 'access_denied');
        await prisma.user.update({ where: { id: user.id }, data: { isActive: true, emailVerifiedAt: new Date(), sessionVersion: 0, roleId: roles.SuperAdmin.id } });
      }
      await prisma.user.delete({ where: { id: user.id } });
      assert.equal((await createTransactionAction(null, form())).code, 'access_denied');
      assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 0);
    });

    await t.test('restricted and unknown billing statuses reject writes with no side effects', async () => {
      const { user } = await fixture(); signIn(user);
      for (const subscriptionStatus of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'unknown', '']) {
        await prisma.tenant.update({ where: { id: user.tenantId }, data: { subscriptionStatus } });
        assert.equal((await createTransactionAction(null, form())).code, 'subscription_restricted');
      }
      assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 0);
    });

    await t.test('the tenth stored transaction succeeds and the eleventh fails for Free and canceled workspaces', async () => {
      for (const status of ['free', 'canceled']) {
        const { user } = await fixture(status); signIn(user); await seedTransactions(user, 9);
        assert.equal((await createTransactionAction(null, form())).success, true);
        assert.equal((await createTransactionAction(null, form())).code, 'creation_limit_reached');
        assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 10);
      }
    });

    await t.test('simultaneous creators with different admins cannot exceed the final Free slot', async () => {
      const { user } = await fixture(); await seedTransactions(user, 9);
      const otherAdmin = await prisma.user.create({ data: {
        email: `${crypto.randomUUID()}@example.test`, passwordHash: 'unused', tenantId: user.tenantId,
        roleId: roles.SuperAdmin.id, emailVerifiedAt: new Date(),
      } });
      const requests = Array.from({ length: 12 }, (_, index) => {
        signIn(index % 2 ? otherAdmin : user);
        return createTransactionAction(null, form({ description: `Concurrent ${index}` }));
      });
      const results = await Promise.all(requests);
      assert.equal(results.filter((r) => r.success).length, 1);
      assert.equal(results.filter((r) => r.code === 'creation_limit_reached').length, 11);
      assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 10);
    });

    await t.test('each workspace has its own quota and concurrent writes never cross tenant boundaries', async () => {
      const a = await fixture(); const b = await fixture();
      await seedTransactions(a.user, 10); await seedTransactions(b.user, 9);
      signIn(a.user); const requestA = createTransactionAction(null, form());
      signIn(b.user); const requestB = createTransactionAction(null, form());
      const [resultA, resultB] = await Promise.all([requestA, requestB]);
      assert.equal(resultA.code, 'creation_limit_reached'); assert.equal(resultB.success, true);
      const row = await prisma.transaction.findUnique({ where: { id: resultB.transactionId } });
      assert.equal(row.tenantId, b.tenant.id); assert.equal(row.userId, b.user.id);
    });

    await t.test('active and trialing workspaces can create beyond ten transactions', async () => {
      for (const status of ['active', 'trialing']) {
        const { user } = await fixture(status); signIn(user); await seedTransactions(user, 10);
        const results = await Promise.all(Array.from({ length: 3 }, () => createTransactionAction(null, form())));
        assert.ok(results.every((r) => r.success));
        assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 13);
      }
    });

    await t.test('membership, session and billing changes committed while waiting on the lock are rechecked', async () => {
      for (const change of ['inactive', 'demoted', 'password-reset', 'tenant-moved', 'billing']) {
        const { user } = await fixture(); signIn(user);
        const blocker = await pool.connect();
        let pending;
        try {
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [user.tenantId]);
          let reached;
          const waiting = new Promise((resolve) => { reached = resolve; });
          onTenantLock = reached;
          pending = createTransactionAction(null, form());
          await Promise.race([waiting, pending.then(() => { throw new Error('Request returned before reaching the lock'); })]);
          if (change === 'billing') await blocker.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['past_due', user.tenantId]);
          else {
            const data = change === 'inactive' ? { isActive: false }
              : change === 'demoted' ? { roleId: roles.Member.id }
              : change === 'password-reset' ? { sessionVersion: 1 }
              : { tenantId: (await fixture()).tenant.id };
            await prisma.user.update({ where: { id: user.id }, data });
          }
          await blocker.query('COMMIT');
          assert.equal((await pending).code, change === 'billing' ? 'subscription_restricted' : 'access_denied');
          assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 0);
        } finally {
          onTenantLock = undefined;
          await blocker.query('ROLLBACK'); blocker.release();
          if (pending) await pending;
        }
      }
    });

    await t.test('billing summary matches transaction policy for quota, Pro and restricted states', async () => {
      const { user } = await fixture(); await seedTransactions(user, 10);
      for (const status of ['free', 'canceled', 'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'unknown']) {
        await prisma.tenant.update({ where: { id: user.tenantId }, data: { subscriptionStatus: status } });
        const summary = await checkTenantBillingStatus(user.tenantId);
        assert.equal(summary.currentUsage, 10);
        const pro = ['active', 'trialing'].includes(status);
        const free = ['free', 'canceled'].includes(status);
        assert.equal(summary.isLocked, !pro);
        assert.equal(summary.reason, pro ? 'none' : free ? 'usage_limit_exceeded' : 'subscription_restricted');
        assert.equal(summary.maxUsage, free ? 10 : null);
      }
      assert.equal((await checkTenantBillingStatus(crypto.randomUUID())).reason, 'subscription_restricted');
      assert.equal((await checkTenantBillingStatus('invalid')).reason, 'subscription_restricted');
    });
    function statusForm(id, status = 'completed', extra = {}) {
      const data = new FormData();
      for (const [key, value] of Object.entries({ id, status, ...extra })) data.set(key, value);
      return data;
    }
    await t.test('details and status writes reject foreign and missing IDs without disclosure', async () => {
      const a = await fixture(); const b = await fixture(); signIn(a.user);
      const row = await createTransaction({ description: 'Private detail', amount: '1' });
      assert.equal((await getTransactionDetail(row.id)).transaction.description, 'Private detail');
      assert.equal(await getTransactionDetail('invalid'), null);
      signIn(b.user);
      assert.equal(await getTransactionDetail(row.id), null);
      for (const id of [row.id, crypto.randomUUID()]) assert.equal((await updateStatus(null, statusForm(id))).code, 'not_found');
    });
    await t.test('status updates work at Free quota and terminal states cannot change or reopen', async () => {
      for (const status of ['completed', 'failed']) {
        const { user } = await fixture(); signIn(user); await seedTransactions(user, 9);
        const row = await createTransaction({ description: 'At quota', amount: '2.50' });
        assert.equal((await updateStatus(null, statusForm(row.id, status))).success, true);
        for (const target of ['completed', 'failed']) assert.equal((await updateStatus(null, statusForm(row.id, target))).code, 'status_conflict');
        assert.equal((await updateStatus(null, statusForm(row.id, 'pending'))).code, 'invalid_input');
        assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 10);
        const saved = await prisma.transaction.findUnique({ where: { id: row.id } });
        assert.equal(saved.status, status); assert.equal(saved.amount.toFixed(2), '2.50'); assert.equal(saved.userId, user.id);
      }
    });
    await t.test('competing terminal updates have one winner and cannot overwrite its status', async () => {
      const { user } = await fixture(); signIn(user);
      const row = await createTransaction({ description: 'Race', amount: '3' });
      const results = await Promise.all(['completed', 'failed'].map((status) => updateStatus(null, statusForm(row.id, status))));
      assert.equal(results.filter((r) => r.success).length, 1);
      assert.equal(results.filter((r) => r.code === 'status_conflict').length, 1);
      assert.equal((await prisma.transaction.findUnique({ where: { id: row.id } })).status, results[0].success ? 'completed' : 'failed');
    });
    await t.test('status action rejects forged input, stale sessions, insufficient roles and restricted billing', async () => {
      const { user } = await fixture(); signIn(user);
      const row = await createTransaction({ description: 'Protected', amount: '4' });
      for (const extra of [{ tenantId: crypto.randomUUID() }, { amount: '9' }, { userId: user.id }]) {
        assert.equal((await updateStatus(null, statusForm(row.id, 'completed', extra))).code, 'invalid_input');
      }
      const duplicate = statusForm(row.id); duplicate.append('status', 'failed');
      assert.equal((await updateStatus(null, duplicate)).code, 'invalid_input');
      harness.setSession(null);
      assert.equal((await updateStatus(null, statusForm(row.id))).code, 'access_denied');
      signIn(user);
      for (const changes of [{ isActive: false }, { emailVerifiedAt: null }, { sessionVersion: 1 }, ...['Member', 'Developer'].map((role) => ({ roleId: roles[role].id }))]) {
        await prisma.user.update({ where: { id: user.id }, data: changes });
        assert.equal((await updateStatus(null, statusForm(row.id))).code, 'access_denied');
        await prisma.user.update({ where: { id: user.id }, data: { isActive: true, emailVerifiedAt: new Date(), sessionVersion: 0, roleId: roles.SuperAdmin.id } });
      }
      for (const subscriptionStatus of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'unknown']) {
        await prisma.tenant.update({ where: { id: user.tenantId }, data: { subscriptionStatus } });
        assert.equal((await updateStatus(null, statusForm(row.id))).code, 'subscription_restricted');
        assert.ok(await getTransactionDetail(row.id));
      }
      assert.equal((await prisma.transaction.findUnique({ where: { id: row.id } })).status, 'pending');
    });
    await t.test('status updates recheck membership and billing after waiting for the lock', async () => {
      for (const change of ['billing', 'demoted', 'inactive', 'password-reset']) {
        const { user } = await fixture(); signIn(user);
        const row = await createTransaction({ description: 'Waiting', amount: '5' });
        const blocker = await pool.connect(); let pending;
        try {
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [user.tenantId]);
          let reached; const waiting = new Promise((resolve) => { reached = resolve; });
          onTenantLock = reached;
          pending = updateStatus(null, statusForm(row.id));
          await Promise.race([waiting, pending.then(() => { throw new Error('Did not reach lock'); })]);
          if (change === 'billing') await blocker.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['paused', user.tenantId]);
          else await prisma.user.update({ where: { id: user.id }, data: change === 'demoted' ? { roleId: roles.Member.id } : change === 'inactive' ? { isActive: false } : { sessionVersion: 1 } });
          await blocker.query('COMMIT');
          assert.equal((await pending).code, change === 'billing' ? 'subscription_restricted' : 'access_denied');
          assert.equal((await prisma.transaction.findUnique({ where: { id: row.id } })).status, 'pending');
        } finally {
          onTenantLock = undefined;
          await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending;
        }
      }
    });

    await t.test('database write failure rolls back and the action exposes no internal details', async () => {
      const { user } = await fixture(); signIn(user);
      await admin.query(`ALTER TABLE transactions ADD CONSTRAINT test_reject_creation CHECK (description <> 'force-test-failure')`);
      try {
        const result = await createTransactionAction(null, form({ description: 'force-test-failure' }));
        assert.equal(result.code, 'unavailable');
        assert.ok(!result.error.includes('test_reject_creation'));
        assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 0);
      } finally { await admin.query('ALTER TABLE transactions DROP CONSTRAINT test_reject_creation'); }
      // The failed transaction released its lock, allowing a later valid creation.
      assert.deepEqual(Object.keys(await createTransaction({ description: 'Retry', amount: '0.01' })), ['id']);
    });
  } finally {
    harness?.restore();
    await prisma.$disconnect(); await pool.end();
    await admin.query('ROLLBACK');
    // Only the validated, randomly generated schema owned by this test is removed.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
