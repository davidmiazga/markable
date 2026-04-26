/**
 * tests/list-style-keybindings.test.ts
 *
 * Step 2 tests for the Advanced Lists feature: keybinding entries in formatKeymap.
 *
 * Verifies that:
 *   - Ctrl-r, Ctrl-n, Ctrl-l bindings exist in formatKeymap
 *   - Each binding's `run` function delegates to the correct switchTo* handler
 *   - The switchListStyle function is re-exported for menu handler use
 *
 * These tests exercise the wiring only — the actual style-switching logic is
 * tested exhaustively in list-style-switch.test.ts (Step 1).
 */

import { describe, it, expect } from "vitest";
import { formatKeymap } from "../src/editor/format";
import {
  switchToAlphanumeric,
  switchToDecimal,
  switchToSteps,
  switchToStandard,
  switchListStyle,
} from "../src/editor/list-style-switch";

describe("Step 2: List style keybindings in formatKeymap", () => {
  it("contains a Ctrl-r binding for switchToAlphanumeric", () => {
    const entry = formatKeymap.find((b) => b.key === "Ctrl-r");
    expect(entry).toBeDefined();
    expect(entry!.run).toBe(switchToAlphanumeric);
  });

  it("contains a Ctrl-n binding for switchToDecimal", () => {
    const entry = formatKeymap.find((b) => b.key === "Ctrl-n");
    expect(entry).toBeDefined();
    expect(entry!.run).toBe(switchToDecimal);
  });

  it("contains a Ctrl-l binding for switchToSteps", () => {
    const entry = formatKeymap.find((b) => b.key === "Ctrl-l");
    expect(entry).toBeDefined();
    expect(entry!.run).toBe(switchToSteps);
  });

  it("does not duplicate existing keybinding count (sanity check)", () => {
    const ctrlR = formatKeymap.filter((b) => b.key === "Ctrl-r");
    const ctrlN = formatKeymap.filter((b) => b.key === "Ctrl-n");
    const ctrlL = formatKeymap.filter((b) => b.key === "Ctrl-l");
    expect(ctrlR).toHaveLength(1);
    expect(ctrlN).toHaveLength(1);
    expect(ctrlL).toHaveLength(1);
  });

  it("switchToStandard is exported for menu handler use (no keybinding)", () => {
    expect(typeof switchToStandard).toBe("function");
  });

  it("switchListStyle is exported for menu handler use", () => {
    expect(typeof switchListStyle).toBe("function");
  });
});
