const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('membership changes against PostgreSQL in an isolated disposable schema', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'membership_test_' + crypto.randomBytes(10).toString('hex');
  assert.match(schema, /^membership_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL or packages/database/.env DATABASE_URL');
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let harness;
  let onTenantLock;
  let onTenantLocked;
  // A notification at the real lock boundary makes race tests deterministic;
  // all database reads, locks, transactions, and writes still execute on PostgreSQL.
  const database = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') return (callback, options) => target.$transaction(async (tx) => callback(new Proxy(tx, {
        get(transaction, member) {
          if (member === '$queryRaw') return (strings, ...values) => {
            if (strings.join('').includes('FROM tenants')) {
              onTenantLock?.();
              return transaction.$queryRaw(strings, ...values).then((rows) => { onTenantLocked?.(); return rows; });
            }
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
    const { changeMemberRoleAction: changeRole, deactivateMemberAction: deactivate } = require('../apps/web/src/app/(dashboard)/settings/member-actions.ts');
    const { createTransactionAction } = require('../apps/web/src/app/(dashboard)/transactions/create-action.ts');
    const { requirePermission } = require('../apps/web/src/lib/authorization.ts');
    const roles = {};
    for (const name of ['SuperAdmin', 'Member', 'Developer', 'CustomAdmin']) roles[name] = await prisma.role.create({ data: { name, permissions: [] } });
    async function addUser(tenantId, role = 'SuperAdmin', extra = {}) {
      return prisma.user.create({ data: { email: crypto.randomUUID() + '@example.test', passwordHash: 'unused', tenantId, roleId: roles[role].id, emailVerifiedAt: new Date(), ...extra } });
    }
    async function fixture(status = 'free') {
      const tenant = await prisma.tenant.create({ data: { name: 'Membership test', subscriptionStatus: status } });
      return { tenant, user: await addUser(tenant.id) };
    }
    function signIn(user) { harness.setSession({ user: { id: user.id, tenantId: user.tenantId, sessionVersion: user.sessionVersion } }); }
    function form(id, extra = {}) { const value = new FormData(); for (const [key, item] of Object.entries({ id, ...extra })) value.set(key, item); return value; }
    async function saved(id) { return prisma.user.findUnique({ where: { id }, include: { role: true } }); }
    await t.test('role change invalidates old sessions; a fresh session sees the new role', async () => {
      const { user } = await fixture(); const member = await addUser(user.tenantId, 'Member'); signIn(user);
      await prisma.role.delete({ where: { id: roles.Developer.id } });
      const result = await changeRole(null, form(member.id, { role: 'Developer' }));
      assert.equal(result.success, true); assert.equal(result.selfChanged, false);
      const row = await saved(member.id); assert.equal(row.role.name, 'Developer'); assert.equal(row.sessionVersion, 1);
      roles.Developer = row.role;
      signIn(member); await assert.rejects(() => requirePermission('workspace:read'), /Access denied/);
      signIn(row); assert.equal((await requirePermission('workspace:read')).role, 'Developer');
      await assert.rejects(() => requirePermission('members:manage'), /Access denied/);
    });
    await t.test('deactivation preserves history and blocks old and fresh sessions', async () => {
      const { user } = await fixture(); const member = await addUser(user.tenantId, 'Member');
      const ledger = await prisma.transaction.create({ data: { description: 'Keep history', amount: '1', tenantId: user.tenantId, userId: member.id } });
      signIn(user); assert.equal((await deactivate(null, form(member.id))).success, true);
      const row = await saved(member.id); assert.equal(row.isActive, false); assert.equal(row.sessionVersion, 1);
      assert.ok(await prisma.transaction.findUnique({ where: { id: ledger.id } }));
      for (const session of [member, row]) { signIn(session); await assert.rejects(() => requirePermission('workspace:read'), /Access denied/); }
    });
    await t.test('only another active verified admin in the same tenant permits self changes', async () => {
      for (const operation of ['role', 'deactivate']) {
        const { user } = await fixture(); await fixture();
        await addUser(user.tenantId, 'SuperAdmin', { isActive: false });
        await addUser(user.tenantId, 'SuperAdmin', { emailVerifiedAt: null }); signIn(user);
        const submit = () => operation === 'role' ? changeRole(null, form(user.id, { role: 'Member' })) : deactivate(null, form(user.id));
        assert.equal((await submit()).code, 'last_admin'); assert.equal((await saved(user.id)).sessionVersion, 0);
        await addUser(user.tenantId); const result = await submit();
        assert.equal(result.success, true); assert.equal(result.selfChanged, true);
        await assert.rejects(() => requirePermission('workspace:read'), /Access denied/);
      }
    });
    await t.test('competing self and cross-admin mutations cannot remove both admins', async () => {
      for (const self of [false, true]) {
        const { user } = await fixture(); const second = await addUser(user.tenantId);
        signIn(user); const first = deactivate(null, form(self ? user.id : second.id));
        signIn(second); const next = changeRole(null, form(self ? second.id : user.id, { role: 'Member' }));
        const results = await Promise.all([first, next]);
        assert.equal(results.filter((r) => r.success).length, 1);
        assert.ok(results.some((r) => ['last_admin', 'access_denied'].includes(r.code)));
        assert.equal(await prisma.user.count({ where: { tenantId: user.tenantId, isActive: true, emailVerifiedAt: { not: null }, role: { name: 'SuperAdmin' } } }), 1);
      }
    });
    await t.test('foreign and missing IDs look identical; forged and repeated fields cannot write', async () => {
      const { user } = await fixture(); const foreign = await fixture(); signIn(user);
      for (const id of [crypto.randomUUID(), foreign.user.id]) {
        assert.equal((await deactivate(null, form(id))).code, 'not_found');
        assert.equal((await changeRole(null, form(id, { role: 'Member' }))).code, 'not_found');
      }
      for (const extra of [{ tenantId: foreign.tenant.id }, { actorId: foreign.user.id }, { isActive: 'true' }, { role: 'Owner' }]) assert.equal((await changeRole(null, form(user.id, { role: 'Member', ...extra }))).code, 'invalid_input');
      assert.equal((await deactivate(null, form('bad-id'))).code, 'invalid_input');
      assert.equal((await deactivate(null, form(user.id, { role: 'Member' }))).code, 'invalid_input');
      const duplicate = form(user.id); duplicate.append('id', foreign.user.id);
      assert.equal((await deactivate(null, duplicate)).code, 'invalid_input');
      assert.equal((await saved(foreign.user.id)).sessionVersion, 0);
    });
    await t.test('anonymous, stale, inactive, unverified and insufficient-role actors are denied', async () => {
      const { user } = await fixture(); const target = await addUser(user.tenantId, 'Member');
      harness.setSession(null); assert.equal((await deactivate(null, form(target.id))).code, 'access_denied');
      for (const changes of [{ isActive: false }, { emailVerifiedAt: null }, { sessionVersion: 1 }, ...['Member', 'Developer', 'CustomAdmin'].map((role) => ({ roleId: roles[role].id }))]) {
        await prisma.user.update({ where: { id: user.id }, data: changes }); signIn(user);
        assert.equal((await deactivate(null, form(target.id))).code, 'access_denied');
        assert.equal((await changeRole(null, form(target.id, { role: 'Developer' }))).code, 'access_denied');
        await prisma.user.update({ where: { id: user.id }, data: { isActive: true, emailVerifiedAt: new Date(), sessionVersion: 0, roleId: roles.SuperAdmin.id } });
      }
      assert.equal((await saved(target.id)).sessionVersion, 0);
    });
    await t.test('inactive/no-op changes do not write; restricted billing does not block management', async () => {
      const { user } = await fixture('paused'); const target = await addUser(user.tenantId, 'Member'); signIn(user);
      assert.equal((await changeRole(null, form(target.id, { role: 'Member' }))).code, 'unchanged_role');
      assert.equal((await deactivate(null, form(target.id))).success, true);
      assert.equal((await deactivate(null, form(target.id))).code, 'inactive_member');
      assert.equal((await changeRole(null, form(target.id, { role: 'Developer' }))).code, 'inactive_member');
      assert.equal((await saved(target.id)).sessionVersion, 1);
    });
    await t.test('membership mutations recheck the actor after waiting on the tenant lock', async () => {
      for (const change of ['demoted', 'inactive', 'session', 'moved']) {
        const { user } = await fixture(); const target = await addUser(user.tenantId, 'Member'); signIn(user);
        const blocker = await pool.connect(); let pending;
        try {
          await blocker.query('BEGIN'); await blocker.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [user.tenantId]);
          let reached; const waiting = new Promise((resolve) => { reached = resolve; }); onTenantLock = reached;
          pending = deactivate(null, form(target.id));
          await Promise.race([waiting, pending.then(() => { throw new Error('Did not reach tenant lock'); })]);
          await prisma.user.update({ where: { id: user.id }, data: change === 'demoted' ? { roleId: roles.Member.id } : change === 'inactive' ? { isActive: false } : change === 'session' ? { sessionVersion: 1 } : { tenantId: (await fixture()).tenant.id } });
          await blocker.query('COMMIT'); assert.equal((await pending).code, 'access_denied');
          assert.equal((await saved(target.id)).isActive, true);
        } finally { onTenantLock = undefined; await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending; }
      }
    });
    await t.test('queued transaction creation is denied after membership deactivation', async () => {
      const { user } = await fixture(); const target = await addUser(user.tenantId);
      const blocker = await pool.connect(); let mutation; let write;
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [target.id]);
        let reached; let waiting = new Promise((resolve) => { reached = resolve; }); onTenantLocked = reached;
        signIn(user); mutation = deactivate(null, form(target.id)); await waiting;
        onTenantLocked = undefined;
        waiting = new Promise((resolve) => { reached = resolve; }); onTenantLock = reached;
        signIn(target); const data = new FormData(); data.set('description', 'Old tab'); data.set('amount', '1');
        write = createTransactionAction(null, data); await waiting;
        await blocker.query('COMMIT');
        assert.equal((await mutation).success, true); assert.equal((await write).code, 'access_denied');
        assert.equal(await prisma.transaction.count({ where: { tenantId: user.tenantId } }), 0);
      } finally { onTenantLock = undefined; onTenantLocked = undefined; await blocker.query('ROLLBACK'); blocker.release(); if (mutation) await mutation; if (write) await write; }
    });
    await t.test('database errors roll back membership and session changes without leaking details', async () => {
      const { user } = await fixture(); const target = await addUser(user.tenantId, 'Member'); signIn(user);
      await admin.query('ALTER TABLE users ADD CONSTRAINT test_membership_failure CHECK ("sessionVersion" < 1) NOT VALID');
      try {
        const result = await deactivate(null, form(target.id)); assert.equal(result.code, 'unavailable');
        assert.ok(!result.error.includes('test_membership_failure'));
        const row = await saved(target.id); assert.equal(row.isActive, true); assert.equal(row.sessionVersion, 0);
      } finally { await admin.query('ALTER TABLE users DROP CONSTRAINT test_membership_failure'); }
      assert.equal((await deactivate(null, form(target.id))).success, true);
    });
  } finally {
    harness?.restore(); await prisma.$disconnect(); await pool.end(); await admin.query('ROLLBACK');
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); await admin.end();
  }
});
