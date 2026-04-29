/**
 * Group A — Bridge wrapper tests for `searchVaultContent` (step_04_tests.md §A).
 *
 * Tests A-1 through A-4 verify that the typed `searchVaultContent()` wrapper in
 * `src/lib/bridge.ts`:
 *   - correctly invokes the Tauri `search_vault_content` command
 *   - passes parameters with snake_case keys (Tauri invoke convention)
 *   - returns a discriminated FileResult<ContentSearchPayload> on success
 *   - returns a FileResult error on rejection (A-3)
 *   - converts non-string rejections to strings (A-4)
 *
 * Tauri is fully mocked so these tests run without a real Tauri runtime.
 * The Clipboard plugin is mocked because bridge.ts imports it as a side-effect.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri before importing bridge ────────────────────────────────────────
// All @tauri-apps/* modules must be mocked before any import of bridge.ts so
// the module evaluates against our controlled stubs, not the real Tauri runtime.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// bridge.ts imports readText from clipboard-manager as a side-effect — stub it.
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
}));

// ── Import bridge after mocks ─────────────────────────────────────────────────
import { searchVaultContent } from "../src/lib/bridge";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

// ── Shared fixture ────────────────────────────────────────────────────────────

/** A minimal valid ContentSearchPayload returned by the Rust command. */
const emptyPayload = {
  results: [],
  capped: false,
  skippedCount: 0,
};

/** Default params used across tests that don't care about specific values. */
const defaultParams = {
  rootPaths: ["/vault"],
  excludePatterns: [],
  query: "foo",
  maxResults: 50,
};

describe("searchVaultContent() bridge wrapper", () => {
  beforeEach(() => {
    // Reset mock state before each test to prevent call-count bleed.
    mockInvoke.mockReset();
  });

  // ── A-1: happy path ───────────────────────────────────────────────────────

  it("A-1: resolved invoke returns { ok: true, value: payload }", async () => {
    // Arrange: invoke resolves with a valid payload.
    mockInvoke.mockResolvedValueOnce(emptyPayload);

    // Act.
    const result = await searchVaultContent(defaultParams);

    // Assert: the wrapper wraps the value in a FileResult discriminated union.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results).toEqual([]);
      expect(result.value.capped).toBe(false);
      expect(result.value.skippedCount).toBe(0);
    }
  });

  // ── A-2: parameter mapping ────────────────────────────────────────────────

  it("A-2: invoke is called with snake_case parameter keys (Tauri convention)", async () => {
    // Tauri's `generate_handler!` macro reads argument names from the Rust function
    // signature directly (not from serde renames), so the invoke call must use
    // snake_case: root_paths, exclude_patterns, max_results (not camelCase).
    mockInvoke.mockResolvedValueOnce(emptyPayload);

    await searchVaultContent({
      rootPaths: ["/v"],
      excludePatterns: ["node_modules"],
      query: "bar",
      maxResults: 20,
    });

    expect(mockInvoke).toHaveBeenCalledWith("search_vault_content", {
      root_paths: ["/v"],
      exclude_patterns: ["node_modules"],
      query: "bar",
      max_results: 20,
    });
  });

  // ── A-3: error path ───────────────────────────────────────────────────────

  it("A-3: rejected invoke returns { ok: false, error: { command, message } }", async () => {
    // Arrange: Tauri invoke rejects with a string error (Rust returns Err(String)).
    mockInvoke.mockRejectedValueOnce("permission denied");

    // Act.
    const result = await searchVaultContent(defaultParams);

    // Assert: the wrapper catches and wraps the rejection as a FileResult error.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.command).toBe("search_vault_content");
      expect(result.error.message).toContain("permission denied");
    }
  });

  // ── A-4: non-string rejection ─────────────────────────────────────────────

  it("A-4: non-string rejection (Error object) is converted to a string message", async () => {
    // Arrange: Tauri invoke rejects with an Error object (unexpected but must be handled).
    mockInvoke.mockRejectedValueOnce(new Error("network error"));

    // Act.
    const result = await searchVaultContent(defaultParams);

    // Assert: the error.message field is a plain string, not an Error instance.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error.message).toBe("string");
      // String(new Error("network error")) === "Error: network error"
      expect(result.error.message).toContain("network error");
    }
  });
});
