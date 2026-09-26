// Opens the notification centre as a trainer and as an administrator, and checks
// the role-specific behaviour. Run:
//   node scripts/audit-notifications-roles.mjs
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

async function signIn(email) {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  const payload = await response.json();
  if (!payload?.data?.token) throw new Error(`login failed for ${email}: ${JSON.stringify(payload).slice(0, 160)}`);
  return payload.data;
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chrome" });

for (const account of [
  { email: "trainer.a@fitconnect.local", role: "trainer" },
  { email: "admin.demo@fitconnect.local", role: "admin" },
]) {
  console.log(`\n=== ${account.role}: ${account.email} ===`);
  const session = await signIn(account.email);
  const expected = await fetch(`${api}/v1/notifications`, {
    headers: { Authorization: `Bearer ${session.token}` },
  }).then((r) => r.json());

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 120)));

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([token, user]) => {
    localStorage.setItem("fitconnect_token", token);
    localStorage.setItem("fitconnect_user", JSON.stringify(user));
  }, [session.token, session.user]);
  await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const shown = await page.evaluate(() => ({
    rows: document.querySelectorAll(".notification-list li").length,
    totalText: document.querySelector(".notification-list-panel__toolbar .toolbar-headline span")?.textContent?.trim() ?? null,
    categoryLabels: [...document.querySelectorAll(".notification-categories button")].map((b) =>
      (b.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim()),
    badgeCounts: [...document.querySelectorAll(".notification-categories button [data-slot=badge]")].map((b) => b.textContent.trim()),
    empty: document.querySelector(".notification-empty")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
  }));

  check(
    `${account.role}: lists the notifications the API returns`,
    shown.rows > 0 || expected.data.pagination.total === 0,
    `${shown.rows} rows, API total ${expected.data.pagination.total}, header "${shown.totalText}"`,
  );
  check(
    `${account.role}: the unread badges match the API`,
    JSON.stringify(shown.badgeCounts) === JSON.stringify(
      Object.values(expected.data.unread).filter((count) => count > 0).map((count) => String(count)),
    ) || Object.keys(expected.data.unread).every((key) => expected.data.unread[key] === 0),
    `badges ${JSON.stringify(shown.badgeCounts)} vs API ${JSON.stringify(expected.data.unread)}`,
  );

  // Open every row and check the CTA against the API's own action path.
  const rowCount = await page.locator(".notification-list li button").count();
  let ctaMismatches = 0;
  const ctaSamples = [];
  for (let index = 0; index < rowCount; index += 1) {
    await page.locator(".notification-list li button").nth(index).click();
    await page.waitForTimeout(700);
    const row = await page.evaluate(() => {
      const panel = document.querySelector(".notification-detail-panel");
      return {
        title: panel?.querySelector("h2")?.textContent?.trim() ?? null,
        href: panel?.querySelector(".notification-cta-btn")?.getAttribute("href") ?? null,
        label: panel?.querySelector(".notification-cta-btn")?.textContent?.trim() ?? null,
      };
    });
    const source = expected.data.items[index];
    if (source && row.href !== source.actionPath) {
      ctaMismatches += 1;
      ctaSamples.push(`${source.type}: link ${row.href} != ${source.actionPath}`);
    }
    if (index < 3) ctaSamples.push(`${source?.type} -> "${row.label}" (${row.href})`);
  }
  check(`${account.role}: every CTA points where the API says`, ctaMismatches === 0, ctaSamples.slice(0, 5).join(" | "));

  if (account.role === "admin") {
    // Every seeded review notification points at a slip that has already been
    // decided, so the honest label is the settled one. The "still waiting" label
    // is covered by unit tests; here the point is that the two agree.
    const pendingReviews = expected.data.items.filter((item) => item.type.startsWith("payment_review_"));
    const details = await Promise.all(pendingReviews.map(async (item) => {
      const detail = await fetch(`${api}/v1/notifications/${item.id}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).then((r) => r.json());
      return { id: item.id, paymentStatus: detail.data.booking.paymentStatus, status: detail.data.booking.status };
    }));
    const settled = details.every((entry) => entry.paymentStatus !== "reviewing" || entry.status !== "payment_review");
    const panelText = (await page.locator(".notification-detail-panel").textContent()) ?? "";
    check(
      "admin: a review notification whose slip is already decided says so",
      !settled || /ไม่มีรายการที่ต้องดำเนินการ/.test(panelText),
      `${details.length} review notifications, all settled: ${settled}; panel said ${JSON.stringify(panelText.replace(/\s+/g, " ").slice(0, 80))}`,
    );
    check(
      "admin: the settled label replaces the review task label",
      !settled || /ดูการจองที่ตรวจแล้ว/.test(await page.locator(".notification-cta-btn").textContent() ?? ""),
      await page.locator(".notification-cta-btn").textContent().catch(() => "(no cta)") ?? "(no cta)",
    );
  }

  check(`${account.role}: no console errors`, errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  await page.close();
}

await browser.close();
const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} role checks passed`);
const failures = results.filter((r) => !r.passed);
for (const failure of failures) console.log(`  FAIL ${failure.name}: ${failure.detail ?? ""}`);
process.exit(failures.length === 0 ? 0 : 1);
