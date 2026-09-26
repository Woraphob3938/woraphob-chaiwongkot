// Checks that text in an icon-bearing field does not sit underneath the icon or
// the password toggle. Run:
//   node scripts/audit-input-icon.mjs
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

const targets = [
  { route: "/login", field: "#email", label: "login email" },
  { route: "/login", field: "#password", label: "login password (icon + eye)" },
  { route: "/register", field: "#display-name", label: "register display name" },
  { route: "/forgot-password", field: "#reset-email", label: "forgot-password email" },
  { route: "/reset-password", field: "#reset-code", label: "reset code" },
];

let failures = 0;
for (const target of targets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + target.route, { waitUntil: "networkidle" });
  await page.fill(target.field, "1234").catch(() => {});
  const result = await page.evaluate((selector) => {
    const input = document.querySelector(selector);
    if (!input) return null;
    const wrapper = input.closest(".input-with-icon");
    const icon = wrapper?.querySelector("svg");
    const style = getComputedStyle(input);
    const box = input.getBoundingClientRect();
    const textStart = box.left + parseFloat(style.paddingLeft);
    const textEnd = box.right - parseFloat(style.paddingRight);
    const iconRect = icon?.getBoundingClientRect();
    const toggle = wrapper?.querySelector(".password-toggle-btn")?.getBoundingClientRect();
    return {
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      clearsIcon: iconRect ? textStart >= iconRect.right : true,
      clearsToggle: toggle ? textEnd <= toggle.left : true,
      textStart: Math.round(textStart),
      textEnd: Math.round(textEnd),
      iconRight: iconRect ? Math.round(iconRect.right) : null,
      toggleLeft: toggle ? Math.round(toggle.left) : null,
    };
  }, target.field);

  if (!result) {
    console.log(`SKIP  ${target.label} — field not found`);
    await page.close();
    continue;
  }
  const ok = result.clearsIcon && result.clearsToggle;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${target.label}`);
  console.log(`      padding ${result.paddingLeft} / ${result.paddingRight} · text ${result.textStart}..${result.textEnd} · icon ends ${result.iconRight} · toggle starts ${result.toggleLeft}`);
  await page.close();
}

console.log(failures === 0 ? "\nAll icon fields clear their text." : `\n${failures} field(s) still overlap.`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
