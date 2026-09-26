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

function importantPropertyInMedia(selector: string, property: string, mediaQuery: string) {
  let value: string | undefined;

  stylesheet.walkAtRules("media", (media) => {
    if (media.params !== mediaQuery) return;
    media.walkRules(selector, (rule) => {
      rule.walkDecls(property, (declaration) => {
        if (declaration.important) value = declaration.value;
      });
    });
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

  it("keeps the requested sidebar transition when Windows reduces motion", () => {
    expect(importantPropertyInMedia(
      "body:has(.app-sidebar)",
      "transition-duration",
      "(prefers-reduced-motion: reduce)",
    )).toBe("var(--dur-short)");
  });

  it("does not clip the account menu when the sidebar is expanded or collapsed", () => {
    expect(propertyAtWidth(".app-sidebar", "overflow", 1280)).toBe("visible");
    expect(propertyAtWidth(".app-sidebar .profile-menu", "left", 1280)).toBe("0");
  });
});
