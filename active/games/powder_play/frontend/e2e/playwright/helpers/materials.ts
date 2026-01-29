import type { Page } from "@playwright/test";

export async function loadMaterialByName(page: Page, name: string) {
  const nameMatcher = new RegExp(`^${name}$`);
  const row = page
    .locator("#materials-list > div")
    .filter({ has: page.locator("strong", { hasText: nameMatcher }) })
    .first();
  if ((await row.count()) === 0) {
    await page.locator("#show-all-materials").check();
    await row.first().waitFor({ state: "visible" });
  }
  await row.click();
  await page.waitForFunction(
    (n) => document.getElementById("status")?.textContent?.includes(n),
    name,
    { timeout: 5000 },
  );
}
