import { expect, type Page } from "@playwright/test";

/** Demo accounts from backend/database/seed.sql (local only). */
export const DEMO = {
  member: "member.demo@fitconnect.local",
  trainer: "trainer.a@fitconnect.local",
  admin: "admin.demo@fitconnect.local",
} as const;
const DEMO_PASSWORD = "password";

export async function signIn(page: Page, role: keyof typeof DEMO) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(DEMO[role]);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(DEMO_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The page must never scroll sideways (DESIGN.md §5). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
