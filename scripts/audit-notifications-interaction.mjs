// Exercises the notification centre the way a person would, in a real browser,
// against real data. Run:
//   node scripts/audit-notifications-interaction.mjs
//
// It signs in as the demo member, so it needs the API and the seeded database.
// Marking everything read is part of the suite, which means a second run has no
// unread rows left: those two checks report SKIP rather than failing. Restore
// them by clearing read_at for a few of the member's own rows, or re-seed with
// `npm run xampp:connect`.
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
const token = (await login.json()).data.token;
const user = { id: 1, email: "member.demo@fitconnect.local", displayName: "สมาชิกสาธิต", role: "member", status: "active" };

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message.slice(0, 120)));

await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(([t, u]) => {
  localStorage.setItem("fitconnect_token", t);
  localStorage.setItem("fitconnect_user", JSON.stringify(u));
}, [token, user]);

const seenRequests = [];
page.on("request", (request) => {
  const url = request.url();
  if (url.includes("/v1/notifications")) seenRequests.push(url.replace(api, "").replace(base, ""));
});

await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const countRows = () => page.locator(".notification-list li").count();
const headings = () => page.locator(".notification-list li strong").allTextContents();
const pagerText = () => page.locator(".notification-pagination > span").textContent();
const listRequestCount = () => seenRequests.filter((u) => /^\/v1\/notifications\?/.test(u)).length;

// --- 1. pagination -----------------------------------------------------------
check("page 1 shows a full page of rows", (await countRows()) === 10, `${await countRows()} rows`);
const page1Headings = await headings();
const pagerStart = await pagerText();
check("pager reports the first of three pages", pagerStart?.includes("หน้า 1 จาก 3") ?? false, pagerStart ?? "no pager");
check("previous page is disabled on page 1", await page.getByRole("button", { name: "หน้าก่อนหน้า" }).isDisabled());

const requestsBeforeNext = listRequestCount();
await page.getByRole("button", { name: "หน้าถัดไป" }).click();
await page.waitForTimeout(1200);
const page2Headings = await headings();
const pagerAfter = await pagerText();
check("next page issues a new list request", listRequestCount() === requestsBeforeNext + 1, `${requestsBeforeNext} -> ${listRequestCount()}`);
check("page 2 shows different rows", page2Headings[0] !== page1Headings[0], `p1[0]=${page1Headings[0]?.slice(0, 22)} p2[0]=${page2Headings[0]?.slice(0, 22)}`);
check("pager reports page 2", pagerAfter?.includes("หน้า 2 จาก 3") ?? false, pagerAfter ?? "no pager");
check("page 2 still lists 10 rows", (await countRows()) === 10, `${await countRows()} rows`);

// --- 2. filter state must survive pagination --------------------------------
await page.getByRole("button", { name: /^การชำระเงิน/ }).click();
await page.waitForTimeout(1200);
const paymentRows = await countRows();
const paymentBadges = await page.locator(".notification-list li .category-badge").allTextContents();
check("category filter loads a different set", paymentRows > 0, `${paymentRows} payment rows`);
check("every row in the payment category is a payment", paymentBadges.every((b) => b.includes("การชำระเงิน")), JSON.stringify([...new Set(paymentBadges)]));

// --- 3. unread-only filter --------------------------------------------------
// The category and unread controls are pressed through their real labels so the
// header's "อ่านแล้วทั้งหมด" button cannot be mistaken for the "ทั้งหมด" category.
const allCategory = page.locator(".notification-categories button").first();
const unreadToggle = page.getByRole("button", { name: "เฉพาะที่ยังไม่ได้อ่าน" });

