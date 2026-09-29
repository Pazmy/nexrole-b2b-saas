const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client, Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

test('billing persistence and required audit in a disposable migrated PostgreSQL schema', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const { writeRequiredAudit } = await import('../packages/database/dist/audit.js');
  const schema = 'billing_foundation_test_' + randomBytes(10).toString('hex');
  assert.match(schema, /^billing_foundation_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 }); await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const tenant = randomUUID(), other = randomUUID(), user = randomUUID(), role = randomUUID(), legacyAudit = randomUUID();
  const actor = { kind: 'user', id: user, tenantId: tenant };
  const event = (extra = {}) => ({ tenantId: tenant, actor, action: 'MEMBER_DEACTIVATED', details: { targetId: user, previousActive: true, active: false }, ...extra });
  const operation = (extra = {}) => ({ tenantId: tenant, actorId: user, kind: 'checkout_create', idempotencyKey: randomUUID(), parameterFingerprint: 'a'.repeat(64), ...extra });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}"`);
    const migrations = 'packages/database/prisma/migrations';
    for (const directory of fs.readdirSync(migrations).sort()) {
      const file = path.join(migrations, directory, 'migration.sql'); if (!fs.existsSync(file)) continue;
      if (directory === '20260928000000_billing_audit_foundation') {
        await admin.query('INSERT INTO tenants (id,name,"subscriptionStatus","stripeCustomerId","updatedAt") VALUES ($1,$2,$3,$4,NOW()),($5,$6,$7,NULL,NOW())', [tenant, 'Keep paid tenant', 'active', 'cus_Legacy', other, 'Other tenant', 'free']);
        await admin.query('INSERT INTO roles (id,name,permissions,"updatedAt") VALUES ($1,$2,$3,NOW())', [role, 'SuperAdmin', '[]']);
        await admin.query('INSERT INTO users (id,email,"passwordHash","tenantId","roleId","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW())', [user, 'audit@example.test', 'unused', tenant, role]);
        await admin.query('INSERT INTO audit_logs (id,action,"tenantId",metadata) VALUES ($1,$2,$3,$4)', [legacyAudit, 'LEGACY_ACTION', tenant, '{"keep":true}']);
        await admin.query('INSERT INTO processed_stripe_events (id) VALUES ($1)', ['evt_Legacy']);
      }
      await admin.query(fs.readFileSync(file, 'utf8'));
    }
    await t.test('migration preserves legacy billing, actor-less audit and completed receipts', async () => {
      const row = await db.tenant.findUnique({ where: { id: tenant } });
      assert.equal(row.subscriptionStatus, 'active'); assert.equal(row.stripeCustomerId, 'cus_Legacy');
      assert.equal(row.stripeSubscriptionId, null); assert.equal(row.billingSyncStatus, 'unverified'); assert.equal(row.billingVersion, 0n);
      const audit = await db.auditLog.findUnique({ where: { id: legacyAudit } });
      assert.equal(audit.actorSource, 'legacy'); assert.equal(audit.actorId, null); assert.deepEqual(audit.metadata, { keep: true });
      const receipt = await db.processedStripeEvent.findUnique({ where: { id: 'evt_Legacy' } });
      assert.equal(receipt.disposition, 'processed'); assert.equal(receipt.processedAt.getTime(), receipt.createdAt.getTime());
      assert.equal(receipt.tenantId, null);
      // Existing handlers still insert receipts and legacy audit with their old shapes.
      assert.equal((await db.processedStripeEvent.create({ data: { id: 'evt_OldHandler' } })).disposition, 'processed');
    });
    await t.test('subscription identity is unique, nullable, and independent of existing status', async () => {
      await db.tenant.update({ where: { id: tenant }, data: { stripeSubscriptionId: 'sub_Canonical' } });
      await assert.rejects(() => db.tenant.update({ where: { id: other }, data: { stripeSubscriptionId: 'sub_Canonical' } }), { code: 'P2002' });
      assert.equal((await db.tenant.findUnique({ where: { id: other } })).subscriptionStatus, 'free');
    });
    await t.test('simultaneous checkout reservations have one winner; unknown/open remain blocking', async () => {
      const results = await Promise.allSettled([db.externalOperation.create({ data: operation() }), db.externalOperation.create({ data: operation() })]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const winner = results.find((result) => result.status === 'fulfilled').value;
      for (const state of ['unknown', 'open']) {
        await db.externalOperation.update({ where: { id: winner.id }, data: { state } });
        await assert.rejects(() => db.externalOperation.create({ data: operation() }), { code: 'P2002' });
      }
      const otherTenant = await db.externalOperation.create({ data: operation({ tenantId: other, actorId: null }) });
      const customer = await db.externalOperation.create({ data: operation({ kind: 'customer_create' }) });
      assert.ok(otherTenant.id); assert.ok(customer.id);
      await db.externalOperation.update({ where: { id: winner.id }, data: { state: 'expired', resolvedAt: new Date() } });
      assert.ok((await db.externalOperation.create({ data: operation() })).id);
    });
    await t.test('operation keys and invitation generations are unique; malformed states fail', async () => {
      const id = randomUUID(), generation = randomUUID();
      const data = operation({ kind: 'invitation_delivery', invitationId: id, invitationGeneration: generation });
      await db.externalOperation.create({ data });
      await assert.rejects(() => db.externalOperation.create({ data: { ...data, idempotencyKey: randomUUID() } }), { code: 'P2002' });
      await assert.rejects(() => db.externalOperation.create({ data: operation({ kind: 'portal_create', idempotencyKey: data.idempotencyKey }) }), { code: 'P2002' });
      for (const extra of [{ kind: 'invalid' }, { state: 'failed' }, { parameterFingerprint: 'raw-secret' }, { outcomeCode: 'provider body with secret' }, { kind: 'invitation_delivery' }]) {
        await assert.rejects(() => db.externalOperation.create({ data: operation({ kind: 'portal_create', ...extra }) }));
      }
    });
    await t.test('fencing version prevents an old lease owner from committing after replacement', async () => {
      const first = randomUUID(), next = randomUUID();
      await db.tenant.update({ where: { id: tenant }, data: { billingLeaseOwner: first, billingLeaseExpiresAt: new Date(0), billingVersion: { increment: 1 } } });
      await db.tenant.update({ where: { id: tenant }, data: { billingLeaseOwner: next, billingLeaseExpiresAt: new Date(Date.now() + 60000), billingVersion: { increment: 1 } } });
      const stale = await db.tenant.updateMany({ where: { id: tenant, billingLeaseOwner: first, billingVersion: 1n }, data: { subscriptionStatus: 'canceled' } });
      assert.equal(stale.count, 0);
      await assert.rejects(() => db.tenant.update({ where: { id: tenant }, data: { billingVersion: -1n } }));
      assert.equal((await db.tenant.findUnique({ where: { id: tenant } })).subscriptionStatus, 'active');
    });
    await t.test('self-deactivation audit captures actor despite the new inactive state', async () => {
      const result = await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user }, data: { isActive: false, sessionVersion: { increment: 1 } } });
        return writeRequiredAudit(tx, event());
      });
      const row = await db.auditLog.findUnique({ where: { id: result.id } });
      assert.equal(row.actorId, user); assert.equal(row.actorSource, 'user'); assert.equal(row.actorEmail, 'audit@example.test');
      assert.equal(row.tenantId, tenant); assert.ok(row.createdAt); assert.deepEqual(row.metadata, event().details);
    });
    await t.test('wrong tenant actors, forbidden secrets and arbitrary fields roll back the business mutation', async () => {
      for (const extra of [{ actor: { ...actor, tenantId: other } }, { tenantId: other, actor: { ...actor, tenantId: other } },
        { details: { ...event().details, token: 'sensitive-value' } }, { action: 'UNSUPPORTED' },
        { actor: { kind: 'stripe', eventId: 'evt_Test', id: user } }, { password: 'sensitive-value' }]) {
        await assert.rejects(() => db.$transaction(async (tx) => {
          await tx.tenant.update({ where: { id: tenant }, data: { name: 'Should roll back' } });
          await writeRequiredAudit(tx, event(extra));
        }), { message: 'Required audit could not be recorded.' });
        assert.equal((await db.tenant.findUnique({ where: { id: tenant } })).name, 'Keep paid tenant');
      }
    });
    await t.test('real audit insert failure rolls back session and data updates without leaking DB details', async () => {
      await admin.query(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database diagnostic'; END; $$`);
      await admin.query('CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit()');
      const before = await db.user.findUnique({ where: { id: user } });
      try {
        await assert.rejects(() => db.$transaction(async (tx) => {
          await tx.user.update({ where: { id: user }, data: { sessionVersion: { increment: 1 }, isActive: true } });
          await writeRequiredAudit(tx, event());
        }), { message: 'Required audit could not be recorded.' });
        const after = await db.user.findUnique({ where: { id: user } }); assert.equal(after.sessionVersion, before.sessionVersion); assert.equal(after.isActive, before.isActive);
      } finally { await admin.query('DROP TRIGGER reject_audit ON audit_logs'); await admin.query('DROP FUNCTION reject_audit()'); }
    });
    await t.test('operation phase retries deduplicate concurrently and reject conflicting audit content', async () => {
      const op = await db.externalOperation.create({ data: operation({ kind: 'portal_create' }) });
      const input = { tenantId: tenant, actor, action: 'BILLING_OPERATION', details: { kind: 'portal_create', outcome: 'requested' }, operation: { id: op.id, phase: 'requested' } };
      const results = await Promise.all([db.$transaction((tx) => writeRequiredAudit(tx, input)), db.$transaction((tx) => writeRequiredAudit(tx, input))]);
      assert.equal(results[0].id, results[1].id); assert.equal(await db.auditLog.count({ where: { operationId: op.id } }), 1);
      await assert.rejects(() => db.$transaction((tx) => writeRequiredAudit(tx, { ...input, details: { ...input.details, outcome: 'failed' } })), /Required audit/);
      await assert.rejects(() => db.$transaction((tx) => writeRequiredAudit(tx, { ...input, tenantId: other, actor: { kind: 'reconciliation' } })), /Required audit/);
      await assert.rejects(() => db.auditLog.create({ data: { tenantId: other, action: 'BILLING_OPERATION', operationId: op.id, phase: 'forged' } }), { code: 'P2003' });
    });
    await t.test('system events have explicit attribution and pending receipts are distinct', async () => {
      const input = { tenantId: tenant, actor: { kind: 'stripe', eventId: 'evt_Current' }, action: 'BILLING_SUBSCRIPTION_CHANGED', details: { customerId: 'cus_Legacy', subscriptionId: 'sub_Canonical', previousStatus: 'active', status: 'past_due', cancelAtPeriodEnd: false } };
      const result = await db.$transaction((tx) => writeRequiredAudit(tx, input));
      const audit = await db.auditLog.findUnique({ where: { id: result.id } });
      assert.equal(audit.actorSource, 'stripe'); assert.equal(audit.actorId, null); assert.equal(audit.sourceEventId, 'evt_Current');
      const receipt = await db.processedStripeEvent.create({ data: { id: 'evt_Current', tenantId: tenant, eventType: 'invoice.payment_failed', livemode: false, disposition: 'pending' } });
      assert.equal(receipt.processedAt, null);
      await assert.rejects(() => db.processedStripeEvent.create({ data: { id: receipt.id } }), { code: 'P2002' });
    });
    await t.test('an external outcome that cannot be audited leaves a durable unresolved intent', async () => {
      const op = await db.externalOperation.create({ data: operation({ kind: 'portal_create', state: 'unknown' }) });
      await assert.rejects(() => db.$transaction(async (tx) => {
        await tx.externalOperation.update({ where: { id: op.id }, data: { state: 'succeeded', resolvedAt: new Date(), providerObjectId: 'bps_Test' } });
        await writeRequiredAudit(tx, { tenantId: tenant, actor, action: 'BILLING_OPERATION', details: { kind: 'portal_create', outcome: 'confirmed', url: 'secret-url' }, operation: { id: op.id, phase: 'confirmed' } });
      }), /Required audit/);
      assert.equal((await db.externalOperation.findUnique({ where: { id: op.id } })).state, 'unknown');
    });
    await t.test('tenant cascade removes its operations and linked audit without foreign-tenant damage', async () => {
      const op = await db.externalOperation.findFirstOrThrow({ where: { tenantId: other } });
      await db.$transaction((tx) => writeRequiredAudit(tx, { tenantId: other, actor: { kind: 'reconciliation' },
        action: 'BILLING_OPERATION', details: { kind: 'checkout_create', outcome: 'requested' }, operation: { id: op.id, phase: 'requested' } }));
      await db.tenant.delete({ where: { id: other } });
      assert.equal(await db.externalOperation.count({ where: { tenantId: other } }), 0);
      assert.equal(await db.auditLog.count({ where: { tenantId: other } }), 0);
      assert.ok(await db.tenant.findUnique({ where: { id: tenant } }));
    });
  } finally {
    await db.$disconnect(); await pool.end(); await admin.query('ROLLBACK');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
