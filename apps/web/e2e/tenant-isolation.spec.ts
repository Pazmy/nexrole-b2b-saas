import { test, expect } from "@playwright/test";

test.describe("B2B SaaS Multi-Tenant Boundary Controls", () => {
  test("should enforce absolute data isolation between Tenant A and Tenant B", async ({
    browser,
  }) => {
    // ------------------------------------------------------------------------
    // LAYER 1: ASSESSMENT OF TENANT A (Sensei Corp Profile)
    // ------------------------------------------------------------------------
    // Create an entirely isolated browser window context (simulates a clean user machine)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // 1. Navigate to portal login
    await pageA.goto("/login");
    await pageA.fill('input[type="email"]', "admin@sensei.com");
    await pageA.fill('input[type="password"]', "admin123");
    await pageA.click('button[type="submit"]');

    // 2. Wait for landing dashboard completion parameters
    await expect(pageA.locator("text=Dashboard Overview")).toBeVisible({
      timeout: 10000,
    });

    // 3. Navigate directly to operational ledger logs
    await pageA.goto("/transactions");
    await expect(pageA.locator("text=Ledger Operations")).toBeVisible();

    // 4. Confirm Tenant A's seed data text is explicitly present
    const tenantADataText = "B2B Custom Integration Advisory Services";
    await expect(pageA.locator(`text=${tenantADataText}`)).toBeVisible();

    console.log(
      "✅ Tenant A data validation verified inside Sensei Corp workspace layout.",
    );

    // ------------------------------------------------------------------------
    // LAYER 2: ASSESSMENT OF TENANT B (Glowstone Profile)
    // ------------------------------------------------------------------------
    // Spin up a completely separate, concurrent context (simulates another company logging in at the same time)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // 1. Authenticate as a completely different company tenant profile
    await pageB.goto("/login");
    await pageB.fill('input[type="email"]', "admin@glowstone.io");
    await pageB.fill('input[type="password"]', "admin123");
    await pageB.click('button[type="submit"]');

    // 2. Wait for confirmation landing
    await expect(pageB.locator("text=Dashboard Overview")).toBeVisible({
      timeout: 10000,
    });

    // 3. Route to the ledger viewport
    await pageB.goto("/transactions");
    await expect(pageB.locator("text=Ledger Operations")).toBeVisible();

    // 4. HARD COMPLIANCE SECURITY CHECK: Ensure Tenant A's private string NEVER leaks into Tenant B's workspace
    const leakedElement = pageB.locator(`text=${tenantADataText}`);
    await expect(leakedElement).not.toBeVisible();

    console.log(
      "🔒 MULTI-TENANT CROSS OVER EXPOSURE CHECK PASSED: Tenant B UI strictly blocked from inspecting Tenant A files.",
    );

    // Clean up memory profiles
    await contextA.close();
    await contextB.close();
  });
});
