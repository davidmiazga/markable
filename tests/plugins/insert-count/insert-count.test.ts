/**
 * insert-count.test.ts
 *
 * Vitest unit tests for the Insert Count plugin.
 * Tests are organised into six groups (A–F) matching the strategy in
 * docs/specs/insert-count/step_05_tests.md.
 *
 * All pure-logic tests import directly from insert-count.logic.ts — no eval,
 * no IIFE sandbox, no DOM required for Groups A–D.
 * Groups E and F use jsdom (Vitest's default environment) and mock objects.
 *
 * Edge cases covered: EC-01 through EC-27.
 * EC items marked "Manual" in step_05 are documented below with comments
 * pointing at the code path that satisfies them.
 */

import { describe, it, expect, vi } from "vitest";
import {
  formatValue,
  resolveInsertionPositions,
  buildChanges,
  computePostInsertionCursor,
  validateInputs,
  isInteger,
  applyInsertions,
} from "../../../src/plugins/insert-count/insert-count.logic";
import type {
  InsertCountSettings,
  InsertionPosition,
  EditorStateLike,
} from "../../../src/plugins/insert-count/insert-count.logic";

// ── Shared helper: build a mock EditorStateLike from a doc string and ranges ──

/**
 * Build a minimal EditorStateLike from a plain text document string and an
 * array of selection ranges. Tests supply ranges as { from, to, head? } —
 * `head` defaults to `to` (the end of the range / cursor blink position).
 *
 * The helper faithfully computes line boundaries by splitting on "\n", matching
 * what CM6's EditorState.doc would return. This lets resolveInsertionPositions
 * run against plain objects without any @codemirror/* imports.
 */
