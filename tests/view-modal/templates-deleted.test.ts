/**
 * tests/view-modal/templates-deleted.test.ts (step_08)
 *
 * Regression pins. After step_08 the legacy "New Folder View" template
 * picker (Hub Page / Media Gallery / Project Table / Simple Index) is
 * deleted from `file-browser.plugin.ts`. These tests assert the
 * symbols and template-related strings no longer appear in the
 * source — if a future refactor accidentally restores them, the pin
 * fires.
 *
 * The pinned strings are deliberately specific (full constant names,
 * template ids) so they will not collide with legitimate uses
 * elsewhere.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function fileText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("step_08 — deleted template constants are gone", () => {
  it("FOLDER_VIEW_TEMPLATES constant is not declared in file-browser.plugin.ts", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).not.toMatch(/\bconst\s+FOLDER_VIEW_TEMPLATES\b/);
  });

  it("openFolderViewPicker function is not declared in file-browser.plugin.ts", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).not.toMatch(/function\s+openFolderViewPicker\b/);
  });

  it("the four template SVG constants are not declared", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).not.toMatch(/\bconst\s+HUB_PAGE_SVG\b/);
    expect(src).not.toMatch(/\bconst\s+MEDIA_GALLERY_SVG\b/);
    expect(src).not.toMatch(/\bconst\s+PROJECT_TABLE_SVG\b/);
    expect(src).not.toMatch(/\bconst\s+SIMPLE_INDEX_SVG\b/);
  });

  it("the writeFolderViewTemplate helper is not declared", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).not.toMatch(/async\s+function\s+writeFolderViewTemplate\b/);
  });

  it("the duplicate `src/plugins/file-browser/template-picker.ts` no longer exists", () => {
    // step_08 deletes the in-plugin copy of the template-picker module.
    // `src/lib/template-picker.ts` survives — layout-manager still uses
    // it for the apply-page-layout flow.
    expect(existsSync(join(ROOT, "src/plugins/file-browser/template-picker.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/template-picker.ts"))).toBe(true);
  });

  it("the legacy template-picker overlay id is not referenced in file-browser.plugin.ts", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).not.toContain("__template-picker-overlay__");
  });

  it("the file-browser plugin imports openViewModal (the new entry point)", () => {
    const src = fileText("src/plugins/file-browser/file-browser.plugin.ts");
    expect(src).toContain("openViewModal");
  });
});
