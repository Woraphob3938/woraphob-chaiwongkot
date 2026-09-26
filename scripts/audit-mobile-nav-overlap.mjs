// Checks whether the fixed bottom navigation permanently covers page content.
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
const browser = await chromium.launch({ channel: "chrome" });

for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/trainers`, { waitUntil: "networkidle" });
  // Scroll to the very bottom, where a fixed bar does its damage.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  const report = await page.evaluate(() => {
    const nav = document.querySelector(".mobile-role-nav");
    const navRect = nav?.getBoundingClientRect();
    const navVisible = navRect ? getComputedStyle(nav).display !== "none" && navRect.height > 0 : false;

    const interesting = [...document.querySelectorAll(".trainer-marketplace-card, .page-footer, .trainer-marketplace-grid")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          cls: el.getAttribute("class"),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          covered: navVisible && navRect ? Math.max(0, Math.min(rect.bottom, navRect.bottom) - Math.max(rect.top, navRect.top)) : 0,
        };
      });

    // Every interactive element the bar sits on top of while scrolled to the end.
    const buried = [];
    for (const el of document.querySelectorAll("a, button, input, select")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (!navVisible || !navRect) continue;
      const overlapTop = Math.max(rect.top, navRect.top);
      const overlapBottom = Math.min(rect.bottom, navRect.bottom);
      const overlap = overlapBottom - overlapTop;
      if (overlap > 4) {
        buried.push({
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
          overlap: Math.round(overlap),
          height: Math.round(rect.height),
        });
      }
    }

    return {
      navVisible,
      navTop: navRect ? Math.round(navRect.top) : null,
      navHeight: navRect ? Math.round(navRect.height) : null,
      bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
      atBottom: Math.round(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2,
      interesting,
      buried: buried.slice(0, 8),
      buriedCount: buried.length,
    };
  });
  console.log(`\n=== /trainers @ ${viewport.width}x${viewport.height}, scrolled to the end ===`);
  console.log(`  bottom nav visible: ${report.navVisible} · top ${report.navTop} · height ${report.navHeight}`);
  console.log(`  reached the end: ${report.atBottom} · body padding-bottom: ${report.bodyPaddingBottom}`);
  for (const item of report.interesting) {
    console.log(`  ${item.cls}: ${item.top}..${item.bottom} (covered ${item.covered}px)`);
  }
  console.log(`  interactive elements under the bar: ${report.buriedCount}`);
  for (const item of report.buried) console.log(`      <${item.tag}> "${item.text}" overlap ${item.overlap}px of ${item.height}px`);
  await page.close();
}

await browser.close();
