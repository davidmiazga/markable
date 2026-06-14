/**
 * tests/view-modal/css.test.ts (step_04)
 *
 * EC-15: ensure the new Unified View Modal source files use theme
 * tokens, not hardcoded hex literals. Greps the two new files plus the
 * view-modal-specific CSS injection inside `codeblock-modal.ts`.
 *
 * NFR-5: all colors and sizes come from the canonical token catalog
 * in `src/styles.css`. The legacy `cbm-*` rules inside
 * `codeblock-modal.ts` carry historical hex fallbacks (e.g.
 * `rgba(0,0,0,.55)`); those are pre-existing and not the subject of
 * this test. Only the NEW view-modal-specific code paths are checked.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function fileText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Detect any explicit hex color literal: `#abc`, `#abcd`, `#aabbcc`,
 * `#aabbccdd`. The pattern is intentionally permissive so we catch
 * 3/4/6/8-digit forms equally.
 */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

describe("View Modal — no hardcoded hex colors in new files (EC-15)", () => {
  it("view-modal-illustrations.ts uses currentColor only — no hex", () => {
    const src = fileText("src/lib/view-modal-illustrations.ts");
    const matches = src.match(HEX_RE) ?? [];
    expect(matches).toEqual([]);
  });

  it("VIEW_MODAL_STYLES block in codeblock-modal.ts uses theme tokens — no hex", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    // Anchor on the well-defined sentinel comment markers around the new
    // CSS block. The grep is scoped to that range; legacy `cbm-*` styles
    // outside the markers are not part of this audit.
    const start = src.indexOf("/* VIEW_MODAL_STYLES_BEGIN */");
    const end = src.indexOf("/* VIEW_MODAL_STYLES_END */");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    const matches = block.match(HEX_RE) ?? [];
    expect(matches).toEqual([]);
  });
});
