import { describe, it, expect, afterEach, vi } from "vitest";
import PropertiesWrangler, {
  buildScanModel,
  renderWranglerPanel,
} from "../../../src/plugins/properties-wrangler/properties-wrangler.plugin";

function makeMockApi() {
  const registeredPanels: any[] = [];
  return {
    registerSidebarPanel: vi.fn((panel: any) => registeredPanels.push(panel)),
    unregisterSidebarPanel: vi.fn(),
    addExtensions: vi.fn(),
    removeExtensions: vi.fn(),
    _registeredPanels: registeredPanels,
  };
}

describe("buildScanModel", () => {
  it("splits tags and field:value categories", () => {
    const model = buildScanModel(
      [
        { tag: "recipe", count: 3 },
        { tag: "status:draft", count: 2 },
        { tag: "status:complete", count: 1 },
      ],
      "/vault",
    );
    expect(model.rootLabel).toBe("/vault");
    expect(model.tags).toEqual([{ value: "recipe", count: 3 }]);
    expect(model.fields.status.map((i) => i.value)).toEqual(["draft", "complete"]);
  });
});

describe("Properties Wrangler lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById("__markable_properties_wrangler_css__")?.remove();
  });

  it("onEnable registers the Wrangler sidebar panel", () => {
    const api = makeMockApi();
    PropertiesWrangler.onEnable(api as any);
    expect(api.registerSidebarPanel).toHaveBeenCalledOnce();
    expect(api._registeredPanels[0].id).toBe("properties-wrangler");
    expect(document.getElementById("__markable_properties_wrangler_css__")).not.toBeNull();
    PropertiesWrangler.onDisable(api as any);
    expect(api.unregisterSidebarPanel).toHaveBeenCalledWith("properties-wrangler");
    expect(document.getElementById("__markable_properties_wrangler_css__")).toBeNull();
  });

  it("render shows scan and choose-folder actions", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockRejectedValue("no vault") });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    expect(div.querySelector(".pw-wrap")).not.toBeNull();
    const labels = Array.from(div.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toContain("Scan");
    expect(labels).toContain("Choose folder…");
    expect(labels).toContain("Open properties file");
  });
});
