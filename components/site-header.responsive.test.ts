import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule } from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8"));

function mediaApplies(media: AtRule, width: number) {
  const maximum = media.params.match(/max-width:\s*([\d.]+)rem/);
  return !maximum || width <= Number(maximum[1]) * 16;
}

function propertyAtWidth(selector: string, property: string, width: number) {
  let value: string | undefined;

  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const media = rule.parent?.type === "atrule" && rule.parent.name === "media"
      ? rule.parent as AtRule
      : null;
    if (media && !mediaApplies(media, width)) return;
    rule.walkDecls(property, (declaration) => { value = declaration.value; });
  });

  return value;
}

describe("responsive site header", () => {
  it("compacts the desktop header enough to fit at the 768px boundary", () => {
    expect(propertyAtWidth(".desktop-nav", "display", 768)).toBe("flex");
    expect(propertyAtWidth(".mobile-role-nav", "display", 768)).toBe("none");
    expect(propertyAtWidth(".header-inner", "gap", 768)).toBe("var(--space-sm)");
    expect(propertyAtWidth(".desktop-nav", "gap", 768)).toBe("var(--space-md)");
    expect(propertyAtWidth(".header-actions", "gap", 768)).toBe("var(--space-xs)");
  });
});
