// Cross-checks every class selector in the stylesheet against the source tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = [...collectFiles("app"), ...collectFiles("components"), ...collectFiles("lib"), ...collectFiles("tests")]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const classes = new Set();
for (const match of css.matchAll(/(^|[},])([^{}@]*)\{/g)) {
  for (const cls of match[2].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(cls[1]);
}

const escape = (value) => value.replace(/-/g, "\\-");

/** Every class name the components actually apply, including template-built ones. */
function appliedClassNames() {
  const names = new Set();
  for (const match of sources.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    for (const token of raw.split(/[\s"'`+{}]+/)) {
      const clean = token.trim();
      if (clean && /^[a-zA-Z][\w-]*$/.test(clean)) names.add(clean);
    }
  }
  // A template such as `trainer-week-event--${state}` contributes its literal prefix.
  for (const match of sources.matchAll(/`([^`]*)\$\{/g)) {
    const literal = match[1];
    const lastToken = literal.split(/[\s"'`+{}]+/).filter(Boolean).pop() ?? "";
    if (lastToken && /^[a-zA-Z][\w-]*$/.test(lastToken)) names.add(`${lastToken}*`);
  }
  return names;
}

const applied = appliedClassNames();
const appliedList = [...applied];

function isUsed(name) {
  if (applied.has(name)) return true;
  // `trainer-week-event--booked` is live when `trainer-week-event--*` was applied.
  return appliedList.some((token) => token.endsWith("*") && name.startsWith(token.slice(0, -1)));
}

const orphans = [...classes].filter((name) => !isUsed(name)).sort();

// Each candidate is re-checked against the exact token, so a class that only
// appears inside a longer name is listed separately for a human to judge:
// `check-row` is dead even though `marketplace-check-row` contains it.
const files = [...collectFiles("app"), ...collectFiles("components"), ...collectFiles("lib"), ...collectFiles("tests")];
const confirmed = [];
const superseded = [];
for (const name of orphans) {
  const exactToken = new RegExp(`(^|[^\\w-])${escape(name)}([^\\w-]|$)`);
  const exact = files.some((file) => exactToken.test(readFileSync(file, "utf8")));
  if (exact) superseded.push(name);
  else confirmed.push(name);
}

console.log(`class selectors: ${classes.size}; candidates: ${orphans.length}`);
console.log("");
console.log("CONFIRMED DEAD (exact token nowhere in sources):");
console.log(confirmed.join(" "));
console.log("");
console.log("NEEDS A LOOK (token appears only inside a longer name):");
console.log(superseded.join(" "));
