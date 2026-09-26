// Captures the notification centre at desktop and mobile with a real session,
// and reports the layout facts that matter: overflow, control height, and the
// mobile category select. Contrast is measured by audit-notification-contrast.mjs.
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

for (const viewport of [{ name: "1440", width: 1440, height: 1000 }, { name: "375", width: 375, height: 900 }]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => {
    localStorage.setItem("fitconnect_token", t);
    localStorage.setItem("fitconnect_user", JSON.stringify(u));
  }, [token, user]);
  await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const facts = await page.evaluate(() => {
    const search = document.querySelector(".notification-search-box input");
    const select = document.querySelector(".notification-category-select");
    const rail = document.querySelector(".notification-categories");
    const code = document.querySelector(".notification-list__copy code");
    return {
      searchHeight: search ? Math.round(search.getBoundingClientRect().height) : null,
      codeClipped: code ? code.scrollWidth > code.clientWidth + 1 : null,
      codeText: code?.textContent?.trim() ?? null,
      selectVisible: select ? select.getBoundingClientRect().height > 0 : false,
      railVisible: rail ? getComputedStyle(rail).display !== "none" && rail.getBoundingClientRect().height > 0 : false,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      urgency: [...document.querySelectorAll(".urgency-badge")].map((el) => el.textContent.trim()),
      hasEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.querySelector(".notification-center")?.textContent ?? ""),
    };
  });
  console.log(`\n=== /notifications @ ${viewport.name} ===`);
  console.log(`  search height ${facts.searchHeight}px · horizontal overflow ${facts.horizontalOverflow}`);
  console.log(`  booking code "${facts.codeText}" clipped: ${facts.codeClipped}`);
  console.log(`  category select visible ${facts.selectVisible} · rail visible ${facts.railVisible}`);
  console.log(`  urgency labels ${JSON.stringify(facts.urgency)} · emoji present: ${facts.hasEmoji}`);
  await page.screenshot({ path: `output/browser/notifications-final-${viewport.name}.png` });
  await page.close();
}

await browser.close();
