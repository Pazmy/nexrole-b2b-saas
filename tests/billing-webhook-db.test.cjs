const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client, Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const Stripe = require('stripe');
const express = require('express');
require('dotenv').config({ path: 'packages/database/.env', quiet: true });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const items = () => ({ has_more: false, data: [{ price: { id: 'price_Pro', type: 'recurring' }, quantity: 1 }] });

test('signed billing webhooks and reconciliation against migrated PostgreSQL', { timeout: 120000 }, async (t) => {
  const database = await import('../packages/database/dist/index.js');
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = 'billing_webhook_test_' + randomBytes(10).toString('hex');
  assert.match(schema, /^billing_webhook_test_[a-f0-9]{20}$/);
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const admin = new Client({ connectionString }); await admin.connect();
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const resources = { customer: new Map(), subscription: new Map(), checkout: new Map(), invoice: new Map() };
  let getHook, listHook, calls = 0, number = 0, eventNumber = 0, server;
  const provider = {
    async get(kind, id) {
      calls++;
      const resource = resources[kind].get(id);
      if (!resource) throw new Error('private missing provider resource');
      const value = structuredClone(resource);
      if (getHook) await getHook(kind, id, value);
      return value;
    },
    async list(kind, customer) {
      calls++;
      if (listHook) await listHook(kind, customer);
      return structuredClone([...resources[kind].values()].filter((r) => r.customer === customer));
    },
  };
  const reconciler = new database.BillingReconciler(db, provider, { priceId: 'price_Pro', livemode: false });
  const originalLoad = Module._load, originalTs = require.extensions['.ts'];
  let role;
  async function fixture({ canonical = true, status = 'active' } = {}) {
    const n = ++number, customerId = `cus_Test${n}`, subscriptionId = `sub_Test${n}`;
    const tenant = await db.tenant.create({ data: { name: 'Webhook fixture', stripeCustomerId: customerId,
      stripeSubscriptionId: canonical ? subscriptionId : null, subscriptionStatus: canonical ? status : 'free' } });
    resources.customer.set(customerId, { id: customerId, livemode: false, metadata: { tenantId: tenant.id } });
    const sub = { id: subscriptionId, customer: customerId, livemode: false, status, cancel_at_period_end: false, cancel_at: null,
      metadata: { tenantId: tenant.id }, items: items() };
    resources.subscription.set(subscriptionId, sub);
    const actor = await db.user.create({ data: { tenantId: tenant.id, roleId: role.id, email: `${n}@billing.example.test`, passwordHash: 'unused', emailVerifiedAt: new Date() } });
    return { tenant, actor, sub, customerId, subscriptionId };
  }
  async function checkout(f, { status = 'complete', state = 'open', bound = true, subscription = f.subscriptionId } = {}) {
    const op = await db.externalOperation.create({ data: { tenantId: f.tenant.id, actorId: f.actor.id, kind: 'checkout_create',
      state, idempotencyKey: randomUUID(), parameterFingerprint: 'a'.repeat(64) } });
    const sessionId = `cs_Test${randomBytes(8).toString('hex')}`;
    const session = { id: sessionId, customer: f.customerId, subscription: status === 'complete' ? subscription : null,
      livemode: false, mode: 'subscription', status, metadata: { tenantId: f.tenant.id, operationId: op.id }, line_items: items(), expires_at: 9999999999 };
    resources.checkout.set(sessionId, session);
    if (bound) await db.externalOperation.update({ where: { id: op.id }, data: { providerObjectId: sessionId } });
    return { op, session };
  }
  function event(type, resource, extra = {}) {
    return { id: `evt_Test${++eventNumber}`, object: 'event', api_version: '2026-06-24.dahlia', created: 1234,
      type, livemode: false, data: { object: structuredClone(resource) }, ...extra };
  }
  const current = (f) => db.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } });
  const audits = (f) => db.auditLog.findMany({ where: { tenantId: f.tenant.id, action: 'BILLING_SUBSCRIPTION_CHANGED' } });
  const receipt = (e) => db.processedStripeEvent.findUnique({ where: { id: e.id } });
  const signer = new Stripe('sk_test_fixture_only');
  const secret = 'whsec_fixture_only_not_a_real_secret';
  async function post(e, options = {}) {
    const payload = JSON.stringify(e);
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret, ...(options.timestamp ? { timestamp: options.timestamp } : {}) });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/stripe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': options.signature ?? signature }, body: options.body ?? payload,
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}"`);
    for (const directory of fs.readdirSync('packages/database/prisma/migrations').sort()) {
      const file = path.join('packages/database/prisma/migrations', directory, 'migration.sql');
      if (fs.existsSync(file)) await admin.query(fs.readFileSync(file, 'utf8'));
    }
    role = await db.role.create({ data: { name: 'SuperAdmin', permissions: [] } });
    require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
    Module._load = function (request, parent, isMain) {
      if (request === '@nexrole/database') return { ...database, prisma: db };
      if (request.endsWith('/lib/env.js')) return { env: { STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET: secret, STRIPE_PRO_PRICE_ID: 'price_Pro' } };
      if (request.endsWith('/loggerMiddleware.js')) return { getContextLogger: () => ({ info() {}, warn() {} }) };
      if (request.startsWith('.') && request.endsWith('.js') && parent) {
        const source = path.resolve(path.dirname(parent.filename), request.replace(/\.js$/, '.ts'));
        if (fs.existsSync(source)) request = source;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createWebhookRouter } = require('../apps/api/routes/webhook.ts');
    const app = express();
    app.use('/api/webhooks', createWebhookRouter((body, sig) => signer.webhooks.constructEvent(body, sig, secret), (e) => reconciler.handle(e)));
    app.use(express.json());
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));

    await t.test('raw signature, body tampering and timestamp checks run before persistence or provider calls', async () => {
      const e = event('customer.subscription.updated', { id: 'sub_Invalid' }); const before = calls;
      for (const options of [{ signature: 'bad' }, { body: JSON.stringify({ ...e, livemode: true }) }, { timestamp: 1 }]) {
        const response = await post(e, options); assert.equal(response.status, 400); assert.equal(await receipt(e), null);
        assert.ok(!JSON.stringify(response).includes(secret));
      }
      assert.equal(calls, before);
    });

    await t.test('completed owned checkout binds subscription, operation, receipt and system audit atomically', async () => {
      const f = await fixture({ canonical: false }); const { op, session } = await checkout(f);
      const e = event('checkout.session.completed', session);
      assert.equal((await post(e)).status, 200);
      const row = await current(f); assert.equal(row.stripeSubscriptionId, f.subscriptionId); assert.equal(row.subscriptionStatus, 'active'); assert.equal(row.billingSyncStatus, 'synced');
      assert.equal((await db.externalOperation.findUnique({ where: { id: op.id } })).state, 'succeeded');
      const [audit] = await audits(f); assert.equal(audit.actorSource, 'stripe'); assert.equal(audit.actorId, null); assert.equal(audit.sourceEventId, e.id);
      assert.equal((await receipt(e)).disposition, 'processed');
      assert.equal((await post(e)).body.reason, 'duplicate'); assert.equal((await audits(f)).length, 1);
      const other = event('customer.subscription.updated', f.sub); await post(other); assert.equal((await audits(f)).length, 1);
    });

    await t.test('both checkout/subscription event orders recover unconfirmed local checkout binding', async () => {
      for (const subscriptionFirst of [true, false]) {
        const f = await fixture({ canonical: false }); const { session } = await checkout(f, { bound: false, state: 'unknown' });
        const events = [event('customer.subscription.created', f.sub), event('checkout.session.completed', session)];
        if (!subscriptionFirst) events.reverse();
        for (const e of events) assert.equal((await post(e)).body.disposition, 'processed');
        assert.equal((await current(f)).stripeSubscriptionId, f.subscriptionId); assert.equal((await audits(f)).length, 1);
      }
    });

    await t.test('invoice failure, recovery and delayed equal-timestamp events use current state', async () => {
      const f = await fixture();
      const invoice = { id: 'in_Lifecycle', customer: f.customerId, livemode: false,
        parent: { type: 'subscription_details', subscription_details: { subscription: { id: f.subscriptionId } } } };
      resources.invoice.set(invoice.id, invoice);
      const failure = event('invoice.payment_failed', invoice), paid = event('invoice.paid', invoice);
      f.sub.status = 'past_due'; await post(failure); assert.equal((await current(f)).subscriptionStatus, 'past_due');
      f.sub.status = 'active'; await post(paid); assert.equal((await current(f)).subscriptionStatus, 'active');
      await post(event('invoice.payment_failed', invoice)); assert.equal((await current(f)).subscriptionStatus, 'active');
      assert.equal((await audits(f)).length, 2);
      f.sub.status = 'past_due'; await post(event('invoice.paid', invoice)); assert.equal((await current(f)).subscriptionStatus, 'past_due');
    });

    await t.test('version-mismatched invoice snapshots are retrieved with the current provider shape', async () => {
      const f = await fixture(); f.sub.status = 'unpaid';
      const invoice = { id: 'in_Version', customer: f.customerId, livemode: false, parent: { type: 'subscription_details', subscription_details: { subscription: f.subscriptionId } } };
      resources.invoice.set(invoice.id, invoice);
      const e = event('invoice.payment_action_required', { id: invoice.id, subscription: 'sub_OldShape', subscription_details: { metadata: { tenantId: randomUUID() } } }, { api_version: '2020-08-27' });
      assert.equal((await post(e)).status, 200); assert.equal((await current(f)).subscriptionStatus, 'unpaid');
    });

    await t.test('period-end scheduling, pause/resume, cancellation and stale paid events preserve authoritative entitlement', async () => {
      const f = await fixture(); f.sub.cancel_at_period_end = true; f.sub.cancel_at = 2000000000;
      await post(event('customer.subscription.updated', f.sub));
      assert.equal((await current(f)).subscriptionStatus, 'active'); assert.equal((await current(f)).subscriptionCancelAtPeriodEnd, true);
      const [audit] = await audits(f); assert.equal(audit.metadata.previousCancelAt, null); assert.equal(audit.metadata.cancelAt, new Date(2000000000000).toISOString());
      f.sub.status = 'paused'; await post(event('customer.subscription.paused', f.sub)); assert.equal((await current(f)).subscriptionStatus, 'paused');
      f.sub.status = 'active'; await post(event('customer.subscription.resumed', f.sub));
      f.sub.status = 'canceled'; f.sub.cancel_at_period_end = false; f.sub.cancel_at = null;
      await post(event('customer.subscription.deleted', f.sub));
      await post(event('customer.subscription.updated', { ...f.sub, status: 'active' }));
      assert.equal((await current(f)).subscriptionStatus, 'canceled');
      assert.equal((await current(f)).stripeSubscriptionId, f.subscriptionId);
    });

    await t.test('superseded subscriptions cannot replace the canonical subscription; legitimate new checkout can', async () => {
      const f = await fixture({ status: 'canceled' });
      const next = { ...structuredClone(f.sub), id: 'sub_Replacement', status: 'active' }; resources.subscription.set(next.id, next);
      const { session } = await checkout(f, { subscription: next.id });
      await post(event('checkout.session.completed', session)); assert.equal((await current(f)).stripeSubscriptionId, next.id);
      const old = event('customer.subscription.updated', f.sub);
      assert.equal((await post(old)).body.reason, 'superseded_subscription');
      assert.equal((await current(f)).subscriptionStatus, 'active'); assert.equal((await audits(f)).length, 1);
    });

    await t.test('mode/account conflicts, unsupported events and unrelated invoices have durable safe dispositions', async () => {
      for (const extra of [{ livemode: true }, { account: 'acct_Foreign' }]) {
        const e = event('customer.subscription.updated', { id: 'sub_NotFetched' }, extra); const before = calls;
        assert.equal((await post(e)).body.disposition, 'quarantined'); assert.equal(calls, before);
      }
      const unsupported = event('payment_intent.succeeded', { id: 'pi_Unrelated' }); assert.equal((await post(unsupported)).body.reason, 'unsupported_event');
      resources.invoice.set('in_Unrelated', { id: 'in_Unrelated', customer: 'cus_Unrelated', livemode: false, parent: null });
      assert.equal((await post(event('invoice.paid', { id: 'in_Unrelated' }))).body.reason, 'unrelated_invoice');
    });

    await t.test('foreign ownership, unexpected prices and multiple active subscriptions never mutate tenant state', async () => {
      for (const mutate of [(f) => f.sub.metadata.tenantId = randomUUID(), (f) => f.sub.items.data[0].price.id = 'price_Other',
        (f) => resources.subscription.set(`sub_Extra${number}`, { ...structuredClone(f.sub), id: `sub_Extra${number}` })]) {
        const f = await fixture(); mutate(f); const before = await current(f);
        const e = event('customer.subscription.updated', f.sub);
        assert.equal((await post(e)).body.disposition, 'quarantined');
        const after = await current(f); assert.equal(after.subscriptionStatus, before.subscriptionStatus); assert.equal(after.stripeSubscriptionId, before.stripeSubscriptionId);
        assert.equal((await audits(f)).length, 0);
      }
      const f = await fixture({ canonical: false });
      const e = event('customer.subscription.created', f.sub); assert.equal((await post(e)).body.disposition, 'quarantined');
      assert.equal((await current(f)).stripeSubscriptionId, null);
    });

    await t.test('provider and required-audit failures leave pending receipts and roll back local business changes', async () => {
      const f = await fixture(); f.sub.status = 'past_due'; const e = event('customer.subscription.updated', f.sub);
      getHook = async () => { throw new Error('private provider credential diagnostic'); };
      const failed = await post(e); assert.equal(failed.status, 503); assert.ok(!JSON.stringify(failed).includes('private'));
      assert.equal((await receipt(e)).disposition, 'pending'); getHook = null;
      await admin.query(`CREATE FUNCTION fail_reconciliation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${f.tenant.id}'::uuid THEN RAISE EXCEPTION 'private diagnostic'; END IF; RETURN NEW; END $$`);
      await admin.query('CREATE TRIGGER reconciliation_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_reconciliation_audit()');
      try { assert.equal((await post(e)).status, 503); assert.equal((await current(f)).subscriptionStatus, 'active'); assert.equal((await receipt(e)).disposition, 'pending'); }
      finally { await admin.query('DROP TRIGGER reconciliation_audit_failure ON audit_logs'); }
      assert.equal((await post(e)).status, 200); assert.equal((await current(f)).subscriptionStatus, 'past_due');
    });

    await t.test('concurrent duplicate delivery remains retryable until the first transaction commits', async () => {
      const f = await fixture(); f.sub.status = 'past_due'; const e = event('customer.subscription.updated', f.sub);
      const entered = deferred(), release = deferred();
      listHook = async (kind, customer) => { if (kind === 'subscription' && customer === f.customerId) { entered.resolve(); await release.promise; } };
      const first = post(e); await entered.promise;
      assert.equal((await post(e)).status, 503); assert.equal((await receipt(e)).disposition, 'pending');
      release.resolve(); assert.equal((await first).status, 200); listHook = null;
      assert.equal((await post(e)).body.reason, 'duplicate'); assert.equal((await audits(f)).length, 1);
    });

    await t.test('different events competing for one tenant recover by redelivery; status check does not drain receipts', async () => {
      const f = await fixture(); f.sub.status = 'past_due';
      const firstEvent = event('customer.subscription.updated', f.sub);
      const secondEvent = event('customer.subscription.updated', f.sub);
      const entered = deferred(), release = deferred();
      listHook = async (kind, customer) => {
        if (kind === 'subscription' && customer === f.customerId) { entered.resolve(); await release.promise; }
      };
      const first = post(firstEvent);
      try {
        await entered.promise;
        assert.equal((await post(secondEvent)).status, 503);
        assert.equal((await receipt(secondEvent)).disposition, 'pending');
      } finally {
        release.resolve(); listHook = null;
        assert.equal((await first).status, 200);
      }
      await reconciler.reconcile({ id: f.actor.id, tenantId: f.tenant.id, sessionVersion: f.actor.sessionVersion });
      assert.equal((await current(f)).subscriptionStatus, 'past_due');
      assert.equal((await receipt(secondEvent)).disposition, 'pending');
      assert.equal((await post(secondEvent)).status, 200);
      assert.equal((await receipt(secondEvent)).disposition, 'processed');
      assert.equal((await post(secondEvent)).body.reason, 'duplicate');
      assert.equal((await audits(f)).length, 1);
    });

    await t.test('expired lease fences stale fetches even when a later delivery has already applied newer state', async () => {
      const f = await fixture(); const slowEvent = event('customer.subscription.updated', f.sub), newEvent = event('customer.subscription.updated', f.sub);
      const entered = deferred(), release = deferred(); let reads = 0;
      getHook = async (kind, resourceId) => { if (kind === 'subscription' && resourceId === f.subscriptionId && ++reads === 2) { entered.resolve(); await release.promise; } };
      const slow = post(slowEvent); await entered.promise; getHook = null;
      await db.tenant.update({ where: { id: f.tenant.id }, data: { billingLeaseExpiresAt: new Date(Date.now() - 1000) } });
      f.sub.status = 'past_due'; assert.equal((await post(newEvent)).status, 200);
      release.resolve(); assert.equal((await slow).status, 503);
      assert.equal((await current(f)).subscriptionStatus, 'past_due'); assert.equal((await receipt(slowEvent)).disposition, 'pending');
      assert.equal((await post(slowEvent)).status, 200); assert.equal((await audits(f)).length, 1);
    });

    await t.test('manual recovery verifies membership and resolves completed/expired attempts without external creation', async () => {
      const f = await fixture({ canonical: false }); const { op } = await checkout(f, { bound: false, state: 'unknown' });
      await assert.rejects(reconciler.reconcile({ ...f.actor, sessionVersion: 99 }), (e) => e.code === 'access_denied');
      assert.equal((await reconciler.reconcile(f.actor)).disposition, 'processed');
      assert.equal((await current(f)).stripeSubscriptionId, f.subscriptionId);
      assert.equal((await db.externalOperation.findUnique({ where: { id: op.id } })).state, 'succeeded');
      const [audit] = await audits(f); assert.equal(audit.actorId, f.actor.id); assert.equal(audit.actorSource, 'user');
      const other = await fixture({ canonical: false }); resources.subscription.delete(other.subscriptionId);
      const expired = await checkout(other, { status: 'expired' }); await reconciler.reconcile(other.actor);
      assert.equal((await db.externalOperation.findUnique({ where: { id: expired.op.id } })).state, 'expired');
    });

    await t.test('a checkout event racing its durable customer binding stays pending for redelivery', async () => {
      const f = await fixture({ canonical: false }); const { session } = await checkout(f);
      await db.tenant.update({ where: { id: f.tenant.id }, data: { stripeCustomerId: null } });
      const e = event('checkout.session.completed', session); assert.equal((await post(e)).status, 503);
      assert.equal((await receipt(e)).disposition, 'pending'); assert.equal((await receipt(e)).processedAt, null);
      await db.tenant.update({ where: { id: f.tenant.id }, data: { stripeCustomerId: f.customerId } });
      assert.equal((await post(e)).status, 200); assert.equal((await current(f)).stripeSubscriptionId, f.subscriptionId);
    });

    await t.test('expired checkout events release only the verified operation and do not grant subscription access', async () => {
      const f = await fixture({ canonical: false }); resources.subscription.delete(f.subscriptionId);
      const { op, session } = await checkout(f, { status: 'expired' });
      const e = event('checkout.session.expired', session);
      assert.equal((await post(e)).body.disposition, 'processed'); assert.equal((await current(f)).subscriptionStatus, 'free');
      assert.equal((await db.externalOperation.findUnique({ where: { id: op.id } })).state, 'expired');
      assert.equal((await audits(f)).length, 0);
    });

    await t.test('cross-tenant checkout evidence and missing canonical resources never grant access', async () => {
      const f = await fixture({ canonical: false }), other = await fixture(); const { session, op } = await checkout(f);
      session.subscription = other.subscriptionId;
      const e = event('checkout.session.completed', session); assert.equal((await post(e)).body.disposition, 'quarantined');
      assert.equal((await current(f)).stripeSubscriptionId, null);
      assert.equal((await db.externalOperation.findUnique({ where: { id: op.id } })).state, 'open');
      const missing = event('customer.subscription.deleted', { id: 'sub_NotRetrievable' });
      assert.equal((await post(missing)).status, 503); assert.equal((await receipt(missing)).disposition, 'pending');
    });

    await t.test('reconciled database states feed the existing transaction entitlement policy', async () => {
      const { getTransactionWriteDecision } = require('../apps/web/src/lib/transaction-entitlements.ts');
      const f = await fixture();
      for (const status of ['trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'active', 'canceled']) {
        f.sub.status = status; await post(event('customer.subscription.updated', f.sub));
        const row = await current(f);
        const create = getTransactionWriteDecision(row.subscriptionStatus, { operation: 'create', storedCount: 10 });
        const update = getTransactionWriteDecision(row.subscriptionStatus, { operation: 'update-status' });
        assert.equal(create.allowed, ['active', 'trialing'].includes(status));
        assert.equal(update.allowed, ['active', 'trialing', 'canceled'].includes(status));
      }
      // A malformed legacy status must be recoverable without persisting arbitrary text in audit metadata.
      await db.tenant.update({ where: { id: f.tenant.id }, data: { subscriptionStatus: 'invalid legacy status' } });
      f.sub.status = 'active'; const recovered = event('customer.subscription.updated', f.sub);
      assert.equal((await post(recovered)).status, 200); assert.equal((await current(f)).subscriptionStatus, 'active');
      const recoveryAudit = await db.auditLog.findFirst({ where: { tenantId: f.tenant.id, sourceEventId: recovered.id } });
      assert.equal(recoveryAudit.metadata.previousStatus, 'unknown');
    });

    await t.test('shared SDK read adapter retrieves current resources and follows bounded customer pagination', async () => {
      const calls = [], iter = (data) => ({ async *[Symbol.asyncIterator]() { yield* data; } });
      const adapter = database.stripeReconciliationProvider({
        customers: { retrieve: async (id) => { calls.push(['customer', id]); return { id }; } },
        invoices: { retrieve: async (id) => { calls.push(['invoice', id]); return { id }; } },
        subscriptions: { retrieve: async (id) => { calls.push(['subscription', id]); return { id }; }, list: (params) => { calls.push(['subscriptions', params]); return iter([{ id: 'sub_First' }, { id: 'sub_Second' }]); } },
        checkout: { sessions: { retrieve: async (id, params) => { calls.push(['checkout', id, params]); return { id }; }, list: (params) => { calls.push(['sessions', params]); return iter([]); } } },
      });
      await adapter.get('customer', 'cus_Test'); await adapter.get('invoice', 'in_Test'); await adapter.get('subscription', 'sub_Test'); await adapter.get('checkout', 'cs_Test');
      assert.equal((await adapter.list('subscription', 'cus_Test')).length, 2); await adapter.list('checkout', 'cus_Test');
      assert.deepEqual(calls[3], ['checkout', 'cs_Test', { expand: ['line_items'] }]);
      assert.deepEqual(calls[4], ['subscriptions', { customer: 'cus_Test', status: 'all', limit: 100 }]);
      const capped = database.stripeReconciliationProvider({ subscriptions: { list: () => iter(Array(501).fill({})) } });
      await assert.rejects(capped.list('subscription', 'cus_Test'), (e) => e.code === 'retry' && e.reason === 'scan_limit');
    });

    await t.test('membership or binding changed during manual fetch cannot commit', async () => {
      const f = await fixture(); f.sub.status = 'past_due';
      listHook = async () => { await db.user.update({ where: { id: f.actor.id }, data: { sessionVersion: { increment: 1 } } }); listHook = null; };
      await assert.rejects(reconciler.reconcile(f.actor), (e) => e.code === 'access_denied'); assert.equal((await current(f)).subscriptionStatus, 'active');
      const other = await fixture(); other.sub.status = 'past_due';
      listHook = async () => { await db.tenant.update({ where: { id: other.tenant.id }, data: { stripeCustomerId: 'cus_ChangedBinding' } }); listHook = null; };
      const e = event('customer.subscription.updated', other.sub); assert.equal((await post(e)).status, 503); assert.equal((await receipt(e)).disposition, 'pending');
    });
  } finally {
    getHook = null; listHook = null;
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Module._load = originalLoad; if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
    await db.$disconnect(); await pool.end(); await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
});
