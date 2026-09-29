const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const ts = require("typescript");
const { writeRequiredAudit } = require('../packages/database/dist/audit.js');
const { BillingError } = require('../packages/database/dist/billing-service.js');
const { ReconciliationError } = require('../packages/database/dist/billing-reconciliation.js');
let billingFailure;
// Compile TypeScript in memory; type checking remains part of the app builds.
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

// Execute the real guards, Auth.js callbacks, actions and Express routes.
// Only external boundaries (session transport, database, Stripe, Next cache) are faked.
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
let session, user, keys, writes, stripeCalls, config, transactionScopes, operations, auditRows;
const match = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const prisma = {
  $transaction: async (callback) => callback(prisma),
  $queryRaw: async (strings) => {
    const sql = strings.join('');
    if (sql.includes('FROM tenants')) return [{ id: user.tenantId }];
    if (sql.includes('FROM users')) return [{ ...user, role: user.role.name }];
    return [{ count: 1 }];
  },
  user: {
    findFirst: async ({ where }) => user && match(user, where) ? user : null,
    findUnique: async ({ where }) => user && match(user, where) ? user : null,
  },
  tenant: {
    findUnique: async ({ where }) => ({ id: where.id, name: "Workspace", stripeCustomerId: "cus_test" }),
    findUniqueOrThrow: async ({ where }) => ({ id: where.id, name: "Workspace", stripeCustomerId: "cus_test" }),
    update: async (args) => { writes.push(args); return args.data; },
  },
  role: { createMany: async () => ({ count: 1 }), findUniqueOrThrow: async ({ where }) => ({ id: "role-id", name: where.name }) },
  invitation: {
    findFirst: async () => null,
    create: async (args) => { writes.push(args); return { id: crypto.randomUUID(), ...args.data }; },
    updateMany: async (args) => { assert.equal(args.where.tenantId, tenantA); assert.ok(args.where.token); return { count: 1 }; },
  },
  apiKey: {
    create: async ({ data }) => { const key = { id: crypto.randomUUID(), ...data }; keys.push(key); writes.push(key); return key; },
    findFirst: async ({ where }) => keys.find((k) => match(k, where)) ?? null,
    findUnique: async ({ where }) => keys.find((k) => match(k, where)) ?? null,
    delete: async ({ where }) => {
      const index = keys.findIndex((k) => match(k, where));
      assert.notEqual(index, -1);
      writes.push(keys[index]);
      return keys.splice(index, 1)[0];
    },
  },
  externalOperation: {
    create: async ({ data }) => { const row = { id: crypto.randomUUID(), state: 'pending', ...data }; operations.push(row); return row; },
    findFirst: async ({ where }) => operations.find((row) => match(row, where)) ?? null,
    updateMany: async ({ where, data }) => { const rows = operations.filter((row) => match(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; },
  },
  auditLog: {
    create: async ({ data }) => { const row = { id: crypto.randomUUID(), ...data }; auditRows.push(row); return row; },
    createMany: async ({ data }) => { for (const row of data) auditRows.push({ id: crypto.randomUUID(), ...row }); return { count: data.length }; },
    findUniqueOrThrow: async ({ where }) => auditRows.find((row) => match(row, where.tenantId_operationId_phase)),
  },
  transaction: { findMany: async ({ where }) => {
    assert.ok(where.tenantId, "queries must never omit tenant scope");
    transactionScopes.push(where.tenantId);
    return [{ id: `transaction-for-${where.tenantId}` }];
  } },
};
class StripeStub {
  checkout = { sessions: { create: async (args) => { stripeCalls.push(args); return { url: "https://stripe.test/checkout" }; } } };
  billingPortal = { sessions: { create: async (args) => { stripeCalls.push(args); return { url: "https://stripe.test/portal" }; } } };
}
const logger = { info() {}, error() {}, warn() {} };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/email" || request === "./email") return { sendAccountEmail: async () => {} };
  if (request === "@nexrole/database") return { prisma, writeRequiredAudit, BillingError, ReconciliationError };
  if (request === "next-auth") return (options) => { config = options; return { auth: async () => session }; };
  if (request === "next-auth/providers/credentials") return (options) => options;
  if (request === "next/cache") return { revalidatePath() {} };
  if (request === "next/navigation") return { redirect: (url) => { throw new Error(`REDIRECT:${url}`); } };
  if (request === "stripe") return StripeStub;
  // This suite verifies action authorization/transport; the billing service has
  // its own real-PostgreSQL suite with a controlled provider boundary.
  if (request === "@/lib/stripe-billing") return { getBillingReconciler: () => ({ reconcile: async (actor) => { assert.equal(actor.tenantId, tenantA); return { reason: 'state_unchanged' }; } }), getBillingService: () => ({ start: async (actor, intent) => {
    if (billingFailure) throw billingFailure;
    stripeCalls.push({ actor, intent }); return `https://stripe.test/${intent}`;
  } }) };
  if (request.endsWith("/lib/env.js")) return { env: { NODE_ENV: "test", STRIPE_SECRET_KEY: "test", STRIPE_WEBHOOK_SECRET: "test" } };
  if (request.endsWith("/loggerMiddleware.js")) return { loggerMiddleware: (_req, _res, next) => next(), getContextLogger: () => logger };
  if (request.startsWith("@/")) request = path.resolve(__dirname, "../apps/web/src", request.slice(2));
  if (request.startsWith(".") && request.endsWith(".js") && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.replace(/\.js$/, ".ts"));
    if (fs.existsSync(source)) request = source;
  }
  return originalLoad.call(this, request, parent, isMain);
};
process.env.STRIPE_SECRET_KEY = "test-only";
process.env.EMAIL_MODE = "preview";
process.env.NODE_ENV = "test";
const { requirePermission } = require("../apps/web/src/lib/authorization.ts");
const { hasPermission } = require("../apps/web/src/lib/permissions.ts");
const { generateApiKey, revokeApiKey } = require("../apps/web/src/app/(dashboard)/settings/developer-action.ts");
const { createMemberInvitation } = require("../apps/web/src/app/(dashboard)/settings/invite-action.ts");
const { updateTenantProfile } = require("../apps/web/src/app/(dashboard)/settings/update-tenant-profile-action.ts");
const { startCheckoutSession, startCustomerPortalSession, reconcileBillingAction, requestBillingSession } = require("../apps/web/src/app/(dashboard)/settings/billing-action.ts");
const { app } = require("../apps/api/app.ts");
const bcrypt = require("bcryptjs");

