/**
 * Tests for the plugins panel (src/plugins/plugins-panel/plugins-panel.ts).
 *
 * Most panel behavior is DOM-interactive and is tested by visual inspection
 * during development. This file covers the guard conditions that protect
 * against calling panel functions before the panel DOM exists.
 *
 * EC-10: updatePluginStates() must not throw when called before
 *        createPluginsPanel() has run (i.e. panelElement is null).
 */

import { describe, it, expect } from "vitest";
import { updatePluginStates } from "../src/plugins/plugins-panel/plugins-panel";
import type { MarkableSettings } from "../src/lib/settings";

describe("plugins-panel — pre-init guard (EC-10)", () => {
  it("updatePluginStates does not throw before createPluginsPanel is called", () => {
    // panelElement is null on initial module load (it is set only by
    // createPluginsPanel). Calling updatePluginStates before the panel exists
    // must be a safe no-op — the early-return on `!panelElement` handles this.
    //
    // Cast to satisfy the Record<string, boolean> type expected by the function.
    // The settings type is not relevant here; we pass any boolean map.
    const partial: Record<string, boolean> = { statusBar: true };
    expect(() => updatePluginStates(partial)).not.toThrow();
  });

  it("updatePluginStates does not throw with an empty partial object", () => {
    // Edge: an empty update must also be safe before panel creation.
    expect(() => updatePluginStates({})).not.toThrow();
  });
});
