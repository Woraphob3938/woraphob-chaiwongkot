// Reads the accessible names the browser computes, so duplicates are a fact and
// not a guess. Run: node scripts/audit-accessible-names.mjs
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

for (const route of ["/trainers", "/trainers/demo-trainer-a", "/"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base + route, { waitUntil: "networkidle" });
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("Accessibility.enable");
  const { nodes } = await client.send("Accessibility.getFullAXTree");
  const interactive = nodes.filter((node) =>
    ["button", "link", "textbox", "combobox", "checkbox", "searchbox"].includes(node.role?.value));

  const byName = new Map();
  for (const node of interactive) {
    const name = (node.name?.value ?? "").trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(node.role.value);
  }
  const duplicates = [...byName.entries()].filter(([, roles]) => roles.length > 1);

  console.log(`\n=== ${route} ===`);
  console.log(`  interactive nodes: ${interactive.length}`);
  for (const [name, roles] of duplicates) {
    console.log(`  DUPLICATE NAME: ${JSON.stringify(name)} × ${roles.length} (${roles.join(", ")})`);
  }
  // The three most telling names on the search page.
  if (route === "/trainers") {
    for (const entry of byName.entries()) {
      if (/ค้นหา|เปิดตัวกรอง|ดูโปรไฟล์/.test(entry[0])) {
        console.log(`      name ${JSON.stringify(entry[0])} → ${entry[1].join(",")}`);
      }
    }
  }
  await page.close();
}

await browser.close();
