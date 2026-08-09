import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Guided FitConnect visual tokens", () => {
  const css = readFileSync("tokens.css", "utf8");
  it.each(["--color-canvas", "--color-surface", "--color-surface-muted", "--radius-card", "--radius-panel", "--shadow-surface"])(
    "defines %s",
    (token) => expect(css).toContain(token),
  );
});
