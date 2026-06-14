/**
 * tests/collections/css.test.ts — step_17
 *
 * Asserts the Collections stylesheet satisfies the project's theme
 * contract (NFR-7) and exposes every selector the renderer emits.
 *
 * Pattern adapted from `tests/folder-icons/css.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cssPath = join(
  process.cwd(),
  "src/plugins/file-browser/collections/collections.css",
);
const fileBrowserCssPath = join(
  process.cwd(),
  "src/plugins/file-browser/file-browser.css",
);

const css = readFileSync(cssPath, "utf8");
const fileBrowserCss = readFileSync(fileBrowserCssPath, "utf8");

const REQUIRED_SELECTORS = [
  ".fv-collection-breadcrumb",
  ".fv-collection-breadcrumb-seg",
  ".fv-collection-breadcrumb-sep",
  ".fv-collection-empty-state",
  ".fv-collection-empty-state-button",
  ".fv-collection-glyph-grid",
  ".fv-collection-stack-glyph",
  ".fv-collection-badge",
  ".fv-collection-stack-label",
  ".fv-collection-add-stack-affordance",
  ".fv-collection-popover",
  ".fv-collection-popover-item",
  ".fv-collection-stack-panel",
  ".fv-collection-stack-header",
  ".fv-collection-stack-list",
  ".fv-collection-stack-add-note",
  ".fv-collection-note-box",
  ".fv-collection-note-box-label",
  ".fv-collection-note-box-body",
  ".fv-collection-inline-editor-host",
];

describe("collections.css (step_17)", () => {
  it("catalog completeness — every selector listed above exists in collections.css", () => {
    for (const sel of REQUIRED_SELECTORS) {
      expect(css).toContain(sel);
    }
  });

  it("FR-22 — `.fv-collection-note-box.is-reference::after` exists (CSS-only reference badge)", () => {
    expect(css).toContain(".fv-collection-note-box.is-reference::after");
  });

  it("NFR-7 — no #hex color literals in collections.css", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("NFR-7 — no raw rgb()/rgba() color literals", () => {
    expect(css).not.toMatch(/\brgba?\s*\(/);
  });

  it("NFR-7 — every color/background/border-color declaration uses a var() token", () => {
    // Match any property whose name ends with `color`, plus `background` and
    // `border` shorthands.  For each match, assert the value contains a
    // var(--token) reference.  This is a coarse-grained guard against
    // accidentally introducing a hardcoded color; the regex sweeps the
    // entire file, so a single offender fails the test.
    const propPattern = /(\bbackground(?:-color)?|\bcolor|\bborder(?:-[a-z]+)?-color)\s*:\s*([^;]+);/gi;
    let match: RegExpExecArray | null;
    while ((match = propPattern.exec(css)) !== null) {
      const value = match[2];
      // Acceptable values: var(...), "transparent", "inherit", "currentColor",
      // "unset", "initial", "none". Anything else must be a var().
      if (
        /var\(--/.test(value) ||
        /\btransparent\b/.test(value) ||
        /\binherit\b/.test(value) ||
        /\bcurrentColor\b/i.test(value) ||
        /\bunset\b/.test(value) ||
        /\binitial\b/.test(value) ||
        /\bnone\b/.test(value)
      ) {
        continue;
      }
      throw new Error(`color/background/border property uses non-token value: ${match[0]}`);
    }
  });

  it("wiring — file-browser.css imports collections.css", () => {
    expect(fileBrowserCss).toMatch(/@import\s+["']\.?\/?collections\/collections\.css["']/);
  });

  it("NFR-7 — hover/lift effect uses transform or var(--shadow-*) rather than raw rgba", () => {
    // Spot-check the .fv-collection-note-box hover rule has a non-rgba hover
    // styling — the catalog completeness test would catch the selector itself.
    // The "no rgba()" guard above already enforces the broader rule.
    const hoverBlock = css.match(/\.fv-collection-note-box:hover\s*\{[^}]*\}/);
    if (hoverBlock) {
      // Cannot contain rgba (caught above) — verify it uses transform OR a var.
      expect(hoverBlock[0]).toMatch(/(transform|var\(--)/);
    }
  });

  it("structure — every rule body opens/closes brace pair correctly (parse sanity)", () => {
    const opens = (css.match(/\{/g) ?? []).length;
    const closes = (css.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});
