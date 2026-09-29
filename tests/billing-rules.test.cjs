const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  });
  module._compile(outputText, filename);
};
const rules = require('../packages/database/billing-rules.ts');
const { getTransactionEntitlement, getTransactionWriteDecision } = require('../apps/web/src/lib/transaction-entitlements.ts');

test('all known subscription states retain the existing entitlement contract', () => {
  for (const status of rules.BILLING_SUBSCRIPTION_STATUSES) {
    const tier = ['active', 'trialing'].includes(status) ? 'pro' : ['free', 'canceled'].includes(status) ? 'free' : 'restricted';
    assert.equal(getTransactionEntitlement(status).tier, tier);
    assert.equal(getTransactionWriteDecision(status, { operation: 'create', storedCount: 10 }).allowed, tier === 'pro');
    assert.equal(getTransactionWriteDecision(status, { operation: 'update-status' }).allowed, tier !== 'restricted');
  }
  for (const status of [null, undefined, '', 'ACTIVE', 'unknown', {}, '__proto__']) assert.equal(getTransactionEntitlement(status).canWrite, false);
});
test('existing nonterminal subscriptions require recovery instead of another checkout', () => {
  for (const status of ['active', 'trialing', 'incomplete', 'past_due', 'unpaid', 'paused']) {
    for (const attempt of ['none', 'open', 'uncertain']) assert.equal(rules.getCheckoutDecision({ status, hasSubscription: true, attempt }), 'portal');
  }
});
test('free and terminal subscriptions can create only after reconciliation resolves prior attempts', () => {
  for (const status of ['free', 'canceled', 'incomplete_expired']) {
    const input = { status, hasSubscription: status !== 'free' };
    assert.equal(rules.getCheckoutDecision({ ...input, attempt: 'none' }), 'create');
    assert.equal(rules.getCheckoutDecision({ ...input, attempt: 'open' }), 'resume');
    assert.equal(rules.getCheckoutDecision({ ...input, attempt: 'uncertain' }), 'reconcile');
  }
  // Allowing a new purchase does not grant writes to an expired initial subscription.
  assert.equal(getTransactionEntitlement('incomplete_expired').canWrite, false);
});
test('missing identity and conflicting or unknown checkout state never create a subscription', () => {
  for (const status of ['active', 'trialing', 'canceled', 'incomplete_expired']) assert.equal(rules.getCheckoutDecision({ status, hasSubscription: false, attempt: 'none' }), 'reconcile');
  for (const input of [
    { status: 'free', hasSubscription: true, attempt: 'none' },
    { status: 'unknown', hasSubscription: false, attempt: 'none' },
    { status: 'free', hasSubscription: false, attempt: 'expired' },
    { status: 'free', hasSubscription: 'false', attempt: 'none' },
  ]) assert.equal(rules.getCheckoutDecision(input), 'reconcile');
});
test('invoice extraction supports string and expanded references in the installed API shape', () => {
  for (const subscription of ['sub_Test123', { id: 'sub_Test123', object: 'subscription' }]) {
    assert.equal(rules.getInvoiceSubscriptionId({ parent: { type: 'subscription_details', subscription_details: { subscription } } }), 'sub_Test123');
  }
});
test('invoice extraction rejects legacy metadata shortcuts, unrelated invoices and malformed references', () => {
  for (const invoice of [null, [], {}, { subscription_details: { metadata: { tenantId: 'forged' }, subscription: 'sub_Test123' } },
    { parent: { type: 'quote_details', subscription_details: { subscription: 'sub_Test123' } } },
    ...[null, {}, 'cus_Test123', '', 'sub_bad/path'].map((subscription) => ({ parent: { type: 'subscription_details', subscription_details: { subscription } } })),
  ]) assert.equal(rules.getInvoiceSubscriptionId(invoice), null);
});
test('both customer and current subscription must match before any billing state change', () => {
  const expected = { customerId: 'cus_Own123', subscriptionId: 'sub_Current123' };
  assert.equal(rules.matchesBillingOwnership(expected, expected), true);
  for (const actual of [{ ...expected, customerId: 'cus_Foreign' }, { ...expected, subscriptionId: 'sub_Old' },
    { ...expected, customerId: null }, { ...expected, subscriptionId: { id: expected.subscriptionId } }]) assert.equal(rules.matchesBillingOwnership(expected, actual), false);
  assert.equal(rules.matchesBillingOwnership({ customerId: '', subscriptionId: '' }, { customerId: '', subscriptionId: '' }), false);
});

const { billingPresentation } = require('../apps/web/src/lib/billing-presentation.ts');
test('billing UI follows transaction policy for every lifecycle state and quota boundary', () => {
  for (const status of [...rules.BILLING_SUBSCRIPTION_STATUSES, 'unknown', '__proto__']) {
    for (const usage of [0, 9, 10, 11]) {
      const result = billingPresentation({ status, usage, hasCustomer: true, hasSubscription: true, syncStatus: 'synced', pendingCheckout: false, cancelAtPeriodEnd: false, cancelAt: null });
      const create = getTransactionWriteDecision(status, { operation: 'create', storedCount: usage });
      assert.equal(!result.restricted && !result.quotaReached, create.allowed);
      assert.equal(result.canCheckout, ['free', 'canceled', 'incomplete_expired'].includes(status));
      assert.equal(typeof result.description, 'string');
    }
  }
});
test('ambiguous billing bindings and conflicts offer review instead of a new purchase', () => {
  for (const status of ['active', 'trialing', 'canceled', 'incomplete_expired']) {
    const view = { status, usage: 0, hasCustomer: true, hasSubscription: false, syncStatus: 'unverified' };
    assert.equal(billingPresentation(view).canCheckout, false);
    assert.equal(billingPresentation(view).needsReview, true);
  }
  assert.equal(billingPresentation({ status: 'free', usage: 0, syncStatus: 'conflict' }).canCheckout, false);
  assert.equal(billingPresentation({ status: 'free', usage: 0, syncStatus: 'unverified', pendingCheckout: true }).canCheckout, true);
});
