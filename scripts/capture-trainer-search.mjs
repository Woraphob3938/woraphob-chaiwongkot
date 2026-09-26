// Captures the trainer search page and a trainer profile. Run:
//   node scripts/capture-trainer-search.mjs
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

const shots = [
  { route: "/trainers", width: 1440, height: 1100, name: "trainers-1440" },
  { route: "/trainers", width: 375, height: 1400, name: "trainers-375" },
  { route: "/trainers/demo-trainer-a", width: 1440, height: 1200, name: "trainer-detail-1440" },
];

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  await page.goto(base + shot.route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `output/browser/${shot.name}.png`, fullPage: false });
  console.log(`captured ${shot.name}.png`);
  await page.close();
}

await browser.close();
