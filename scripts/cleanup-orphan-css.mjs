// One-off: drop rules whose selectors belong to components that no longer exist.
//
// Parsed with postcss rather than by hand. The first attempt split selector lists
// on every comma, which also split the commas inside `:not(.label, .value)` and
// produced malformed selectors, and it mistook a section comment above an at-rule
// for a selector. postcss already knows both.
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const target = "app/globals.css";
const dead = [
  // Components that no longer exist. Each name is a block root, so element and
  // modifier rules such as `.queue-record__title` go with it.
  "admin-queue-disclosure",
  "application-form",
  "availability-help",
  "chat-booking-facts__heading",
  "chat-peer-role-tag",
  "check-row",
  "credential-disclosure",
  "dashboard-columns",
  "dashboard-ledger",
  "desktop-filter-title",
  "discovery-controls",
  "discovery-filter-disclosure",
  "discovery-guided-layout",
  "discovery-intro",
  "discovery-query-field",
  "discovery-search",
  "empty-evidence",
  "evidence-actions",
  "file-control",
  "filter-fields",
  "guided-filter-grid",
  "home-hero",
  "ledger-heading",
  "message-form",
  "mobile-filter-toggle",
  "next-action-card__eyebrow",
  "notification-center__actions",
  "panel-note",
  "process-rule",
  "queue-panel",
  "queue-record",
  "result-avatar",
  "result-copy",
  "result-heading",
  "review-applicant",
  "selected-trainer-copy",
  "selected-trainer-facts",
  "selected-trainer-overview",
  "status-dot",
  "upload-status",
  "verification-queue",
  "verification-row",
  "verified-icon",
  "workbench-title",
  "workflow-progress",
  // Removed in an earlier pass, kept so a re-run stays idempotent.
  "command-pill",
  "responsive-search-button",
  "discovery-workbench",
  "schedule-zone",
  "trainer-result",
  "availability-panel",
  "slot-button",
  "selected-trainer-summary",
  // Removed when /trainer's week became a read-only strip behind a disclosure:
  // the heading, the week controls, the range and the grid's own action buttons
  // have no component left, and .trainer-week-strip replaced them.
  "trainer-week__heading",
  "trainer-week__range",
  "trainer-week__controls",
  "trainer-week-event__actions",
  "trainer-slot-delete",
];

const patterns = dead.map((name) => new RegExp(`\\.${name}\\b`));
const isDead = (selector) => patterns.some((pattern) => pattern.test(selector));

const root = postcss.parse(readFileSync(target, "utf8"));
let removedRules = 0;
let trimmedLists = 0;

root.walkRules((rule) => {
  // `rule.selectors` splits on the commas that matter and keeps the ones inside
  // functional pseudo-classes with the selector they belong to.
  const keep = rule.selectors.filter((selector) => !isDead(selector));
  if (keep.length === rule.selectors.length) return;
  if (keep.length === 0) {
    const parent = rule.parent;
    rule.remove();
    removedRules += 1;
    // A heading comment left alone above an empty at-rule looks like a mistake.
    if (parent && parent.type === "atrule" && parent.nodes && parent.nodes.length === 0) parent.remove();
    return;
  }
  trimmedLists += 1;
  rule.selector = keep.join(",\n");
});

const output = root.toString();
// Confirm the result still parses before it replaces the file.
postcss.parse(output);
writeFileSync(target, output, "utf8");
console.log(`rules removed: ${removedRules}, selector lists trimmed: ${trimmedLists}`);
console.log(`lines ${readFileSync(target, "utf8").split("\n").length}`);
for (const name of dead) {
  if (new RegExp(`\\.${name}\\b`).test(output)) console.log(`STILL PRESENT: ${name}`);
}
