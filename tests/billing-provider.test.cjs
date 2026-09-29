const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const originalTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
class BillingError extends Error { constructor(code) { super(code); this.code = code; } }
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request === '@nexrole/database') return { BillingError };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => { Module._load = originalLoad; if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts']; });
const { stripeBillingProvider } = require('../apps/web/src/lib/stripe-billing.ts');
const iter = (values) => ({ async *[Symbol.asyncIterator]() { yield* values; } });

test('Stripe adapter sends stable owned customer/checkout/portal parameters without email adoption', async () => {
  const calls = [];
  const checkout = { id: 'cs_Test', customer: { id: 'cus_Test' }, livemode: false, mode: 'subscription', status: 'open', expires_at: 9999999999,
    metadata: { tenantId: 'tenant', operationId: 'op' }, url: 'https://checkout.stripe.com/c/pay/test', line_items: { has_more: false, data: [{ price: { id: 'price_Pro' }, quantity: 1 }] } };
  const sdk = {
    customers: { create: async (...args) => { calls.push(['customer', ...args]); return { id: 'cus_Test', livemode: false, metadata: args[0].metadata }; } },
    checkout: { sessions: { create: async (...args) => { calls.push(['checkout', ...args]); return checkout; }, retrieve: async (...args) => { calls.push(['retrieve', ...args]); return checkout; } } },
    billingPortal: { sessions: { create: async (...args) => { calls.push(['portal', ...args]); return { id: 'bps_Test', url: 'https://billing.stripe.com/p/session/test' }; } } },
  };
  const p = stripeBillingProvider(sdk);
  await p.createCustomer('tenant', 'op', 'customer-key');
  const result = await p.createCheckout('cus_Test', 'tenant', 'op', 'checkout-key', { priceId: 'price_Pro', baseUrl: 'https://app.example.test' });
  assert.equal(result.customerId, 'cus_Test'); assert.deepEqual(result.priceIds, ['price_Pro']); assert.equal(result.quantity, 1);
  await p.checkout('cs_Test'); await p.createPortal('cus_Test', 'portal-key', 'https://app.example.test');
  assert.deepEqual(calls[0], ['customer', { metadata: { tenantId: 'tenant', operationId: 'op' } }, { idempotencyKey: 'customer-key' }]);
  assert.deepEqual(calls[1][1].line_items, [{ price: 'price_Pro', quantity: 1 }]);
  assert.deepEqual(calls[1][1].payment_method_types, ['card']); assert.equal(calls[1][1].customer, 'cus_Test');
  assert.deepEqual(calls[1][1].subscription_data.metadata, { tenantId: 'tenant', operationId: 'op' });
  assert.equal(calls[1][1].customer_email, undefined); assert.equal(calls[1][2].idempotencyKey, 'checkout-key');
  assert.deepEqual(calls[2], ['retrieve', 'cs_Test', { expand: ['line_items'] }]);
  assert.deepEqual(calls[3], ['portal', { customer: 'cus_Test', return_url: 'https://app.example.test/settings?tab=profile' }, { idempotencyKey: 'portal-key' }]);
});

test('Stripe lists all subscription states and follows pagination instead of selecting the first match', async () => {
  const queries = [];
  const p = stripeBillingProvider({
    subscriptions: { list: (query) => { queries.push(query); return iter([{ id: 'sub_1', customer: 'cus_Test', livemode: false, status: 'canceled' }, { id: 'sub_2', customer: { id: 'cus_Test' }, livemode: false, status: 'unpaid' }]); } },
    customers: { search: (query) => { queries.push(query); return iter([{ id: 'cus_Test', livemode: false, metadata: { tenantId: 'tenant', operationId: 'op' } }]); } },
  });
  assert.equal((await p.subscriptions('cus_Test')).length, 2);
  assert.deepEqual(queries[0], { customer: 'cus_Test', status: 'all', limit: 100 });
  assert.equal((await p.findCustomers('tenant', 'op'))[0].operationId, 'op');
  assert.ok(queries[1].query.includes("metadata['operationId']:'op'")); assert.ok(!queries[1].query.includes('email'));
});

test('provider scan limit fails closed rather than presenting partial ownership evidence', async () => {
  const p = stripeBillingProvider({ subscriptions: { list: () => iter(Array.from({ length: 501 }, (_, i) => ({ id: `sub_${i}` }))) } });
  await assert.rejects(p.subscriptions('cus_Test'), (e) => e.code === 'reconcile');
});

test('deleted customers and truncated line items cannot appear as valid owned resources', async () => {
  const p = stripeBillingProvider({ customers: { retrieve: async () => ({ id: 'cus_Deleted', deleted: true }) },
    checkout: { sessions: { retrieve: async () => ({ id: 'cs_Test', customer: 'cus_Test', line_items: { has_more: true, data: [{ price: { id: 'price_Pro' }, quantity: 1 }] } }) } } });
  assert.equal((await p.customer('cus_Deleted')).deleted, true); assert.deepEqual((await p.checkout('cs_Test')).priceIds, []);
});
