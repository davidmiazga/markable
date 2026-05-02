/**
 * drag-to-move.test.ts
 *
 * TDD test suite for the drag-to-move feature.
 *
 * Step 01 covers moveNode behaviour (M1–M8).
 * Step 02 adds resolveDropTarget guard logic (D1–D11) and listener behaviour (D9–D11).
 *
 * All tests follow the same mock-global pattern as rename-delete-ops.test.ts.
 *
 * Requirements source: docs/requirements/active_task.md
 * Spec: docs/specs/drag-to-move/step_01_move-node-directory.md
 *       docs/specs/drag-to-move/step_02_drag-drop-listeners.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { moveNode } from "../../../src/plugins/file-browser/file-browser-ops";
import { resolveDropTarget, _testing } from "../../../src/plugins/file-browser/file-browser.plugin";
import type { VaultIndex } from "../../../src/lib/vault-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal VaultIndex for testing checkAndShowLinkBanner.
 * Mirrors the helper in rename-delete-ops.test.ts.
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
let handleFileRenameMock: ReturnType<typeof vi.fn>;
let getTabsMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(undefined);
  reloadVaultIndexMock = vi.fn().mockResolvedValue(undefined);
  handleFileRenameMock = vi.fn();
  getTabsMock = vi.fn().mockReturnValue([]);

  (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    reloadVaultIndex: reloadVaultIndexMock,
    getVaultIndex: vi.fn(() => makeVaultIndex([])),
  };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    handleFileRename: handleFileRenameMock,
    getTabs: getTabsMock,
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
});

// ── Step 01: moveNode ─────────────────────────────────────────────────────────

describe("M1 — file move calls move_file with correct args (FR-10)", () => {
  it("passes source and destinationDir to the move_file Rust command", async () => {
    invokeMock.mockResolvedValue("/vault/B/note.md");

    await moveNode("/vault/A/note.md", "/vault/B", null);

    expect(invokeMock).toHaveBeenCalledWith("move_file", {
      source: "/vault/A/note.md",
      destinationDir: "/vault/B",
    });
  });
});

describe("M2 — file move calls handleFileRename(oldPath, newPath) (FR-10, EC-10)", () => {
  it("calls handleFileRename with the old and new paths exactly once", async () => {
    invokeMock.mockResolvedValue("/vault/B/note.md");

    await moveNode("/vault/A/note.md", "/vault/B", null);

    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/A/note.md",
      "/vault/B/note.md",
    );
    expect(handleFileRenameMock).toHaveBeenCalledTimes(1);
  });
});

describe("M3 — file move calls reloadVaultIndex (FR-13)", () => {
  it("calls reloadVaultIndex exactly once after a successful move", async () => {
    invokeMock.mockResolvedValue("/vault/B/note.md");

    await moveNode("/vault/A/note.md", "/vault/B", null);

    expect(reloadVaultIndexMock).toHaveBeenCalledTimes(1);
  });
});

describe("M4 — directory move updates all open tabs inside the moved folder (FR-11, EC-8)", () => {
  it("applies prefix substitution to every tab under the moved directory path", async () => {
    // Three tabs: two inside /vault/A/docs/, one outside.
    getTabsMock.mockReturnValue([
      { filePath: "/vault/A/docs/note-a.md" },
      { filePath: "/vault/A/docs/sub/note-b.md" },
      { filePath: "/vault/A/other.md" }, // NOT inside /vault/A/docs/
    ]);
    invokeMock.mockResolvedValue("/vault/B/docs");

    await moveNode("/vault/A/docs", "/vault/B", null);

    // Both tabs inside the moved directory get updated paths.
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/A/docs/note-a.md",
      "/vault/B/docs/note-a.md",
    );
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/A/docs/sub/note-b.md",
      "/vault/B/docs/sub/note-b.md",
    );

    // The tab outside the moved directory must NOT be updated.
    expect(handleFileRenameMock).not.toHaveBeenCalledWith(
      "/vault/A/other.md",
      expect.anything(),
    );

    // Exactly two calls — one per tab inside the directory.
    expect(handleFileRenameMock).toHaveBeenCalledTimes(2);
  });
});

describe("M5 — directory move with no open tabs falls through to single handleFileRename (EC-9)", () => {
  it("calls handleFileRename(sourcePath, newPath) when no tabs live under the moved directory", async () => {
    // No tabs open at all — directoryTabsExist will be false.
    getTabsMock.mockReturnValue([]);
    invokeMock.mockResolvedValue("/vault/B/docs");

    await moveNode("/vault/A/docs", "/vault/B", null);

    // The else branch must fire with the full directory paths.
    expect(handleFileRenameMock).toHaveBeenCalledWith(
      "/vault/A/docs",
      "/vault/B/docs",
    );
    expect(handleFileRenameMock).toHaveBeenCalledTimes(1);
  });
});

describe("M6 — move does not show link banner when stem is unchanged (EC-12, AD-01)", () => {
  it("does not render a link banner when moving a file to a different directory with the same name", async () => {
    // The vault index is consulted by checkAndShowLinkBanner.
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex = vi.fn(() =>
      makeVaultIndex(["/vault/other.md"]),
    );
    invokeMock.mockResolvedValue("/vault/B/note.md");
    const container = makeContainer();

    await moveNode("/vault/A/note.md", "/vault/B", container);

    // The stem "note" is unchanged — no banner should appear.
    expect(container.querySelector(".file-browser-link-banner")).toBeNull();
  });
});

describe("M7 — move_file rejection surfaces via catch (EC-6, EC-7, FR-8)", () => {
  it("rejects with the Rust error and does not call handleFileRename or reloadVaultIndex", async () => {
    invokeMock.mockRejectedValue(new Error("already exists"));
    const container = makeContainer();

    // moveNode should propagate the rejection so the plugin's .catch() runs.
    await expect(
      moveNode("/vault/A/note.md", "/vault/B", container),
    ).rejects.toThrow("already exists");

    expect(handleFileRenameMock).not.toHaveBeenCalled();
    expect(reloadVaultIndexMock).not.toHaveBeenCalled();
  });
});

describe("M8 — null container does not throw (EC-16)", () => {
  it("completes without throwing when container is null", async () => {
    invokeMock.mockResolvedValue("/vault/B/note.md");

    // The expectation is simply that this does not throw.
    await expect(
      moveNode("/vault/A/note.md", "/vault/B", null),
    ).resolves.toBeUndefined();
  });
});

// ── Step 02: resolveDropTarget ────────────────────────────────────────────────
//
// resolveDropTarget is a pure exported helper extracted from the drop handler.
// It returns the resolved target directory, or null when the drop should be
// a no-op (guard conditions EC-3 through EC-5, EC-17).

describe("D1 — external drop (empty sourcePath) returns null (EC-17, FR-7)", () => {
  it("returns null when sourcePath is empty string", () => {
    expect(resolveDropTarget("/vault/dir", "directory", "")).toBeNull();
  });
});

describe("D2 — drop on own directory returns null (EC-4)", () => {
  it("returns null when the directory is dropped onto its own <li>", () => {
    expect(resolveDropTarget("/vault/docs", "directory", "/vault/docs")).toBeNull();
  });
});

describe("D3 — drop on own parent directory returns null (EC-3)", () => {
  it("returns null when dragging a node into its current parent directory", () => {
    // targetDir = "/vault", getParentDir("/vault/docs") = "/vault" → own-parent guard fires
    expect(resolveDropTarget("/vault", "directory", "/vault/docs")).toBeNull();
  });
});

describe("D4 — file dropped on sibling file (same parent) returns null (EC-3, EC-2)", () => {
  it("returns null when a file is dragged onto another file in the same directory", () => {
    // targetDir = getParentDir("/vault/A/note.md") = "/vault/A"
    // getParentDir("/vault/A/other.md") = "/vault/A" → own-parent guard fires
    expect(
      resolveDropTarget("/vault/A/note.md", "file", "/vault/A/other.md"),
    ).toBeNull();
  });
});

describe("D5 — cycle prevention: folder dropped into descendant returns null (EC-5)", () => {
  it("returns null when the source would be dropped inside its own subtree", () => {
    // targetDir = "/vault/docs/sub", which starts with "/vault/docs/" → cycle guard fires
    expect(
      resolveDropTarget("/vault/docs/sub", "directory", "/vault/docs"),
    ).toBeNull();
  });
});

describe("D6 — valid file-on-file drop resolves to parent dir (EC-2, FR-5)", () => {
  it("returns the target file's parent directory for a cross-directory file drop", () => {
    expect(
      resolveDropTarget("/vault/B/note.md", "file", "/vault/A/source.md"),
    ).toBe("/vault/B");
  });
});

describe("D7 — valid drop onto directory returns the directory path (FR-10)", () => {
  it("returns the directory path unchanged for a valid directory drop", () => {
    expect(
      resolveDropTarget("/vault/B", "directory", "/vault/A/note.md"),
    ).toBe("/vault/B");
  });
});

describe("D8 — valid drop onto vault root returns vault root path (EC-20)", () => {
  it("allows dropping a deeply-nested folder onto the vault root node", () => {
    // sourcePath is /vault/sub/docs — its parent is /vault/sub, NOT /vault.
    // So the own-parent guard does NOT fire and the drop resolves to "/vault".
    expect(
      resolveDropTarget("/vault", "vault", "/vault/sub/docs"),
    ).toBe("/vault");
  });
});

describe("D8b — own-parent no-op applies to vault-root children (EC-3)", () => {
  it("returns null when the source is already a direct child of the vault root", () => {
    // sourcePath is /vault/docs — its parent is /vault, the same as targetDir.
    // The own-parent guard must fire even for vault-type targets (H1 fix).
    expect(
      resolveDropTarget("/vault", "vault", "/vault/docs"),
    ).toBeNull();
  });
});

// ── Step 02: listener behaviour ───────────────────────────────────────────────
//
// Tests D9–D11 verify the DOM-event handlers wired by attachDragDropListeners.

describe("D9 — dragend clears CSS classes from source and all drag-over nodes (EC-13, EC-14)", () => {
  it("removes is-dragging from the source and drag-over from any highlighted target", () => {
    // Build a minimal tree: a source <li> and a target <li> inside a <ul>.
    const treeEl = document.createElement("ul");
    document.body.appendChild(treeEl);

    const sourceLi = document.createElement("li");
    sourceLi.setAttribute("data-type", "file");
    sourceLi.setAttribute("data-path", "/vault/A/note.md");
    treeEl.appendChild(sourceLi);

    const targetLi = document.createElement("li");
    targetLi.setAttribute("data-type", "directory");
    targetLi.setAttribute("data-path", "/vault/B");
    treeEl.appendChild(targetLi);

    // Wire up listeners on the source node.
    _testing.setTreeEl(treeEl);
    _testing.attachDragDropListeners(sourceLi, "v1");

    // Simulate mid-drag state: source is dimmed, target is highlighted.
    sourceLi.classList.add("is-dragging");
    targetLi.classList.add("drag-over");

    // Fire dragend on the source — should clean up both classes.
    sourceLi.dispatchEvent(new Event("dragend"));

    expect(sourceLi.classList.contains("is-dragging")).toBe(false);
    expect(targetLi.classList.contains("drag-over")).toBe(false);
  });
});

describe("D10 — vault root node is NOT made draggable (EC-1)", () => {
  it("does not set draggable=true on a vault-type <li>", () => {
    const vaultLi = document.createElement("li");
    vaultLi.setAttribute("data-type", "vault");
    vaultLi.setAttribute("data-path", "/vault");

    // Wire up listeners — the vault root path should not set draggable.
    _testing.attachDragDropListeners(vaultLi, "v1");

    // draggable must NOT be "true" after wiring.
    expect(vaultLi.getAttribute("draggable")).not.toBe("true");
  });
});

describe("D11 — move failure surfaces as inline error element (FR-8, FR-9)", () => {
  it("renders a .file-browser-inline-error element when move_file invoke rejects", async () => {
    // Arrange: container that will receive the error strip.
    const container = document.createElement("div");
    document.body.appendChild(container);
    _testing.setPanelContainer(container);

    // Make invoke reject for the move_file command.
    invokeMock.mockRejectedValue(new Error("permission denied"));

    // Build source and target <li> elements and wire them up.
    const sourceLi = document.createElement("li");
    sourceLi.setAttribute("data-type", "file");
    sourceLi.setAttribute("data-path", "/vault/A/note.md");

    const targetLi = document.createElement("li");
    targetLi.setAttribute("data-type", "directory");
    targetLi.setAttribute("data-path", "/vault/B");

    _testing.attachDragDropListeners(sourceLi, "v1");
    _testing.attachDragDropListeners(targetLi, "v1");

    // Build a synthetic drop event carrying the source path.
    const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        getData: (key: string) =>
          key === "text/x-markable-path" ? "/vault/A/note.md" : "",
        types: ["text/x-markable-path"],
      },
      writable: false,
    });

    // Fire the drop on the target.
    targetLi.dispatchEvent(dropEvent);

    // Allow the async .catch() handler to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The error strip must now be in the container.
    expect(container.querySelector(".file-browser-inline-error")).not.toBeNull();
  });
});
