/**
 * Tests for renameNode, deleteFile, deleteDirectory, and closeTabsUnder
 * (via deleteDirectory) in file-browser-ops.ts.
 *
 * Covers:
 *   - renameNode: .md rename, non-.md rename, directory rename, validation
 *     errors, backlink banner logic (EC-1, EC-2, EC-3, EC-17)
 *   - deleteFile: closeFileByPath ordering, abort on decline, confirm guard,
 *     no redundant reloadAndRender call
 *   - deleteDirectory: collect-then-close pattern, abort on decline, confirm
 *     guard (EC-10)
 *   - closeTabsUnder (via deleteDirectory): proceed when no tabs, abort when
 *     any close is declined
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renameNode,
  deleteFile,
  deleteDirectory,
} from "../../../src/plugins/file-browser/file-browser-ops";
import type { VaultIndex } from "../../../src/lib/vault-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal VaultIndex for testing.
 * Each path becomes a VaultEntry with sensible defaults.
 */
function makeVaultIndex(paths: string[]): VaultIndex {
  return {
    vaultId: "v1",
    builtAt: Date.now(),
    entries: paths.map((path) => ({
      path,
      name: path.split("/").pop()?.replace(/\.md$/, "") ?? "note",
      modified: 1000,
      size: 100,
      title: "Note",
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: paths.length,
    skippedCount: 0,
    capped: false,
    nonMdFiles: [],
  };
}

/** Create a fresh container element attached to the document body. */
function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

// ── Shared mock state ─────────────────────────────────────────────────────────

let invokeMock: ReturnType<typeof vi.fn>;
let reloadVaultIndexMock: ReturnType<typeof vi.fn>;
let closeFileByPathMock: ReturnType<typeof vi.fn>;
let handleFileRenameMock: ReturnType<typeof vi.fn>;
let getTabsMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(undefined);
  reloadVaultIndexMock = vi.fn().mockResolvedValue(undefined);
  (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => makeVaultIndex([])),
    reloadVaultIndex: reloadVaultIndexMock,
  };

  closeFileByPathMock = vi.fn().mockResolvedValue(true);
  handleFileRenameMock = vi.fn();
  getTabsMock = vi.fn().mockReturnValue([]);
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    handleFileRename: handleFileRenameMock,
    closeFileByPath: closeFileByPathMock,
    getTabs: getTabsMock,
  };

  // happy-dom does not provide window.confirm; install a permissive stub.
  (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(true);
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
  delete (window as unknown as Record<string, unknown>).confirm;
});

// ── A: renameNode ─────────────────────────────────────────────────────────────

describe("A — renameNode: .md file rename", () => {
  it("test 1a: calls rename_file with newPath ending in .md", async () => {
    const container = makeContainer();

    await renameNode("/vault/old.md", "new-name", container);

    expect(invokeMock).toHaveBeenCalledWith("rename_file", {
      oldPath: "/vault/old.md",
      newPath: "/vault/new-name.md",
    });
  });

  it("test 1b: calls handleFileRename with old and new .md paths", async () => {
    const container = makeContainer();

    await renameNode("/vault/old.md", "new-name", container);

    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/old.md",
      "/vault/new-name.md",
    );
  });
});

describe("A — renameNode: non-.md file rename (EC-17)", () => {
  it("test 2a: calls rename_file with new name as-is (user edited full name, no extension auto-append)", async () => {
    const container = makeContainer();

    // startInlineRename populates the input with the full basename (config.yaml)
    // for non-.md files. If the user types "config-new.yaml" as the full new name:
    await renameNode("/vault/config.yaml", "config-new.yaml", container);

    expect(invokeMock).toHaveBeenCalledWith("rename_file", {
      oldPath: "/vault/config.yaml",
      newPath: "/vault/config-new.yaml",
    });
  });

  it("test 2b: calls handleFileRename with old and new full filenames", async () => {
    const container = makeContainer();

    // User provides the full name including extension
    await renameNode("/vault/config.yaml", "config-new.yaml", container);

    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/config.yaml",
      "/vault/config-new.yaml",
    );
  });

  it("test 2c: renames a .txt file; name provided with extension is used verbatim", async () => {
    const container = makeContainer();

    // User provides "readme-v2.txt" — the full name including extension
    await renameNode("/vault/readme.txt", "readme-v2.txt", container);

    expect(invokeMock).toHaveBeenCalledWith("rename_file", {
      oldPath: "/vault/readme.txt",
      newPath: "/vault/readme-v2.txt",
    });
  });
});

