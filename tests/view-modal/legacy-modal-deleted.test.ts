/**
 * tests/view-modal/legacy-modal-deleted.test.ts (step_09)
 *
 * Regression pins. After step_09, the legacy `openCodeBlockModal()`
 * (type picker: Select / Sidebar / Grid) is deleted. The Unified View
 * Modal (`openViewModal`) handles every `select` flow; `/sidebar` and
 * `/grid` slash commands cover sidebar/grid insertion (step_07).
 *
 * The pinned strings are deliberately specific so future refactors
 * cannot accidentally restore the legacy API.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function fileText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("step_09 — legacy openCodeBlockModal is deleted", () => {
  it("openCodeBlockModal function is not declared in codeblock-modal.ts", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    expect(src).not.toMatch(/export\s+function\s+openCodeBlockModal\b/);
    expect(src).not.toMatch(/function\s+openCodeBlockModal\b/);
  });

  it("`BlockKind` type alias is not exported", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    expect(src).not.toMatch(/export\s+type\s+BlockKind\b/);
  });

  it("the `cbm-tabs` type-picker DOM class is not present in codeblock-modal.ts", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    // The legacy modal used `cbm-tabs` to host the Select/Sidebar/Grid
    // type pills. The Unified View Modal uses `vm-tabs` instead.
    expect(src).not.toContain("cbm-tabs");
  });

  it("buildSidebarFence and buildGridFence are not exported", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    expect(src).not.toMatch(/export\s+function\s+buildSidebarFence\b/);
    expect(src).not.toMatch(/export\s+function\s+buildGridFence\b/);
  });

  it("openViewModal IS exported (sanity)", () => {
    const src = fileText("src/lib/codeblock-modal.ts");
    expect(src).toMatch(/export\s+function\s+openViewModal\b/);
  });

  it("main.ts no longer imports openCodeBlockModal", () => {
    const src = fileText("src/main.ts");
    expect(src).not.toMatch(/import\s+\{[^}]*openCodeBlockModal[^}]*\}/);
  });

  it("main.ts imports openViewModal", () => {
    const src = fileText("src/main.ts");
    expect(src).toMatch(/import\s+\{[^}]*openViewModal[^}]*\}/);
  });
});