function makeState(
  ranges: Array<{ from: number; to: number; head?: number }>,
  docText: string,
): EditorStateLike {
  const lines = docText.split("\n");

  /**
   * Return the line descriptor for the line containing document offset `pos`.
   * Lines are 1-indexed (CM6 convention). The `length` field excludes the
   * newline character, matching CM6's TextLine.length behaviour.
   */
  function lineAt(pos: number): { number: number; from: number; to: number; length: number } {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length;
      const lineEnd = offset + lineLen;
      if (pos <= lineEnd || i === lines.length - 1) {
        return { number: i + 1, from: offset, to: lineEnd, length: lineLen };
      }
      offset = lineEnd + 1; // +1 for the '\n' character between lines
    }
    // Fallback (should not be reached for valid positions).
    return { number: 1, from: 0, to: docText.length, length: docText.length };
  }

  /**
   * Return the line descriptor for the 1-based line number `n`.
   */
  function line(n: number): { number: number; from: number; to: number; length: number } {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length;
      if (i + 1 === n) {
        return { number: n, from: offset, to: offset + len, length: len };
      }
      offset += len + 1; // +1 for '\n'
    }
    // Fallback: return a zero-length line at the start (should not happen in tests).
    return { number: n, from: 0, to: 0, length: 0 };
  }

  return {
    readOnly: false,
    selection: {
      ranges: ranges.map((r) => ({
        from: r.from,
        to: r.to,
        head: r.head ?? r.to,
        anchor: r.from,
      })),
    },
    doc: { lineAt, line },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — formatValue (pure arithmetic + substitution)
// EC-03, EC-09 through EC-12, EC-24
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatValue", () => {
  // EC-03, FR-03.6 rule 1: empty wrap → bare number string.
  it("returns bare number when wrap is empty (index 0)", () => {
    expect(formatValue(1, 1, "", 0)).toBe("1");
  });

  it("increments correctly with non-zero index (empty wrap)", () => {
    expect(formatValue(1, 1, "", 4)).toBe("5");
  });

  // EC-10: no "#" token in pattern → number appended after the pattern string.
  it("appends number after pattern string when no # token", () => {
    expect(formatValue(1, 1, "Item ", 0)).toBe("Item 1");
    expect(formatValue(1, 1, "Item ", 2)).toBe("Item 3");
  });

  // EC-11: single "#" token → replaced with number.
  it("replaces # token with number", () => {
    expect(formatValue(1, 1, "Step #:", 2)).toBe("Step 3:");
  });

  // EC-12: multiple "#" tokens → all replaced (replaceAll behaviour).
  it("replaces ALL occurrences of # (replaceAll)", () => {
    expect(formatValue(3, 1, "#/#", 0)).toBe("3/3");
    expect(formatValue(3, 1, "#/#", 1)).toBe("4/4");
  });

  // EC-09: negative step should decrement the sequence.
  it("handles negative step correctly", () => {
    expect(formatValue(10, -2, "", 0)).toBe("10");
    expect(formatValue(10, -2, "", 1)).toBe("8");
    expect(formatValue(10, -2, "", 3)).toBe("4");
  });

  // EC-24: very large start value — String() must not truncate.
  it("handles very large start values without truncation", () => {
    expect(formatValue(9999999999, 1, "", 0)).toBe("9999999999");
  });

  // Boundary: start of zero is a valid integer (FR-05.1).
  it("allows start value of 0", () => {
    expect(formatValue(0, 1, "", 0)).toBe("0");
  });

  // Negative start with positive step.
  it("allows negative start value", () => {
    expect(formatValue(-5, 1, "", 2)).toBe("-3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — resolveInsertionPositions (mode selection + column calculation)
// EC-03, EC-04, EC-06, EC-07, EC-23
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveInsertionPositions", () => {
  // EC-03: single bare cursor (from === to) → Mode C, one position at `from`.
  it("Mode C: single bare cursor returns one position at cursor offset", () => {
    const state = makeState([{ from: 5, to: 5 }], "hello world");
    const pos = resolveInsertionPositions(state);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toEqual({ offset: 5, index: 0 });
  });

  // EC-07: single-line partial selection → treated as Mode C, position at `from`.
  it("Mode C: single-line selection treated as single cursor at from", () => {
    const state = makeState([{ from: 3, to: 8 }], "hello world");
    const pos = resolveInsertionPositions(state);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toEqual({ offset: 3, index: 0 });
  });

  // EC-04: three cursors → Mode A, positions sorted ascending, indices 0/1/2.
  it("Mode A: 3 cursors return 3 positions sorted ascending by offset", () => {
    // Cursors at offsets 5 (end of "line1"), 0 (start), 11 (start of "line3").
    // Intentionally unsorted to verify defensive sort.
    const state = makeState(
      [{ from: 5, to: 5 }, { from: 0, to: 0 }, { from: 11, to: 11 }],
      "line1\nline2\nline3",
    );
    const pos = resolveInsertionPositions(state);
    expect(pos).toHaveLength(3);
    // Offsets must be strictly ascending.
    expect(pos[0].offset).toBeLessThan(pos[1].offset);
    expect(pos[1].offset).toBeLessThan(pos[2].offset);
    // Sequential indices.
    expect(pos[0].index).toBe(0);
    expect(pos[1].index).toBe(1);
    expect(pos[2].index).toBe(2);
  });

  // EC-06: selection spanning 4 lines → Mode B, 4 positions, indices 0–3.
  it("Mode B: selection spanning 4 lines returns 4 positions", () => {
    const doc = "aa\nbb\ncc\ndd";
    // Select entire document; head at end.
    const state = makeState([{ from: 0, to: doc.length, head: doc.length }], doc);
    const pos = resolveInsertionPositions(state);
    expect(pos).toHaveLength(4);
    pos.forEach((p, i) => expect(p.index).toBe(i));
  });

  // EC-06: Mode B cursor-column insertion on each line.
  it("Mode B: inserts at cursor column on each line", () => {
    // "aa\nbb\ncc" — head at offset 2 (col 2 on line 1 "aa", which has length 2).
    const doc = "aa\nbb\ncc";
    // Select entire doc; head at position 2 (end of line 1 "aa").
    const state = makeState([{ from: 0, to: doc.length, head: 2 }], doc);
    const pos = resolveInsertionPositions(state);
    // Line 1 "aa": from=0, col=2 → offset 0+2=2
    // Line 2 "bb": from=3, col=2 → offset 3+2=5
    // Line 3 "cc": from=6, col=2 → offset 6+2=8
    expect(pos[0].offset).toBe(2);
    expect(pos[1].offset).toBe(5);
    expect(pos[2].offset).toBe(8);
  });

  // FR-03.3: if a line is shorter than cursorCol, clamp to line end.
  it("Mode B: appends at line end when line is shorter than cursor column", () => {
    // "long_line\nab\nlong_line" — "long_line" has length 9; head at col 9.
    const doc = "long_line\nab\nlong_line";
    // head=9 → col 9 on line 1. Line 2 "ab" has length 2 → clamped to 2.
    const state = makeState([{ from: 0, to: doc.length, head: 9 }], doc);
    const pos = resolveInsertionPositions(state);
    // Line 2 "ab": from=10, clamped col=2 → offset 10+2=12
    expect(pos[1].offset).toBe(12);
  });

  // EC-23: two cursors on the same line → Mode A, both positions returned.
  it("Mode A: two cursors on same line produce two positions", () => {
    const state = makeState(
      [{ from: 2, to: 2 }, { from: 4, to: 4 }],
      "hello world",
    );
    const pos = resolveInsertionPositions(state);
    expect(pos).toHaveLength(2);
    expect(pos[0].offset).toBe(2);
    expect(pos[1].offset).toBe(4);
  });

  // H-01: invariant that keeps computePostInsertionCursor's @precondition safe.
  // resolveInsertionPositions must ALWAYS return positions sorted ascending by
  // offset, regardless of the order CM6 provides the selection ranges.
  // This test deliberately passes ranges in DESCENDING order to verify the
  // defensive sort in Mode A.
  it("always returns positions sorted ascending by offset (precondition for computePostInsertionCursor)", () => {
    // Ranges intentionally in reverse order: 12, 6, 0.
    const state = makeState(
      [{ from: 12, to: 12 }, { from: 6, to: 6 }, { from: 0, to: 0 }],
      "aaa\nbbb\nccc\nddd",
    );
    const pos = resolveInsertionPositions(state);
    // Every adjacent pair must be strictly ascending.
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i].offset).toBeGreaterThan(pos[i - 1].offset);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — buildChanges (ChangeSpec assembly)
// EC-22
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildChanges", () => {
  // All specs must be pure insertions: from === to.
  it("produces from===to specs (pure inserts, no text replaced)", () => {
    const positions: InsertionPosition[] = [
      { offset: 0, index: 0 },
      { offset: 5, index: 1 },
    ];
    const config: InsertCountSettings = { start: 1, step: 1, wrap: "" };
    const changes = buildChanges(positions, config);
    expect(changes).toHaveLength(2);
    changes.forEach((c) => expect(c.from).toBe(c.to));
  });

  // Verify formatted strings match expected values.
  it("inserts correct formatted strings for each position", () => {
    const positions: InsertionPosition[] = [
      { offset: 0, index: 0 },
      { offset: 10, index: 1 },
    ];
    const config: InsertCountSettings = { start: 5, step: 2, wrap: "x#" };
    const changes = buildChanges(positions, config);
    expect(changes[0].insert).toBe("x5");
    expect(changes[1].insert).toBe("x7");
  });

  // EC-22: 200 cursor positions — must produce exactly 200 specs without error.
  it("produces 200 change specs for 200 positions without error", () => {
    const positions: InsertionPosition[] = Array.from({ length: 200 }, (_, i) => ({
      offset: i * 10,
      index: i,
    }));
    const config: InsertCountSettings = { start: 1, step: 1, wrap: "" };
    const changes = buildChanges(positions, config);
    expect(changes).toHaveLength(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — computePostInsertionCursor (post-dispatch cursor offset)
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePostInsertionCursor", () => {
  // Single insertion: cursor lands at offset + length of inserted string.
  it("returns offset after last insert for single position", () => {
    const positions: InsertionPosition[] = [{ offset: 5, index: 0 }];
    const config: InsertCountSettings = { start: 1, step: 1, wrap: "" };
    // Inserts "1" (length 1) at offset 5 → cursor at 5 + 0 (shift) + 1 (len) = 6.
    expect(computePostInsertionCursor(positions, config)).toBe(6);
  });

  // Two insertions: the first shifts the second's final position.
  it("accounts for earlier insertions shifting the final cursor offset", () => {
    // Position 0: inserts "1" at offset 0 (1 char shift).
    // Position 1: inserts "2" at offset 5 (original). shift=1, len=1 → 5+1+1=7.
    const positions: InsertionPosition[] = [
      { offset: 0, index: 0 },
      { offset: 5, index: 1 },
    ];
    const config: InsertCountSettings = { start: 1, step: 1, wrap: "" };
    expect(computePostInsertionCursor(positions, config)).toBe(7);
  });

  // Multi-digit number: length is 3, not 1.
  it("handles multi-digit numbers correctly", () => {
    const positions: InsertionPosition[] = [{ offset: 0, index: 0 }];
    const config: InsertCountSettings = { start: 100, step: 1, wrap: "" };
    // Inserts "100" (length 3) at offset 0 → cursor at 3.
    expect(computePostInsertionCursor(positions, config)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group E — Input validation helpers
// EC-08, EC-13, EC-14, EC-15, EC-09
// ═══════════════════════════════════════════════════════════════════════════════

describe("isInteger", () => {
  it("accepts positive integers", () => {
    expect(isInteger("1")).toBe(true);
    expect(isInteger("100")).toBe(true);
  });

  it("accepts negative integers", () => {
    expect(isInteger("-5")).toBe(true);
  });

  it("accepts zero", () => {
    expect(isInteger("0")).toBe(true);
  });

  // EC-13, EC-14: decimal values must be rejected.
  it("rejects decimals (EC-13, EC-14)", () => {
    expect(isInteger("1.5")).toBe(false);
    expect(isInteger("0.5")).toBe(false);
  });

  // EC-13: non-numeric strings.
  it("rejects non-numeric strings (EC-13)", () => {
    expect(isInteger("abc")).toBe(false);
    expect(isInteger("1a")).toBe(false);
  });

  // EC-15: empty string is not a valid integer.
  it("rejects empty string (EC-15)", () => {
    expect(isInteger("")).toBe(false);
  });
});

describe("validateInputs", () => {
  // EC-08: Step=0 must produce a specific error message.
  it("reports error for step=0 (EC-08)", () => {
    const result = validateInputs("1", "0");
    expect(result.valid).toBe(false);
    expect(result.stepError).toBe("Step cannot be zero");
  });

  // EC-13: non-integer start field.
  it("reports error for non-integer start (EC-13)", () => {
    const result = validateInputs("abc", "1");
    expect(result.valid).toBe(false);
    expect(result.startError).toBeTruthy();
  });

  // Also test decimal in start.
  it("reports error for decimal start value", () => {
    const result = validateInputs("1.5", "1");
    expect(result.valid).toBe(false);
    expect(result.startError).toBe("Must be a whole number");
  });

  // EC-14: non-integer step field.
  it("reports error for non-integer step (EC-14)", () => {
    const result = validateInputs("1", "1.5");
    expect(result.valid).toBe(false);
    expect(result.stepError).toBeTruthy();
  });

  // EC-15: empty start field → "Required".
  it("reports 'Required' for empty start (EC-15)", () => {
    const result = validateInputs("", "1");
    expect(result.valid).toBe(false);
    expect(result.startError).toBe("Required");
  });

  // EC-09: negative step is valid (user wants a descending sequence).
  it("accepts negative step (EC-09)", () => {
    const result = validateInputs("10", "-2");
    expect(result.valid).toBe(true);
    expect(result.stepError).toBe("");
    expect(result.startError).toBe("");
  });

  // Valid zero start (negative start is also valid per FR-05.1).
  it("accepts zero start with positive step", () => {
    const result = validateInputs("0", "1");
    expect(result.valid).toBe(true);
  });

  // Both fields empty → both show Required errors.
  it("reports Required for both fields when both are empty", () => {
    const result = validateInputs("", "");
    expect(result.valid).toBe(false);
    expect(result.startError).toBe("Required");
    expect(result.stepError).toBe("Required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group F — applyInsertions integration tests (mocked view + api)
// EC-01, EC-05, EC-16, EC-26, EC-27
// ═══════════════════════════════════════════════════════════════════════════════

describe("applyInsertions", () => {
  /**
   * Build a minimal mock EditorView with a spy on dispatch.
   * The `state` field is a full EditorStateLike produced by makeState.
   */
  function makeView(
    docText: string,
    ranges: Array<{ from: number; to: number; head?: number }>,
  ) {
    const dispatchSpy = vi.fn();
    return {
      state: { ...makeState(ranges, docText) },
      dispatch: dispatchSpy,
      _dispatchSpy: dispatchSpy,
    };
  }

  // EC-05: all insertions must be in a single dispatch call.
  it("calls dispatch exactly once regardless of cursor count (EC-05)", async () => {
    const view = makeView("abc\ndef\nghi", [
      { from: 0, to: 0 },
      { from: 4, to: 4 },
      { from: 8, to: 8 },
    ]);
    const api = {
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };

    await applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api);

    expect(view._dispatchSpy).toHaveBeenCalledTimes(1);
    const call = view._dispatchSpy.mock.calls[0][0];
    expect(call.changes).toHaveLength(3);
  });

  // EC-27: read-only editor → dispatch must NOT be called; no save.
  it("skips dispatch for read-only editor (EC-27)", async () => {
    const view = makeView("readonly content", [{ from: 0, to: 0 }]);
    // Simulate a read-only editor state.
    (view.state as any).readOnly = true;
    const api = { saveSettings: vi.fn() };

    await applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api);

    expect(view._dispatchSpy).not.toHaveBeenCalled();
    // Settings must not be saved when insertion was skipped.
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  // EC-16: saveSettings must NOT be called when insertion is skipped because the
  // editor is read-only. This exercises the same early-return code path that the
  // Cancel button uses: neither path ever reaches the saveSettings call.
  //
  // We reuse the read-only guard (EC-27) here — if dispatch is not called, the
  // function returns before the saveSettings block, proving settings cannot be
  // persisted on a non-insert path. The Cancel path in the plugin is even
  // stricter: closeDialog(false) never calls applyInsertions at all.
  it("EC-16: saveSettings is not called when insertion is skipped (read-only guard)", async () => {
    const view = makeView("some content", [{ from: 0, to: 0 }]);
    (view.state as any).readOnly = true;
    const api = { saveSettings: vi.fn() };

    await applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api);

    // Insertion was skipped — saveSettings must not be called.
    expect(api.saveSettings).not.toHaveBeenCalled();
    // dispatch must also be clean — belt-and-suspenders check.
    expect(view._dispatchSpy).not.toHaveBeenCalled();
  });

  // EC-26: saveSettings rejection must not prevent or roll back the insertion.
  it("dispatch is called even when saveSettings rejects (EC-26)", async () => {
    const view = makeView("hello", [{ from: 0, to: 0 }]);
    const api = {
      saveSettings: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    // applyInsertions must resolve without throwing (EC-26 — error is logged only).
    await expect(
      applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api),
    ).resolves.not.toThrow();

    // Insertion must still have been dispatched.
    expect(view._dispatchSpy).toHaveBeenCalledTimes(1);
  });

  // EC-01: null view → silent no-op; no saveSettings call.
  it("returns immediately when view is null (EC-01)", async () => {
    const api = { saveSettings: vi.fn() };

    await expect(
      applyInsertions(null, { start: 1, step: 1, wrap: "" }, api),
    ).resolves.not.toThrow();

    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  // Verify dispatch payload has scrollIntoView: true (FR-03.5 UX).
  it("dispatch payload includes scrollIntoView: true", async () => {
    const view = makeView("hello", [{ from: 3, to: 3 }]);
    const api = { saveSettings: vi.fn().mockResolvedValue(undefined) };

    await applyInsertions(view as any, { start: 7, step: 1, wrap: "" }, api);

    const call = view._dispatchSpy.mock.calls[0][0];
    expect(call.scrollIntoView).toBe(true);
  });

  // Verify post-insertion cursor is placed after the last inserted character.
  it("dispatch payload selection anchor is after last inserted string", async () => {
    // Single cursor at offset 2 in "hello"; inserts "1" (length 1).
    // Expected anchor in new doc: 2 + 0 (shift) + 1 (len) = 3.
    const view = makeView("hello", [{ from: 2, to: 2 }]);
    const api = { saveSettings: vi.fn().mockResolvedValue(undefined) };

    await applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api);

    const call = view._dispatchSpy.mock.calls[0][0];
    expect(call.selection).toEqual({ anchor: 3 });
  });

  // EC-22: 200 cursors — dispatch called once with 200 changes.
  it("handles 200 cursor positions in a single transaction (EC-22)", async () => {
    // Build a doc with 200 lines; one cursor at the start of each line.
    const lines = Array.from({ length: 200 }, (_, i) => `line${i}`);
    const docText = lines.join("\n");
    // Build ranges: one per line at each line's start.
    const ranges: Array<{ from: number; to: number }> = [];
    let offset = 0;
    for (const line of lines) {
      ranges.push({ from: offset, to: offset });
      offset += line.length + 1; // +1 for '\n'
    }

    const view = makeView(docText, ranges);
    const api = { saveSettings: vi.fn().mockResolvedValue(undefined) };

    await applyInsertions(view as any, { start: 1, step: 1, wrap: "" }, api);

    expect(view._dispatchSpy).toHaveBeenCalledTimes(1);
    const call = view._dispatchSpy.mock.calls[0][0];
    expect(call.changes).toHaveLength(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Manual / structural EC notes (EC-02, EC-17 through EC-21, EC-25)
// ═══════════════════════════════════════════════════════════════════════════════

/*
 * EC-02: Plugin disabled, menu item clicked.
 *   handleAction("edit-insert-count") in main.ts checks
 *   window.__MARKABLE_INSERT_COUNT_OPEN__. When null (plugin off), it calls
 *   alert("Enable the Insert Count plugin in Markable > Plugins to use this feature.").
 *   Verified by code review of main.ts case "edit-insert-count".
 *
 * EC-17: Enter key submits dialog.
 *   buildDialogDOM() attaches a "keydown" listener on the dialog element that
 *   calls doInsert() when e.key === "Enter". Verified by code review of plugin.
 *
 * EC-18: Escape key dismisses dialog.
 *   Same keydown listener calls closeDialog(false) when e.key === "Escape".
 *   Verified by code review.
 *
 * EC-19: Double-open guard.
 *   openDialog() returns early and calls dialogEl.focus() when dialogOpen === true.
 *   No second dialog is created. Verified by code review.
 *
 * EC-20: Plugin disabled while dialog open.
 *   onDisable() calls closeDialog(false) when dialogEl is non-null, removing the
 *   dialog DOM without inserting. Verified by code review.
 *
 * EC-21: Tab switch while dialog open.
 *   The dialog is a fixed-position div on document.body and is not tied to any
 *   editor tab DOM. It remains visible when the active tab changes (UK-05).
 *   When Insert is clicked, applyInsertions uses __MARKABLE_EDITOR_VIEW__ which
 *   always reflects the currently active tab. Verified by code review.
 *
 * EC-25: First run (loadSettings returns null).
 *   onEnable() receives null from api.loadSettings() and applies DEFAULT_SETTINGS
 *   explicitly via property-type checks. No null-dereference error occurs.
 *   Verified by code review of onEnable.
 */
