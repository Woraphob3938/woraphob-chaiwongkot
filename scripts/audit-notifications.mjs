// Audits the notification centre with a real signed-in session.
// Run: node scripts/audit-notifications.mjs
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
const token = (process.env.FC_TOKEN ?? "").trim();
const user = { id: 1, email: "member.demo@fitconnect.local", displayName: "สมาชิกสาธิต", role: "member", status: "active" };

const browser = await chromium.launch({ channel: "chrome" });

for (const viewport of [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x800", width: 1024, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "375x812", width: 375, height: 812 },
]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 100)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 100)));

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => {
    localStorage.setItem("fitconnect_token", t);
    localStorage.setItem("fitconnect_user", JSON.stringify(u));
  }, [token, user]);
  await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const grid = document.querySelector(".notification-center__grid");
    const categories = document.querySelector(".notification-categories");
    const list = document.querySelector(".notification-list-panel");
    const items = [...document.querySelectorAll(".notification-list li")];

    // A category button outside the rail's own scroll viewport is invisible.
    let hiddenCategories = [];
    if (categories) {
      const box = categories.getBoundingClientRect();
      hiddenCategories = [...categories.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        const label = b.getAttribute("aria-label") ?? b.textContent.trim();
        return { label: label.slice(0, 30), visible: r.right <= box.right + 1 && r.width > 0, right: Math.round(r.right), boxRight: Math.round(box.right) };
      }).filter((entry) => !entry.visible);
    }

    const smallTargets = [];
    for (const el of document.querySelectorAll("a, button, input, select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        smallTargets.push({ tag: el.tagName.toLowerCase(), text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 26), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }

    // Emoji standing in for an icon.
    const emoji = [...document.querySelectorAll(".notification-center *")].filter((el) => {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text);
    }).map((el) => (el.textContent || "").trim().slice(0, 30));

    const firstItem = items[0];
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
      itemCount: items.length,
      pageHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      categoriesDisplay: categories ? getComputedStyle(categories).display : null,
      hiddenCategories,
      listBusy: list?.getAttribute("aria-busy"),
      smallTargets: smallTargets.slice(0, 8),
      smallTargetCount: smallTargets.length,
      emoji: [...new Set(emoji)],
      firstItemText: firstItem ? firstItem.textContent.replace(/\s+/g, " ").trim().slice(0, 150) : null,
      ctaLabels: [...document.querySelectorAll(".notification-cta-btn, .notification-detail a[data-slot=button]")].map((a) => a.textContent.trim()),
    };
  });

  console.log(`\n=== /notifications @ ${viewport.name} ===`);
  console.log(`  grid columns: ${report.columns}`);
  console.log(`  list items: ${report.itemCount} · page height ${report.pageHeight}px · horizontal overflow ${report.horizontalOverflow} (${report.scrollWidth} vs ${viewport.width})`);
  console.log(`  category rail display: ${report.categoriesDisplay} · aria-busy on list: ${report.listBusy}`);
  if (report.hiddenCategories.length > 0) console.log(`  CATEGORIES OUTSIDE THE RAIL: ${JSON.stringify(report.hiddenCategories)}`);
  console.log(`  targets under 44px: ${report.smallTargetCount}`);
  for (const t of report.smallTargets) console.log(`      <${t.tag}> "${t.text}" ${t.w}x${t.h}`);
  if (report.emoji.length > 0) console.log(`  EMOJI IN UI: ${JSON.stringify(report.emoji)}`);
  console.log(`  CTA labels: ${JSON.stringify(report.ctaLabels)}`);
  if (errors.length > 0) console.log(`  console errors: ${JSON.stringify(errors)}`);
  await page.close();
}

await browser.close();
