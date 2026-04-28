/**
 * drag-drop.test.ts — Unit tests for createDragDropHandler().
 *
 * Covers all edge cases from docs/requirements/active_task.md:
 *   EC-01  already-open file (duplicate) → no crash, refresh still called
 *   EC-02  .txt files → accepted
 *   EC-03  non-.md / non-.txt files → silently ignored
 *   EC-04  directories → silently ignored (no .md / .txt extension)
 *   EC-05  mixed valid + invalid payload → only valid files opened
 *   EC-06  paths with Unicode characters → passed through unchanged
 *   EC-07  (FR-5) paths with spaces → passed through unchanged
 *   EC-10  non-"drop" event types (enter / over / leave) → ignored
 *   EC-12  refreshRecentFilesMenu called after ALL opens, not before
 *   EC-13  empty paths array after filtering → no open, no refresh
 *   NFR-6  multiple files opened in payload order (sequential)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDragDropHandler } from "../../src/tabs/drag-drop";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandler() {
  const openFileInTab = vi.fn((_path: string) => Promise.resolve(true));
  const refreshRecentFilesMenu = vi.fn(() => Promise.resolve());
  const handler = createDragDropHandler(
    { openFileInTab },
    refreshRecentFilesMenu
  );
  return { handler, openFileInTab, refreshRecentFilesMenu };
}

function dropEvent(paths: string[]) {
  return { payload: { type: "drop" as const, paths } };
}

function nonDropEvent(type: "enter" | "over" | "leave") {
  if (type === "over") return { payload: { type: "over" as const } };
  if (type === "leave") return { payload: { type: "leave" as const } };
  return { payload: { type: "enter" as const, paths: ["/ignored.md"] } };
}

// ── EC-10 — non-"drop" event types are ignored ────────────────────────────────

describe("createDragDropHandler — event type guard (EC-10)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores 'enter' events", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(nonDropEvent("enter"));
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("ignores 'over' events", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(nonDropEvent("over"));
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("ignores 'leave' events", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(nonDropEvent("leave"));
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("does not call refreshRecentFilesMenu for non-drop events", async () => {
    const { handler, refreshRecentFilesMenu } = makeHandler();
    await handler(nonDropEvent("enter"));
    expect(refreshRecentFilesMenu).not.toHaveBeenCalled();
  });
});

// ── EC-13 — empty paths after filter ─────────────────────────────────────────

describe("createDragDropHandler — empty paths guard (EC-13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exits early when the payload paths array is empty", async () => {
    const { handler, openFileInTab, refreshRecentFilesMenu } = makeHandler();
    await handler(dropEvent([]));
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(refreshRecentFilesMenu).not.toHaveBeenCalled();
  });

  it("exits early when all paths are filtered out (non-.md/.txt only)", async () => {
    const { handler, openFileInTab, refreshRecentFilesMenu } = makeHandler();
    await handler(dropEvent(["/img/photo.png", "/docs/report.pdf"]));
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(refreshRecentFilesMenu).not.toHaveBeenCalled();
  });
});

// ── EC-02 — .txt files are accepted ──────────────────────────────────────────

describe("createDragDropHandler — .txt file support (EC-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a .txt file", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(dropEvent(["/notes/readme.txt"]));
    expect(openFileInTab).toHaveBeenCalledWith("/notes/readme.txt");
  });

  it("opens a .md file", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(dropEvent(["/notes/doc.md"]));
    expect(openFileInTab).toHaveBeenCalledWith("/notes/doc.md");
  });
});

// ── EC-03 & EC-04 — unsupported extensions and directories are ignored ────────

describe("createDragDropHandler — extension filter (EC-03, EC-04)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [".pdf", "/docs/report.pdf"],
    [".png", "/imgs/photo.png"],
    [".docx", "/docs/letter.docx"],
    [".jpg", "/imgs/snap.jpg"],
    ["(directory)", "/Users/dave/Documents"],
    ["(no ext)", "/Users/dave/somefile"],
  ])("ignores %s (%s)", async (_label, path) => {
    const { handler, openFileInTab } = makeHandler();
    await handler(dropEvent([path]));
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("extension match is case-sensitive (.MD is not accepted)", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(dropEvent(["/notes/DOC.MD"]));
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});

// ── EC-05 — mixed valid + invalid payload ────────────────────────────────────

describe("createDragDropHandler — mixed payload (EC-05)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens only .md from a mixed payload", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(dropEvent(["/notes/foo.md", "/images/photo.png", "/data/report.pdf"]));
    expect(openFileInTab).toHaveBeenCalledTimes(1);
    expect(openFileInTab).toHaveBeenCalledWith("/notes/foo.md");
  });

  it("opens both .md and .txt from a mixed payload, skipping others", async () => {
    const { handler, openFileInTab } = makeHandler();
    await handler(
      dropEvent(["/notes/doc.md", "/notes/readme.txt", "/images/photo.png"])
    );
    expect(openFileInTab).toHaveBeenCalledTimes(2);
    expect(openFileInTab).toHaveBeenNthCalledWith(1, "/notes/doc.md");
    expect(openFileInTab).toHaveBeenNthCalledWith(2, "/notes/readme.txt");
  });
});

// ── NFR-6 — sequential opens in payload order ────────────────────────────────

describe("createDragDropHandler — sequential ordering (NFR-6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens multiple files in payload order", async () => {
    const { handler, openFileInTab } = makeHandler();
    const order: string[] = [];
    openFileInTab.mockImplementation(async (p: string) => {
      order.push(p);
      return true;
    });
    await handler(dropEvent(["/a.md", "/b.md", "/c.md"]));
    expect(order).toEqual(["/a.md", "/b.md", "/c.md"]);
  });
});

// ── EC-01 — already-open file (duplicate) ────────────────────────────────────

describe("createDragDropHandler — deduplication (EC-01)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not crash when openFileInTab returns false for a duplicate", async () => {
    const { handler, openFileInTab, refreshRecentFilesMenu } = makeHandler();
    openFileInTab.mockResolvedValueOnce(false);
    await expect(handler(dropEvent(["/docs/open.md"]))).resolves.toBeUndefined();
    expect(refreshRecentFilesMenu).toHaveBeenCalled();
  });
});

// ── EC-12 — refreshRecentFilesMenu called after all opens ────────────────────

describe("createDragDropHandler — refreshRecentFilesMenu ordering (EC-12)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls refreshRecentFilesMenu after all openFileInTab calls complete", async () => {
    const { handler, openFileInTab, refreshRecentFilesMenu } = makeHandler();
    const order: string[] = [];
    openFileInTab.mockImplementation(async (p: string) => {
      order.push(`open:${p}`);
      return true;
    });
    refreshRecentFilesMenu.mockImplementation(async () => {
      order.push("refresh");
    });
    await handler(dropEvent(["/a.md", "/b.md"]));
    expect(order).toEqual(["open:/a.md", "open:/b.md", "refresh"]);
  });

  it("does NOT call refreshRecentFilesMenu when all paths are filtered out", async () => {
    const { handler, refreshRecentFilesMenu } = makeHandler();
    await handler(dropEvent(["/image.png"]));
    expect(refreshRecentFilesMenu).not.toHaveBeenCalled();
  });
});

// ── EC-06 / EC-07 — paths with spaces and Unicode ────────────────────────────

describe("createDragDropHandler — path passthrough (EC-06, EC-07)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes paths with spaces through to openFileInTab unchanged (EC-07)", async () => {
    const { handler, openFileInTab } = makeHandler();
    const spaced = "/Users/dave/My Notes/Meeting Notes April.md";
    await handler(dropEvent([spaced]));
    expect(openFileInTab).toHaveBeenCalledWith(spaced);
  });

  it("passes Unicode paths through to openFileInTab unchanged (EC-06)", async () => {
    const { handler, openFileInTab } = makeHandler();
    const unicode = "/Users/dave/日本語ノート/レシピ.md";
    await handler(dropEvent([unicode]));
    expect(openFileInTab).toHaveBeenCalledWith(unicode);
  });
});
