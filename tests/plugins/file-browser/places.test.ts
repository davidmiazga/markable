/**
 * Bookmarks, pin previews, the folder dashboard, and the pin canvas.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  addGroupPlace,
  addSearchPlace,
  buildBookmarkSection,
  buildPlaceSection,
  headingsIn,
  isNotePath,
  listFolderItems,
  layoutsFor,
  mergeVaultSlices,
  moveCard,
  notePreview,
  relocatePlace,
  renderFileDashboard,
  renderPinCanvas,
  sanitizePathList,
  sanitizePinLayout,
  stackOnto,
  togglePlaceCollapsed,
  NOTE_PREVIEW_MAX,
  type PlaceEntry,
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

describe("bookmark marks", () => {
  it("puts a star on the right of a bookmark and removes it on click", () => {
    const onUnbookmark = vi.fn();
    const onOpen = vi.fn();
    const section = buildBookmarkSection(["/vault/Meeting notes.md"], {
      activePath: null,
      onOpen,
      onContextMenu: () => {},
      onUnbookmark,
      unbookmarkIcon: "<svg></svg>",
    });
    const row = section?.querySelector("li");
    const mark = row?.querySelector(".tree-node-mark");
    expect(row?.lastElementChild).toBe(mark);
    expect(mark?.getAttribute("title")).toBe("Remove bookmark");
    mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onUnbookmark).toHaveBeenCalledWith("/vault/Meeting notes.md");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("file browser menus", () => {
  it("keeps pin and bookmark off the file right-click and on the row menu", () => {
    _testing.setBookmarkPaths(new Set());
    _testing.setPinnedPaths(new Set());
    const fileItems = _testing.buildFileContextMenuItems(document.createElement("div"), "/vault/note.md", "vault-1");
    const fileLabels = fileItems.map((item) => item.label);
    expect(fileLabels).not.toContain("Bookmark");
    expect(fileLabels).not.toContain("Pin");
    expect(fileLabels).not.toContain("Apply Page Layout");
    expect(fileLabels).toContain("Rename");

    const actions = _testing.rowActionItems("/vault/note.md", "vault-1", false);
    expect(actions.map((item) => item.label)).toEqual(["Pin", "Bookmark", "Pin heading", "Apply Page Layout"]);

    _testing.setBookmarkPaths(new Set(["/vault/note.md"]));
    _testing.setPinnedPaths(new Set(["/vault/note.md"]));
    const again = _testing.rowActionItems("/vault/note.md", "vault-1", true);
    expect(again.map((item) => item.label)).toEqual(["Unpin", "Remove Bookmark", "Pin heading", "Edit Page Layout"]);

    const plain = _testing.rowActionItems("/vault/photo.png", "vault-1", null);
    expect(plain.map((item) => item.label)).toEqual(["Pin", "Bookmark"]);

    const dir = document.createElement("div");
    const dirItems = _testing.buildDirContextMenuItems(dir, "/vault/A", "vault-1", false);
    const labels = dirItems.map((item) => item.label);
    expect(labels).toContain("Folder dashboard");
    expect(labels.indexOf("Pin")).toBe(labels.indexOf("Delete") + 1);
    const visible = dirItems.filter((item) => !item.separator);
    expect(visible[visible.length - 1]?.label).toBe("Reveal in Finder");
  });
});

describe("place lists", () => {
  const file = (id: string, path: string): PlaceEntry => ({ id, kind: "file", path });

  it("reads headings and ignores duplicates", () => {
    expect(headingsIn("# Title\n\n## Title\n### Notes")).toEqual(["Title", "Notes"]);
  });

  it("moves an item into a group and collapses that group", () => {
    let entries = [file("a", "/vault/a.md"), file("b", "/vault/b.md")];
    entries = addGroupPlace(entries, "Daily");
    const group = entries.find((entry) => entry.kind === "group")!;
    entries = relocatePlace(entries, "a", group.id, 0);
    expect(entries.find((entry) => entry.id === group.id)?.children?.map((child) => child.id)).toEqual(["a"]);
    entries = togglePlaceCollapsed(entries, group.id);
    expect(entries.find((entry) => entry.id === group.id)?.collapsed).toBe(true);
  });

  it("stores a search once and draws it with the search icon", () => {
    let entries = addSearchPlace([], "  invoices  ");
    entries = addSearchPlace(entries, "invoices");
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe("invoices");

    const section = buildPlaceSection({
      title: "Pinned",
      entries,
      collapsed: false,
      activePath: null,
      removeIcon: "<svg></svg>",
      removeTitle: "Unpin",
      onToggleSection: () => {},
      onToggleGroup: () => {},
      onNewGroup: () => {},
      onOpenFile: () => {},
      onRunSearch: () => {},
      onRemove: () => {},
      onReorder: () => {},
      onContextMenu: () => {},
    });
    const icon = section?.querySelector(".place-kind-icon svg");
    expect(icon).not.toBeNull();
    expect(section?.querySelector(".tree-node-label")?.textContent).toBe("invoices");
    expect(section?.querySelector(".place-twist.is-open")).not.toBeNull();
  });

  it("hides rows when the section is collapsed", () => {
    const section = buildPlaceSection({
      title: "Bookmarks",
      entries: [file("a", "/vault/a.md")],
      collapsed: true,
      activePath: null,
      removeIcon: "<svg></svg>",
      removeTitle: "Remove bookmark",
      onToggleSection: () => {},
      onToggleGroup: () => {},
      onNewGroup: () => {},
      onOpenFile: () => {},
      onRunSearch: () => {},
      onRemove: () => {},
      onReorder: () => {},
      onContextMenu: () => {},
    });
    expect(section?.querySelector(".tree-node")).toBeNull();
    expect(section?.querySelector(".place-section-header")?.textContent).toContain("Bookmarks");
  });

  it("paints a colored row with that color instead of the selection blue", () => {
    const section = buildPlaceSection({
      title: "Pinned",
      entries: [{ id: "a", kind: "file", path: "/vault/Test02.md", color: "purple" }],
      collapsed: false,
      activePath: "/vault/Test02.md",
      removeIcon: "<svg></svg>",
      removeTitle: "Unpin",
      onToggleSection: () => {},
      onToggleGroup: () => {},
      onNewGroup: () => {},
      onOpenFile: () => {},
      onRunSearch: () => {},
      onRemove: () => {},
      onReorder: () => {},
      onContextMenu: () => {},
    });
    const row = section?.querySelector(".place-row");
    expect(row?.classList.contains("tree-node-active")).toBe(true);
    expect(row?.classList.contains("place-tinted")).toBe(true);
    expect(row?.classList.contains("place-tint-purple")).toBe(true);
    expect(row?.querySelector(".place-color-dot")).not.toBeNull();
  });

  it("opens a row of color circles and an X", () => {
    _testing.bookmarkPath("/vault/a.md", "vault-1");
    const entry = _testing.getBookmarkItems()[0];
    _testing.openPlaceMenu(entry, "bookmarks", "vault-1", 20, 20);

    const colors = Array.from(document.querySelectorAll(".place-swatch")).map((el) => el.className);
    expect(colors).toEqual([
      "place-swatch place-color-red",
      "place-swatch place-color-orange",
      "place-swatch place-color-yellow",
      "place-swatch place-color-green",
      "place-swatch place-color-blue",
      "place-swatch place-color-purple",
    ]);
    expect(document.querySelector(".place-swatch-remove")?.textContent).toBe("×");
    expect(document.querySelector(".context-menu-item")).toBeNull();

    (document.querySelector(".place-color-blue") as HTMLButtonElement).click();
    expect(_testing.getBookmarkItems()[0]?.color).toBe("blue");

    _testing.openPlaceMenu(_testing.getBookmarkItems()[0], "bookmarks", "vault-1", 20, 20);
    expect(document.querySelector(".place-color-blue")?.classList.contains("is-selected")).toBe(true);
    (document.querySelector(".place-swatch-remove") as HTMLButtonElement).click();
    expect(_testing.getBookmarkItems()).toEqual([]);
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});
