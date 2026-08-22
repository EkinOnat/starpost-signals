import { expect, test } from "@playwright/test";

test("navigates the responsive Signals, Grants, and Activity views with a mocked wallet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /choose the next/i })).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByText("Mock Freighter", { exact: true })).toBeVisible();
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile).toBeVisible();
  await mobile.getByRole("button", { name: /grants/i }).click();
  await expect(page.getByRole("heading", { name: "Community grants" })).toBeVisible();
  await mobile.getByRole("button", { name: /activity/i }).click();
  await expect(page.getByText("VERIFIED CONTRACT ACTIVITY")).toBeVisible();
  await expect(page.getByText("10 VERIFIED EVENTS")).toBeVisible();
});

test("guides a first-time supporter from wallet readiness to confirmed proof", async ({ page }) => {
  await page.goto("/");
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await mobile.getByRole("button", { name: /start/i }).click();
  await expect(page.getByRole("heading", { name: /choose how you want to help/i })).toBeVisible();
  await page.getByRole("radio", { name: /supporter/i }).click();
  await page.getByRole("button", { name: /continue to wallet/i }).click();
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await expect(page.getByText("5,000.00 XLM")).toBeVisible();
  await page.getByRole("button", { name: /choose an action/i }).click();
  await page.getByRole("button", { name: /open signals/i }).click();
  await page.getByRole("button", { name: /payments/i }).first().click();
  await page.getByRole("button", { name: /cast this signal/i }).click();
  await expect(page.getByText("Confirmed by Stellar RPC", { exact: false })).toBeVisible();
  await mobile.getByRole("button", { name: /start/i }).click();
  await expect(page.getByRole("heading", { name: /confirmed by stellar rpc/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /inspect transaction/i })).toBeVisible();
});

test("reads verified Level 4 deployment proof without fabricated projects", async ({ page }) => {
  await page.goto("/");
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await mobile.getByRole("button", { name: /proof/i }).click();
  await expect(page.getByRole("heading", { name: /fund the work/i })).toBeVisible();
  await expect(page.getByText("Level 4 contracts are not configured")).toHaveCount(0);
  await expect(page.getByText("DEPLOYED V1 CONTRACTS")).toBeVisible();
  await expect(page.getByText("VERIFIED TRANSACTIONS")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof infrastructure is live" })).toBeVisible();
  await expect(page.getByRole("button", { name: /create proof project/i })).toBeEnabled();
  await expect(page.locator(".deployment-proof-card")).toHaveCount(2);
  await expect(page.locator(".impact-project-card:not(.deployment-proof-card)")).toHaveCount(0);
});

test("creates a grant through review and all confirmed transaction stages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: /grants/i }).click();
  await page.getByRole("button", { name: /create a grant/i }).first().click();
  await page.getByLabel("Grant title").fill("Open remittance toolkit");
  await page.getByLabel("Purpose").fill("Ship a reusable Testnet remittance flow with public delivery evidence.");
  await page.getByRole("button", { name: /review grant/i }).click();
  await expect(page.getByText("Wallet signature required")).toBeVisible();
  await page.getByRole("button", { name: /create on testnet/i }).click();
  await expect(page.getByText("Confirmed by Stellar RPC", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /check transaction/i })).toBeVisible();
});

test("contributes and synchronizes an injected contract event to a second browser view", async ({ page, context }) => {
  const second = await context.newPage();
  await Promise.all([page.goto("/"), second.goto("/")]);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: /grants/i }).click();
  await page.getByRole("button", { name: /open climate receipts/i }).click();
  await page.getByRole("button", { name: /vote yes/i }).click();
  await expect(page.getByText("Confirmed by Stellar RPC", { exact: false })).toBeVisible();

  await second.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: /activity/i }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("starpost:e2e-event", { detail: {
      id: "e2e-live-event",
      kind: "ContributionMade",
      contractId: "C-E2E",
      grantId: 2,
      actor: "GMOCK...TEST",
      amount: 25,
      total: 5025,
      txHash: "e2e-live-hash",
      ledger: 999999,
      closedAt: new Date().toISOString(),
    } }));
  });
  await expect(second.getByText("GMOCK...TEST")).toBeVisible();
  await second.close();
});
