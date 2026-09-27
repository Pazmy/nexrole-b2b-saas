import "dotenv/config";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const expect = baseExpect.configure({ timeout: 20_000 });

test("invitation UI preserves the form and completes preview invite, resend, revoke and join", async ({ browser }) => {
  test.setTimeout(180_000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const tenant = randomUUID(), foreignTenant = randomUUID();
  const emails = Array.from({ length: 5 }, () => randomUUID() + "@example.test");
  emails.push("fail-" + randomUUID() + "@example.test");
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, reader, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  const previews = path.resolve(".email-previews");
  const invitationRegion = admin.getByRole("region", { name: "Pending invitations" });
  const row = (email: string) => invitationRegion.getByRole("row").filter({ hasText: email });
  async function login(page: Page, email: string) {
    await page.goto("/login"); await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill("InvitationTest123!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard Overview" })).toBeVisible();
    await page.goto("/settings?tab=team");
    await expect(page.getByRole("heading", { name: "Membership Log", exact: true })).toBeVisible();
  }
  async function previewLink(email: string, previous?: string) {
    let found = "";
    await expect.poll(async () => {
      for (const filename of (await readdir(previews)).sort().reverse()) {
        const content = await readFile(path.join(previews, filename), "utf8");
        if (!content.startsWith(`To: ${email}\n`)) continue;
        const match = content.match(/https?:\/\/[^\s]+\/register\/invite\?token=[a-f0-9]+/);
        if (match) {
          const url = new URL(match[0]); const local = url.pathname + url.search;
          if (local !== previous) { found = local; return true; }
        }
      }
      return false;
    }).toBe(true);
    return found;
  }
  try {
    const hash = await bcrypt.hash("InvitationTest123!", 4);
    for (const id of [tenant, foreignTenant]) await db.query('INSERT INTO tenants (id,name,"updatedAt") VALUES ($1,$2,NOW())', [id, "Invitation UI " + id]);
    for (const [i, role] of ["SuperAdmin", "Member"].entries()) {
      await db.query('INSERT INTO roles (name,permissions,"updatedAt") VALUES ($1,$2,NOW()) ON CONFLICT (name) DO NOTHING', [role, "[]"]);
      await db.query('INSERT INTO users (email,"passwordHash","tenantId","roleId","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name=$4),NOW(),NOW())', [emails[i], hash, tenant, role]);
    }
    await db.query('INSERT INTO invitations (email,token,"roleId","tenantId","expiresAt") VALUES ($1,$2,(SELECT id FROM roles WHERE name=$3),$4,NOW()+INTERVAL \'1 day\')', [emails[4], createHash("sha256").update(randomUUID()).digest("hex"), "Member", foreignTenant]);
    await login(admin, emails[0]); await login(reader, emails[1]);
    await expect(reader.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "+ Invite Workspace Member", exact: true })).toHaveCount(0);
    await expect(invitationRegion.getByText("No pending invitations.")).toBeVisible();
    await expect(admin.getByText(emails[4], { exact: true })).toHaveCount(0);
    await admin.getByRole("button", { name: "+ Invite Workspace Member", exact: true }).click();
    await admin.getByLabel("Invite a teammate").fill(emails[2]);
    await admin.getByLabel("Assigned role", { exact: true }).selectOption("Developer");
    await db.query("BEGIN"); await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenant]);
    try {
      await admin.getByRole("button", { name: "Send invitation", exact: true }).click();
      await expect(admin.getByRole("button", { name: "Sending invitation..." })).toBeDisabled();
      await expect(admin.getByLabel("Assigned role", { exact: true })).toBeDisabled();
    } finally { await db.query("ROLLBACK"); }
    await expect(admin.getByText("Invitation sent. Your teammate can use the email link to join.")).toBeVisible();
    await expect(row(emails[2]).getByText("Developer", { exact: true })).toBeVisible();
    await invitationRegion.screenshot({ path: test.info().outputPath("invitations.png") });
    const originalLink = await previewLink(emails[2]);
    await admin.getByRole("button", { name: "Invite Another User" }).click();
    await expect(admin.getByLabel("Assigned role", { exact: true })).toHaveValue("Member");
    await admin.getByLabel("Invite a teammate").fill(emails[2]);
    await admin.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(admin.getByText("An invitation already exists for this email. Use Resend or revoke it first.")).toBeVisible();
    await admin.getByLabel("Invite a teammate").fill(emails[1]);
    await admin.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(admin.getByText("An account with this email already exists. It cannot join another workspace.")).toBeVisible();
    await admin.getByRole("button", { name: "Cancel", exact: true }).click();
    await db.query('UPDATE invitations SET "expiresAt"=$3 WHERE "tenantId"=$1 AND email=$2', [tenant, emails[2], new Date(1)]);
    await admin.reload();
    await expect(row(emails[2]).getByText("Expired / not ready")).toBeVisible();
    await row(emails[2]).getByRole("button", { name: "Resend", exact: true }).click();
    await expect(invitationRegion.getByRole("status")).toContainText("Invitation email sent.");
    await expect(row(emails[2]).getByText("Pending", { exact: true })).toBeVisible();
    const currentLink = await previewLink(emails[2], originalLink);
    await guest.goto(originalLink);
    await expect(guest.getByRole("heading", { name: "This invitation is no longer available" })).toBeVisible();
    await guest.goto(currentLink);
    await expect(guest.getByRole("heading", { name: "Join Workspace" })).toBeVisible();
    await guest.getByLabel("Account Password", { exact: true }).fill("InvitationTest123!");
    await guest.getByRole("button", { name: "Complete Workspace Enrollment" }).click();
    await expect(guest.getByRole("status")).toContainText("You have joined the workspace");
    await guest.goto(currentLink);
    await expect(guest.getByRole("heading", { name: "This invitation is no longer available" })).toBeVisible();
    await login(guest, emails[2]);
    await expect(guest.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
    await admin.reload(); await expect(row(emails[2])).toHaveCount(0);
    const joined = await db.query('SELECT r.name FROM users u JOIN roles r ON r.id=u."roleId" WHERE u.email=$1 AND u."tenantId"=$2', [emails[2], tenant]);
    expect(joined.rows[0].name).toBe("Developer");
    // Complete the same invited account's journey with already-open sessions.
    const joinedRow = admin.getByRole("row").filter({ hasText: emails[2] });
    await joinedRow.getByRole("combobox").selectOption("Member");
    await joinedRow.getByRole("button", { name: "Save role" }).click();
    await expect(joinedRow.getByRole("status")).toHaveText("Member role updated.");
    await guest.goto("/settings?tab=team"); await expect(guest).toHaveURL(/\/login/);
    await login(guest, emails[2]);
    await expect(guest.getByRole("combobox")).toHaveCount(0);
    await joinedRow.getByRole("button", { name: "Deactivate", exact: true }).click();
    await joinedRow.getByRole("button", { name: "Confirm deactivation" }).click();
    await expect(joinedRow.getByText("Inactive", { exact: true })).toBeVisible();
    await guest.goto("/settings?tab=team"); await expect(guest).toHaveURL(/\/login/);
    await admin.getByRole("button", { name: "+ Invite Workspace Member", exact: true }).click();
    await admin.getByLabel("Invite a teammate").fill(emails[3]);
    await admin.getByLabel("Assigned role", { exact: true }).selectOption("SuperAdmin");
    await expect(admin.getByText("SuperAdmin can manage members, invitations, billing and API keys.")).toBeVisible();
    await admin.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(row(emails[3])).toBeVisible();
    const revokedLink = await previewLink(emails[3]);
    await row(emails[3]).getByRole("button", { name: "Revoke", exact: true }).click();
    await row(emails[3]).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(row(emails[3])).toBeVisible();
    await row(emails[3]).getByRole("button", { name: "Revoke", exact: true }).click();
    await row(emails[3]).getByRole("button", { name: "Confirm revoke", exact: true }).click();
    await expect(invitationRegion.getByRole("status")).toContainText("Invitation revoked.");
    await expect(row(emails[3])).toHaveCount(0);
    await expect(invitationRegion.getByText("No pending invitations.")).toBeVisible();
    await reader.goto(revokedLink);
    await expect(reader.getByRole("heading", { name: "This invitation is no longer available" })).toBeVisible();
    if (process.env.E2E_RESEND_STUB === "true") {
      await admin.getByRole("button", { name: "+ Invite Workspace Member", exact: true }).click();
      await admin.getByLabel("Invite a teammate").fill(emails[5]);
      await admin.getByRole("button", { name: "Send invitation", exact: true }).click();
      await expect(admin.getByText("We could not send the invitation. No new link is usable. Retry the invitation.")).toBeVisible();
      await admin.getByRole("button", { name: "Cancel", exact: true }).click();
      const raw = randomUUID().replaceAll("-", "").repeat(2);
      await db.query('INSERT INTO invitations (email,token,"roleId","tenantId","expiresAt") VALUES ($1,$2,(SELECT id FROM roles WHERE name=$3),$4,$5)', [emails[5], createHash("sha256").update(raw).digest("hex"), "Member", tenant, new Date(Date.now() + 86400000)]);
      await admin.reload(); await row(emails[5]).getByRole("button", { name: "Resend", exact: true }).click();
      await expect(invitationRegion.getByRole("alert")).toContainText("We could not send the invitation");
      await expect(row(emails[5]).getByText("No active link. Refresh or resend.")).toBeVisible();
      await reader.goto("/register/invite?token=" + raw);
      await expect(reader.getByRole("heading", { name: "This invitation is no longer available" })).toBeVisible();
      await row(emails[5]).getByRole("button", { name: "Revoke", exact: true }).click();
      await row(emails[5]).getByRole("button", { name: "Confirm revoke", exact: true }).click();
      await expect(row(emails[5])).toHaveCount(0);
    }
  } finally {
    await db.query("ROLLBACK");
    for (const context of contexts) await context.close();
    for (const id of [tenant, foreignTenant]) {
      await db.query('DELETE FROM invitations WHERE "tenantId"=$1', [id]);
      await db.query('DELETE FROM tenants WHERE id=$1 AND name=$2', [id, "Invitation UI " + id]);
    }
    for (const filename of await readdir(previews).catch(() => [])) {
      const file = path.join(previews, filename); const content = await readFile(file, "utf8");
      if (emails.some((email) => content.startsWith(`To: ${email}\n`))) await unlink(file);
    }
    await db.end();
  }
});
