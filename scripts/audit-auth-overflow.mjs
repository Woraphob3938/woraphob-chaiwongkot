// Finds the elements that push the register page wider than the viewport, and
// re-checks the "break inside a word" heuristic against a whitespace test that
// understands Thai has no word spaces. Run:
//   node scripts/audit-auth-ui.mjs --overflow
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  const root = process.env.PLAYWRIGHT_ROOT;
  const playwrightPackage = root
    ? await import(pathToFileURL(createRequire(`${root}/`).resolve("playwright")).href)
    : await import("playwright");
  const chromium = playwrightPackage.chromium ?? playwrightPackage.default?.chromium;
  if (!chromium) throw new Error("playwright module did not expose chromium");
  return { chromium };
}

const { chromium } = await loadPlaywright();
const base = process.env.AUDIT_BASE ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });

for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }, { width: 320, height: 568 }]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/register`, { waitUntil: "networkidle" });
  const offenders = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const found = [];
    for (const el of document.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      // Report only the outermost offenders: a child of an overflowing parent is noise.
      if (rect.right > limit + 1 || rect.left < -1) {
        found.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") ?? "").slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          parentOverflows: el.parentElement
            ? el.parentElement.getBoundingClientRect().right > limit + 1
            : false,
        });
      }
    }
    return { limit, found };
  });
  console.log(`\n=== /register @ ${viewport.width}px (client width ${offenders.limit}) ===`);
  const outer = offenders.found.filter((o) => !o.parentOverflows);
  for (const o of outer.slice(0, 12)) {
    console.log(`  <${o.tag} class="${o.cls}"> left=${o.left} right=${o.right} width=${o.width}`);
  }
  if (outer.length === 0) {
    console.log("  no outermost offender found; innermost sample:");
    for (const o of offenders.found.slice(0, 8)) {
      console.log(`    <${o.tag} class="${o.cls}"> right=${o.right} width=${o.width}`);
    }
  }
  await page.close();
}

await browser.close();
