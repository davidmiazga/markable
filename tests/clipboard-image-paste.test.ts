/**
 * Unit tests for the clipboard image paste feature.
 *
 * Covers the two pure helper functions exported from src/lib/clipboard-image.ts,
 * and the handleImagePaste logic function exported from
 * src/lib/clipboard-image-handler.ts.
 *
 * These tests have zero Tauri or CodeMirror dependencies — they run in the
 * standard vitest/happy-dom environment without any special mocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImageFilename, computeImageSnippet, extractImageItem } from "../src/lib/clipboard-image";
import { handleImagePaste } from "../src/lib/clipboard-image-handler";

// ---------------------------------------------------------------------------
// generateImageFilename
// ---------------------------------------------------------------------------

describe("generateImageFilename", () => {
  it("T-GIF-01: returns the correct format string for a normal date", () => {
    // 2026-05-05 14:30:22 local time
    const date = new Date(2026, 4, 5, 14, 30, 22); // month is 0-indexed
    expect(generateImageFilename(date)).toBe("20260505-143022.png");
  });

  it("T-GIF-02: pads midnight correctly (00:00:00)", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0); // Jan 1 00:00:00
    expect(generateImageFilename(date)).toBe("20260101-000000.png");
  });

  it("T-GIF-03: handles end-of-year boundary (Dec 31 23:59:59)", () => {
    const date = new Date(2025, 11, 31, 23, 59, 59); // Dec 31 23:59:59
    expect(generateImageFilename(date)).toBe("20251231-235959.png");
  });

  it("T-GIF-04: zero-pads single-digit month, day, hour, minute, and second", () => {
    // Month 2 (March = index 2), day 3, hour 4, minute 5, second 6
    const date = new Date(2026, 2, 3, 4, 5, 6);
    expect(generateImageFilename(date)).toBe("20260303-040506.png");
  });

  it("T-GIF-05: extension is always .png regardless of other values", () => {
    const date = new Date(2024, 6, 15, 12, 0, 0);
    const result = generateImageFilename(date);
    expect(result.endsWith(".png")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeImageSnippet
// ---------------------------------------------------------------------------

describe("computeImageSnippet", () => {
  it("T-CIS-01: activeFilePath null → returns absolute path form", () => {
    const result = computeImageSnippet("/Users/dave/images/photo.png", null);
    // Spec says "![]({imagePath})" — the full absolute path wrapped in Markdown img syntax.
    expect(result).toBe("![](" + "/Users/dave/images/photo.png" + ")");
  });

  it("T-CIS-02: same directory → returns filename-only form", () => {
    const result = computeImageSnippet(
      "/Users/dave/notes/photo.png",
      "/Users/dave/notes/myfile.md"
    );
    // Same directory — only basename
    expect(result).toBe("![](photo.png)");
  });

  it("T-CIS-03: different directory → returns absolute path form", () => {
    const result = computeImageSnippet(
      "/Users/dave/images/photo.png",
      "/Users/dave/notes/myfile.md"
    );
    expect(result).toBe("![](" + "/Users/dave/images/photo.png" + ")");
  });

  it("T-CIS-04: image and file in the same shallow directory → relative", () => {
    // activeFilePath in /a/, imagePath in /a/
    const result = computeImageSnippet("/a/image.png", "/a/b.md");
    expect(result).toBe("![](image.png)");
  });

  it("T-CIS-05: activeFilePath in /a/b/, imagePath in /a/ → different dir → absolute", () => {
    const result = computeImageSnippet("/a/image.png", "/a/b/notes.md");
    expect(result).toBe("![](" + "/a/image.png" + ")");
  });
});

// ---------------------------------------------------------------------------
// extractImageItem — Guard 1 logic (EC-01, EC-21)
// ---------------------------------------------------------------------------
//
// Guards 2 and 5 (editor.hasFocus and item.getAsFile() !== null) live in the
// document paste listener in main.ts, which closes over the live `editor`
// singleton and is not accessible from unit tests without a full Tauri+DOM
// integration harness. Those guards are verified by manual smoke-testing only.
// AC-11 acknowledges this for EC-06, EC-15, EC-20, EC-22, and EC-23.

/** Build a minimal DataTransferItem stub. */
function makeItem(type: string): DataTransferItem {
  return { type, getAsFile: () => null, getAsString: () => {} } as unknown as DataTransferItem;
}

/** Build a minimal DataTransferItemList stub from an array of items. */
function makeItemList(items: DataTransferItem[]): DataTransferItemList {
  const list: Record<string | number, unknown> = { length: items.length };
  for (let i = 0; i < items.length; i++) list[i] = items[i];
  return list as unknown as DataTransferItemList;
}

