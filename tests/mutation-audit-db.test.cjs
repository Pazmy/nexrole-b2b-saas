const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Client, Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('required mutation audits and invitation delivery recovery against PostgreSQL', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'mutation_audit_test_' + randomBytes(10).toString('hex');
  assert.match(schema, /^mutation_audit_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const admin = new Client({ connectionString }); await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let harness, onMail, onTenantLock, roles;
  const sent = [];
  const database = new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (fn, options) => target.$transaction(async (tx) => fn(new Proxy(tx, { get(transaction, member) {
      if (member === '$queryRaw') return (strings, ...values) => { if (strings.join('').includes('FROM tenants')) onTenantLock?.(); return transaction.$queryRaw(strings, ...values); };
      const value = transaction[member]; return typeof value === 'function' ? value.bind(transaction) : value;
    } })), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const login = (actor) => harness.setSession({ user: { id: actor.id, tenantId: actor.tenantId, sessionVersion: actor.sessionVersion } });
  async function user(tenantId, role = 'SuperAdmin') {
    return db.user.create({ data: { tenantId, roleId: roles[role].id, email: randomUUID() + '@example.test', passwordHash: 'unused', emailVerifiedAt: new Date() } });
  }
  async function fixture() {
    const tenant = await db.tenant.create({ data: { name: 'Audit workspace', subscriptionStatus: 'active' } });
    const actor = await user(tenant.id); login(actor); return { tenant, actor };
  }
  const audit = (f, action) => db.auditLog.findMany({ where: { tenantId: f.tenant.id, ...(action ? { action } : {}) }, orderBy: { createdAt: 'asc' } });
  const fail = (f, action = '*', phase = '*') => admin.query('INSERT INTO audit_failures VALUES ($1,$2,$3)', [f.tenant.id, action, phase]);
  const clear = (f) => admin.query('DELETE FROM audit_failures WHERE tenant = $1', [f.tenant.id]);
  const profileForm = (name) => { const form = new FormData(); form.set('companyName', name); return form; };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}"`);
    for (const directory of fs.readdirSync('packages/database/prisma/migrations').sort()) {
      const file = path.join('packages/database/prisma/migrations', directory, 'migration.sql');
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, 'utf8'));
    }
    await admin.query('CREATE TABLE audit_failures (tenant uuid, action text, phase text)');
    await admin.query(`CREATE FUNCTION fail_required_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM audit_failures f WHERE f.tenant = NEW."tenantId" AND (f.action = '*' OR f.action = NEW.action)
        AND (f.phase = '*' OR f.phase = NEW.phase)) THEN RAISE EXCEPTION 'private database diagnostic'; END IF; RETURN NEW; END $$`);
    await admin.query('CREATE TRIGGER required_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_required_audit()');
    roles = {}; for (const name of ['SuperAdmin', 'Member', 'Developer']) roles[name] = await db.role.create({ data: { name, permissions: [] } });
    process.env.EMAIL_MODE = 'preview'; process.env.NODE_ENV = 'test';
    harness = require('./account-harness.cjs')(database, async (email, purpose, token) => { sent.push({ email, purpose, token }); if (onMail) await onMail({ email, purpose, token }); });
    const { createTransaction } = require('../apps/web/src/lib/create-transaction.ts');
    const { updateTransactionStatus } = require('../apps/web/src/lib/update-transaction-status.ts');
    const { changeMemberRole, deactivateMember } = require('../apps/web/src/lib/manage-member.ts');
    const invites = require('../apps/web/src/lib/manage-invitation.ts');
    const accounts = require('../apps/web/src/lib/accounts.ts');
    const { generateApiKey, revokeApiKey } = require('../apps/web/src/app/(dashboard)/settings/developer-action.ts');
    const { updateTenantProfile } = require('../apps/web/src/app/(dashboard)/settings/update-tenant-profile-action.ts');
    const invite = () => invites.createInvitation({ email: randomUUID() + '@example.test', role: 'Member' });

    await t.test('transaction creation/status audit captures verified actor and approved fields exactly once', async () => {
      const f = await fixture(); const row = await createTransaction({ amount: '001.2', description: 'Never copied into audit' });
      await updateTransactionStatus({ id: row.id, status: 'completed' });
      await assert.rejects(updateTransactionStatus({ id: row.id, status: 'failed' }), (e) => e.code === 'status_conflict');
      const rows = await audit(f); assert.equal(rows.length, 2);
      assert.deepEqual(rows[0].metadata, { targetId: row.id, amount: '1.20', currency: 'USD', status: 'pending' });
      assert.deepEqual(rows[1].metadata, { targetId: row.id, previousStatus: 'pending', status: 'completed' });
      for (const record of rows) { assert.equal(record.actorId, f.actor.id); assert.equal(record.actorEmail, f.actor.email); assert.equal(record.actorSource, 'user'); }
    });

    await t.test('real audit insertion failures roll back transaction creation and status updates', async () => {
      const f = await fixture(); await fail(f);
      await assert.rejects(createTransaction({ amount: '1', description: 'Rollback' }), /Required audit/);
      assert.equal(await db.transaction.count({ where: { tenantId: f.tenant.id } }), 0); await clear(f);
      const row = await createTransaction({ amount: '1', description: 'Rollback' }); await fail(f);
      await assert.rejects(updateTransactionStatus({ id: row.id, status: 'completed' }), /Required audit/);
      assert.equal((await db.transaction.findUnique({ where: { id: row.id } })).status, 'pending');
      assert.equal((await audit(f)).length, 1); await clear(f);
      const results = await Promise.allSettled(['completed', 'failed'].map((status) => updateTransactionStatus({ id: row.id, status })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal((await audit(f, 'TRANSACTION_STATUS_CHANGED')).length, 1);
    });

    await t.test('member audit failures roll back role/active/session changes; self-deactivation still records its actor', async () => {
      const f = await fixture(); await user(f.tenant.id); await fail(f);
      await assert.rejects(changeMemberRole({ id: f.actor.id, role: 'Developer' }), /Required audit/);
      await assert.rejects(deactivateMember({ id: f.actor.id }), /Required audit/);
      let row = await db.user.findUnique({ where: { id: f.actor.id } }); assert.equal(row.sessionVersion, 0); assert.equal(row.isActive, true); assert.equal(row.roleId, roles.SuperAdmin.id);
      await clear(f); await deactivateMember({ id: f.actor.id }); row = await db.user.findUnique({ where: { id: f.actor.id } });
      assert.equal(row.isActive, false); assert.equal(row.sessionVersion, 1);
      const [record] = await audit(f); assert.equal(record.actorId, f.actor.id); assert.equal(record.actorEmail, f.actor.email);
      assert.deepEqual(record.metadata, { targetId: f.actor.id, previousActive: true, active: false });
      const other = await fixture(); await user(other.tenant.id); await changeMemberRole({ id: other.actor.id, role: 'Member' });
      assert.deepEqual((await audit(other))[0].metadata, { targetId: other.actor.id, previousRole: 'SuperAdmin', role: 'Member' });
    });

    await t.test('profile changes and no-op retries share one atomic audit with their before/after names', async () => {
      const f = await fixture(); await fail(f);
      const failed = await updateTenantProfile(null, profileForm('New company')); assert.ok(failed.error); assert.ok(!failed.error.includes('private'));
      assert.equal((await db.tenant.findUnique({ where: { id: f.tenant.id } })).name, 'Audit workspace'); await clear(f);
      assert.ok((await updateTenantProfile(null, profileForm('New company'))).success);
      assert.ok((await updateTenantProfile(null, profileForm('New company'))).success);
      const [row] = await audit(f); assert.deepEqual(row.metadata, { previousName: 'Audit workspace', name: 'New company' }); assert.equal((await audit(f)).length, 1);
      await db.tenant.update({ where: { id: f.tenant.id }, data: { name: 'x'.repeat(300) } });
      assert.ok((await updateTenantProfile(null, profileForm('Repaired legacy name'))).success);
      assert.equal((await audit(f)).at(-1).metadata.previousName.length, 256);
    });

    await t.test('API key audit never stores credentials; creation/revocation roll back when audit fails', async () => {
      const f = await fixture(); await fail(f);
      await assert.rejects(generateApiKey('Integration'), /Required audit/); assert.equal(await db.apiKey.count({ where: { tenantId: f.tenant.id } }), 0);
      await clear(f); const raw = await generateApiKey('Integration'); const hash = createHash('sha256').update(raw).digest('hex');
      const key = await db.apiKey.findFirstOrThrow({ where: { tenantId: f.tenant.id } }); assert.equal(key.key, hash);
      await fail(f); await assert.rejects(revokeApiKey(key.id), /Required audit/); assert.ok(await db.apiKey.findUnique({ where: { id: key.id } }));
      await clear(f); await revokeApiKey(key.id); await revokeApiKey(key.id);
      const rows = await audit(f); assert.equal(rows.length, 2);
      for (const row of rows) assert.deepEqual(row.metadata, { targetId: key.id, name: 'Integration' });
      const serialized = JSON.stringify(rows); assert.ok(!serialized.includes(raw)); assert.ok(!serialized.includes(hash));
      const legacy = await db.apiKey.create({ data: { tenantId: f.tenant.id, name: 'x'.repeat(300), key: randomUUID() } });
      await revokeApiKey(legacy.id); assert.equal(await db.apiKey.findUnique({ where: { id: legacy.id } }), null);
      assert.equal((await audit(f)).at(-1).metadata.name.length, 256);
    });

    await t.test('profile/key mutations recheck authorization after waiting on the tenant lock', async () => {
      for (const kind of ['profile', 'key']) {
        const f = await fixture(), held = deferred(), release = deferred(), waiting = deferred();
        const lock = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${f.tenant.id}::uuid FOR UPDATE`;
          held.resolve(); await release.promise; await tx.user.update({ where: { id: f.actor.id }, data: { sessionVersion: 1 } });
        });
        await held.promise; onTenantLock = () => waiting.resolve();
        const result = kind === 'profile' ? updateTenantProfile(null, profileForm('Denied')) : assert.rejects(generateApiKey('Denied'), /Access denied/);
        await waiting.promise; release.resolve(); await lock; const value = await result; onTenantLock = null;
        if (kind === 'profile') assert.ok(value.error.includes('Access denied'));
        assert.equal((await audit(f)).length, 0); assert.equal(await db.apiKey.count({ where: { tenantId: f.tenant.id } }), 0);
      }
    });

    await t.test('invitation intent precedes email and activation; generation history excludes tokens and hashes', async () => {
      const f = await fixture();
      onMail = async ({ token }) => {
        const attempt = await db.externalOperation.findFirstOrThrow({ where: { tenantId: f.tenant.id, state: 'pending' } });
        assert.equal(attempt.kind, 'invitation_delivery'); assert.ok(attempt.invitationGeneration);
        assert.equal((await audit(f, 'INVITATION_DELIVERY')).at(-1).phase, 'requested');
        assert.equal((await db.invitation.findUnique({ where: { id: attempt.invitationId } })).expiresAt.getTime(), 0);
        await assert.rejects(accounts.acceptInvitation(token, 'InvitedPassword123!'), /invalid, expired/);
      };
      const result = await invite(); onMail = null; const first = sent.at(-1).token;
      await invites.resendInvitation({ id: result.id }); const second = sent.at(-1).token;
      const attempts = await db.externalOperation.findMany({ where: { tenantId: f.tenant.id }, include: { auditLogs: true } });
      assert.equal(attempts.length, 2); assert.equal(new Set(attempts.map((a) => a.invitationGeneration)).size, 2);
      for (const attempt of attempts) { assert.equal(attempt.state, 'succeeded'); assert.equal(attempt.auditLogs.length, 3); }
      const serialized = JSON.stringify(attempts);
      for (const token of [first, second]) { assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes(accounts.hashToken(token))); }
      assert.equal((await audit(f, 'MEMBER_INVITED')).length, 1); assert.equal((await audit(f, 'INVITATION_RESENT')).length, 1);
      await invites.revokeInvitation({ id: result.id }); assert.equal((await audit(f, 'INVITATION_REVOKED')).length, 1);
    });

    await t.test('failed intent audit prevents sending and rolls back resend invalidation', async () => {
      const f = await fixture(); const existing = await invite(); const token = sent.at(-1).token;
      const before = sent.length; await fail(f);
      await assert.rejects(invite(), /Required audit/); await assert.rejects(invites.resendInvitation({ id: existing.id }), /Required audit/);
      assert.equal(sent.length, before); assert.equal((await db.invitation.findUnique({ where: { id: existing.id } })).token, accounts.hashToken(token));
      assert.equal(await db.externalOperation.count({ where: { tenantId: f.tenant.id } }), 1); await clear(f);
      await accounts.acceptInvitation(token, 'InvitedPassword123!');
    });

    await t.test('provider timeout records an unknown outcome without any usable new link', async () => {
      const f = await fixture(); onMail = async () => { throw new Error('private provider response'); };
      await assert.rejects(invite(), (e) => e.code === 'delivery_failed'); onMail = null;
      assert.equal(await db.invitation.count({ where: { tenantId: f.tenant.id } }), 0);
      const op = await db.externalOperation.findFirstOrThrow({ where: { tenantId: f.tenant.id } }); assert.equal(op.state, 'unknown'); assert.equal(op.resolvedAt, null);
      const rows = await audit(f); assert.equal(rows.length, 2); assert.equal(rows[1].actorSource, 'email_delivery'); assert.equal(rows[1].metadata.outcome, 'unconfirmed');
      assert.equal((await audit(f, 'MEMBER_INVITED')).length, 0);
      await assert.rejects(accounts.acceptInvitation(sent.at(-1).token, 'InvitedPassword123!'), /invalid, expired/);
    });

    await t.test('failure after email delivery never commits activation without both required audit records', async () => {
      for (const [action, phase] of [['MEMBER_INVITED', '*'], ['INVITATION_DELIVERY', 'confirmed'], ['*', '*']]) {
        const f = await fixture(); onMail = async () => fail(f, action, phase);
        await assert.rejects(invite(), (e) => e.code === 'activation_unconfirmed'); onMail = null;
        const old = sent.at(-1).token; const row = await db.invitation.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
        assert.equal(row.expiresAt.getTime(), 0); assert.equal((await audit(f, 'MEMBER_INVITED')).length, 0);
        const attempt = await db.externalOperation.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
        assert.equal(attempt.state, action === '*' ? 'pending' : 'succeeded');
        if (action !== '*') assert.equal(attempt.outcomeCode, 'delivered_inactive');
        await clear(f); await invites.resendInvitation({ id: row.id });
        await assert.rejects(accounts.acceptInvitation(old, 'InvitedPassword123!'), /invalid, expired/);
        await accounts.acceptInvitation(sent.at(-1).token, 'InvitedPassword123!');
      }
    });

    await t.test('acceptance audit failure restores invitation and removes the tentative user; retry records the new member', async () => {
      const f = await fixture(); const invitation = await invite(); const raw = sent.at(-1).token;
      await fail(f, 'INVITATION_ACCEPTED'); await assert.rejects(accounts.acceptInvitation(raw, 'InvitedPassword123!'), /Required audit/);
      assert.ok(await db.invitation.findUnique({ where: { id: invitation.id } })); assert.equal(await db.user.count({ where: { tenantId: f.tenant.id } }), 1);
      await clear(f); await accounts.acceptInvitation(raw, 'InvitedPassword123!');
      await assert.rejects(accounts.acceptInvitation(raw, 'InvitedPassword123!'), /invalid, expired/);
      const [row] = await audit(f, 'INVITATION_ACCEPTED'); assert.equal(row.actorId, row.metadata.memberId); assert.equal(row.metadata.targetId, invitation.id); assert.equal(row.metadata.role, 'Member');
      assert.equal((await audit(f, 'INVITATION_ACCEPTED')).length, 1); assert.ok(!JSON.stringify(row).includes('InvitedPassword123!'));
    });

    await t.test('revocation audit failure restores the invitation; foreign or denied mutations emit no successful audits', async () => {
      const f = await fixture(); const invitation = await invite(); await fail(f, 'INVITATION_REVOKED');
      await assert.rejects(invites.revokeInvitation({ id: invitation.id }), /Required audit/); assert.ok(await db.invitation.findUnique({ where: { id: invitation.id } }));
      await clear(f); const other = await fixture();
      await assert.rejects(invites.revokeInvitation({ id: invitation.id }), (e) => e.code === 'not_found');
      await assert.rejects(deactivateMember({ id: f.actor.id }), (e) => e.code === 'not_found');
      assert.equal((await audit(other)).length, 0); login(await user(other.tenant.id, 'Member'));
      await assert.rejects(generateApiKey('Denied'), /Access denied/); assert.equal((await audit(other)).length, 0);
    });

    await t.test('an older resend finishing late cannot activate or audit the new generation as its own', async () => {
      const f = await fixture(); const invitation = await invite(), entered = deferred(), release = deferred(); let first = true;
      onMail = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
      const old = invites.resendInvitation({ id: invitation.id }); const rejection = assert.rejects(old, (e) => e.code === 'changed');
      await entered.promise; await invites.resendInvitation({ id: invitation.id }); const newest = sent.at(-1).token; release.resolve(); await rejection; onMail = null;
      assert.equal((await db.invitation.findUnique({ where: { id: invitation.id } })).token, accounts.hashToken(newest));
      assert.equal((await audit(f, 'INVITATION_RESENT')).length, 1);
      assert.equal((await audit(f, 'INVITATION_DELIVERY')).filter((r) => r.metadata.outcome === 'delivered_inactive').length, 1);
    });

    await t.test('revoked sender cannot activate after delivery; provider outcome retains explicit system attribution', async () => {
      const f = await fixture();
      onMail = async () => { await db.user.update({ where: { id: f.actor.id }, data: { isActive: false, sessionVersion: 1 } }); };
      await assert.rejects(invite(), /Access denied/); onMail = null;
      assert.equal((await db.invitation.findFirstOrThrow({ where: { tenantId: f.tenant.id } })).expiresAt.getTime(), 0);
      const rows = await audit(f); assert.equal(rows[0].actorId, f.actor.id); assert.equal(rows[1].actorId, null); assert.equal(rows[1].actorSource, 'email_delivery');
      assert.equal((await audit(f, 'MEMBER_INVITED')).length, 0);
    });
  } finally {
    onMail = null; onTenantLock = null; harness?.restore();
    await db.$disconnect(); await pool.end(); await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
