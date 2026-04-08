/**
 * Tests for Tauri command bridge.
 *
 * Tests the TypeScript wrappers for file I/O commands,
 * verifying type safety and error handling.
 */

import { describe, it, expect } from "vitest";
import {
  mockReadFileSuccess,
  mockReadFileError,
  mockWriteFileSuccess,
  mockWriteFileError,
} from "./mocks/tauri";

// Since we can't import and mock the actual bridge in unit tests
// without a full Tauri environment, these tests verify the types
// and the mock helpers themselves.

describe("File I/O Bridge (Mock Verification)", () => {
  describe("readFile mocks", () => {
    it("mocks successful read returning content", async () => {
      const mockFn = mockReadFileSuccess("# Title\n\nContent here");
      const result = await mockFn();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("# Title\n\nContent here");
      }
    });

    it("mocks file not found error", async () => {
      const mockFn = mockReadFileError(
        "File not found: /missing.md",
        "/missing.md"
      );
      const result = await mockFn();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("File not found");
        expect(result.error.command).toBe("read_file");
        expect(result.error.path).toBe("/missing.md");
      }
    });

    it("mocks permission denied error", async () => {
      const mockFn = mockReadFileError("Permission denied: /protected.md");
      const result = await mockFn();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Permission denied");
      }
    });

    it("mocks directory error", async () => {
      const mockFn = mockReadFileError("Is a directory: /tmp", "/tmp");
      const result = await mockFn();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Is a directory");
      }
    });
  });

  describe("writeFile mocks", () => {
    it("mocks successful write", async () => {
      const mockFn = mockWriteFileSuccess();
      const result = await mockFn();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it("mocks permission denied error", async () => {
      const mockFn = mockWriteFileError("Permission denied: /readonly.md");
      const result = await mockFn();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Permission denied");
        expect(result.error.command).toBe("write_file");
      }
    });

    it("mocks disk full error", async () => {
      const mockFn = mockWriteFileError(
        "Disk full: insufficient space to write /file.md"
      );
      const result = await mockFn();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Disk full");
      }
    });
  });

  describe("Error handling patterns", () => {
    it("allows safe type narrowing with discriminated union", async () => {
      const successMock = mockReadFileSuccess("content");
      const result = await successMock();

      // TypeScript should understand the union and allow narrowing
      if (result.ok) {
        const content: string = result.value; // Should be typed as string
        expect(content).toBe("content");
      } else {
        // This branch should never be reached in this test
        throw new Error("Unexpected error");
      }
    });

    it("handles error details in error branch", async () => {
      const errorMock = mockReadFileError(
        "File not found: /test.md",
        "/test.md"
      );
      const result = await errorMock();

      if (!result.ok) {
        // TypeScript should type result.error as TauriCommandError
        expect(result.error.message).toBeDefined();
        expect(result.error.command).toBeDefined();
        expect(result.error.path).toBe("/test.md");
      } else {
        throw new Error("Unexpected success");
      }
    });
  });

  describe("Edge cases", () => {
    it("mocks large file content", async () => {
      const largeContent = "# Large File\n" + "Line\n".repeat(1000);
      const mockFn = mockReadFileSuccess(largeContent);
      const result = await mockFn();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(largeContent);
        expect(result.value.split("\n").length).toBeGreaterThan(1000);
      }
    });

    it("mocks unicode content", async () => {
      const unicodeContent = "# 你好 مرحبا שלום\n\n🚀 Emoji support";
      const mockFn = mockReadFileSuccess(unicodeContent);
      const result = await mockFn();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(unicodeContent);
      }
    });

    it("mocks empty file", async () => {
      const mockFn = mockReadFileSuccess("");
      const result = await mockFn();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("");
      }
    });
  });
});
