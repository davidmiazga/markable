/**
 * Tests for the listCorePlugins bridge wrapper (src/lib/bridge.ts).
 *
 * Issue 7 (LOW): the existing loader-unification test for listCorePlugins only
 * checks the response shape. This file adds an explicit assertion that invoke()
 * is called with the correct command name "list_core_plugins".
 *
 * Tauri internals are mocked at module level so no real Tauri runtime is needed.
 * The pattern mirrors bridge-copy-core-plugins.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri before importing bridge ────────────────────────────────────────
// All @tauri-apps/* modules must be mocked before any bridge import so the
// module-level `invoke` reference inside bridge.ts resolves to our spy.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Clipboard plugin is imported transitively through bridge.ts.
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { listCorePlugins } from "../src/lib/bridge";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("listCorePlugins() — invoke call verification (Issue 7)", () => {
  beforeEach(() => {
    // Reset the mock before each test so call counts don't bleed across tests.
    mockInvoke.mockReset();
  });

  it("calls invoke with the correct command name 'list_core_plugins'", async () => {
    // Arrange: simulate a successful Rust response with one core file.
    mockInvoke.mockResolvedValueOnce({ files: ["focus-mode.js"], truncated: [] });

    // Act
    await listCorePlugins();

    // Assert: invoke was called exactly once with the correct command.
    // This is the key assertion that was missing from the original shape-only test.
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("list_core_plugins");
  });

  it("returns the files and truncated arrays from the invoke response", async () => {
    // Verify that the response is passed through correctly to the caller.
    mockInvoke.mockResolvedValueOnce({
      files: ["focus-mode.js", "word-count.js"],
      truncated: [],
    });

    const result = await listCorePlugins();

    expect(result.files).toEqual(["focus-mode.js", "word-count.js"]);
    expect(result.truncated).toEqual([]);
  });

  it("returns { files: [], truncated: [] } and does not throw when invoke rejects", async () => {
    // The bridge wrapper catches errors and falls back to the empty response.
    // This ensures loadPlugins can proceed even if the core directory is missing
    // (e.g. first launch before copy_core_plugins has run).
    mockInvoke.mockRejectedValueOnce(new Error("directory not found"));

    const result = await listCorePlugins();

    // Must not throw; must return the safe fallback shape.
    expect(result.files).toEqual([]);
    expect(result.truncated).toEqual([]);
  });

  it("does not pass any extra arguments to invoke", async () => {
    // list_core_plugins takes only an AppHandle (injected by Tauri) — no
    // frontend-supplied parameters. Confirm the call has no extra arguments.
    mockInvoke.mockResolvedValueOnce({ files: [], truncated: [] });
    await listCorePlugins();

    const [commandName, ...extraArgs] = mockInvoke.mock.calls[0];
    expect(commandName).toBe("list_core_plugins");
    expect(extraArgs).toHaveLength(0);
  });
});
