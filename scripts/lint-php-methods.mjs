// Guards the class of defect that shipped `PATCH /v1/trainer/me` as a 500:
// a call to a method that does not exist on the class it targets. `php -l` and
// the whole test suite pass straight through that error because nothing in the
// project parses PHP statically. This is a deliberately small checker, not a
// PHPStan replacement: it only knows the classes injected into Handlers and the
// static rule classes, which is exactly where the live defect lived.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const srcDir = join(root, "backend", "src");

/** Handlers' constructor wires these properties to these classes. */
const injected = {
  database: "Database",
  auth: "Auth",
  notifications: "NotificationService",
  rateLimiter: "RateLimiter",
};

const staticClasses = [
  "WorkflowRules",
  "ProfileRules",
  "NotificationRules",
  "PaymentRouting",
  "UserAdminRules",
  "RateLimiter",
  "PasswordResetRules",
];

function collectFiles(dir, predicate) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const phpFiles = collectFiles(join(root, "backend"), (f) => f.endsWith(".php"));

/** Methods declared on each tracked class, read from its own source file. */
const declared = new Map();
function loadClass(name) {
  if (declared.has(name)) return declared.get(name);
  const file = join(srcDir, `${name}.php`);
  let methods = new Set();
  try {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) methods.add(m[1]);
  } catch {
    methods = null; // File missing: reported separately below.
  }
  declared.set(name, methods);
  return methods;
}

for (const cls of [...Object.values(injected), ...staticClasses]) loadClass(cls);

const violations = [];
const missingClass = [];
for (const [cls, methods] of declared) {
  if (methods === null) missingClass.push(cls);
}

for (const file of phpFiles) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `${relative(root, file)}:${index + 1}`;
    // `$this->database->pdo()->prepare(...)` must resolve only `pdo` here: the
    // capture stops at the first `(`, so the chained call is not inspected.
    for (const m of line.matchAll(/\$this->(\w+)->(\w+)\s*\(/g)) {
      const cls = injected[m[1]];
      if (!cls) continue;
      const methods = declared.get(cls);
      if (methods && !methods.has(m[2])) {
        violations.push(`${where}  $this->${m[1]}->${m[2]}()  — ${cls} has no such method`);
      }
    }
    for (const m of line.matchAll(/\b([A-Z]\w+)::(\w+)\s*\(/g)) {
      if (!staticClasses.includes(m[1])) continue;
      const methods = declared.get(m[1]);
      if (methods && !methods.has(m[2])) {
        violations.push(`${where}  ${m[1]}::${m[2]}()  — no such static method`);
      }
    }
  });
}

if (missingClass.length > 0) {
  console.error(`lint-php-methods: expected class file not found for: ${missingClass.join(", ")}`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`lint-php-methods: ${violations.length} call(s) to methods that do not exist:`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`lint-php-methods: ok (${phpFiles.length} PHP files checked)`);
