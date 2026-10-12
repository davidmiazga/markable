import { describe, it, expect, vi } from "vitest";
import plugin from "../../../src/plugins/calendar/calendar.plugin";
import type { MarkablePluginAPI } from "../../../src/plugins/markable-plugin-api";

describe("calendar plugin", () => {
  it("reveals Daily Note's calendar and does not register a grid", () => {
    const api = {
      focusSidebarPanel: vi.fn(),
      registerSidebarPanel: vi.fn(),
      unregisterSidebarPanel: vi.fn(),
      toggleSidebarPanel: vi.fn(),
    };
    plugin.onEnable(api as unknown as MarkablePluginAPI);
    expect(api.focusSidebarPanel).toHaveBeenCalledWith("daily-note-calendar");
    expect(api.registerSidebarPanel).not.toHaveBeenCalled();
    plugin.onDisable(api as unknown as MarkablePluginAPI);
    expect(api.unregisterSidebarPanel).not.toHaveBeenCalled();
    expect(plugin.id).toBe("calendar");
  });
});
