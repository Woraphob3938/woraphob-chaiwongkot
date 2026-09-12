// Reports the colour actually behind the list metadata, so the contrast figure
// is a fact rather than an assumption about which ancestor paints the surface.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(([t, u]) => {
  localStorage.setItem("fitconnect_token", t);
  localStorage.setItem("fitconnect_user", JSON.stringify(u));
}, [token, user]);
await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  // getComputedStyle returns lab() in this Chrome, so text scraping gives the
  // wrong numbers. A canvas normalises any CSS colour to RGB.
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  const toRgb = (css) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (fg, bg) => {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };

  const targets = {
    "list message": ".notification-list__copy > span:first-child",
    "list meta small": ".notification-list__copy small",
    "list time": ".notification-list__copy time",
    "booking code": ".notification-list__copy code",
    "toolbar count": ".notification-list-panel__toolbar .toolbar-headline span",
  };
  const out = {};
  for (const [label, selector] of Object.entries(targets)) {
    const el = document.querySelector(selector);
    if (!el) { out[label] = null; continue; }
    const style = getComputedStyle(el);
    let node = el;
    let background = null;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      const parsed = toRgb(bg);
      if (parsed.a > 0) { background = { source: node.className || node.tagName, ...parsed }; break; }
      node = node.parentElement;
    }
    const foreground = toRgb(style.color);
    out[label] = {
      color: `rgb(${foreground.r}, ${foreground.g}, ${foreground.b})`,
      surface: background ? `rgb(${background.r}, ${background.g}, ${background.b})` : "(none)",
      surfaceFrom: background?.source ?? null,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      contrast: background ? ratio(foreground, background) : null,
      needsLargeText: parseFloat(style.fontSize) >= 18.66 || (parseFloat(style.fontSize) >= 14 && Number(style.fontWeight) >= 700),
    };
  }
  return out;
});

for (const [label, data] of Object.entries(report)) {
  if (!data) { console.log(`${label}: not found`); continue; }
  const minimum = data.needsLargeText ? 3 : 4.5;
  const verdict = data.contrast >= minimum ? "PASS" : "FAIL";
  console.log(`${verdict}  ${label}: ${data.contrast}:1 (needs ${minimum}:1) · ${data.fontSize}/${data.fontWeight} · ${data.color} on ${data.surface}`);
}
await browser.close();
