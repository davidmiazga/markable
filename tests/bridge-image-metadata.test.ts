/**
 * tests/bridge-image-metadata.test.ts
 *
 * Unit tests for the three image metadata bridge wrappers in bridge.ts:
 *   getImageDimensions, getExifData, sidecarExists.
 *
 * Tests BW-01 through BW-08 per step_02_bridge_wrappers.md.
 *
 * Pattern: mock "@tauri-apps/api/core" invoke, verify the wrapper calls the
 * correct Tauri command with the correct args, and maps success/failure to
 * FileResult<T>.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getImageDimensions,
  getExifData,
  sidecarExists,
} from "../src/lib/bridge";

// ── Mock setup ────────────────────────────────────────────────────────────────

// vi.mock must be at the top level (not inside describe) per Vitest conventions.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Also mock the clipboard plugin to avoid import errors (bridge.ts imports it).
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

// Import the mocked invoke after the mock declaration.
import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getImageDimensions ────────────────────────────────────────────────────────

describe("getImageDimensions", () => {
  it("BW-01: calls get_image_dimensions with {path} and returns {ok:true, value:{width,height}}", async () => {
    // Rust tuple Result<(u32, u32), String> serialises as a JSON array [w, h].
    mockInvoke.mockResolvedValueOnce([1920, 1080]);

    const result = await getImageDimensions("/vault/photo.jpg");

    expect(mockInvoke).toHaveBeenCalledWith("get_image_dimensions", {
      path: "/vault/photo.jpg",
    });
    expect(result).toEqual({
      ok: true,
      value: { width: 1920, height: 1080 },
    });
  });

  it("BW-02: returns {ok:false, error:{message,command,path}} on invoke failure", async () => {
    mockInvoke.mockRejectedValueOnce("Unsupported image format");

    const result = await getImageDimensions("/vault/bad.bmp");

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Unsupported image format",
        command: "get_image_dimensions",
        path: "/vault/bad.bmp",
      },
    });
  });
});

// ── getExifData ───────────────────────────────────────────────────────────────

describe("getExifData", () => {
  it("BW-03: calls get_exif_data and maps snake_case fields to camelCase in value", async () => {
    // Rust uses snake_case: date_taken, camera.
    mockInvoke.mockResolvedValueOnce({
      date_taken: "2024-03-15",
      camera: "Canon EOS R5",
    });

    const result = await getExifData("/vault/photo.jpg");

    expect(mockInvoke).toHaveBeenCalledWith("get_exif_data", {
      path: "/vault/photo.jpg",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        dateTaken: "2024-03-15",
        camera: "Canon EOS R5",
      },
    });
  });

  it("BW-04: maps null date and camera (Rust None → JSON null) correctly", async () => {
    mockInvoke.mockResolvedValueOnce({
      date_taken: null,
      camera: null,
    });

    const result = await getExifData("/vault/no-exif.jpg");

    expect(result).toEqual({
      ok: true,
      value: {
        dateTaken: null,
        camera: null,
      },
    });
  });

  it("BW-05: returns {ok:false} on invoke rejection", async () => {
    mockInvoke.mockRejectedValueOnce("No Exif segment found");

    const result = await getExifData("/vault/broken.jpg");

    expect(result).toEqual({
      ok: false,
      error: {
        message: "No Exif segment found",
        command: "get_exif_data",
        path: "/vault/broken.jpg",
      },
    });
  });
});

// ── sidecarExists ─────────────────────────────────────────────────────────────

describe("sidecarExists", () => {
  it("BW-06: calls sidecar_exists and returns {ok:true, value:true} when sidecar exists", async () => {
    mockInvoke.mockResolvedValueOnce(true);

    const result = await sidecarExists("/vault/photo.jpg");

    expect(mockInvoke).toHaveBeenCalledWith("sidecar_exists", {
      path: "/vault/photo.jpg",
    });
    expect(result).toEqual({ ok: true, value: true });
  });

  it("BW-07: returns {ok:true, value:false} when invoke returns false", async () => {
    mockInvoke.mockResolvedValueOnce(false);

    const result = await sidecarExists("/vault/photo.jpg");

    expect(result).toEqual({ ok: true, value: false });
  });

  it("BW-08: returns {ok:false, error:{...}} on invoke rejection", async () => {
    mockInvoke.mockRejectedValueOnce("Failed to check sidecar: permission denied");

    const result = await sidecarExists("/vault/photo.jpg");

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Failed to check sidecar: permission denied",
        command: "sidecar_exists",
        path: "/vault/photo.jpg",
      },
    });
  });
});