beforeEach(() => {
  session = { user: { id: userId, tenantId: tenantA, role: "SuperAdmin", sessionVersion: 0 } };
  user = { id: userId, tenantId: tenantA, email: "admin@example.test", isActive: true, emailVerifiedAt: new Date(), sessionVersion: 0,
    role: { name: "SuperAdmin" }, tenant: { name: "Workspace" }, passwordHash: bcrypt.hashSync("test-password", 4) };
  keys = [{ id: "foreign-key", tenantId: tenantB, key: "foreign-hash", name: "Other workspace" }];
  billingFailure = null;
  writes = []; stripeCalls = []; transactionScopes = []; operations = []; auditRows = [];
});
after(() => { Module._load = originalLoad; });

test("fixed roles deny unknown roles and reserve management for administrators", () => {
  for (const role of ["Member", "Developer"]) {
    assert.equal(hasPermission(role, "transactions:read"), true);
    for (const permission of ["workspace:update", "members:invite", "keys:manage", "billing:manage"])
      assert.equal(hasPermission(role, permission), false);
  }
  for (const role of ["", "Manager", "__proto__", "toString"])
    assert.equal(hasPermission(role, "workspace:read"), false);
});

const mutations = [
  () => generateApiKey("Test key"),
  () => revokeApiKey("foreign-key"),
  () => createMemberInvitation("member@example.test"),
  () => startCheckoutSession(),
  () => startCustomerPortalSession(),
  () => reconcileBillingAction(),
  () => requestBillingSession("checkout"),
  () => requestBillingSession("portal"),
];
for (const scenario of ["anonymous", "inactive", "deleted", "demoted", "unknown role", "moved tenant", "missing tenant", "missing identity", "malformed identity"]) {
  test(`server actions reject ${scenario} callers without side effects`, async () => {
    if (scenario === "anonymous") session = null;
    if (scenario === "inactive") user.isActive = false;
    if (scenario === "deleted") user = null;
    if (scenario === "demoted") user.role.name = "Member"; // JWT still says SuperAdmin
    if (scenario === "unknown role") user.role.name = "CustomAdmin";
    if (scenario === "moved tenant") user.tenantId = tenantB;
    if (scenario === "missing tenant") delete session.user.tenantId;
    if (scenario === "missing identity") delete session.user.id;
    if (scenario === "malformed identity") session.user.id = "not-a-uuid";
    for (const mutation of mutations) await assert.rejects(mutation, /Access denied/);
    const form = new FormData(); form.set("name", "Changed");
    assert.match((await updateTenantProfile(null, form)).error, /Access denied/);
    assert.deepEqual(writes, []);
    assert.deepEqual(stripeCalls, []);
    if (scenario !== "demoted") await assert.rejects(() => requirePermission("transactions:read"), /Access denied/);
  });
}

