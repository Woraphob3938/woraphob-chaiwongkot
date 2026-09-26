// Uses the notification centre with the keyboard only, and makes the API fail in
// the ways a real deployment fails. Run:
//   node scripts/audit-notifications-keyboard.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  const root = process.env.PLAYWRIGHT_ROOT;
  const pkg = root
    ? await import(pathToFileURL(createRequire(`${root}/`).resolve("playwright")).href)
    : await import("playwright");
  return { chromium: pkg.chromium ?? pkg.default?.chromium };
}

const { chromium } = await loadPlaywright();
const base = process.env.AUDIT_BASE ?? "http://localhost:3000";
const api = process.env.AUDIT_API ?? "http://localhost/fitconnect-api";

const login = await fetch(`${api}/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "member.demo@fitconnect.local", password: "password" }),
});
const session = (await login.json()).data;
if (!session?.token) throw new Error("login failed — clear rate_limits if the limiter blocked this address");

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chrome" });

async function openPage(setup) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([token, user]) => {
    localStorage.setItem("fitconnect_token", token);
    localStorage.setItem("fitconnect_user", JSON.stringify(user));
  }, [session.token, session.user]);
  if (setup) await setup(page);
  await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { page, errors };
}

const describeFocus = (page) => page.evaluate(() => {
  const active = document.activeElement;
  if (!active || active === document.body) return "(body)";
  return `${active.tagName.toLowerCase()}:${(active.getAttribute("aria-label") ?? active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}`;
});

// --- keyboard only ----------------------------------------------------------
{
  const { page, errors } = await openPage();
  await page.evaluate(() => document.body.focus());
  const order = [];
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press("Tab");
    order.push(await describeFocus(page));
  }
  check("Tab reaches the category controls", order.some((entry) => /การจอง/.test(entry)), order.slice(0, 8).join(" > "));
  check("Tab reaches a notification row", order.some((entry) => /ยังไม่ได้อ่าน|อ่านแล้ว/.test(entry)), order.slice(0, 12).join(" > "));
  const uniqueStops = new Set(order.filter((entry) => entry !== "(body)")).size;
  check("Tab does not loop on one stop", uniqueStops >= 5, `${uniqueStops} distinct stops in 14 presses`);

  // Enter on a row must open the detail, and focus must remain usable after.
  await page.evaluate(() => {
    const row = document.querySelector(".notification-list li button");
    row.focus();
  });
  const beforeEnter = await page.locator(".notification-detail-panel h2").textContent().catch(() => null);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const afterEnter = await page.locator(".notification-detail-panel h2").textContent().catch(() => null);
  check("Enter on a focused row opens its detail", Boolean(afterEnter?.trim()), `${JSON.stringify(beforeEnter)} -> ${JSON.stringify(afterEnter)}`);
  const focusAfterOpen = await describeFocus(page);
  check("focus is not lost after opening a row", focusAfterOpen !== "(body)", focusAfterOpen);

  // The category control must be operable from the keyboard too.
  await page.evaluate(() => document.querySelectorAll(".notification-categories button")[2].focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const pressed = await page.evaluate(() =>
    document.querySelectorAll(".notification-categories button")[2].getAttribute("aria-pressed"));
  check("Enter activates a category and it reports as pressed", pressed === "true", `aria-pressed=${pressed}`);

  // Space must not scroll the page instead of activating a focused button.
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => document.querySelectorAll(".notification-categories button")[0].focus());
  await page.keyboard.press(" ");
  await page.waitForTimeout(1200);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const firstPressed = await page.evaluate(() =>
    document.querySelectorAll(".notification-categories button")[0].getAttribute("aria-pressed"));
  check("Space activates the focused control without scrolling the page", firstPressed === "true" && scrollAfter === scrollBefore, `aria-pressed=${firstPressed}, scrollY ${scrollBefore} -> ${scrollAfter}`);

  // Escape is expected to be harmless when nothing is open.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape does not break the page", (await page.locator(".notification-list").count()) === 1);

  check("keyboard session produced no console errors", errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  await page.close();
}

// --- failure modes ----------------------------------------------------------
{
  // 500 on the list request.
  const { page } = await openPage(async (target) => {
    await target.route(`${api}/v1/notifications?*`, (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "SERVER_ERROR", message: "บริการขัดข้อง กรุณาลองใหม่" } }),
    }));
  });
  const errorText = (await page.locator(".notification-center").textContent())?.replace(/\s+/g, " ") ?? "";
  check("a 500 shows an error instead of an empty inbox", /ขัดข้อง|ไม่สำเร็จ|ลองใหม่/.test(errorText), errorText.slice(0, 90));
  const retry = page.getByRole("button", { name: /ลองใหม่/ }).first();
  const hasRetry = (await retry.count()) > 0;
  check("a 500 offers a retry", hasRetry);
  if (hasRetry) {
    await page.unroute(`${api}/v1/notifications?*`);
    await retry.click();
    await page.waitForTimeout(1800);
    const rows = await page.locator(".notification-list li").count();
    check("retry recovers once the API answers again", rows > 0, `${rows} rows after retry`);
  }
  await page.close();
}

{
  // 401 on the list request.
  const { page } = await openPage(async (target) => {
    await target.route(`${api}/v1/notifications?*`, (route) => route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INVALID_TOKEN", message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" } }),
    }));
  });
  const text = (await page.locator(".notification-center").textContent())?.replace(/\s+/g, " ") ?? "";
  check("a 401 asks the visitor to sign in", /เข้าสู่ระบบ/.test(text), text.slice(0, 90));
  check("a 401 does not blame the server", !/Apache|MySQL|XAMPP/.test(text));
  const loginLink = page.getByRole("link", { name: /เข้าสู่ระบบ/ });
  check("a 401 links to the sign-in page", (await loginLink.count()) > 0 && (await loginLink.first().getAttribute("href")) === "/login");
  await page.close();
}

{
  // Network failure, as if Apache were down. The pattern must name the API host,
  // otherwise it also aborts the page navigation itself.
  const { page } = await openPage(async (target) => {
    await target.route(`${api}/v1/notifications**`, (route) => route.abort("connectionrefused"));
  });
  const text = (await page.locator(".notification-center").textContent())?.replace(/\s+/g, " ") ?? "";
  check("an unreachable API explains itself in the user''s terms", /เชื่อมต่อบริการ FitConnect ไม่ได้|ยังไม่พร้อมใช้งาน/.test(text), text.slice(0, 110));
check("an unreachable API does not name Apache or MySQL", !/Apache|MySQL|XAMPP/.test(text), text.slice(0, 90));
  check("an unreachable API offers a retry", (await page.getByRole("button", { name: /ลองใหม่/ }).count()) > 0);
  await page.close();
}

{
  // Failure while loading a detail.
  const { page } = await openPage(async (target) => {
    await target.route(`${api}/v1/notifications/*`, async (route) => {
      const url = route.request().url();
      if (/\/v1\/notifications\/\d+$/.test(url)) {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVER_ERROR", message: "บริการขัดข้อง" } }) });
        return;
      }
      await route.continue();
    });
  });
  await page.locator(".notification-list li button").first().click();
  await page.waitForTimeout(1500);
  const detailError = (await page.locator(".notification-detail-panel").textContent())?.replace(/\s+/g, " ") ?? "";
  check("a failing detail shows its own error", /ไม่สำเร็จ|ขัดข้อง|ลอง/.test(detailError), detailError.slice(0, 90));
  // The control is named "ลองเปิดรายละเอียดอีกครั้ง", not the list's "ลองใหม่".
  const detailRetry = page.getByRole("button", { name: "ลองเปิดรายละเอียดอีกครั้ง" });
  const hasDetailRetry = (await detailRetry.count()) > 0;
  check("a failing detail offers a retry", hasDetailRetry, detailError.slice(0, 60));
  if (hasDetailRetry) {
    await page.unroute(`${api}/v1/notifications/*`);
    await detailRetry.click();
    await page.waitForTimeout(1800);
    const recovered = await page.locator(".notification-detail-panel h2").textContent().catch(() => null);
    check("the detail retry recovers once the API answers", Boolean(recovered?.trim()), JSON.stringify(recovered));
  }
  await page.close();
}

await browser.close();
const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} keyboard and failure checks passed`);
const failures = results.filter((r) => !r.passed);
for (const failure of failures) console.log(`  FAIL ${failure.name}: ${failure.detail ?? ""}`);
process.exit(failures.length === 0 ? 0 : 1);
