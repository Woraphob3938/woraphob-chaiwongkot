import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

function layerName(rule: Rule) {
  type CssParent = { type: string; name?: string; params?: string; parent?: CssParent };
  let parent = rule.parent as CssParent | undefined;
  while (parent) {
    if (parent.type === "atrule" && parent.name === "layer") {
      return parent.params ?? null;
    }
    parent = parent.parent;
  }
  return null;
}

function selectorMatchesButton(selector: string) {
  return selector.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "button" || candidate === ".text-primary-foreground";
  });
}

describe("compiled shadcn cascade", () => {
  it("lets a Tailwind text utility override the generic button color", async () => {
    const inputPath = resolve(process.cwd(), "app/globals.css");
    const result = await postcss([tailwindcss()]).process(readFileSync(inputPath, "utf8"), {
      from: inputPath,
    });
    const stylesheet = postcss.parse(result.css);
    const candidates: Array<{ layer: string | null; selector: string; value: string }> = [];

    stylesheet.walkRules((rule) => {
      if (!selectorMatchesButton(rule.selector)) return;
      rule.walkDecls("color", (declaration) => {
        candidates.push({ layer: layerName(rule), selector: rule.selector, value: declaration.value });
      });
    });

    const layerRank = new Map([
      ["theme", 0],
      ["base", 1],
      ["components", 2],
      ["utilities", 3],
    ]);
    const winner = candidates.toSorted((left, right) => {
      const leftRank = left.layer === null ? Number.POSITIVE_INFINITY : (layerRank.get(left.layer) ?? -1);
      const rightRank = right.layer === null ? Number.POSITIVE_INFINITY : (layerRank.get(right.layer) ?? -1);
      if (leftRank !== rightRank) return leftRank - rightRank;
      const leftSpecificity = left.selector === ".text-primary-foreground" ? 10 : 1;
      const rightSpecificity = right.selector === ".text-primary-foreground" ? 10 : 1;
      return leftSpecificity - rightSpecificity;
    }).at(-1);

    expect(winner).toEqual(expect.objectContaining({
      layer: "utilities",
      selector: ".text-primary-foreground",
      value: "var(--primary-foreground)",
    }));
  });
});