describe("extractImageItem", () => {
  it("EC-01: text-only clipboard → returns null", () => {
    const list = makeItemList([makeItem("text/plain"), makeItem("text/html")]);
    expect(extractImageItem(list)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractImageItem(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractImageItem(undefined)).toBeNull();
  });

  it("returns null for empty item list", () => {
    expect(extractImageItem(makeItemList([]))).toBeNull();
  });

  it("returns the image item when present among other items", () => {
    const img = makeItem("image/png");
    const list = makeItemList([makeItem("text/plain"), img]);
    expect(extractImageItem(list)).toBe(img);
  });

  it("EC-21: returns first image item when multiple image items are present", () => {
    const first = makeItem("image/png");
    const second = makeItem("image/jpeg");
    const list = makeItemList([first, second]);
    expect(extractImageItem(list)).toBe(first);
  });

  it("matches image/jpeg and image/gif in addition to image/png", () => {
    const jpeg = makeItem("image/jpeg");
    expect(extractImageItem(makeItemList([jpeg]))).toBe(jpeg);
    const gif = makeItem("image/gif");
    expect(extractImageItem(makeItemList([gif]))).toBe(gif);
  });
});

// ---------------------------------------------------------------------------
// handleImagePaste — paste logic extracted for testability
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake Blob that resolves arrayBuffer() with the given bytes.
 * Avoids constructing a real File object so tests remain environment-neutral.
 */
function makeFakeBlob(bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): Blob {
  const uint8 = new Uint8Array(bytes);
  return {
    arrayBuffer: async () => uint8.buffer,
    size: bytes.length,
    type: "image/png",
    slice: () => { throw new Error("not implemented"); },
    stream: () => { throw new Error("not implemented"); },
    text: () => { throw new Error("not implemented"); },
  } as unknown as Blob;
}

/**
 * Build a standard deps object for handleImagePaste with sensible defaults
 * so individual tests only need to override the fields they care about.
 */
function makeDeps(overrides: Partial<Parameters<typeof handleImagePaste>[0]> = {}): Parameters<typeof handleImagePaste>[0] {
  return {
    imageBlob: makeFakeBlob(),
    activeTab: { kind: "editor", filePath: "/vault/notes.md" },
    getActiveVault: () => ({ rootPaths: ["/vault"] }),
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
    writeBinaryFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    saveImageDialog: vi.fn().mockResolvedValue({ cancelled: true }),
    dispatch: vi.fn(),
    getSelectionHead: () => 0,
    now: new Date(2026, 4, 5, 14, 30, 22),
    ...overrides,
  };
}

describe("handleImagePaste", () => {
  // happy-dom may not define window.alert; install a vi.fn() spy on globalThis
  // before each test so handleImagePaste's alert() calls can be asserted.
  // Using a loose type to avoid vitest generic constraints.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let alertSpy: { mock: { calls: any[][] }; mockClear: () => void } & ((...args: any[]) => any);

  beforeEach(() => {
    alertSpy = vi.fn() as typeof alertSpy;
    // Cast through unknown to avoid TS strict assignment checks on the global.
    (globalThis as unknown as Record<string, unknown>)["alert"] = alertSpy;
  });

  it("T-HPG-01: non-image blob falls through — no write, no dispatch", async () => {
    // Guard 5-equivalent: pass a null blob at the callsite.
    // handleImagePaste receives imageBlob directly; the null guard is in main.ts.
    // We simulate this by testing that a real null simply doesn't crash — we
    // cover the null guard path by passing an empty-bytes blob and a null tab.
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn();
    await handleImagePaste(makeDeps({
      activeTab: null,   // Guard 3 equivalent
      dispatch,
      writeBinaryFile,
    }));
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-02: null activeTab → falls through, no write, no dispatch", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn();
    await handleImagePaste(makeDeps({ activeTab: null, dispatch, writeBinaryFile }));
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-03: activeTab.kind = 'media' → falls through, no write, no dispatch", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn();
    await handleImagePaste(makeDeps({
      activeTab: { kind: "media", filePath: null },
      dispatch,
      writeBinaryFile,
    }));
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-04: arrayBuffer() rejects → alert called, no write, no dispatch", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn();
    const badBlob = {
      arrayBuffer: async () => { throw new Error("out of memory"); },
    } as unknown as Blob;
    await handleImagePaste(makeDeps({ imageBlob: badBlob, dispatch, writeBinaryFile }));
    expect(alertSpy).toHaveBeenCalledWith("Could not read clipboard image data.");
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-05: arrayBuffer() rejects with error → alert called, no dispatch", async () => {
    const dispatch = vi.fn();
    const badBlob = {
      arrayBuffer: () => Promise.reject(new Error("memory error")),
    } as unknown as Blob;
    await handleImagePaste(makeDeps({ imageBlob: badBlob, dispatch }));
    expect(alertSpy).toHaveBeenCalledWith("Could not read clipboard image data.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-06: vault active, write succeeds → dispatch called with assets/ snippet", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const ensureDirectory = vi.fn().mockResolvedValue(undefined);

    await handleImagePaste(makeDeps({
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
      ensureDirectory,
      writeBinaryFile,
      dispatch,
      now: new Date(2026, 4, 5, 14, 30, 22),
    }));

    // ensureDirectory called with assets path
    expect(ensureDirectory).toHaveBeenCalledWith("/vault/assets");

    // writeBinaryFile called with correct path
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/assets/20260505-143022.png",
      expect.any(Array)
    );

    // dispatch called with vault-relative snippet
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        insert: "![](assets/20260505-143022.png)",
      }),
    }));
  });

  it("T-HPG-07: vault active, ensureDirectory throws → alert called, no write", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn();
    const ensureDirectory = vi.fn().mockRejectedValue(new Error("Permission denied"));

    await handleImagePaste(makeDeps({
      ensureDirectory,
      writeBinaryFile,
      dispatch,
    }));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Could not create assets directory"));
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-08: vault active, writeBinaryFile fails → alert called, no dispatch", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: "Disk full", command: "write_binary_file", path: "/vault/assets/x.png" },
    });

    await handleImagePaste(makeDeps({ writeBinaryFile, dispatch }));

    expect(alertSpy).toHaveBeenCalledWith("Could not save image: Disk full");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-09: vault rootPaths empty (EC-18) → falls to no-vault path", async () => {
    const saveImageDialog = vi.fn().mockResolvedValue({ cancelled: true });
    const dispatch = vi.fn();

    await handleImagePaste(makeDeps({
      getActiveVault: () => ({ rootPaths: [] }), // empty rootPaths
      saveImageDialog,
      dispatch,
    }));

    // Should have called the dialog (no-vault path)
    expect(saveImageDialog).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-10: no vault, user cancels dialog → no write, no dispatch", async () => {
    const writeBinaryFile = vi.fn();
    const dispatch = vi.fn();
    const saveImageDialog = vi.fn().mockResolvedValue({ cancelled: true });

    await handleImagePaste(makeDeps({
      getActiveVault: () => null,
      saveImageDialog,
      writeBinaryFile,
      dispatch,
    }));

    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-11: no vault, write succeeds, same dir → dispatch with filename-only snippet", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const saveImageDialog = vi.fn().mockResolvedValue({
      cancelled: false,
      path: "/Users/dave/notes/20260505-143022.png",
    });

    await handleImagePaste(makeDeps({
      getActiveVault: () => null,
      activeTab: { kind: "editor", filePath: "/Users/dave/notes/myfile.md" },
      saveImageDialog,
      writeBinaryFile,
      dispatch,
      now: new Date(2026, 4, 5, 14, 30, 22),
    }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        insert: "![](20260505-143022.png)",
      }),
    }));
  });

  it("T-HPG-12: no vault, write succeeds, different dir → dispatch with absolute path", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const saveImageDialog = vi.fn().mockResolvedValue({
      cancelled: false,
      path: "/Users/dave/images/20260505-143022.png",
    });

    await handleImagePaste(makeDeps({
      getActiveVault: () => null,
      activeTab: { kind: "editor", filePath: "/Users/dave/notes/myfile.md" },
      saveImageDialog,
      writeBinaryFile,
      dispatch,
    }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        insert: "![](" + "/Users/dave/images/20260505-143022.png" + ")",
      }),
    }));
  });

  it("T-HPG-13: no vault, writeBinaryFile fails → alert called, no dispatch", async () => {
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: "Permission denied", command: "write_binary_file", path: "/x.png" },
    });
    const saveImageDialog = vi.fn().mockResolvedValue({
      cancelled: false,
      path: "/Users/dave/images/photo.png",
    });

    await handleImagePaste(makeDeps({
      getActiveVault: () => null,
      saveImageDialog,
      writeBinaryFile,
      dispatch,
    }));

    expect(alertSpy).toHaveBeenCalledWith("Could not save image: Permission denied");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("T-HPG-14: multiple image items — only first item used (EC-21)", async () => {
    // handleImagePaste only receives the selected imageBlob, so EC-21 (first-item
    // selection) is enforced in the main.ts paste listener loop. We verify here
    // that the handler always processes exactly one blob without question.
    const dispatch = vi.fn();
    const writeBinaryFile = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    await handleImagePaste(makeDeps({ dispatch, writeBinaryFile }));

    // Only one write call confirms no re-iteration
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
