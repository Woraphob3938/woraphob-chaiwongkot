// Measures the auth pages in a real browser. Run with:
//   node scripts/audit-auth-ui.mjs
// playwright is resolved from the npx cache, so this project needs no new
// dependency: set PLAYWRIGHT_ROOT to the `node_modules` directory that holds it,
// or let the script fall back to a plain import when it is installed locally.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  const root = process.env.PLAYWRIGHT_ROOT;
  const playwrightPackage = root
    ? await import(pathToFileURL(createRequire(`${root}/`).resolve("playwright")).href)
    : await import("playwright");
  // The npx cache copy is CommonJS, so the named export can arrive on `default`.
  const chromium = playwrightPackage.chromium ?? playwrightPackage.default?.chromium;
  if (!chromium) throw new Error("playwright module did not expose chromium");
  return { chromium };
}

const { chromium } = await loadPlaywright();

const base = process.env.AUDIT_BASE ?? "http://localhost:3000";
const viewports = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "375x812", width: 375, height: 812 },
  { name: "320x568", width: 320, height: 568 },
];
const routes = ["/login", "/register"];

const browser = await chromium.launch({ channel: "chrome" });

for (const route of routes) {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(base + route, { waitUntil: "networkidle" });
    const report = await page.evaluate(() => {
      const submit = document.querySelector("form.auth-form button[type=submit]");
      const heading = document.querySelector(".auth-copy h1");
      const rect = submit?.getBoundingClientRect();
      // Character-level boxes reveal a break that lands inside a word.
      const lines = [];
      if (heading?.firstChild?.nodeType === Node.COMMENT_NODE) {
        heading.childNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) lines.push(node.textContent.trim());
        });
      } else {
        lines.push(heading?.textContent.trim());
      }
      const range = document.createRange();
      const breaks = [];
      if (heading) {
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text) {
          for (let i = 0; i < text.length; i += 1) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const box = range.getBoundingClientRect();
            if (box.width === 0) continue;
            breaks.push({ ch: text.data[i], top: Math.round(box.top), left: Math.round(box.left) });
          }
          text = walker.nextNode();
        }
      }
      const tops = [...new Set(breaks.map((b) => b.top))];
      const lineShapes = tops.map((top) => breaks.filter((b) => b.top === top).map((b) => b.ch).join(""));
      // Does a line end and the next begin without a space between?
      const seamless = [];
      for (let i = 1; i < lineShapes.length; i += 1) {
        const prev = lineShapes[i - 1];
        const curr = lineShapes[i];
        if (prev && curr && !/\s$/.test(prev) && /^[ก-๙]/.test(curr)) {
          seamless.push(`${prev.slice(-6)} | ${curr.slice(0, 8)}`);
        }
      }
      return {
        documentHeight: document.documentElement.scrollHeight,
        scrolls: document.documentElement.scrollHeight > window.innerHeight + 4,
        submitTop: rect ? Math.round(rect.top) : null,
        submitBelowFold: rect ? rect.top > window.innerHeight : null,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        headingLines: lineShapes,
        seamlessBreaks: seamless,
        labelledControls: [...document.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label")),
      };
    });
    console.log(`\n=== ${route} @ ${viewport.name} ===`);
    console.log(`  page height ${report.documentHeight}px (viewport ${viewport.height}) — scrolls: ${report.scrolls}`);
    console.log(`  submit button top: ${report.submitTop}px — below the fold: ${report.submitBelowFold}`);
    console.log(`  horizontal overflow: ${report.horizontalOverflow} (scrollWidth ${report.scrollWidth} vs ${report.innerWidth})`);
    console.log(`  heading lines: ${JSON.stringify(report.headingLines)}`);
    if (report.seamlessBreaks.length > 0) console.log(`  BREAKS INSIDE A WORD: ${JSON.stringify(report.seamlessBreaks)}`);
    const duplicates = report.labelledControls.filter((v, i, a) => a.indexOf(v) !== i);
    if (duplicates.length > 0) console.log(`  duplicate aria-labels: ${JSON.stringify([...new Set(duplicates)])}`);
    await page.close();
  }
}

await browser.close();
