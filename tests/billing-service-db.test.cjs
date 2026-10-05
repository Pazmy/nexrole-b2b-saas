const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client, Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
let providerNumber = 0;
function provider() {
  const providerId = ++providerNumber;
  const customers = new Map(), sessions = new Map(), subscriptions = [], keys = new Map(), calls = [];
  let customerNo = 0, checkoutNo = 0, portalNo = 0;
  const api = {
    customers, sessions, subscriptionsData: subscriptions, calls, keys,
    async customer(id) { calls.push(['customer', id]); return customers.get(id); },
    async findCustomers(tenant, operation) { calls.push(['findCustomers']); return [...customers.values()].filter((c) => c.tenantId === tenant && c.operationId === operation); },
    async createCustomer(tenantId, operationId, key) {
      calls.push(['createCustomer', key]);
      if (!keys.has(key)) { const c = { id: `cus_Test${providerId}N${++customerNo}`, livemode: false, tenantId, operationId }; keys.set(key, c); customers.set(c.id, c); }
      return keys.get(key);
    },
    async subscriptions(customerId) { calls.push(['subscriptions', customerId]); return subscriptions.filter((s) => s.customerId === customerId); },
    async checkouts(customerId) { calls.push(['checkouts', customerId]); return [...sessions.values()].filter((s) => s.customerId === customerId); },
    async checkout(id) { calls.push(['checkout', id]); return sessions.get(id); },
    async createCheckout(customerId, tenantId, operationId, key, config) {
      calls.push(['createCheckout', key]);
      if (!keys.has(key)) {
        const s = { id: `cs_Test${++checkoutNo}`, customerId, tenantId, operationId, mode: 'subscription', status: 'open',
          livemode: false, expiresAt: Math.floor(Date.now() / 1000) + 86400, priceIds: [config.priceId], quantity: 1,
          url: `https://checkout.stripe.com/c/pay/test${checkoutNo}` };
        keys.set(key, s); sessions.set(s.id, s);
      }
      return keys.get(key);
    },
    async createPortal(customerId, key) {
      calls.push(['createPortal', key, customerId]);
      if (!keys.has(key)) keys.set(key, { id: `bps_Test${++portalNo}`, url: `https://billing.stripe.com/p/session/test${portalNo}` });
      return keys.get(key);
    },
  };
  return api;
}

