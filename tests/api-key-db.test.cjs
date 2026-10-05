const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Client, Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('real HTTP API-key isolation and revocation against migrated PostgreSQL', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'api_key_test_' + randomBytes(10).toString('hex');
  assert.match(schema, /^api_key_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL or packages/database/.env DATABASE_URL');
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const originalLoad = Module._load, originalTs = require.extensions['.ts'];
  let harness, server, baseUrl, roles, generateApiKey, revokeApiKey;
  const login = actor => harness.setSession({ user: { id: actor.id, tenantId: actor.tenantId, sessionVersion: actor.sessionVersion } });
  const digest = raw => createHash('sha256').update(raw).digest('hex');
  async function fixture(withTransaction = true) {
    const tenant = await db.tenant.create({ data: { name: 'API acceptance ' + randomUUID() } });
    const actor = await db.user.create({ data: { tenantId: tenant.id, roleId: roles.SuperAdmin.id,
      email: randomUUID() + '@example.test', passwordHash: 'unused', emailVerifiedAt: new Date() } });
    const transaction = withTransaction ? await db.transaction.create({ data: { tenantId: tenant.id, userId: actor.id,
      description: 'Private ' + tenant.id, amount: '12.34', status: 'pending' } }) : null;
    login(actor);
    const raw = await generateApiKey('Acceptance key');
    const key = await db.apiKey.findUniqueOrThrow({ where: { key: digest(raw) } });
    return { tenant, actor, transaction, raw, key };
  }
  async function request(raw, route = '/api/v1/transactions', extraHeaders = {}) {
    return fetch(baseUrl + route, { headers: { ...(raw === undefined ? {} : { 'X-API-Key': raw }), ...extraHeaders } });
  }
  async function assertOwn(response, fixture) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object, 'list');
    assert.equal(body.count, 1);
    assert.deepEqual(body.data.map(row => row.id), [fixture.transaction.id]);
    assert.equal(body.data[0].description, fixture.transaction.description);
    assert.deepEqual(Object.keys(body.data[0]).sort(), ['amount', 'createdAt', 'description', 'id', 'status']);
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const directory of fs.readdirSync('packages/database/prisma/migrations').sort()) {
      const file = path.join('packages/database/prisma/migrations', directory, 'migration.sql');
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, 'utf8'));
    }
    roles = {};
    for (const name of ['SuperAdmin', 'Member', 'Developer']) roles[name] = await db.role.create({ data: { name, permissions: [] } });
    // Real actions/guards/Prisma/audit. Only framework session/cache, config and logging are replaced.
    harness = require('./account-harness.cjs')(db);
    const harnessLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request.endsWith('/lib/env.js')) return { env: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:3000', STRIPE_SECRET_KEY: 'disabled', STRIPE_WEBHOOK_SECRET: 'disabled' } };
      if (request.endsWith('/loggerMiddleware.js')) return { loggerMiddleware: (_req, _res, next) => next(), getContextLogger: () => ({ info() {}, warn() {}, error() {} }) };
      if (request.startsWith('.') && request.endsWith('.js') && parent) {
        const source = path.resolve(path.dirname(parent.filename), request.replace(/\.js$/, '.ts'));
        if (fs.existsSync(source)) request = source;
      }
      return harnessLoad.call(this, request, parent, isMain);
    };
    ({ generateApiKey, revokeApiKey } = require('../apps/web/src/app/(dashboard)/settings/developer-action.ts'));
    const { app } = require('../apps/api/app.ts');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('generated credential works over HTTP but its stored hash does not', async () => {
      const f = await fixture();
      assert.equal(f.key.tenantId, f.tenant.id);
      assert.equal(f.key.key, digest(f.raw));
      assert.notEqual(f.key.key, f.raw);
      await assertOwn(await request(f.raw), f);
      assert.equal((await request(f.key.key)).status, 403);
      const audit = await db.auditLog.findMany({ where: { tenantId: f.tenant.id, action: 'DEVELOPER_API_KEY_GENERATED' } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actorId, f.actor.id);
      assert.deepEqual(audit[0].metadata, { targetId: f.key.id, name: 'Acceptance key' });
      assert.ok(!JSON.stringify(audit).includes(f.raw));
      assert.ok(!JSON.stringify(audit).includes(f.key.key));
    });

    await t.test('simultaneous requests and forged tenant headers/query cannot cross workspace scope', async () => {
      const a = await fixture(), b = await fixture();
      await Promise.all(Array.from({ length: 8 }, async (_, i) => {
        const own = i % 2 ? a : b, foreign = i % 2 ? b : a;
        const response = await request(own.raw, `/api/v1/transactions?tenantId=${foreign.tenant.id}&userId=${foreign.actor.id}`, {
          'X-Tenant-Id': foreign.tenant.id, 'X-User-Id': foreign.actor.id,
        });
        await assertOwn(response, own);
      }));
      const empty = await fixture(false);
      const response = await request(empty.raw);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { object: 'list', count: 0, data: [] });
    });

    await t.test('missing or invalid credentials expose no records and legacy/detail/write routes remain absent', async () => {
      const f = await fixture();
      assert.equal((await request()).status, 401);
      assert.equal((await request('')).status, 401);
      const invalid = await request('unrecognized-key');
      assert.equal(invalid.status, 403);
      assert.deepEqual(Object.keys(await invalid.json()), ['error']);
      for (const route of ['/api/users', '/api/transactions', `/api/v1/transactions/${f.transaction.id}`]) {
        assert.equal((await request(f.raw, route)).status, 404);
      }
      assert.equal((await fetch(baseUrl + '/api/v1/transactions', { method: 'POST', headers: { 'X-API-Key': f.raw } })).status, 404);
    });

    await t.test('another administrator cannot revoke a foreign workspace key', async () => {
      const a = await fixture(), b = await fixture();
      login(a.actor);
      await revokeApiKey(b.key.id);
      assert.ok(await db.apiKey.findUnique({ where: { id: b.key.id } }));
      assert.equal(await db.auditLog.count({ where: { action: 'DEVELOPER_API_KEY_REVOKED', tenantId: { in: [a.tenant.id, b.tenant.id] } } }), 0);
      await assertOwn(await request(b.raw), b);
    });

    await t.test('fresh role, active, verified, tenant and session checks protect key management', async () => {
      const f = await fixture(), foreign = await fixture();
      for (const patch of [
        { roleId: roles.Member.id }, { roleId: roles.Developer.id }, { isActive: false },
        { emailVerifiedAt: null }, { sessionVersion: 1 }, { tenantId: foreign.tenant.id },
      ]) {
        login(f.actor);
        await db.user.update({ where: { id: f.actor.id }, data: patch });
        await assert.rejects(generateApiKey('Denied key'), /Access denied/);
        await assert.rejects(revokeApiKey(f.key.id), /Access denied/);
        await db.user.update({ where: { id: f.actor.id }, data: { roleId: roles.SuperAdmin.id, isActive: true,
          emailVerifiedAt: f.actor.emailVerifiedAt, sessionVersion: 0, tenantId: f.tenant.id } });
      }
      harness.setSession(null);
      await assert.rejects(generateApiKey('Denied key'), /Access denied/);
      await assert.rejects(revokeApiKey(f.key.id), /Access denied/);
      assert.equal(await db.apiKey.count({ where: { tenantId: f.tenant.id } }), 1);
      assert.equal(await db.auditLog.count({ where: { tenantId: f.tenant.id } }), 1);
    });

    await t.test('committed action revocation rejects the next HTTP request and preserves other tenant keys', async () => {
      const a = await fixture(), b = await fixture();
      await assertOwn(await request(a.raw), a);
      login(a.actor);
      await revokeApiKey(a.key.id);
      assert.equal(await db.apiKey.findUnique({ where: { id: a.key.id } }), null);
      for (let i = 0; i < 2; i++) assert.equal((await request(a.raw)).status, 403);
      await assertOwn(await request(b.raw), b);
      await revokeApiKey(a.key.id);
      const audit = await db.auditLog.findMany({ where: { tenantId: a.tenant.id, action: 'DEVELOPER_API_KEY_REVOKED' } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actorId, a.actor.id);
      assert.equal(audit[0].actorSource, 'user');
      assert.deepEqual(audit[0].metadata, { targetId: a.key.id, name: 'Acceptance key' });
    });

    await t.test('tenant deletion cascades credentials and denies their next HTTP use', async () => {
      const f = await fixture(false);
      assert.equal((await request(f.raw)).status, 200);
      await db.tenant.delete({ where: { id: f.tenant.id } });
      assert.equal((await request(f.raw)).status, 403);
    });
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    harness?.restore(); Module._load = originalLoad;
    if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
    await db.$disconnect(); await pool.end();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
