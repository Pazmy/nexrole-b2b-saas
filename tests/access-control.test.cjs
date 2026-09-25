const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const ts = require("typescript");
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
let session, user, keys, writes, stripeCalls, config, transactionScopes;
const match = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const prisma = {
  $queryRaw: async () => [{ count: 1 }],
  user: {
    findFirst: async ({ where }) => user && match(user, where) ? user : null,
    findUnique: async ({ where }) => user && match(user, where) ? user : null,
  },
  tenant: {
    findUnique: async ({ where }) => ({ id: where.id, name: "Workspace", stripeCustomerId: "cus_test" }),
    update: async (args) => { writes.push(args); return args.data; },
  },
  role: { upsert: async ({ where }) => ({ id: "role-id", name: where.name }) },
  invitation: { create: async (args) => { writes.push(args); return args.data; } },
  apiKey: {
    create: async ({ data }) => { const key = { id: "new-key", ...data }; keys.push(key); writes.push(key); return key; },
    findFirst: async ({ where }) => keys.find((k) => match(k, where)) ?? null,
    findUnique: async ({ where }) => keys.find((k) => match(k, where)) ?? null,
    delete: async ({ where }) => {
      const index = keys.findIndex((k) => match(k, where));
      assert.notEqual(index, -1);
      writes.push(keys[index]);
      return keys.splice(index, 1)[0];
    },
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
  if (request === "@nexrole/database") return { prisma };
  if (request === "next-auth") return (options) => { config = options; return { auth: async () => session }; };
  if (request === "next-auth/providers/credentials") return (options) => options;
  if (request === "next/cache") return { revalidatePath() {} };
  if (request === "next/navigation") return { redirect: (url) => { throw new Error(`REDIRECT:${url}`); } };
  if (request === "@/lib/audit") return { writeAuditLog: async () => {} };
  if (request === "stripe") return StripeStub;
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
const { startCheckoutSession, startCustomerPortalSession } = require("../apps/web/src/app/(dashboard)/settings/billing-action.ts");
const { app } = require("../apps/api/app.ts");
const bcrypt = require("bcryptjs");

beforeEach(() => {
  session = { user: { id: userId, tenantId: tenantA, role: "SuperAdmin", sessionVersion: 0 } };
  user = { id: userId, tenantId: tenantA, email: "admin@example.test", isActive: true, emailVerifiedAt: new Date(), sessionVersion: 0,
    role: { name: "SuperAdmin" }, tenant: { name: "Workspace" }, passwordHash: bcrypt.hashSync("test-password", 4) };
  keys = [{ id: "foreign-key", tenantId: tenantB, key: "foreign-hash", name: "Other workspace" }];
  writes = []; stripeCalls = []; transactionScopes = [];
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
  await assert.rejects(() => createMemberInvitation("member@example.test", "CustomAdmin"), /Invalid workspace role/);
});

test("authorized administrator can open checkout and the customer portal", async () => {
  await assert.rejects(startCheckoutSession, /REDIRECT:https:\/\/stripe.test\/checkout/);
  await assert.rejects(startCustomerPortalSession, /REDIRECT:https:\/\/stripe.test\/portal/);
  assert.equal(stripeCalls[0].metadata.tenantId, tenantA);
  assert.equal(stripeCalls[1].customer, "cus_test");
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