test('billing backend uses durable attempts and real PostgreSQL locks', { timeout: 120000 }, async (t) => {
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const { BillingService } = await import('../packages/database/dist/billing-service.js');
  const schema = 'billing_service_test_' + randomBytes(10).toString('hex');
  assert.match(schema, /^billing_service_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const admin = new Client({ connectionString }); await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const config = { priceId: 'price_Pro', baseUrl: 'https://app.example.test', livemode: false, accountScope: 'test-account' };
  const count = (p, name) => p.calls.filter(([n]) => n === name).length;
  const denied = (code) => (e) => e.code === code && !e.message.includes('private');
  let roles;
  async function user(tenantId, role = 'SuperAdmin') {
    return db.user.create({ data: { tenantId, roleId: roles[role].id, email: randomUUID() + '@example.test', passwordHash: 'unused', emailVerifiedAt: new Date() } });
  }
  let fixtureNumber = 0;
  async function fixture({ bound = true, status = 'free', subscription = null } = {}) {
    const p = provider();
    // Distinct provider identities across tenants also exercise unique customer bindings.
    const customerId = `cus_Bound${++fixtureNumber}`;
    const tenant = await db.tenant.create({ data: { name: 'Billing test', subscriptionStatus: status,
      stripeCustomerId: bound ? customerId : null, stripeSubscriptionId: subscription } });
    if (bound) p.customers.set(customerId, { id: customerId, livemode: false, tenantId: tenant.id });
    const actor = await user(tenant.id);
    const service = new BillingService(db, p, config);
    return { p, tenant, actor, service, start: (intent = 'checkout') => service.start(actor, intent) };
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}"`);
    for (const directory of fs.readdirSync('packages/database/prisma/migrations').sort()) {
      const file = path.join('packages/database/prisma/migrations', directory, 'migration.sql');
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, 'utf8'));
    }
    roles = {};
    for (const name of ['SuperAdmin', 'Member', 'Developer']) roles[name] = await db.role.create({ data: { name, permissions: [] } });

    await t.test('only fresh verified SuperAdmins in the same tenant may call Stripe', async () => {
      const f = await fixture();
      for (const role of ['Member', 'Developer']) await assert.rejects(f.service.start(await user(f.tenant.id, role), 'checkout'), denied('access_denied'));
      await assert.rejects(f.service.start({ ...f.actor, sessionVersion: 99 }, 'portal'), denied('access_denied'));
      const other = await fixture();
      await assert.rejects(f.service.start({ ...other.actor, tenantId: f.tenant.id }, 'portal'), denied('access_denied'));
      await db.user.update({ where: { id: f.actor.id }, data: { emailVerifiedAt: null } });
      await assert.rejects(f.start(), denied('access_denied'));
      assert.equal(f.p.calls.length, 0);
    });

    await t.test('creates a tenant customer once and resumes checkout without duplicate audit or bearer persistence', async () => {
      const f = await fixture({ bound: false });
      const url = await f.start(); assert.match(url, /^https:\/\/checkout.stripe.com\//);
      assert.equal(await f.start(), url);
      const another = await user(f.tenant.id);
      assert.equal(await f.service.start(another, 'checkout'), url);
      assert.equal(count(f.p, 'createCustomer'), 1); assert.equal(count(f.p, 'createCheckout'), 1);
      const rows = await db.externalOperation.findMany({ where: { tenantId: f.tenant.id }, include: { auditLogs: true } });
      assert.equal(rows.length, 2); assert.equal(rows.reduce((n, o) => n + o.auditLogs.length, 0), 4);
      assert.ok(!JSON.stringify(rows).includes('https://'));
      assert.ok((await db.tenant.findUnique({ where: { id: f.tenant.id } })).stripeCustomerId);
    });

    await t.test('concurrent administrators and double-clicks cannot create a second checkout', async () => {
      const f = await fixture(), entered = deferred(), release = deferred(), create = f.p.createCheckout;
      f.p.createCheckout = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
      const first = f.start(); await entered.promise;
      const other = await user(f.tenant.id);
      await assert.rejects(f.service.start(other, 'checkout'), denied('busy'));
      await assert.rejects(f.start(), denied('busy'));
      release.resolve(); await first;
      assert.equal(count(f.p, 'createCheckout'), 1);
      assert.equal(await db.externalOperation.count({ where: { tenantId: f.tenant.id, kind: 'checkout_create' } }), 1);
    });

    await t.test('concurrent new workspaces bind one customer; tenant lock waits recheck membership', async () => {
      const f = await fixture({ bound: false }), entered = deferred(), release = deferred(), create = f.p.createCustomer;
      f.p.createCustomer = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
      const running = f.start(); await entered.promise;
      await assert.rejects(f.service.start(await user(f.tenant.id), 'checkout'), denied('busy'));
      release.resolve(); await running; assert.equal(count(f.p, 'createCustomer'), 1);

      const other = await fixture(), held = deferred(), unlock = deferred(), waiting = deferred();
      const lock = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${other.tenant.id}::uuid FOR UPDATE`;
        held.resolve(); await unlock.promise;
        await tx.user.update({ where: { id: other.actor.id }, data: { roleId: roles.Member.id, sessionVersion: { increment: 1 } } });
      });
      await held.promise;
      const observed = new Proxy(db, { get(target, key) {
        if (key === '$transaction') return (fn, options) => target.$transaction(async (tx) => fn(new Proxy(tx, { get(transaction, member) {
          if (member === '$queryRaw') return (strings, ...values) => { if (strings.join('').includes('FROM tenants')) waiting.resolve(); return transaction.$queryRaw(strings, ...values); };
          const value = transaction[member]; return typeof value === 'function' ? value.bind(transaction) : value;
        } })), options);
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      const attempt = assert.rejects(new BillingService(observed, other.p, config).start(other.actor, 'checkout'), denied('access_denied'));
      await waiting.promise; unlock.resolve(); await lock; await attempt; assert.equal(other.p.calls.length, 0);
    });

    await t.test('old customer attempts recover only from their durable operation reference', async () => {
      const f = await fixture({ bound: false }), original = f.p.createCustomer;
      f.p.createCustomer = async (...args) => { await original(...args); throw new Error('private timeout'); };
      await assert.rejects(f.start(), denied('unavailable'));
      await db.externalOperation.updateMany({ where: { tenantId: f.tenant.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
      f.p.createCustomer = async () => { assert.fail('Old customer key must never be replayed'); };
      await f.start(); assert.equal(count(f.p, 'findCustomers'), 1); assert.equal(count(f.p, 'createCustomer'), 1);
      const other = await fixture({ bound: false }); other.p.createCustomer = async () => { throw new Error('private'); };
      await assert.rejects(other.start(), denied('unavailable'));
      await db.externalOperation.updateMany({ where: { tenantId: other.tenant.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
      await assert.rejects(other.start(), denied('reconcile'));
    });

    await t.test('customer timeout reuses the same key across different administrators', async () => {
      const f = await fixture({ bound: false }), original = f.p.createCustomer;
      // Avoid reusing a fake customer ID from the earlier fixture.
      f.p.createCustomer = async (...args) => { const c = await original(...args); f.p.customers.delete(c.id); c.id = 'cus_Recovered'; f.p.customers.set(c.id, c); throw new Error('private upstream secret'); };
      await assert.rejects(f.start(), denied('unavailable'));
      const attempt = await db.externalOperation.findFirst({ where: { tenantId: f.tenant.id } }); assert.equal(attempt.state, 'unknown');
      f.p.createCustomer = original;
      await f.service.start(await user(f.tenant.id), 'checkout');
      assert.equal(new Set(f.p.calls.filter(([name]) => name === 'createCustomer').map(([, key]) => key)).size, 1);
      assert.equal((await db.tenant.findUnique({ where: { id: f.tenant.id } })).stripeCustomerId, 'cus_Recovered');
    });

    await t.test('lost checkout response is recovered from the provider before any new create', async () => {
      const f = await fixture(), original = f.p.createCheckout;
      f.p.createCheckout = async (...args) => { await original(...args); throw new Error('private timeout'); };
      await assert.rejects(f.start(), denied('unavailable'));
      f.p.createCheckout = original;
      await f.start(); assert.equal(count(f.p, 'createCheckout'), 1);
      assert.equal((await db.externalOperation.findFirst({ where: { tenantId: f.tenant.id } })).state, 'open');
    });

    await t.test('old uncertain attempts are inspected but never blindly recreated after key retention', async () => {
      const f = await fixture(); f.p.createCheckout = async () => { throw new Error('private timeout'); };
      await assert.rejects(f.start(), denied('unavailable'));
      await db.externalOperation.updateMany({ where: { tenantId: f.tenant.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
      f.p.createCheckout = async () => { assert.fail('Must not recreate an old ambiguous checkout'); };
      await assert.rejects(f.start(), denied('reconcile'));
      assert.ok(count(f.p, 'checkouts') >= 2);
    });

    await t.test('only provider-confirmed expiry releases the checkout slot', async () => {
      const f = await fixture(); const first = await f.start();
      const session = [...f.p.sessions.values()][0];
      session.expiresAt = Math.floor(Date.now() / 1000) - 1;
      await assert.rejects(f.start(), denied('reconcile')); assert.equal(count(f.p, 'createCheckout'), 1);
      session.status = 'expired';
      assert.notEqual(await f.start(), first); assert.equal(count(f.p, 'createCheckout'), 2);
      assert.equal(await db.externalOperation.count({ where: { tenantId: f.tenant.id, state: 'expired' } }), 1);
    });

    await t.test('completed checkout and unknown subscriptions block a second purchase', async () => {
      const f = await fixture(); await f.start(); [...f.p.sessions.values()][0].status = 'complete';
      await assert.rejects(f.start(), denied('reconcile')); assert.equal(count(f.p, 'createCheckout'), 1);
      const other = await fixture();
      other.p.subscriptionsData.push({ id: 'sub_Unmapped', customerId: other.tenant.stripeCustomerId, livemode: false, status: 'incomplete' });
      await assert.rejects(other.start(), denied('reconcile')); assert.equal(count(other.p, 'createCheckout'), 0);
      assert.match(await other.start('portal'), /^https:\/\/billing.stripe.com\//);
    });

    await t.test('all nonterminal canonical states go to portal; canceled subscriptions may checkout', async () => {
      for (const status of ['active', 'trialing', 'incomplete', 'past_due', 'unpaid', 'paused']) {
        const f = await fixture({ status, subscription: `sub_${status.replace('_', '')}` });
        f.p.subscriptionsData.push({ id: f.tenant.stripeSubscriptionId, customerId: f.tenant.stripeCustomerId, status, livemode: false });
        assert.match(await f.start(), /^https:\/\/billing.stripe.com\//); assert.equal(count(f.p, 'createCheckout'), 0);
      }
      const f = await fixture({ status: 'canceled', subscription: 'sub_Canceled' });
      f.p.subscriptionsData.push({ id: 'sub_Canceled', customerId: f.tenant.stripeCustomerId, status: 'canceled', livemode: false });
      await f.start(); assert.equal(count(f.p, 'createCheckout'), 1);
    });

    await t.test('legacy/multiple subscriptions never choose a customer or subscription by email', async () => {
      const missing = await fixture({ bound: false, status: 'active' });
      await assert.rejects(missing.start(), denied('reconcile')); assert.equal(missing.p.calls.length, 0);
      const legacy = await fixture({ status: 'active' });
      await assert.rejects(legacy.start(), denied('reconcile')); await legacy.start('portal');
      const f = await fixture({ subscription: 'sub_Multiple' });
      f.p.subscriptionsData.push(...['sub_Multiple', 'sub_Second'].map((id) => ({ id, customerId: f.tenant.stripeCustomerId, livemode: false, status: 'active' })));
      await assert.rejects(f.start(), denied('reconcile')); assert.equal(count(f.p, 'createCheckout'), 0);
    });

    await t.test('foreign metadata, mode, customer and changed price prevent checkout reuse', async () => {
      for (const mutate of [s => s.customerId = 'cus_Foreign', s => s.tenantId = randomUUID(), s => s.livemode = true, s => s.mode = 'payment', s => s.priceIds = ['price_Wrong'], s => s.quantity = 2, s => s.url = 'https://attacker.example/']) {
        const f = await fixture(); await f.start(); mutate([...f.p.sessions.values()][0]);
        await assert.rejects(f.start(), denied('reconcile')); assert.equal(count(f.p, 'createCheckout'), 1);
      }
      const f = await fixture(); await f.start();
      await assert.rejects(new BillingService(db, f.p, { ...config, priceId: 'price_Changed' }).start(f.actor, 'checkout'), denied('reconcile'));
      assert.equal(count(f.p, 'createCheckout'), 1);
    });

    await t.test('foreign or deleted customer bindings fail closed', async () => {
      for (const overrides of [{ tenantId: randomUUID() }, { livemode: true }, { deleted: true }]) {
        const f = await fixture(); Object.assign(f.p.customers.get(f.tenant.stripeCustomerId), overrides);
        await assert.rejects(f.start('portal'), denied('reconcile')); assert.equal(count(f.p, 'createPortal'), 0);
      }
    });

    await t.test('revocation during a provider request prevents redirect and leaves recoverable intent', async () => {
      const f = await fixture(), original = f.p.createCheckout;
      f.p.createCheckout = async (...args) => { const result = await original(...args); await db.user.update({ where: { id: f.actor.id }, data: { isActive: false, sessionVersion: { increment: 1 } } }); return result; };
      await assert.rejects(f.start(), denied('access_denied'));
      assert.equal((await db.externalOperation.findFirst({ where: { tenantId: f.tenant.id } })).state, 'pending');
      f.p.createCheckout = original;
      await f.service.start(await user(f.tenant.id), 'checkout'); assert.equal(count(f.p, 'createCheckout'), 1);
    });

    await t.test('replaced lease holders cannot persist a late provider response or clear the new lease', async () => {
      const f = await fixture(), original = f.p.createCheckout, replacement = randomUUID();
      f.p.createCheckout = async (...args) => {
        const result = await original(...args);
        await db.tenant.update({ where: { id: f.tenant.id }, data: { billingLeaseOwner: replacement, billingVersion: { increment: 1 }, billingLeaseExpiresAt: new Date(Date.now() + 60000) } });
        return result;
      };
      await assert.rejects(f.start(), denied('busy'));
      const tenant = await db.tenant.findUnique({ where: { id: f.tenant.id } }); assert.equal(tenant.billingLeaseOwner, replacement);
      assert.equal((await db.externalOperation.findFirst({ where: { tenantId: f.tenant.id } })).state, 'pending');
    });

    await t.test('required intent audit failure prevents external calls; outcome failure retains durable intent', async () => {
      // A trigger keyed by a fixture UUID affects all pooled connections deterministically.
      const f = await fixture();
      await admin.query(`CREATE OR REPLACE FUNCTION fail_billing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${f.tenant.id}'::uuid THEN RAISE EXCEPTION 'private audit diagnostic'; END IF; RETURN NEW; END $$`);
      await admin.query('CREATE TRIGGER billing_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_billing_audit()');
      try { await assert.rejects(f.start(), denied('unavailable')); assert.equal(count(f.p, 'createCheckout'), 0); assert.equal(await db.externalOperation.count({ where: { tenantId: f.tenant.id } }), 0); }
      finally { await admin.query('DROP TRIGGER billing_audit_failure ON audit_logs'); }
      const other = await fixture(), original = other.p.createCheckout;
      other.p.createCheckout = async (...args) => {
        const result = await original(...args);
        await admin.query(`CREATE OR REPLACE FUNCTION fail_billing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${other.tenant.id}'::uuid THEN RAISE EXCEPTION 'private audit diagnostic'; END IF; RETURN NEW; END $$`);
        await admin.query('CREATE TRIGGER billing_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_billing_audit()'); return result;
      };
      try { await assert.rejects(other.start(), denied('unavailable')); assert.equal((await db.externalOperation.findFirst({ where: { tenantId: other.tenant.id } })).state, 'pending'); }
      finally { await admin.query('DROP TRIGGER billing_audit_failure ON audit_logs'); }
      other.p.createCheckout = original; await other.start(); assert.equal(count(other.p, 'createCheckout'), 1);
    });

    await t.test('portal timeout is retried with stable parameters; missing price does not block portal recovery', async () => {
      const f = await fixture(), original = f.p.createPortal;
      f.p.createPortal = async (...args) => { await original(...args); throw new Error('private portal error'); };
      await assert.rejects(f.start('portal'), denied('unavailable')); f.p.createPortal = original;
      await new BillingService(db, f.p, { ...config, priceId: '' }).start(f.actor, 'portal');
      assert.equal(new Set(f.p.calls.filter(([n]) => n === 'createPortal').map(([, k]) => k)).size, 1);
    });
  } finally {
    await db.$disconnect(); await pool.end(); await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
