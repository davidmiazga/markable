/**
 * Tests for the copyCorePlugins bridge wrapper (src/lib/bridge.ts).
 *
 * Verifies that copyCorePlugins() calls invoke("copy_core_plugins") and that
 * it propagates the resolved value (void on success, thrown error on failure).
 * Tauri internals are mocked so these tests run without a real Tauri runtime.
 *
 * Step 02b requirement: "Add frontend test: copyCorePlugins bridge wrapper
 * calls invoke('copy_core_plugins')".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri before importing bridge ────────────────────────────────────────
// All @tauri-apps/* modules are mocked at the top level so no real Tauri runtime
// is needed. The `invoke` mock is accessed via the module spy below.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Clipboard plugin is imported transitively through bridge.ts — mock it too.
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
}));

// ── Import bridge after mocks ─────────────────────────────────────────────────
import { copyCorePlugins } from "../src/lib/bridge";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("copyCorePlugins()", () => {
  beforeEach(() => {
    // Reset the mock before each test so call counts don't bleed across tests.
    mockInvoke.mockReset();
  });

  it("calls invoke with the correct command name", async () => {
    // Arrange: simulate a successful Rust-side command (returns undefined/void).
    mockInvoke.mockResolvedValueOnce(undefined);

    // Act
    await copyCorePlugins();

    // Assert: invoke was called exactly once with "copy_core_plugins".
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("copy_core_plugins");
  });

  it("resolves without a value when the command succeeds", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    // copyCorePlugins returns Promise<void> — await should resolve without throwing.
    await expect(copyCorePlugins()).resolves.toBeUndefined();
  });

  it("propagates a rejection when invoke throws", async () => {
    // Simulate a Rust-side error (e.g. permissions failure).
    const rustError = "Failed to resolve app data directory: …";
    mockInvoke.mockRejectedValueOnce(new Error(rustError));

    // The bridge does NOT swallow the error — callers (initApp) are responsible
    // for wrapping in try/catch.
    await expect(copyCorePlugins()).rejects.toThrow(rustError);
  });

  it("does not pass any extra arguments to invoke", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await copyCorePlugins();

    // The copy_core_plugins command takes only an AppHandle (injected by Tauri) —
    // no frontend-supplied parameters. Confirm the call has no extra arguments.
    const [commandName, ...extraArgs] = mockInvoke.mock.calls[0];
    expect(commandName).toBe("copy_core_plugins");
    expect(extraArgs).toHaveLength(0);
  });
});
