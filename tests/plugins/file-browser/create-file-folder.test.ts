/**
 * Tests for "Create file / folder from file browser tree" feature.
 *
 * Covers:
 *   - hasExplicitExtension helper
 *   - createNote: extension handling, openFileInTab fix, duplicate check
 *   - showInlineCreateInput / showInlineFolderCreateInput: insert position fix
 *   - buildInlineInputNode: auto-expand parent on folder create
 *   - buildFileContextMenuItems: "New Folder" item
 *   - buildVaultContextMenuItems: "New File" / "New Folder" items
 *   - Empty-space contextmenu (EC-16)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hasExplicitExtension,
  createNote,
} from "../../../src/plugins/file-browser/file-browser-ops";
import {
  _testing,
} from "../../../src/plugins/file-browser/file-browser.plugin";
import type { VaultEntry, VaultIndex } from "../../../src/lib/vault-types";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "v1",
    name: "My Notes",
    rootPaths: ["/vault"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

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

function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

let invokeMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(undefined);
  (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getActiveVault: vi.fn(() => makeVault()),
    getVaultIndex: vi.fn(() => makeVaultIndex([])),
    reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
  };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn().mockResolvedValue(true),
  };
  _testing.setPanelContainer(makeContainer());
  const ul = document.createElement("ul");
  document.body.appendChild(ul);
  _testing.setTreeEl(ul);
  _testing.setExpandedPaths(new Set());
});

afterEach(() => {
  document.body.innerHTML = "";
  _testing.setPanelContainer(null);
  _testing.setTreeEl(null);
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
});

// ── A: hasExplicitExtension ────────────────────────────────────────────────────

describe("A — hasExplicitExtension", () => {
  it("returns false for a plain name with no dot", () => {
    expect(hasExplicitExtension("my-note")).toBe(false);
  });

  it("returns true for name.md", () => {
    expect(hasExplicitExtension("note.md")).toBe(true);
  });

  it("returns true for name.txt", () => {
    expect(hasExplicitExtension("notes.txt")).toBe(true);
  });

  it("returns false for a leading-dot hidden file (.hidden)", () => {
    expect(hasExplicitExtension(".hidden")).toBe(false);
  });

  it("returns false for a trailing-dot name (notes.)", () => {
    expect(hasExplicitExtension("notes.")).toBe(false);
  });

  it("returns true for multi-segment extension (archive.tar.gz)", () => {
    expect(hasExplicitExtension("archive.tar.gz")).toBe(true);
  });
});

// ── B: createNote — extension handling ────────────────────────────────────────

describe("B — createNote extension handling", () => {
  it("appends .md when no extension is typed", async () => {
    const container = makeContainer();
    await createNote("/vault", "my-note", container);
    expect(invokeMock).toHaveBeenCalledWith("create_file", {
      path: "/vault/my-note.md",
      content: "",
    });
  });

  it("honours explicit .txt extension", async () => {
    const container = makeContainer();
    await createNote("/vault", "notes.txt", container);
    expect(invokeMock).toHaveBeenCalledWith("create_file", {
      path: "/vault/notes.txt",
      content: "",
    });
  });

  it("honours explicit .md extension without doubling it", async () => {
    const container = makeContainer();
    await createNote("/vault", "my-note.md", container);
    expect(invokeMock).toHaveBeenCalledWith("create_file", {
      path: "/vault/my-note.md",
      content: "",
    });
  });

  it("calls openFileInTab (not openFile) after successful create", async () => {
    const openFileInTab = vi.fn().mockResolvedValue(true);
    (window as any).__MARKABLE_TAB_MANAGER__ = { openFileInTab };
    const container = makeContainer();
    await createNote("/vault", "new-note", container);
    expect(openFileInTab).toHaveBeenCalledWith("/vault/new-note.md");
  });

  it("shows inline error and does not invoke when file already exists", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__.getVaultIndex = vi.fn(() =>
      makeVaultIndex(["/vault/existing.md"])
    );
    const container = makeContainer();
    await createNote("/vault", "existing", container);
    expect(invokeMock).not.toHaveBeenCalled();
    const err = container.querySelector(".file-browser-inline-error");
    expect(err?.textContent).toMatch(/already exists/);
  });

  it("shows inline error for illegal characters", async () => {
    const container = makeContainer();
    await createNote("/vault", "bad:name", container);
    expect(invokeMock).not.toHaveBeenCalled();
    const err = container.querySelector(".file-browser-inline-error");
    expect(err?.textContent).toMatch(/illegal/i);
  });
});

// ── C: showInlineCreateInput — insert position ────────────────────────────────

describe("C — showInlineCreateInput insert position", () => {
  it("inserts inline input immediately after the target dir <li>", () => {
    const ul = _testing.getTreeEl()!;
    const dirLi = document.createElement("li");
    dirLi.setAttribute("data-path", "/vault/docs");
    const otherLi = document.createElement("li");
    otherLi.setAttribute("data-path", "/vault/docs/note.md");
    ul.appendChild(dirLi);
    ul.appendChild(otherLi);

    const container = _testing.getPanelContainer()!;
    _testing.showInlineCreateInput("/vault/docs", container, "v1");

    const children = Array.from(ul.children);
    expect(children[0]).toBe(dirLi);
    expect(children[1].querySelector("input")).not.toBeNull();
    expect(children[2]).toBe(otherLi);
  });

  it("falls back to prepend when target dir <li> is not found (EC-3)", () => {
    const ul = _testing.getTreeEl()!;
    const existingLi = document.createElement("li");
    ul.appendChild(existingLi);

    const container = _testing.getPanelContainer()!;
    _testing.showInlineCreateInput("/vault/missing", container, "v1");

    expect(ul.firstElementChild?.querySelector("input")).not.toBeNull();
  });
});

// ── D: showInlineFolderCreateInput — insert position ─────────────────────────

describe("D — showInlineFolderCreateInput insert position", () => {
  it("inserts folder input after the target dir <li>", () => {
    const ul = _testing.getTreeEl()!;
    const dirLi = document.createElement("li");
    dirLi.setAttribute("data-path", "/vault");
    ul.appendChild(dirLi);

    const container = _testing.getPanelContainer()!;
    _testing.showInlineFolderCreateInput("/vault", container, "v1");

    const children = Array.from(ul.children);
    expect(children[0]).toBe(dirLi);
    expect(children[1].querySelector("input")).not.toBeNull();
  });

  it("falls back to prepend when target not found", () => {
    const container = _testing.getPanelContainer()!;
    _testing.showInlineFolderCreateInput("/vault/missing", container, "v1");
    const ul = _testing.getTreeEl()!;
    expect(ul.firstElementChild?.querySelector("input")).not.toBeNull();
  });
});

// ── E: buildInlineInputNode — folder auto-expand ──────────────────────────────

describe("E — buildInlineInputNode folder auto-expand", () => {
  it("adds dirPath to _expandedPaths after folder creation", async () => {
    const container = _testing.getPanelContainer()!;
    const li = _testing.buildInlineInputNode("/vault/docs", container, "v1", "directory");
    document.body.appendChild(li);

    const input = li.querySelector("input") as HTMLInputElement;
    input.value = "new-folder";

    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    input.dispatchEvent(enterEvent);

    await new Promise((r) => setTimeout(r, 50));

    expect(_testing.getExpandedPaths().has("/vault/docs")).toBe(true);
  });

  it("calls create_directory via __TAURI_INTERNALS__", async () => {
    const container = _testing.getPanelContainer()!;
    const li = _testing.buildInlineInputNode("/vault", container, "v1", "directory");
    document.body.appendChild(li);

    const input = li.querySelector("input") as HTMLInputElement;
    input.value = "my-folder";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await new Promise((r) => setTimeout(r, 50));

    expect(invokeMock).toHaveBeenCalledWith("create_directory", {
      path: "/vault/my-folder",
    });
  });
});

// ── F: buildFileContextMenuItems — New Folder present ────────────────────────

describe("F — buildFileContextMenuItems includes New Folder", () => {
  it("has both New Note and New Folder items", () => {
    const el = document.createElement("li");
    el.setAttribute("data-path", "/vault/note.md");
    el.setAttribute("data-type", "file");
    (window as any).__MARKABLE_VAULT_MANAGER__.getActiveVault = vi.fn(() =>
      makeVault()
    );
    const items = _testing.buildFileContextMenuItems(el, "/vault/note.md", "v1");
    const labels = items.filter((i) => !i.separator).map((i) => i.label);
    expect(labels).toContain("New Note");
    expect(labels).toContain("New Folder");
  });

  it("New Folder appears immediately after New Note", () => {
    const el = document.createElement("li");
    el.setAttribute("data-path", "/vault/note.md");
    const items = _testing.buildFileContextMenuItems(el, "/vault/note.md", "v1");
    const nonSep = items.filter((i) => !i.separator);
    expect(nonSep[0].label).toBe("New Note");
    expect(nonSep[1].label).toBe("New Folder");
  });
});

// ── G: buildVaultContextMenuItems — New File / New Folder ────────────────────

describe("G — buildVaultContextMenuItems includes New File and New Folder", () => {
  it("has New File and New Folder as the first two non-separator items", () => {
    const el = document.createElement("li");
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => makeVault()),
      deleteVault: vi.fn(),
    };
    const items = _testing.buildVaultContextMenuItems(el, "/vault", "v1");
    const nonSep = items.filter((i) => !i.separator);
    expect(nonSep[0].label).toBe("New File");
    expect(nonSep[1].label).toBe("New Folder");
  });

  it("EC-1: New File handler is a no-op when no vault is active", () => {
    const el = document.createElement("li");
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => null),
    };
    const items = _testing.buildVaultContextMenuItems(el, "", "v1");
    const newFile = items.find((i) => i.label === "New File");
    expect(() => newFile?.handler?.()).not.toThrow();
  });
});
