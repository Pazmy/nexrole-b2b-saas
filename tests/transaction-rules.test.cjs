const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Exercise the actual shared rules, without a database, Next server, or provider mocks.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { parseTransactionQuery } = require('../apps/web/src/lib/transaction-query.ts');
test('list queries normalize repeated/malformed values and bound search text', () => {
  for (const page of ['0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992', ['2', '3']]) {
    assert.equal(parseTransactionQuery({ page }).page, 1);
  }
  assert.deepEqual(parseTransactionQuery({ page: '99999999', status: 'failed', search: '  invoice  ' }), { page: 99999999, status: 'failed', search: 'invoice' });
  assert.deepEqual(parseTransactionQuery({ page: ['1'], status: ['pending'], search: ['private', 'other'] }), { page: 1, status: 'all', search: '' });
  assert.equal(parseTransactionQuery({ status: 'unknown', search: 'a'.repeat(501) }).search.length, 500);
  assert.equal(parseTransactionQuery({ status: 'unknown' }).status, 'all');
});
const { createTransactionSchema, transactionAmountSchema, updateTransactionStatusSchema,
  canTransitionTransactionStatus, INITIAL_TRANSACTION_STATUS } = require('../apps/web/src/lib/transaction-rules.ts');
const { getTransactionEntitlement, getTransactionWriteDecision } = require('../apps/web/src/lib/transaction-entitlements.ts');
const { hasPermission } = require('../apps/web/src/lib/permissions.ts');

test('amounts retain exact cents and normalize accepted decimal input', () => {
  for (const [input, expected] of [['0.01', '0.01'], ['10', '10.00'], [' 0010.5 ', '10.50'], ['99999999.99', '99999999.99']]) {
    assert.equal(transactionAmountSchema.parse(input), expected);
  }
});

test('invalid or out-of-range amounts are rejected instead of rounded or coerced', () => {
  for (const input of ['0', '0.00', '-1', '0.001', '1.999', '100000000', '1e3', '1,000.00', '1,50', '+1', '', ' ', 'NaN', 'Infinity', '.5', '1.', 10, null]) {
    assert.equal(transactionAmountSchema.safeParse(input).success, false, String(input));
  }
});

test('creation trims descriptions and enforces required text and length', () => {
  assert.deepEqual(createTransactionSchema.parse({ description: ' Consulting ', amount: '12.5' }), { description: 'Consulting', amount: '12.50' });
  for (const description of ['', '  ', 'a'.repeat(501), null]) {
    assert.equal(createTransactionSchema.safeParse({ description, amount: '1' }).success, false);
  }
  assert.equal(createTransactionSchema.safeParse({ description: 'a'.repeat(500), amount: '1' }).success, true);
});

test('creation accepts no client-supplied tenant, actor, currency or initial status', () => {
  assert.equal(INITIAL_TRANSACTION_STATUS, 'pending');
  for (const extra of [{ tenantId: 'foreign' }, { userId: 'foreign' }, { status: 'completed' }, { currency: 'EUR' }]) {
    assert.equal(createTransactionSchema.safeParse({ description: 'Example', amount: '1', ...extra }).success, false);
  }
});

test('only pending transactions may become completed or failed', () => {
  for (const from of ['pending', 'completed', 'failed', 'unknown', null]) {
    for (const to of ['pending', 'completed', 'failed', 'unknown', null]) {
      assert.equal(canTransitionTransactionStatus(from, to), from === 'pending' && ['completed', 'failed'].includes(to), `${from} -> ${to}`);
    }
  }
});

test('status submissions require a valid identity and permitted destination', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(updateTransactionStatusSchema.safeParse({ id, status: 'completed' }).success, true);
  for (const input of [{ id: 'bad', status: 'completed' }, { id, status: 'pending' }, { id, status: 'unknown' }, { id, status: 'failed', tenantId: 'foreign' }]) {
    assert.equal(updateTransactionStatusSchema.safeParse(input).success, false);
  }
});

test('only SuperAdmin has transaction write permissions; known members keep read access', () => {
  for (const role of ['SuperAdmin', 'Member', 'Developer', 'Manager', '', '__proto__', 'toString']) {
    for (const permission of ['transactions:create', 'transactions:update-status']) {
      assert.equal(hasPermission(role, permission), role === 'SuperAdmin');
    }
    assert.equal(hasPermission(role, 'transactions:read'), ['SuperAdmin', 'Member', 'Developer'].includes(role));
  }
});

test('the tenth Free transaction is allowed, the eleventh and higher are blocked', () => {
  for (const status of ['free', 'canceled']) {
    assert.equal(getTransactionWriteDecision(status, { operation: 'create', storedCount: 9 }).allowed, true);
    for (const storedCount of [10, 11, 100]) {
      assert.deepEqual(getTransactionWriteDecision(status, { operation: 'create', storedCount }), { allowed: false, reason: 'creation_limit_reached' });
    }
    assert.equal(getTransactionWriteDecision(status, { operation: 'update-status' }).allowed, true);
  }
});

test('only active and trialing qualify for unlimited Pro transaction counts', () => {
  for (const status of ['active', 'trialing']) {
    assert.deepEqual(getTransactionEntitlement(status), { tier: 'pro', canWrite: true, maxStoredTransactions: null });
    assert.equal(getTransactionWriteDecision(status, { operation: 'create', storedCount: 1000000 }).allowed, true);
    assert.equal(getTransactionWriteDecision(status, { operation: 'update-status' }).allowed, true);
  }
});

test('delinquent, incomplete, paused, missing and unknown subscriptions cannot write', () => {
  for (const status of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'unknown', 'ACTIVE', '__proto__', '', null, undefined]) {
    assert.equal(getTransactionEntitlement(status).canWrite, false);
    for (const request of [{ operation: 'create', storedCount: 0 }, { operation: 'update-status' }]) {
      assert.deepEqual(getTransactionWriteDecision(status, request), { allowed: false, reason: 'subscription_restricted' });
    }
  }
});

test('invalid usage counts and unsupported operations cannot bypass the write policy', () => {
  for (const status of ['free', 'active']) {
    for (const storedCount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', undefined]) {
      assert.deepEqual(getTransactionWriteDecision(status, { operation: 'create', storedCount }), { allowed: false, reason: 'invalid_usage' });
    }
    assert.equal(getTransactionWriteDecision(status, { operation: 'delete' }).allowed, false);
  }
});
