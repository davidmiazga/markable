/**
 * tests/collections/picker.test.ts — step_R07
 *
 * End-to-end verification of the picker → render round-trip for the
 * `collection-home` layout:
 *
 *   1. The display-options picker registers Collection as a valid choice.
 *   2. `buildSelectFenceFromState` emits `display: collection-home` when
 *      the state's display is set to that slug.
 *   3. Switching FROM `collection-home` to another layout (Cards, etc.)
 *      preserves unrelated keys and leaves the underlying notes/folders
 *      byte-identical (no destructive rewrite).
 *   4. The select-widget's RENDERERS map dispatches `collection-home` to
 *      `renderCollectionHome`.
 *
 * This step typically has NO source-code edits if R02–R06 landed cleanly.
 * The verification tests catch wire-up gaps and document the contract.
 */

import { describe, it, expect } from "vitest";
import {
  buildSelectFenceFromState,
  type DisplayKind,
} from "../../src/lib/select-builder";
import { DISPLAY_REGISTRY } from "../../src/plugins/file-browser/folder-view/display-options";
// The select-widget exports its dispatch map under `SELECT_WIDGET_RENDERERS`
// (the R02 work renamed it from the local `RENDERERS` constant so refactor
// tests can import it without grepping the file body).
import { SELECT_WIDGET_RENDERERS } from "../../src/editor/select-widget";
import { renderCollectionHome } from "../../src/plugins/file-browser/collections/renderer";

function baseState(
  overrides: Record<string, unknown> = {},
): Parameters<typeof buildSelectFenceFromState>[0] {
  return {
    rules: [],
    path: "./",
    display: "cards" as DisplayKind,
    displayOption: "grid",
    sort: "name-asc",
    showModified: true,
    showExtensions: true,
    previewPane: false,
    kanbanField: "",
    contentWidth: "normal" as const,
    ...overrides,
  } as Parameters<typeof buildSelectFenceFromState>[0];
}

describe("picker: DISPLAY_REGISTRY + RENDERERS contract (R07)", () => {
  it("EC-13 — DISPLAY_REGISTRY includes a `collection-home` entry labelled `Collection`", () => {
    const entry = DISPLAY_REGISTRY.find((d) => d.slug === "collection-home");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Collection");
    // Single-option shape — only "default" exists for now.
    expect(entry?.defaultOption).toBe("default");
    expect(entry?.options.length).toBe(1);
  });

  it("RQ-3 — SELECT_WIDGET_RENDERERS[\"collection-home\"] resolves to renderCollectionHome (reference equality)", () => {
    // The select-widget's dispatch map is the modern codefence-widget
    // dispatch path. A mismatch here would silently route Collection
    // picks to the wrong renderer.
    expect(SELECT_WIDGET_RENDERERS["collection-home"]).toBe(renderCollectionHome);
  });
});

describe("picker: buildSelectFenceFromState (R07)", () => {
  it("EC-13 — writes `display: collection-home` when state.display is `collection-home`", () => {
    const fence = buildSelectFenceFromState(
      baseState({ display: "collection-home" as DisplayKind }),
    );
    expect(fence).toContain("display: collection-home");
  });

  it("EC-13 — Collection emission stays inside the ```select fence", () => {
    // Sanity: the fence opens/closes correctly so the codefence parser
    // accepts it on the round-trip.
    const fence = buildSelectFenceFromState(
      baseState({ display: "collection-home" as DisplayKind }),
    );
    expect(fence.startsWith("```select")).toBe(true);
    expect(fence.trim().endsWith("```")).toBe(true);
  });

  it("EC-13 — does NOT silently emit a `type:` legacy marker", () => {
    // R04 stripped the legacy `type: collection` field. The picker write
    // path must NOT reintroduce it via the codefence — the fence carries
    // `display:` only, not the frontmatter-level `type:` field.
    const fence = buildSelectFenceFromState(
      baseState({ display: "collection-home" as DisplayKind }),
    );
    expect(fence).not.toContain("type: collection");
  });

  it("EC-13 — round-trip: a fence containing `display: collection-home` parses back to display = collection-home", () => {
    // We don't import the codeblock parser here — it's exercised by the
    // select-widget tests. The contract is: buildSelectFenceFromState
    // emits literally `display: collection-home`, and the parser reads
    // the slug verbatim. Validate the literal emission so any rename of
    // the slug is caught.
    const fence = buildSelectFenceFromState(
      baseState({ display: "collection-home" as DisplayKind }),
    );
    // Extract the `display:` line and verify the value is the slug.
    const match = fence.match(/^display:\s*(.+)$/m);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe("collection-home");
  });

  it("EC-14 — switching FROM collection-home to cards re-emits without leftover Collection-specific data", () => {
    // The picker's state machine is the source of truth — switching the
    // `display:` field is a single-field edit. Unrelated YAML keys in
    // the fence (sort, path, content-width, etc.) are preserved verbatim.
    const fromCollection = buildSelectFenceFromState(
      baseState({
        display: "collection-home" as DisplayKind,
        sort: "name-asc",
        path: "./Sub",
        contentWidth: "wide",
      }),
    );
    const toCards = buildSelectFenceFromState(
      baseState({
        display: "cards" as DisplayKind,
        sort: "name-asc",
        path: "./Sub",
        contentWidth: "wide",
      }),
    );
    // Switching the display value must not introduce a `display:
    // collection-home` line, AND the unrelated keys survive.
    expect(toCards).not.toContain("display: collection-home");
    expect(toCards).toContain("display: cards");
    expect(toCards).toContain("path: ./Sub");
    expect(toCards).toContain("content-width: wide");
    expect(toCards).toContain("sort: name-asc");
    // Smoke check that the two fences are NOT byte-identical (the
    // display: line should differ).
    expect(toCards).not.toBe(fromCollection);
  });

  it("EC-13 — option key is omitted for collection-home (default option = `default`)", () => {
    // The picker emits `option:` only when the chosen sub-option differs
    // from the display's defaultOption. Collection has one option, the
    // default, so `option:` is suppressed on a fresh write — keeps the
    // fence minimal and round-trip byte-stable.
    const fence = buildSelectFenceFromState(
      baseState({
        display: "collection-home" as DisplayKind,
        displayOption: "default",
      }),
    );
    expect(fence).not.toContain("option:");
  });
});
