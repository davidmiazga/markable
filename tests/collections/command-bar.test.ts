/**
 * tests/collections/command-bar.test.ts — step_15 + refactor R01
 *
 * Asserts that the SURVIVING Collections command-bar entries are registered
 * in the COMMANDS list under section "Collection" with empty default keys
 * (FR-20 / FR-61). The MVP-era `collection:make-collection` row was deleted
 * in step_R01 — the layout is opted into via the display-options picker
 * instead.
 *
 * Action dispatch is exercised manually via `handleAction` calls outside the
 * unit-test scope (the dispatcher lives in `main.ts`, which is the app entry
 * and is not unit-testable in isolation).
 */

import { describe, it, expect } from "vitest";
import { COMMANDS } from "../../src/keybindings/keybindings-panel";

describe("command-bar: Collections registration (step_15 + refactor)", () => {
  const ids = ["collection:new-stack", "collection:add-reference"];

  it("FR-61 — surviving Collection commands present in COMMANDS", () => {
    for (const id of ids) {
      expect(COMMANDS.find((c) => c.id === id)).toBeDefined();
    }
  });

  it("FR-61 — every surviving Collection command is in section 'Collection'", () => {
    for (const id of ids) {
      const cmd = COMMANDS.find((c) => c.id === id);
      expect(cmd?.section).toBe("Collection");
    }
  });

  it("FR-61 — every surviving Collection command has defaultKey: ''", () => {
    for (const id of ids) {
      const cmd = COMMANDS.find((c) => c.id === id);
      expect(cmd?.defaultKey).toBe("");
    }
  });

  it("FR-61 — labels match the spec exactly", () => {
    expect(COMMANDS.find((c) => c.id === "collection:new-stack")?.label).toBe(
      "New Stack in Current Collection",
    );
    expect(COMMANDS.find((c) => c.id === "collection:add-reference")?.label).toBe(
      "Add Reference to Another Stack…",
    );
  });
});
