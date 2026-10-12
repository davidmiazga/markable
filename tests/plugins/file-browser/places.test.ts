/**
 * Bookmarks, pin previews, the folder dashboard, and the pin canvas.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isNotePath,
  listFolderItems,
  layoutsFor,
  mergeVaultSlices,
  moveCard,
  notePreview,
  renderFileDashboard,
  renderPinCanvas,
  sanitizePathList,
  sanitizePinLayout,
  stackOnto,
  NOTE_PREVIEW_MAX,
} from "../../../src/plugins/file-browser/places";
import { _testing } from "../../../src/plugins/file-browser/file-browser.plugin";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { __MARKABLE_CONVERT_FILE_SRC__?: unknown }).__MARKABLE_CONVERT_FILE_SRC__;
});

describe("note previews and path lists", () => {
  it("skips front matter and keeps only the start of the note", () => {
    const body = "The opening line of the note.";
    const raw = `---\ntitle: Secret\n---\n${body}\n${"word ".repeat(200)}`;
    const preview = notePreview(raw);
    expect(preview.startsWith("The opening line")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX + 1);
    expect(preview).not.toContain("title: Secret");
    expect(preview).not.toContain(raw);
  });

  it("keeps unique path strings and drops anything else", () => {
    expect(sanitizePathList(["/a.md", " /a.md ", "", 3, "/b.md", "/a.md"])).toEqual(["/a.md", "/b.md"]);
    expect(sanitizePathList({ "/a.md": "full note text" })).toEqual([]);
  });

  it("treats markdown paths as notes", () => {
    expect(isNotePath("/vault/Note.md")).toBe(true);
    expect(isNotePath("/vault/Note.MARKDOWN")).toBe(true);
    expect(isNotePath("/vault/photo.png")).toBe(false);
  });
});

describe("settings merge", () => {
  it("stores bookmark paths and pin positions without note text", () => {
    const saved = mergeVaultSlices(
      {
        expandedPaths: { vault1: ["/notes"] },
        pinnedPaths: { vault1: ["/notes/a.md"] },
      },
      "vault1",
      {
        bookmarks: ["/notes/a.md", "/notes/photo.png"],
        pinLayouts: { "/notes/a.md": { x: 10, y: 20, z: 1, stackId: null } },
      },
    );
    expect(saved.expandedPaths).toEqual({ vault1: ["/notes"] });
    expect(saved.pinnedPaths).toEqual({ vault1: ["/notes/a.md"] });
    expect(saved.bookmarks).toEqual({ vault1: ["/notes/a.md", "/notes/photo.png"] });
    expect(JSON.stringify(saved)).not.toContain("note body");
  });

  it("drops a pin layout that is not coordinates", () => {
    expect(sanitizePinLayout({
      "/notes/a.md": { x: 4, y: 8, z: 2, stackId: "s1" },
      "/notes/b.md": "the whole note",
    })).toEqual({
      "/notes/a.md": { x: 4, y: 8, z: 2, stackId: "s1" },
    });
  });
});

describe("pin canvas layout", () => {
  it("moves a card off a stack", () => {
    const layout = layoutsFor(["/a.md"], {});
    const moved = moveCard(layout, "/a.md", 80, 90);
    expect(moved["/a.md"]).toMatchObject({ x: 80, y: 90, stackId: null });
  });

  it("stacks a card dropped onto another card", () => {
    const layout = {
      "/a.md": { x: 10, y: 10, z: 1, stackId: null },
      "/b.md": { x: 40, y: 40, z: 2, stackId: null },
    };
    const stacked = stackOnto(layout, "/b.md", "/a.md");
    expect(stacked["/a.md"].stackId).toBe("/a.md");
    expect(stacked["/b.md"].stackId).toBe("/a.md");
    expect(stacked["/b.md"].x).toBe(stacked["/a.md"].x + 18);
    expect(stacked["/b.md"].y).toBe(stacked["/a.md"].y + 18);
    expect(stacked["/b.md"].z).toBeGreaterThan(stacked["/a.md"].z);
  });
});

describe("folder listing", () => {
  it("lists images and other files in the current folder", () => {
    const items = listFolderItems("/vault", {
      directories: ["/vault/sub", "/vault/sub/nested", "/other"],
      entries: [
        { path: "/vault/note.md", name: "note" },
        { path: "/vault/sub/inner.md", name: "inner" },
      ],
      nonMdFiles: [
        { path: "/vault/photo.png", name: "photo.png" },
        { path: "/vault/brief.pdf", name: "brief.pdf" },
      ],
    });
    expect(items.map((item) => item.name)).toEqual(["sub", "brief.pdf", "note", "photo.png"]);
    expect(items.find((item) => item.name === "brief.pdf")?.ext).toBe(".pdf");
    expect(items.find((item) => item.name === "photo.png")?.ext).toBe(".png");
  });
});

describe("folder dashboard", () => {
  it("shows an image preview and leaves a PDF as a named row", () => {
    (window as unknown as { __MARKABLE_CONVERT_FILE_SRC__?: (path: string) => string }).__MARKABLE_CONVERT_FILE_SRC__ =
      (path) => `asset://${path}`;
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderFileDashboard(host, {
      folderPath: "/vault",
      items: [
        { path: "/vault/photo.png", name: "photo.png", kind: "file", ext: ".png" },
        { path: "/vault/brief.pdf", name: "brief.pdf", kind: "file", ext: ".pdf" },
      ],
      onOpenFile: () => {},
      onOpenFolder: () => {},
      onRename: () => {},
      onMove: () => {},
      onContextMenu: () => {},
    });
    const rows = [...host.querySelectorAll<HTMLElement>(".file-browser-dash-row")];
    const photo = rows.find((row) => row.getAttribute("data-path") === "/vault/photo.png");
    const pdf = rows.find((row) => row.getAttribute("data-path") === "/vault/brief.pdf");
    expect(photo?.querySelector("img.file-browser-dash-thumb")).not.toBeNull();
    expect(pdf?.querySelector("img")).toBeNull();
    expect(pdf?.querySelector(".tree-node-label")?.textContent).toBe("brief.pdf");
    expect(pdf?.querySelector("video")).toBeNull();
  });

  it("selects and opens a file on click", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onOpenFile = vi.fn();
    renderFileDashboard(host, {
      folderPath: "/vault",
      items: [{ path: "/vault/note.md", name: "note", kind: "file", ext: ".md" }],
      onOpenFile,
      onOpenFolder: () => {},
      onRename: () => {},
      onMove: () => {},
      onContextMenu: () => {},
    });
    const row = host.querySelector<HTMLElement>(".file-browser-dash-row")!;
    row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 4, clientY: 4, button: 0, pointerId: 1 }));
    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 5, clientY: 5, button: 0, pointerId: 1 }));
    expect(row.classList.contains("tree-node-active")).toBe(true);
    expect(onOpenFile).toHaveBeenCalledWith("/vault/note.md");
  });
});

describe("pin canvas", () => {
  it("shows the start of a pinned note and opens it on click", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onOpen = vi.fn();
    renderPinCanvas(host, {
      paths: ["/vault/note.md"],
      layout: {},
      loadPreview: async () => "Opening sentence.",
      onOpen,
      onLayout: () => {},
    });
    const card = host.querySelector<HTMLElement>(".file-browser-pin-card")!;
    await vi.waitFor(() => {
      expect(card.querySelector(".file-browser-pin-preview")?.textContent).toBe("Opening sentence.");
    });
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 8, clientY: 8, button: 0, pointerId: 1 }));
    card.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 9, clientY: 8, button: 0, pointerId: 1 }));
    expect(onOpen).toHaveBeenCalledWith("/vault/note.md");
  });

  it("pointer-drags a card to a new position", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onLayout = vi.fn();
    renderPinCanvas(host, {
      paths: ["/vault/note.md"],
      layout: { "/vault/note.md": { x: 16, y: 16, z: 1, stackId: null } },
      loadPreview: async () => "",
      onOpen: () => {},
      onLayout,
    });
    const card = host.querySelector<HTMLElement>(".file-browser-pin-card")!;
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20, button: 0, pointerId: 3 }));
    card.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 70, clientY: 80, button: 0, pointerId: 3 }));
    card.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 70, clientY: 80, button: 0, pointerId: 3 }));
    expect(onLayout).toHaveBeenCalledOnce();
    const next = onLayout.mock.calls[0][0] as Record<string, { x: number; y: number; stackId: string | null }>;
    expect(next["/vault/note.md"].x).toBe(66);
    expect(next["/vault/note.md"].y).toBe(76);
    expect(next["/vault/note.md"].stackId).toBeNull();
  });
});

describe("file browser menus", () => {
  it("offers Bookmark on a file and Folder dashboard on a folder", () => {
    _testing.setBookmarkPaths(new Set());
    const fileItems = _testing.buildFileContextMenuItems(document.createElement("div"), "/vault/note.md", "vault-1");
    expect(fileItems.map((item) => item.label)).toContain("Bookmark");
    expect(fileItems.map((item) => item.label)).toContain("Pin");

    _testing.setBookmarkPaths(new Set(["/vault/note.md"]));
    const again = _testing.buildFileContextMenuItems(document.createElement("div"), "/vault/note.md", "vault-1");
    expect(again.map((item) => item.label)).toContain("Remove Bookmark");

    const dir = document.createElement("div");
    const dirItems = _testing.buildDirContextMenuItems(dir, "/vault/A", "vault-1", false);
    const labels = dirItems.map((item) => item.label);
    expect(labels).toContain("Folder dashboard");
    expect(labels.indexOf("Pin")).toBe(labels.indexOf("Delete") + 1);
    const visible = dirItems.filter((item) => !item.separator);
    expect(visible[visible.length - 1]?.label).toBe("Reveal in Finder");
  });
});