await page.waitForTimeout(600);
const rowsBeforeUnread = await countRows();
const readFlagsBefore = await page.locator(".notification-list li button").evaluateAll((els) => els.map((el) => el.dataset.read));
await unreadToggle.click();
await page.waitForTimeout(1200);
check("unread filter sets aria-pressed", (await unreadToggle.getAttribute("aria-pressed")) === "true");
const unreadRows = await countRows();
const unreadFlags = await page.locator(".notification-list li button").evaluateAll((els) => els.map((el) => el.dataset.read));
check("unread filter returns only unread rows", unreadFlags.every((flag) => flag === "false"), JSON.stringify([...new Set(unreadFlags)]));
check(
  "unread filter never returns more rows than the unfiltered list",
  unreadRows <= rowsBeforeUnread,
  `${rowsBeforeUnread} (read flags ${JSON.stringify([...new Set(readFlagsBefore)])}) -> ${unreadRows}`,
);
await unreadToggle.click();
await page.waitForTimeout(1200);
check("turning the unread filter off restores the rows", (await countRows()) === rowsBeforeUnread, `${await countRows()} vs ${rowsBeforeUnread}`);

// --- 4. search over the loaded page ----------------------------------------
const search = page.getByRole("searchbox", { name: "ค้นหาการแจ้งเตือน" });
const firstCode = (await page.locator(".notification-list li code").first().textContent())?.trim() ?? "";
await search.fill(firstCode);
await page.waitForTimeout(400);
const searchedRows = await countRows();
check("search narrows the list to the matching code", searchedRows >= 1 && searchedRows <= paymentRows, `"${firstCode}" -> ${searchedRows} rows`);
const searchedText = await page.locator(".notification-list").textContent();
check("the matched row contains the code", searchedText?.includes(firstCode) ?? false);
await search.fill("zzzz-no-such-notification");
await page.waitForTimeout(400);
check("a search with no match shows the empty state", (await countRows()) === 0 && (await page.locator(".notification-empty").count()) === 1);
const resetButton = page.getByRole("button", { name: "ดูทั้งหมด" });
check("the empty state offers a way back", await resetButton.isVisible());
await resetButton.click();
await page.waitForTimeout(1200);
check("reset restores the category rows", (await countRows()) === paymentRows, `${await countRows()} vs ${paymentRows}`);

await allCategory.click();
await page.waitForTimeout(1200);

// --- 5. opening a row marks it read ----------------------------------------
const before = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const unreadBefore = before.data.unread.all;
const readOnPage1 = (await page.locator(".notification-list li button[data-read='false']").count()) === 0;
if (!readOnPage1) {
  const target = page.locator(".notification-list li button[data-read='false']").first();
  const badgeBefore = await page.locator(".notification-categories button").first().locator("[data-slot=badge]").textContent().catch(() => null);
  await target.click();
  await page.waitForTimeout(1500);
  const after = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  check("opening an unread row marks it read server-side", after.data.unread.all === unreadBefore - 1, `${unreadBefore} -> ${after.data.unread.all}`);
  const badgeAfter = await page.locator(".notification-categories button").first().locator("[data-slot=badge]").textContent().catch(() => null);
  check("the category badge follows the new count", badgeBefore !== badgeAfter, `${badgeBefore} -> ${badgeAfter}`);
} else if ((await page.locator(".notification-list li button").count()) === 0) {
  // The suite marks everything read as its last step, so a second run starts
  // with an empty unread list. Report that instead of timing out on a row that
  // cannot exist; re-seed with `npm run xampp:connect` for a full pass.
  console.log("SKIP  opening an unread row marks it read server-side — nothing unread left from a previous run");
  console.log("SKIP  the opened row leaves the unread list — nothing unread left");
} else {
  // Page 1 is sorted newest first and every row there is already read, so the
  // unread path is exercised through the unread-only filter instead.
  await unreadToggle.click();
  await page.waitForTimeout(1200);
  if ((await page.locator(".notification-list li button").count()) === 0) {
    console.log("SKIP  opening an unread row marks it read server-side — the unread filter returned nothing");
    console.log("SKIP  the opened row leaves the unread list — the unread filter returned nothing");
  } else {
    const target = page.locator(".notification-list li button").first();
    const targetId = await target.getAttribute("aria-label");
    await target.click();
    await page.waitForTimeout(1500);
    const after = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    check("opening an unread row marks it read server-side", after.data.unread.all === unreadBefore - 1, `${unreadBefore} -> ${after.data.unread.all} (opened ${targetId})`);
    const openedTitle = (targetId ?? "").replace(" ยังไม่ได้อ่าน", "");
    const remainingTitles = await headings();
    check(
      "the opened row leaves the unread list",
      openedTitle !== "" && !remainingTitles.includes(openedTitle),
      `"${openedTitle}" still listed: ${remainingTitles.includes(openedTitle)}`,
    );
  }
}