describe("A — renameNode: directory rename", () => {
  it("test 3a: calls handleFileRename once per open tab inside the directory", async () => {
    const container = makeContainer();

    // Two tabs whose paths start with /vault/docs/
    getTabsMock.mockReturnValue([
      { filePath: "/vault/docs/note-a.md" },
      { filePath: "/vault/docs/note-b.md" },
      { filePath: "/vault/other.md" }, // not inside /vault/docs/
    ]);

    // nodeType must be "directory" so the directory-rename branch fires (H2 fix).
    await renameNode("/vault/docs", "documentation", container, "directory");

    // Should update the two tabs inside /vault/docs/
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/docs/note-a.md",
      "/vault/documentation/note-a.md",
    );
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/docs/note-b.md",
      "/vault/documentation/note-b.md",
    );

    // Must NOT update the tab outside the renamed directory
    expect(handleFileRenameMock).not.toHaveBeenCalledWith(
      "/vault/other.md",
      expect.anything(),
    );
  });

  it("test 3b: calls rename_file with the new directory name", async () => {
    const container = makeContainer();

    // nodeType must be "directory" so the directory-rename branch fires (H2 fix).
    await renameNode("/vault/docs", "documentation", container, "directory");

    expect(invokeMock).toHaveBeenCalledWith("rename_file", {
      oldPath: "/vault/docs",
      newPath: "/vault/documentation",
    });
  });

  it("test 3c (H2): extension-less file (e.g. Makefile) is NOT treated as a directory", async () => {
    const container = makeContainer();

    // nodeType = "file" means this extension-less file goes through the file branch.
    await renameNode("/vault/Makefile", "Makefile-new", container, "file");

    // handleFileRename must be called for the file (not the directory loop)
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/Makefile",
      "/vault/Makefile-new",
    );
  });
});

describe("A — renameNode: validation errors", () => {
  it("test 4: shows inline error when validateFilename fails (illegal char)", async () => {
    const container = makeContainer();

    await renameNode("/vault/note.md", "bad:name", container);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(container.querySelector(".file-browser-inline-error")?.textContent).toMatch(/illegal/i);
  });

  it("test 5: shows inline error when filenameExistsInDir returns true", async () => {
    const container = makeContainer();

    // Vault index already contains the target name
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex = vi.fn(() =>
      makeVaultIndex(["/vault/new-name.md"])
    );

    await renameNode("/vault/old.md", "new-name", container);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(container.querySelector(".file-browser-inline-error")?.textContent).toMatch(/already exists/i);
  });
});

describe("A — renameNode: backlink banner", () => {
  it("test 6: shows backlink banner when a .md file stem changes and links exist", async () => {
    const container = makeContainer();

    // Vault index has a file that links to the old stem
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex = vi.fn(() => ({
      ...makeVaultIndex(["/vault/linker.md"]),
      entries: [{
        path: "/vault/linker.md",
        name: "linker",
        modified: 1000,
        size: 100,
        title: "Linker",
        tags: [],
        outboundLinks: ["old-name"],
      }],
    }));

    await renameNode("/vault/old-name.md", "new-name", container);

    // Banner should appear
    expect(container.querySelector(".file-browser-link-banner")).not.toBeNull();
  });

  it("test 7: does NOT show backlink banner when a non-.md file is renamed", async () => {
    const container = makeContainer();

    await renameNode("/vault/config.yaml", "config-v2", container);

    expect(container.querySelector(".file-browser-link-banner")).toBeNull();
  });

  it("test 8: does NOT show backlink banner when the .md stem is unchanged (EC-1)", async () => {
    const container = makeContainer();

    // User types the exact same stem — no change
    await renameNode("/vault/note.md", "note", container);

    // rename_file is still called (Rust handles the no-op), but no banner
    expect(container.querySelector(".file-browser-link-banner")).toBeNull();
  });
});

// ── B: deleteFile ─────────────────────────────────────────────────────────────

