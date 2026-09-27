import "dotenv/config";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const expect = baseExpect.configure({ timeout: 20_000 });

test("member controls preserve the roster, invalidate sessions, and protect the last admin", async ({ browser }) => {
  test.setTimeout(180_000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tenant = randomUUID();
  const members = ["SuperAdmin", "Member", "Developer"].map((role) => ({ id: randomUUID(), email: randomUUID() + "@example.test", role }));
  const contexts = await Promise.all(members.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const row = (page: Page, index: number) => page.getByRole("row").filter({ hasText: members[index].email });
  async function login(page: Page, index: number) {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(members[index].email);
    await page.locator('input[type="password"]').fill("MembershipTest123!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard Overview" })).toBeVisible();
    await page.goto("/settings/members");
    await expect(page).toHaveURL(/\/settings\?tab=team$/);
    await expect(page.getByRole("heading", { name: "Membership Log", exact: true })).toBeVisible();
  }
  try {
    const hash = await bcrypt.hash("MembershipTest123!", 4);
    await db.query('INSERT INTO tenants (id, name, "subscriptionStatus", "updatedAt") VALUES ($1, $2, $3, NOW())', [tenant, "Member UI test " + tenant, "free"]);
    for (const member of members) {
      await db.query('INSERT INTO roles (name, permissions, "updatedAt") VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING', [member.role, "[]"]);
      await db.query('INSERT INTO users (id, email, "passwordHash", "tenantId", "roleId", "emailVerifiedAt", "updatedAt") VALUES ($1,$2,$3,$4,(SELECT id FROM roles WHERE name=$5),NOW(),NOW())', [member.id, member.email, hash, tenant, member.role]);
    }
    for (const route of ["/settings/members", "/settings/roles"]) {
      await pages[0].goto(route);
      await expect(pages[0]).toHaveURL(/\/login/);
    }
    for (let i = 0; i < pages.length; i++) {
      await login(pages[i], i);
      await pages[i].getByRole("link", { name: "View role permissions" }).click();
      await expect(pages[i].getByRole("heading", { name: "Workspace roles" })).toBeVisible();
      const matrix = pages[i].getByRole("table", { name: "Workspace role permissions" });
      await expect(matrix.getByRole("row").filter({ hasText: "View transactions" }).getByRole("cell", { name: "Allowed", exact: true })).toHaveCount(3);
      const management = matrix.getByRole("row").filter({ hasText: "Change member roles and deactivate members" });
      await expect(management.getByRole("cell", { name: "Allowed", exact: true })).toHaveCount(1);
      await expect(management.getByRole("cell", { name: "Not allowed", exact: true })).toHaveCount(2);
      await pages[i].getByRole("link", { name: "Back to Team Members" }).click();
      await expect(pages[i].getByRole("heading", { name: "Membership Log", exact: true })).toBeVisible();
    }
    const [admin, promoted, developer] = pages;
    for (const readonly of [promoted, developer]) {
      await expect(readonly.getByRole("combobox")).toHaveCount(0);
      await expect(readonly.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);
      await expect(readonly.getByRole("columnheader", { name: "System Enrollment Timestamp" })).toBeVisible();
    }
    await expect(row(admin, 0).getByRole("combobox")).toBeDisabled();
    await expect(row(admin, 0).getByText("Keep at least one", { exact: false })).toBeVisible();
    await row(admin, 1).getByRole("combobox").selectOption("Developer");
    await row(admin, 1).getByRole("button", { name: "Save role" }).click();
    await expect(row(admin, 1).getByRole("status")).toHaveText("Member role updated.");
    await expect(row(admin, 1).getByRole("combobox")).toHaveValue("Developer");
    await promoted.goto("/settings?tab=team");
    await expect(promoted).toHaveURL(/\/login/);
    await login(promoted, 1);
    await expect(promoted.getByRole("combobox")).toHaveCount(0);

    await row(admin, 2).getByRole("button", { name: "Deactivate", exact: true }).click();
    await row(admin, 2).getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await db.query('SELECT "isActive" FROM users WHERE id=$1', [members[2].id])).rows[0].isActive).toBe(true);
    await row(admin, 2).getByRole("button", { name: "Deactivate", exact: true }).click();
    await db.query("BEGIN");
    await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenant]);
    try {
      await row(admin, 2).getByRole("button", { name: "Confirm deactivation" }).click();
      await expect(row(admin, 2).getByText("Saving changes…")).toBeVisible();
      await expect(row(admin, 2).getByRole("button", { name: "Confirm deactivation" })).toBeDisabled();
    } finally { await db.query("ROLLBACK"); }
    await expect(row(admin, 2).getByRole("status")).toHaveText("Member deactivated.");
    await expect(row(admin, 2).getByText("Inactive", { exact: true })).toBeVisible();
    await expect(row(admin, 2).getByRole("combobox")).toHaveCount(0);
    await developer.goto("/settings?tab=team");
    await expect(developer).toHaveURL(/\/login/);

    await row(admin, 1).getByRole("combobox").selectOption("SuperAdmin");
    await row(admin, 1).getByRole("button", { name: "Save role" }).click();
    await expect(row(admin, 1).getByRole("combobox")).toHaveValue("SuperAdmin");
    await expect(row(admin, 0).getByRole("combobox")).toBeEnabled();
    await login(promoted, 1);
    await expect(row(promoted, 1).getByRole("combobox")).toBeEnabled();
    await row(admin, 0).getByRole("combobox").selectOption("Member");
    await row(admin, 0).getByRole("button", { name: "Save role" }).click();
    await expect(admin).toHaveURL(/\/login/);
    // The other admin's stale page still offers self-demotion; the server must reject it.
    await row(promoted, 1).getByRole("combobox").selectOption("Member");
    await row(promoted, 1).getByRole("button", { name: "Save role" }).click();
    await expect(row(promoted, 1).getByRole("alert")).toContainText("Keep at least one other active, verified administrator");
    await row(promoted, 1).getByRole("link", { name: "Refresh member list" }).click();
    await expect(row(promoted, 1).getByRole("combobox")).toBeDisabled();
    await login(admin, 0);
    await expect(admin.getByRole("combobox")).toHaveCount(0);
    const results = await db.query('SELECT id, "sessionVersion", "isActive" FROM users WHERE "tenantId"=$1', [tenant]);
    expect(results.rows.find((user) => user.id === members[0].id).sessionVersion).toBe(1);
    expect(results.rows.find((user) => user.id === members[1].id).sessionVersion).toBe(2);
    expect(results.rows.find((user) => user.id === members[2].id).isActive).toBe(false);
  } finally {
    await db.query("ROLLBACK");
    for (const context of contexts) await context.close();
    await db.query('DELETE FROM tenants WHERE id=$1 AND name=$2', [tenant, "Member UI test " + tenant]);
    await db.end();
  }
});