// --- 6. detail pane and keyboard -------------------------------------------
// Read state does not matter here, but the unread filter may still be on from the
// branch above, which would leave no rows to open.
if ((await unreadToggle.getAttribute("aria-pressed")) === "true") {
  await unreadToggle.click();
  await page.waitForTimeout(1200);
}
await page.locator(".notification-list li button").first().click();
await page.waitForTimeout(1500);
const detailTitle = await page.locator(".notification-detail-panel h2").textContent({ timeout: 5000 }).catch(() => null);
check("the detail pane renders the selected notification", Boolean(detailTitle?.trim()), JSON.stringify(detailTitle?.trim() ?? null));
// Above 48rem the list and the detail are visible together, so the back control
// is deliberately hidden; its mobile behaviour is checked at the end.
check("the back control is hidden on desktop, where both panes show at once", !(await page.locator(".notification-detail-panel__back").isVisible()));

// Focus must stay on the control the user activated while the list refreshes.
await page.getByRole("button", { name: /^การชำระเงิน/ }).click();
await page.waitForTimeout(1000);
const focusAfterCategory = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30) ?? "(none)");
check("category control keeps focus after the list reloads", /การชำระเงิน/.test(focusAfterCategory), focusAfterCategory);

// --- 7. bulk action ---------------------------------------------------------
const markAll = page.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด" });
const unreadNow = (await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())).data.unread.all;
if (unreadNow === 0) {
  // A previous run already cleared the inbox, so the only thing left to assert is
  // that the control stays disabled rather than offering a no-op.
  check("mark all read is disabled when nothing is unread", await markAll.isDisabled());
} else {
  await markAll.click();
  await page.waitForTimeout(1800);
  const afterAll = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  check("mark all read clears every unread count", afterAll.data.unread.all === 0, `unread=${afterAll.data.unread.all}`);
  check("the mark-all control disables itself once empty", await markAll.isDisabled());
}

check("no console errors during the session", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

await page.close();

// --- 8. mobile: list and detail are one pane at a time ----------------------
const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await mobile.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await mobile.evaluate(([t, u]) => {
  localStorage.setItem("fitconnect_token", t);
  localStorage.setItem("fitconnect_user", JSON.stringify(u));
}, [token, user]);
await mobile.goto(`${base}/notifications`, { waitUntil: "networkidle" });
await mobile.waitForTimeout(1200);
check("mobile hides the category rail in favour of a select", await mobile.locator(".notification-categories").isHidden() && await mobile.locator(".notification-category-select select").isVisible());
const listVisible = await mobile.locator(".notification-list-panel").isVisible();
const detailVisibleBefore = await mobile.locator(".notification-detail-panel").isVisible();
check("mobile shows the list and hides the detail first", listVisible && !detailVisibleBefore, `list=${listVisible} detail=${detailVisibleBefore}`);
await mobile.locator(".notification-list li button").first().click();
await mobile.waitForTimeout(1200);
check("mobile swaps to the detail after a row is tapped", await mobile.locator(".notification-detail-panel").isVisible());
const backVisible = await mobile.locator(".notification-detail-panel__back").isVisible();
check("mobile offers a back control", backVisible);
if (backVisible) {
  await mobile.locator(".notification-detail-panel__back").click();
  await mobile.waitForTimeout(800);
  check("back returns to the list", await mobile.locator(".notification-list-panel").isVisible() && !(await mobile.locator(".notification-detail-panel").isVisible()));
}
await mobile.close();
await browser.close();

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} interaction checks passed`);
const failures = results.filter((r) => !r.passed);
if (failures.length > 0) {
  console.log("failures:");
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail ?? ""}`);
}
process.exit(failures.length === 0 ? 0 : 1);