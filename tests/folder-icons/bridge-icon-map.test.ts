/**
 * tests/folder-icons/bridge-icon-map.test.ts — step_04
 *
 * Asserts that the new typed bridge wrapper `readFolderIconMap` forwards the
 * paths array to the Rust `read_folder_icon_map` command and wraps the result
 * in the standard `FileResult<Array<[string, string | null]>>` shape.
 *
 * Pattern: mock "@tauri-apps/api/core" invoke per the existing
 * tests/bridge-image-metadata.test.ts convention (vi.spyOn does not work
 * cleanly with the happy-dom environment for the Tauri core module).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { readFolderIconMap } from "../../src/lib/bridge";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bridge.readFolderIconMap (step_04)", () => {
  it("forwards the paths array to the Rust command and returns a typed FileResult", async () => {
    mockInvoke.mockResolvedValueOnce([
      ["/v/A/_folder.md", "book"],
      ["/v/B/_folder.md", null],
    ]);
    const r = await readFolderIconMap([
      "/v/A/_folder.md",
      "/v/B/_folder.md",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual(["/v/A/_folder.md", "book"]);
      expect(r.value[1]).toEqual(["/v/B/_folder.md", null]);
    }
    expect(mockInvoke).toHaveBeenCalledWith("read_folder_icon_map", {
      paths: ["/v/A/_folder.md", "/v/B/_folder.md"],
    });
  });

  it("returns ok=false with the error message when invoke throws", async () => {
    mockInvoke.mockRejectedValueOnce("boom");
    const r = await readFolderIconMap([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
