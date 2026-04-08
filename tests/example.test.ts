/**
 * Verify test infrastructure is working.
 */
import { describe, it, expect } from "vitest";
import {
  mockReadFileSuccess,
  mockReadFileError,
  mockDialogCancelled,
  mockDialogSuccess,
} from "./mocks/tauri";

describe("Vitest Setup", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("has DOM APIs available via happy-dom", () => {
    const div = document.createElement("div");
    div.textContent = "Markable 2.0";
    document.body.appendChild(div);
    expect(div.textContent).toBe("Markable 2.0");
    div.remove();
  });
});

describe("Tauri Mock Helpers", () => {
  it("mocks a successful file read", async () => {
    const read = mockReadFileSuccess("# Hello");
    const result = await read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("# Hello");
    }
  });

  it("mocks a file read error", async () => {
    const read = mockReadFileError("File not found: /missing.md", "/missing.md");
    const result = await read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("File not found");
      expect(result.error.command).toBe("read_file");
    }
  });

  it("mocks a cancelled dialog", async () => {
    const dialog = mockDialogCancelled();
    const result = await dialog();
    expect(result.cancelled).toBe(true);
  });

  it("mocks a successful dialog", async () => {
    const dialog = mockDialogSuccess("/Users/dave/notes/todo.md");
    const result = await dialog();
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.path).toBe("/Users/dave/notes/todo.md");
    }
  });
});
