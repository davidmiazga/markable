/**
 * tests/folder-icons/index-flow.test.ts — step_05
 *
 * Asserts `buildFolderIconMap()` reshapes the bridge response into a
 * Map<parentDir, iconValue> and that the icon assignment naturally travels
 * with a renamed/moved folder because the map keys are derived from the
 * (new) folder path. Covers EC-12 (rename), EC-13 (move), EC-14 (delete).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

import * as bridge from "../../src/lib/bridge";
import { buildFolderIconMap } from "../../src/plugins/file-browser/folder-icon-store";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("buildFolderIconMap propagation (step_05)", () => {
  it("EC-12 — keyed by parent folder path so a renamed folder's new path resolves", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [["/v/NewName/_folder.md", "book"]],
    });
    const map = await buildFolderIconMap(["/v/NewName/_folder.md"]);
    expect(map.get("/v/NewName")).toBe("book");
    expect(map.get("/v/OldName")).toBeUndefined();
  });

  it("EC-13 — moved folder still resolves (icon lives in the file, not in a path-keyed sidecar)", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [["/v/SubA/Moved/_folder.md", "lightbulb"]],
    });
    const map = await buildFolderIconMap(["/v/SubA/Moved/_folder.md"]);
    expect(map.get("/v/SubA/Moved")).toBe("lightbulb");
  });

  it("EC-14 — a deleted folder is simply absent from the input list and absent from the map", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [],
    });
    const map = await buildFolderIconMap([]);
    expect(map.size).toBe(0);
  });

  it("bridge failure → empty map (renderer falls back for all)", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: false,
      error: { message: "x", command: "read_folder_icon_map" },
    });
    const map = await buildFolderIconMap(["/v/A/_folder.md"]);
    expect(map.size).toBe(0);
  });

  it("null icon values are dropped from the map", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [
        ["/v/A/_folder.md", null],
        ["/v/B/_folder.md", "book"],
      ],
    });
    const map = await buildFolderIconMap([
      "/v/A/_folder.md",
      "/v/B/_folder.md",
    ]);
    expect(map.has("/v/A")).toBe(false);
    expect(map.get("/v/B")).toBe("book");
  });

  it("empty input list short-circuits without calling the bridge", async () => {
    const spy = vi
      .spyOn(bridge, "readFolderIconMap")
      .mockResolvedValue({ ok: true, value: [] });
    const map = await buildFolderIconMap([]);
    expect(map.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
