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
const rules = require('../apps/web/src/lib/membership-rules.ts');
const { hasPermission } = require('../apps/web/src/lib/permissions.ts');
const id = 'f9fc018b-b6cb-4ce8-a970-1bd088454366';
const admin = { role: 'SuperAdmin', isActive: true };

test('only SuperAdmin manages membership and invitations; other roles retain reads', () => {
  for (const role of ['SuperAdmin', 'Member', 'Developer', 'CustomAdmin', '__proto__']) {
    for (const permission of ['members:invite', 'members:manage', 'invitations:manage']) assert.equal(hasPermission(role, permission), role === 'SuperAdmin');
  }
  for (const role of ['Member', 'Developer']) assert.equal(hasPermission(role, 'workspace:read'), true);
});
test('role input accepts only the three fixed roles and a valid target ID', () => {
  for (const role of ['SuperAdmin', 'Member', 'Developer']) assert.ok(rules.changeMemberRoleSchema.safeParse({ id, role }).success);
  for (const input of [{ id: 'invalid', role: 'Member' }, { id, role: 'Owner' }, { id, role: 'superadmin' }, { id, role: null }]) assert.equal(rules.changeMemberRoleSchema.safeParse(input).success, false);
});
test('mutation schemas reject client-owned tenant, actor, state and extra fields', () => {
  for (const [schema, input] of [[rules.changeMemberRoleSchema, { id, role: 'Member' }], [rules.deactivateMemberSchema, { id }], [rules.createInvitationSchema, { email: 'new@example.test', role: 'Member' }], [rules.manageInvitationSchema, { id }]]) {
    for (const extra of [{ tenantId: id }, { actorId: id }, { isActive: true }, { token: 'forged' }, { otherActiveVerifiedAdmins: 2 }]) assert.equal(schema.safeParse({ ...input, ...extra }).success, false);
  }
});
test('last active administrator cannot be demoted or deactivated', () => {
  for (const change of [{ operation: 'deactivate' }, { operation: 'change-role', role: 'Member' }, { operation: 'change-role', role: 'Developer' }]) {
    assert.deepEqual(rules.getMemberChangeDecision(admin, change, 0), { allowed: false, reason: 'last_admin' });
    assert.deepEqual(rules.getMemberChangeDecision(admin, change, 1), { allowed: true });
  }
});
test('member promotion and non-admin deactivation do not require another admin count', () => {
  const member = { role: 'Member', isActive: true };
  assert.deepEqual(rules.getMemberChangeDecision(member, { operation: 'change-role', role: 'SuperAdmin' }, 0), { allowed: true });
  assert.deepEqual(rules.getMemberChangeDecision(member, { operation: 'deactivate' }, 0), { allowed: true });
});
test('inactive targets and no-op role updates are rejected', () => {
  assert.equal(rules.getMemberChangeDecision({ ...admin, isActive: false }, { operation: 'deactivate' }, 1).reason, 'inactive_member');
  assert.equal(rules.getMemberChangeDecision({ ...admin, isActive: false }, { operation: 'change-role', role: 'Member' }, 1).reason, 'inactive_member');
  assert.equal(rules.getMemberChangeDecision(admin, { operation: 'change-role', role: 'SuperAdmin' }, 0).reason, 'unchanged_role');
});
test('invalid counts, unknown current/destination roles and unsupported operations fail closed', () => {
  for (const count of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(rules.getMemberChangeDecision(admin, { operation: 'deactivate' }, count).reason, 'invalid_state');
  assert.equal(rules.getMemberChangeDecision({ role: 'Owner', isActive: true }, { operation: 'deactivate' }, 2).reason, 'invalid_state');
  assert.equal(rules.getMemberChangeDecision(admin, { operation: 'change-role', role: 'Owner' }, 2).reason, 'invalid_state');
  assert.equal(rules.getMemberChangeDecision(admin, { operation: 'reactivate' }, 2).reason, 'invalid_state');
});
test('invitation email is normalized and the role must be explicit', () => {
  assert.deepEqual(rules.createInvitationSchema.parse({ email: ' New@Example.Test ', role: 'Developer' }), { email: 'new@example.test', role: 'Developer' });
  for (const input of [{ email: 'bad', role: 'Member' }, { email: 'a@example.test' }, { email: 'a@example.test', role: 'Owner' }]) assert.equal(rules.createInvitationSchema.safeParse(input).success, false);
});
test('existing accounts cannot be reinvited or moved; existing invites require resend', () => {
  assert.deepEqual(rules.getInvitationCreationDecision(false, false), { allowed: true });
  assert.deepEqual(rules.getInvitationCreationDecision(false, true), { allowed: false, reason: 'use_resend' });
  for (const exists of [false, true]) assert.deepEqual(rules.getInvitationCreationDecision(true, exists), { allowed: false, reason: 'account_exists' });
});
test('invitation expiry is exclusive at the boundary; invalid dates fail closed', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  assert.equal(rules.INVITATION_LIFETIME_MS, 86_400_000);
  assert.equal(rules.isInvitationUnexpired(new Date(now.getTime() + 1), now), true);
  for (const date of [now, new Date(now.getTime() - 1), new Date('invalid')]) assert.equal(rules.isInvitationUnexpired(date, now), false);
  assert.equal(rules.isInvitationUnexpired(now, new Date('invalid')), false);
});
