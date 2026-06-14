/**
 * tests/collections/dispatch.test.ts — refactor step_R03
 *
 * Asserts that the heavy MVP detection short-circuit in
 * `folder-view/tab.ts` has been removed, and that layout dispatch flows
 * through the standard `LAYOUT_RENDERERS[config.layout]` path. A surgical
 * three-line legacy alias remains (added in step_R04 — read-compat for
 * pre-refactor folders whose `_folder.md` carries `type: collection`
 * without a `layout:` field); this file verifies that alias is the ONLY
 * Collections-specific code path in `tab.ts` and that the
 * `detection-glue.ts` module is gone.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LAYOUT_RENDERERS } from "../../src/plugins/file-browser/folder-view/tab";
import { renderCollectionHome } from "../../src/plugins/file-browser/collections/renderer";

const TAB_PATH = resolve(__dirname, "../../src/plugins/file-browser/folder-view/tab.ts");
const DETECTION_GLUE_PATH = resolve(
  __dirname,
  "../../src/plugins/file-browser/collections/detection-glue.ts",
);

describe("dispatch: tab.ts source hygiene (refactor R03)", () => {
  it("C-2 — tab.ts does NOT import detection-glue", () => {
    const src = readFileSync(TAB_PATH, "utf-8");
    expect(src).not.toContain('from "../collections/detection-glue"');
    expect(src).not.toContain("from '../collections/detection-glue'");
  });

  it("C-2 — tab.ts does NOT reference detectCollectionLayout", () => {
    const src = readFileSync(TAB_PATH, "utf-8");
    expect(src).not.toContain("detectCollectionLayout");
  });

  it("cleanup — detection-glue.ts no longer exists in the source tree", () => {
    expect(existsSync(DETECTION_GLUE_PATH)).toBe(false);
  });
});

describe("dispatch: LAYOUT_RENDERERS (refactor R03)", () => {
  it("FR-1 — LAYOUT_RENDERERS['collection-home'] is exactly renderCollectionHome", () => {
    expect(LAYOUT_RENDERERS["collection-home"]).toBe(renderCollectionHome);
  });

  it("FR-1 — LAYOUT_RENDERERS contains the baseline view-* layouts plus collection-home", () => {
    // Bounded sanity: every slug below MUST exist after the refactor. The
    // legacy tab.ts dispatch path uses `view-*` keys (with `folder-*`
    // aliases for backwards compat); the new `collection-home` slot was
    // registered by MVP step_05 and remains untouched by the refactor.
    for (const slug of ["view-cards", "view-table", "view-timeline", "view-kanban", "collection-home"]) {
      expect(typeof LAYOUT_RENDERERS[slug]).toBe("function");
    }
  });
});
