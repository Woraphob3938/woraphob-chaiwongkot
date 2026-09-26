// Measures the trainer search page in a real browser. Run:
//   node scripts/audit-trainer-search.mjs
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

const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x800", width: 1024, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "375x812", width: 375, height: 812 },
];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 120)); });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message.slice(0, 120)));
  await page.goto(`${base}/trainers`, { waitUntil: "networkidle" });
  const report = await page.evaluate(() => {
    const grid = document.querySelector(".trainer-marketplace-grid");
    const cards = [...document.querySelectorAll(".trainer-marketplace-card")];
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns : "";
    // A label that wraps to one character per line is the compressed-card symptom.
    const squeezed = [];
    for (const card of cards) {
      for (const label of card.querySelectorAll("span, strong, h2, p")) {
        const rect = label.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(label).lineHeight) || 16;
        if (rect.height > lineHeight * 2.2 && rect.width < 90) {
          squeezed.push({ text: label.textContent.trim().slice(0, 24), width: Math.round(rect.width), height: Math.round(rect.height) });
        }
      }
    }
    const smallTargets = [];
    for (const el of document.querySelectorAll("a, button, input, select")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44 || rect.width < 44) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 26),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }
    return {
      cardCount: cards.length,
      columns,
      cardWidth: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : null,
      pageHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      squeezed: squeezed.slice(0, 6),
      smallTargets: smallTargets.slice(0, 8),
      smallTargetCount: smallTargets.length,
      filterRailVisible: Boolean(document.querySelector(".marketplace-filter-rail")?.getBoundingClientRect().width),
      resultCountText: document.querySelector(".marketplace-results__heading span")?.textContent ?? null,
    };
  });
  console.log(`\n=== /trainers @ ${viewport.name} ===`);
  console.log(`  cards ${report.cardCount} · columns: ${report.columns} · card width ${report.cardWidth}px`);
  console.log(`  page height ${report.pageHeight}px · horizontal overflow ${report.horizontalOverflow} (${report.scrollWidth} vs ${viewport.width})`);
  console.log(`  results label: ${JSON.stringify(report.resultCountText)} · filter rail visible: ${report.filterRailVisible}`);
  if (report.squeezed.length > 0) console.log(`  SQUEEZED LABELS: ${JSON.stringify(report.squeezed)}`);
  console.log(`  targets under 44px: ${report.smallTargetCount}`);
  for (const target of report.smallTargets) console.log(`      <${target.tag}> "${target.text}" ${target.w}x${target.h}`);
  if (consoleErrors.length > 0) console.log(`  console errors: ${JSON.stringify(consoleErrors)}`);
  await page.close();
}

await browser.close();