describe("B — deleteFile", () => {
  it("test 9: calls closeFileByPath BEFORE invoke(delete_file)", async () => {
    const container = makeContainer();
    const callOrder: string[] = [];
    closeFileByPathMock.mockImplementation(async () => {
      callOrder.push("closeFileByPath");
      return true;
    });
    invokeMock.mockImplementation(async () => {
      callOrder.push("invoke");
    });

    await deleteFile("/vault/note.md", container);

    expect(callOrder[0]).toBe("closeFileByPath");
    expect(callOrder[1]).toBe("invoke");
  });

  it("test 10: aborts (no invoke) when closeFileByPath returns false", async () => {
    const container = makeContainer();
    closeFileByPathMock.mockResolvedValue(false);

    await deleteFile("/vault/note.md", container);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("test 11: aborts when window.confirm returns false", async () => {
    const container = makeContainer();
    (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(false);

    await deleteFile("/vault/note.md", container);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(closeFileByPathMock).not.toHaveBeenCalled();
  });

  it("test 12: calls reloadVaultIndex exactly once (no redundant reloadAndRender call)", async () => {
    const container = makeContainer();

    await deleteFile("/vault/note.md", container);

    // The one reloadVaultIndex call comes from inside deleteFile itself.
    expect(reloadVaultIndexMock).toHaveBeenCalledTimes(1);
  });

  // M2: EC-11 — Rust delete error is surfaced via showInlineError
  it("test 12b: shows inline error and does NOT call reloadVaultIndex when delete_file throws (EC-11)", async () => {
    const container = makeContainer();
    invokeMock.mockRejectedValue(new Error("File not found"));

    await deleteFile("/vault/note.md", container);

    // Error strip must appear in the container
    expect(container.querySelector(".file-browser-inline-error")).not.toBeNull();
    // Vault index must NOT be reloaded after a failed delete
    expect(reloadVaultIndexMock).not.toHaveBeenCalled();
  });
});

// ── C: deleteDirectory ────────────────────────────────────────────────────────

describe("C — deleteDirectory", () => {
  it("test 13: collects tabs whose filePath starts with the directory prefix", async () => {
    const container = makeContainer();
    getTabsMock.mockReturnValue([
      { filePath: "/vault/docs/a.md" },
      { filePath: "/vault/docs/b.md" },
      { filePath: "/vault/other.md" }, // should not be closed
    ]);

    await deleteDirectory("/vault/docs", container);

    expect(closeFileByPathMock).toHaveBeenCalledWith("/vault/docs/a.md");
    expect(closeFileByPathMock).toHaveBeenCalledWith("/vault/docs/b.md");
    expect(closeFileByPathMock).not.toHaveBeenCalledWith("/vault/other.md");
  });

  it("test 14: aborts entire delete when any closeFileByPath returns false", async () => {
    const container = makeContainer();
    getTabsMock.mockReturnValue([
      { filePath: "/vault/docs/a.md" },
      { filePath: "/vault/docs/b.md" },
    ]);
    // Second close returns false (user declined)
    closeFileByPathMock
      .mockResolvedValueOnce(true)   // a.md closes OK
      .mockResolvedValueOnce(false); // b.md: user cancels

    await deleteDirectory("/vault/docs", container);

    // delete_directory must NOT be called when any close is declined
    expect(invokeMock).not.toHaveBeenCalledWith("delete_directory", expect.anything());

    // M3: the first tab's close must still have been attempted, confirming the
    // collect-then-close loop ran and only aborted after the second decline.
    expect(closeFileByPathMock).toHaveBeenCalledWith("/vault/docs/a.md");
    // Two calls total — one success (a.md) + one decline (b.md)
    expect(closeFileByPathMock).toHaveBeenCalledTimes(2);
  });

  it("test 15: calls invoke(delete_directory) when all tabs close successfully", async () => {
    const container = makeContainer();
    getTabsMock.mockReturnValue([
      { filePath: "/vault/docs/a.md" },
    ]);
    closeFileByPathMock.mockResolvedValue(true);

    await deleteDirectory("/vault/docs", container);

    expect(invokeMock).toHaveBeenCalledWith("delete_directory", { path: "/vault/docs" });
  });

  it("test 16: aborts when window.confirm returns false", async () => {
    const container = makeContainer();
    (window as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(false);

    await deleteDirectory("/vault/docs", container);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(closeFileByPathMock).not.toHaveBeenCalled();
  });

  // M2: EC-11 — Rust delete error is surfaced via showInlineError
  it("test 16b: shows inline error and does NOT call reloadVaultIndex when delete_directory throws (EC-11)", async () => {
    const container = makeContainer();
    invokeMock.mockRejectedValue(new Error("Directory not found"));

    await deleteDirectory("/vault/docs", container);

    // Error strip must appear in the container
    expect(container.querySelector(".file-browser-inline-error")).not.toBeNull();
    // Vault index must NOT be reloaded after a failed delete
    expect(reloadVaultIndexMock).not.toHaveBeenCalled();
  });
});

// ── D: closeTabsUnder (via deleteDirectory behaviour) ─────────────────────────

describe("D — closeTabsUnder (via deleteDirectory)", () => {
  it("test 17: returns false (proceed) when no tabs are open under the directory", async () => {
    const container = makeContainer();
    // No tabs under /vault/docs
    getTabsMock.mockReturnValue([
      { filePath: "/vault/other.md" },
    ]);

    await deleteDirectory("/vault/docs", container);

    // delete_directory should still be called (no abort)
    expect(invokeMock).toHaveBeenCalledWith("delete_directory", { path: "/vault/docs" });
  });

  it("test 18: returns true (abort) when any tab closeFileByPath returns false", async () => {
    const container = makeContainer();
    getTabsMock.mockReturnValue([
      { filePath: "/vault/docs/note.md" },
    ]);
    closeFileByPathMock.mockResolvedValue(false);

    await deleteDirectory("/vault/docs", container);

    // Abort path — delete_directory must NOT be called
    expect(invokeMock).not.toHaveBeenCalledWith("delete_directory", expect.anything());
  });
});
