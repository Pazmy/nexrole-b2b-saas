// Run explicitly from the repository root. Never called by migrations or Docker startup.
const { randomBytes, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const dotenv = require('dotenv');
dotenv.config({ path: 'apps/web/.env.local', quiet: true });
dotenv.config({ path: 'apps/web/.env', quiet: true });
dotenv.config({ path: 'packages/database/.env', quiet: true });

const tenantId = 'ac375538-6d6b-4fb8-ae47-377d4af7c901';
const tenantName = 'Nexrole Studio — Showcase';
const ownerEmail = 'owner@nexrole-showcase.example.test';
const people = [
  ['owner', 'SuperAdmin', true], ['operations', 'SuperAdmin', true],
  ['finance', 'Member', true], ['support', 'Member', true],
  ['integrations', 'Developer', true], ['alumni', 'Member', false],
];
const ledger = [
  ['2450.00', 'completed', 'Acme Retail — platform implementation', 28],
  ['875.50', 'completed', 'Northstar Labs — analytics integration', 24],
  ['3200.00', 'completed', 'Harbor Logistics — annual support agreement', 19],
  ['149.00', 'failed', 'Atlas Design — payment authorization declined', 13],
  ['1250.75', 'completed', 'Summit Health — onboarding workshop', 10],
  ['640.00', 'completed', 'Cedar Digital — reporting configuration', 6],
  ['1800.00', 'pending', 'Brightworks Studio — integration milestone', 3],
  ['425.25', 'completed', 'Orbit Commerce — support renewal', 1],
  ['950.00', 'pending', 'Maple Ventures — service delivery deposit', 0],
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Showcase seeding requires a local development environment.');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Showcase seeding only permits a loopback PostgreSQL host.');
  }
  const { PrismaClient } = await import('../packages/database/dist/generated/prisma/client.js');
  const schema = url.searchParams.get('schema') || 'public';
  assert.match(schema, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  try {
    const existing = await db.tenant.findUnique({ where: { id: tenantId } });
    if (existing) {
      const marker = await db.auditLog.findFirst({ where: { tenantId, action: 'SHOWCASE_DATA_SEEDED' } });
      assert.ok(marker && existing.name === tenantName, 'Reserved showcase identity is already used by unrelated data.');
      console.log('Showcase already exists. Preserved its data and credentials; no changes made.');
      return;
    }
    const password = 'Showcase-' + randomBytes(12).toString('base64url') + '!';
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const ago = days => new Date(now.getTime() - days * 86400000);
    await db.$transaction(async tx => {
      const roles = {};
      for (const name of ['SuperAdmin', 'Member', 'Developer']) {
        roles[name] = await tx.role.upsert({ where: { name }, update: {}, create: { name, permissions: name === 'SuperAdmin' ? ['all'] : [] } });
      }
      await tx.tenant.create({ data: { id: tenantId, name: tenantName, subscriptionStatus: 'free', createdAt: ago(35) } });
      let owner;
      for (const [prefix, role, isActive] of people) {
        const user = await tx.user.create({ data: { email: `${prefix}@nexrole-showcase.example.test`, tenantId,
          roleId: roles[role].id, passwordHash, isActive, emailVerifiedAt: ago(32), createdAt: ago(32), sessionVersion: isActive ? 0 : 1 } });
        if (prefix === 'owner') owner = user;
      }
      for (const [amount, status, description, days] of ledger) {
        await tx.transaction.create({ data: { tenantId, userId: owner.id, amount, status, description, createdAt: ago(days), updatedAt: ago(days) } });
      }
      for (const [prefix, role, expired] of [['new-analyst', 'Member', false], ['contractor', 'Developer', true]]) {
        // No email sent and no usable raw credential retained.
        await tx.invitation.create({ data: { tenantId, email: `${prefix}@nexrole-showcase.example.test`, roleId: roles[role].id,
          token: createHash('sha256').update(randomBytes(32)).digest('hex'), createdAt: ago(expired ? 3 : 0),
          expiresAt: new Date(now.getTime() + (expired ? -86400000 : 86400000)) } });
      }
      for (const name of ['Reporting Dashboard — showcase', 'Internal Ledger Sync — showcase']) {
        await tx.apiKey.create({ data: { tenantId, name, key: createHash('sha256').update(randomBytes(32)).digest('hex'), createdAt: ago(5) } });
      }
      // Honest seed attribution, rather than fabricated historical user/provider actions.
      await tx.auditLog.create({ data: { tenantId, action: 'SHOWCASE_DATA_SEEDED', actorSource: 'legacy',
        metadata: { purpose: 'local screenshot fixtures', transactions: 9, users: 6, invitations: 2, apiKeys: 2 } } });
    });
    const [count, completed, pending, failed, revenue, users, invites, keys] = await Promise.all([
      db.transaction.count({ where: { tenantId } }),
      db.transaction.count({ where: { tenantId, status: 'completed' } }),
      db.transaction.count({ where: { tenantId, status: 'pending' } }),
      db.transaction.count({ where: { tenantId, status: 'failed' } }),
      db.transaction.aggregate({ where: { tenantId, status: 'completed' }, _sum: { amount: true } }),
      db.user.count({ where: { tenantId } }), db.invitation.count({ where: { tenantId } }), db.apiKey.count({ where: { tenantId } }),
    ]);
    assert.deepEqual([count, completed, pending, failed, users, invites, keys], [9, 6, 2, 1, 6, 2, 2]);
    assert.equal(revenue._sum.amount.toFixed(2), '8841.50');
    console.log('Showcase ready: 9 transactions; 6 completed; 2 pending; 1 failed; completed revenue USD 8,841.50.');
    console.log('6 users; 2 invitation examples; 2 API-key labels; Free quota 9/10.');
    console.log('Login email: ' + ownerEmail);
    console.log('Local demo password: ' + password);
  } finally {
    await db.$disconnect(); await pool.end();
  }
}
main().catch(error => { console.error('Showcase setup failed (' + (error.code || error.name) + '). Check local database availability, compiled client, migrations and reserved fixture identities. No existing workspace is reset.'); process.exitCode = 1; });
