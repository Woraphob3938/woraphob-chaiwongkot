import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signIn } from "./helpers";

// Read-only checks: nothing here creates, edits or deletes data, so the suite
// can run against the local database at any time.

test("guests can browse the trainer marketplace", async ({ page }) => {
  await page.goto("/trainers");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a member lands on their bookings", async ({ page }) => {
  await signIn(page, "member");
  await page.goto("/member");
  await expect(page.getByRole("link", { name: "การจองของฉัน" }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the trainer workspace opens on the weekly calendar", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/trainer");
  const calendar = page.locator("#schedule");
  await expect(calendar.getByRole("heading", { name: "ตารางงาน" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "นัดของสมาชิก" })).toBeVisible();
  await expect(calendar.getByRole("group")).toHaveCount(7);
  await expectNoHorizontalOverflow(page);
});

test("the trainer can browse weeks and open the add-slot dialog", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/trainer");
  const range = page.locator(".trainer-cal__title p");
  // Wait for the hydrated calendar before reading or clicking, or the first
  // click can land before React has attached its handlers.
  await expect(page.locator("#schedule .trainer-cal__scroll")).toBeVisible();
  await expect(range).toContainText("–");
  const before = await range.textContent();
  await page.getByRole("button", { name: "7 วันถัดไป" }).click();
  await expect(range).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "วันนี้" }).click();
  await expect(range).toHaveText(before ?? "");

  await page.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" }).click();
  const dialog = page.getByRole("dialog", { name: "เพิ่มช่วงเวลาว่าง" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(dialog).toBeHidden();
});

test("trainer members and reviews stay paged", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/trainer");
  await page.getByRole("tab", { name: /สมาชิก/ }).click();
  // A freshly reset database has no members yet; then the empty state shows.
  const members = page.getByRole("list", { name: "รายชื่อสมาชิก" });
  await expect(members.or(page.getByText("ยังไม่มีสมาชิก"))).toBeVisible();
  if (await members.count()) {
    expect(await members.locator(":scope > li").count()).toBeLessThanOrEqual(10);
  }

  await page.getByRole("tab", { name: "รีวิว" }).click();
  const reviews = page.getByRole("list", { name: "รีวิวจากสมาชิก" });
  if (await reviews.count()) {
    expect(await reviews.locator(":scope > li").count()).toBeLessThanOrEqual(5);
  }
});

test("the admin review queue holds trainer applications and no slips", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin");
  await expect(page.getByText("ใบสมัครรอตรวจ")).toBeVisible();
  // Payments settle through Stripe Checkout; nothing about slips is left to review.
  await expect(page.getByText(/สลิป/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("the trainer finance tab offers the Stripe payout account", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/trainer?stripe=return");
  await expect(page.getByRole("heading", { name: "บัญชีรับเงิน" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the trainer profile zooms its photo and the booking page leads back to it", async ({ page }) => {
  await page.goto("/trainers");
  const profileLink = page.locator('a[href^="/trainers/"]').first();
  const href = await profileLink.getAttribute("href");
  await profileLink.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "ขยายรูป" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const slug = new URL(href ?? "", "http://localhost").pathname.split("/")[2];
  await page.goto(`/booking?trainer=${slug}`);
  await expect(page.getByRole("link", { name: "ย้อนกลับ" })).toHaveAttribute("href", `/trainers/${slug}`);
  await expectNoHorizontalOverflow(page);
});

test("the member welcome steps open without saving anything", async ({ page }, info) => {
  await signIn(page, "member");
  await page.goto("/member/welcome");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ยินดีต้อนรับ");
  await expect(page.getByRole("link", { name: "ข้ามไปก่อน" })).toHaveAttribute("href", "/trainers");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `output/member-welcome-${info.project.name}.png`, fullPage: true });

  // "ถัดไป" must open step two, not submit the form and leave the page.
  await page.getByLabel("ชื่อ", { exact: true }).fill("ทดสอบ");
  await page.getByLabel("นามสกุล").fill("ทดสอบ");
  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await expect(page.getByRole("heading", { name: "เป้าหมายการฝึก", level: 2 })).toBeVisible();
  await expect(page).toHaveURL(/\/member\/welcome/);
});

test("the notification page names itself like the menu and never scrolls sideways", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "การแจ้งเตือน" })).toBeVisible();
  // A clean database has no notifications: one message, no empty toolbar.
  const list = page.getByRole("list", { name: "รายการแจ้งเตือน" });
  await expect(list.or(page.getByText("ยังไม่มีการแจ้งเตือน", { exact: true }))).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the brand fonts load from the app itself, not from Google Fonts", async ({ page }, info) => {
  const googleRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) googleRequests.push(request.url());
  });
  await page.goto("/trainers");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement);
    const faces = [
      ["--font-chakra", "600"],
      ["--font-bai", "400"],
      ["--font-bai", "700"],
      ["--font-jetbrains", "600"],
    ] as const;
    const counts = [];
    for (const [variable, weight] of faces) {
      const family = root.getPropertyValue(variable).trim();
      // "ทดสอบ BK-49D693F7" covers both the Thai and the Latin glyphs.
      counts.push((await document.fonts.load(`${weight} 16px ${family}`, "ทดสอบ BK-49D693F7")).length);
    }
    return counts;
  });
  expect(loaded.every((count) => count > 0)).toBe(true);
  expect(googleRequests).toEqual([]);
  await page.screenshot({ path: `output/fonts-${info.project.name}.png` });
});

test("the trainer tabs sit on one row and the calendar starts today", async ({ page }) => {
  await signIn(page, "trainer");
  await page.goto("/trainer");
  await expect(page.locator("#schedule .trainer-cal__scroll")).toBeVisible();
  const tops = await page.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(page.locator("#schedule [role=group]").first()).toHaveClass(/is-today/);
  await expectNoHorizontalOverflow(page);
});