test("database role changes take effect with the same session", async () => {
  await requirePermission("billing:manage");
  user.role.name = "Member";
  await assert.rejects(() => requirePermission("billing:manage"), /Access denied/);
  assert.equal((await requirePermission("transactions:read")).role, "Member");
  user.isActive = false;
  await assert.rejects(() => requirePermission("transactions:read"), /Access denied/);
});

test("credential login rejects inactive accounts and authenticates active accounts", async () => {
  const authorize = config.providers[0].authorize;
  const credentials = { email: user.email, password: "test-password" };
  assert.equal((await authorize(credentials)).id, userId);
  assert.equal(await authorize({ ...credentials, password: "wrong" }), null);
  user.isActive = false;
  assert.equal(await authorize(credentials), null);
});

test("Auth.js refreshes roles and invalidates existing JWTs after deactivation or tenant change", async () => {
  const token = { sub: userId, tenantId: tenantA, role: "SuperAdmin", sessionVersion: 0 };
  user.role.name = "Member";
  assert.equal((await config.callbacks.jwt({ token })).role, "Member");
  const refreshed = await config.callbacks.session({ session: { user: {} }, token });
  assert.equal(refreshed.user.id, userId);
  user.isActive = false;
  assert.equal(await config.callbacks.jwt({ token }), null);
  user.isActive = true; user.tenantId = tenantB;
  assert.equal(await config.callbacks.jwt({ token }), null);
});

test("admin mutations use the verified tenant and cannot revoke another tenant's key", async () => {
  await revokeApiKey("foreign-key");
  assert.equal(keys.length, 1);
  assert.deepEqual(writes, []);
  const raw = await generateApiKey("My key");
  assert.equal(keys[1].tenantId, tenantA);
  assert.equal(keys[1].key, crypto.createHash("sha256").update(raw).digest("hex"));
  await revokeApiKey(keys[1].id);
  assert.equal(keys.length, 1);
  const form = new FormData(); form.set("name", "Updated"); form.set("tenantId", tenantB);
  assert.ok((await updateTenantProfile(null, form)).success);
  assert.equal(writes.at(-1).where.id, tenantA);
  await createMemberInvitation("member@example.test");
  assert.equal(writes.at(-1).data.tenantId, tenantA);
  await assert.rejects(() => createMemberInvitation("member@example.test", "CustomAdmin"), /Invalid option/);
});

test("billing actions forward only the freshly authorized actor and redirect to the service result", async () => {
  const injected = new FormData(); injected.set('tenantId', tenantB); injected.set('customerId', 'cus_Foreign');
  await assert.rejects(() => startCheckoutSession(injected), /REDIRECT:https:\/\/stripe.test\/checkout/);
  await assert.rejects(() => startCustomerPortalSession(injected), /REDIRECT:https:\/\/stripe.test\/portal/);
  assert.equal(stripeCalls[0].actor.tenantId, tenantA);
  assert.equal(stripeCalls[1].actor.id, userId);
  assert.equal(stripeCalls[1].actor.sessionVersion, 0);
  assert.deepEqual(await requestBillingSession("portal"), { success: true, url: "https://stripe.test/portal" });
  assert.deepEqual(await requestBillingSession("invalid"), { success: false, error: "Invalid billing request." });
  assert.deepEqual(await reconcileBillingAction(injected), { success: true, reason: 'state_unchanged' });
});

test("HTTP routes remove legacy access and enforce tenant-scoped API keys", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ["/api/users", "/api/transactions"])
      assert.equal((await fetch(url + route)).status, 404);
    assert.equal((await fetch(url + "/api/v1/transactions")).status, 401);
    assert.equal((await fetch(url + "/api/v1/transactions", { headers: { "X-API-Key": "invalid" } })).status, 403);
    for (const tenantId of [tenantA, tenantB]) {
      const key = `secret-${tenantId}`;
      keys.push({ id: tenantId, tenantId, key: crypto.createHash("sha256").update(key).digest("hex") });
      const response = await fetch(url + "/api/v1/transactions", { headers: { "X-API-Key": key } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, [{ id: `transaction-for-${tenantId}` }]);
    }
    assert.deepEqual(transactionScopes, [tenantA, tenantB]);
    keys = [];
    assert.equal((await fetch(url + "/api/v1/transactions", { headers: { "X-API-Key": `secret-${tenantA}` } })).status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('structured billing actions expose safe errors and redact unexpected provider failures', async () => {
  for (const failure of [new BillingError('busy'), new BillingError('configuration'), new ReconciliationError('conflict', 'private_reason')]) {
    billingFailure = failure;
    assert.deepEqual(await requestBillingSession('portal'), { success: false, error: failure.message });
  }
  billingFailure = new Error('secret provider payload');
  const response = await requestBillingSession('portal');
  assert.equal(response.success, false);
  assert.doesNotMatch(response.error, /secret|payload/);
  assert.match(response.error, /Retry to recover/);
});
