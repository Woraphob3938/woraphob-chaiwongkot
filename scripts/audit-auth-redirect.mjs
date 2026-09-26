// Verifies the sign-in redirect rules in a real browser. Run:
//   node scripts/audit-auth-redirect.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  const root = process.env.PLAYWRIGHT_ROOT;
  const pkg = root
    ? await import(pathToFileURL(createRequire(`${root}/`).resolve("playwright")).href)
    : await import("playwright");
  const chromium = pkg.chromium ?? pkg.default?.chromium;
  return { chromium };
}

const { chromium } = await loadPlaywright();
const base = process.env.AUDIT_BASE ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });

const member = { id: 1, email: "member.demo@fitconnect.local", displayName: "สมาชิกสาธิต", role: "member", status: "active" };
const trainer = { id: 2, email: "trainer.a@fitconnect.local", displayName: "เทรนเนอร์สาธิต ก.", role: "trainer", status: "active" };

async function attempt(label, { route, user, session }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (session) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(([token, person]) => {
      localStorage.setItem("fitconnect_token", token);
      localStorage.setItem("fitconnect_user", JSON.stringify(person));
    }, [session, user]);
  }
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const landed = new URL(page.url()).pathname + new URL(page.url()).search;
  const emailValue = await page.locator("#email").inputValue().catch(() => "(no email field)");
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? "(none)");
  console.log(`${label}\n    requested: ${route}\n    landed:    ${landed}\n    email:     ${emailValue === "" ? "(empty)" : emailValue}  focused: ${focusedId}`);
  await page.close();
  return landed;
}

console.log("=== A1: destination is honoured for every role ===");
await attempt("member with a stored session, sent from a booking", {
  route: "/login?redirect=%2Fbooking%3Ftrainer%3Ddemo-trainer-a%26slot%3D101",
  user: member,
  session: "fake-session-token",
});
await attempt("trainer with a stored session, sent from a trainer profile", {
  route: "/login?redirect=%2Ftrainers%2Fdemo-trainer-a",
  user: trainer,
  session: "fake-session-token",
});
await attempt("no redirect requested: role destination applies", {
  route: "/login",
  user: member,
  session: "fake-session-token",
});
await attempt("register does not move an inherited session away", {
  route: "/register",
  user: member,
  session: "fake-session-token",
});

console.log("\n=== A1 safety: an external destination is dropped ===");
await attempt("protocol-relative host is rejected", {
  route: "/login?redirect=%2F%2Fevil.example.com",
  user: member,
  session: "fake-session-token",
});

console.log("\n=== C3: the address comes back after a reset ===");
await attempt("reset finished, email carried back", {
  route: "/login?reset=done&email=member%40fitconnect.local",
  user: null,
  session: null,
});

await browser.close();
