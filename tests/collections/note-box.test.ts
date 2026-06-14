/**
 * tests/collections/note-box.test.ts — step_09
 *
 * Asserts the framed-box renderer:
 *   - createPlaceholder builds the basic DOM shell.
 *   - renderPreview reads file content + injects sanitised marked HTML.
 *   - reference/broken/canonical variants render the right class + behaviour.
 *   - recycleToPlaceholder restores the placeholder shell using cached height.
 *   - beginInlineRename Enter/Escape semantics.
 *   - buildNoteBoxContextItems for each kind matches the exact spec.
 *   - The sanitiser strips raw <script> from the body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import { createPreviewCache } from "../../src/plugins/file-browser/collections/preview-cache";
import {
  createPlaceholder,
  renderPreview,
  recycleToPlaceholder,
  beginInlineRename,
  buildNoteBoxContextItems,
  type NoteBoxHandlers,
} from "../../src/plugins/file-browser/collections/note-box";
import type { NoteBoxKind } from "../../src/plugins/file-browser/collections/types";

function withFs(initial: Record<string, string>) {
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (path in initial) {
      return { ok: true as const, value: initial[path] };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
  vi.spyOn(bridge, "statFile").mockResolvedValue({
    ok: true,
    value: { mtimeMs: 100, size: 0 },
  });
}

function makeHandlers(): NoteBoxHandlers {
  return {
    onClick: vi.fn(),
    onContextMenu: vi.fn(),
    onRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const canonical: NoteBoxKind = {
  kind: "canonical",
  stackPath: "/v/A/Stack 01",
  noteFilename: "A.md",
};
const reference: NoteBoxKind = {
  kind: "reference",
  ownerStackPath: "/v/A/Stack 02",
  canonicalRel: "Other/X.md",
};
const broken: NoteBoxKind = {
  kind: "broken",
  ownerStackPath: "/v/A/Stack 02",
  canonicalRel: "Other/Missing.md",
};

beforeEach(() => vi.restoreAllMocks());

describe("note-box: placeholder (step_09)", () => {
  it("createPlaceholder returns a box with state='placeholder'", () => {
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    expect(h.state).toBe("placeholder");
    expect(h.el.classList.contains("fv-collection-note-box")).toBe(true);
  });

  it("FR-29 — placeholder height uses passed-in initialHeight when provided", () => {
    const h = createPlaceholder("/v/A/Stack 01/A.md", canonical, "A", makeHandlers(), 200);
    expect(h.el.style.height).toBe("200px");
  });

  it("FR-29 — placeholder height falls back to a default when no initialHeight", () => {
    const h = createPlaceholder("/v/A/Stack 01/A.md", canonical, "A", makeHandlers());
    expect(h.el.style.height).toBe("160px");
  });

  it("FR-22 — reference kind renders with is-reference class", () => {
    const h = createPlaceholder("/v/X/Other.md", reference, "Other", makeHandlers());
    expect(h.el.classList.contains("is-reference")).toBe(true);
  });
});

describe("note-box: renderPreview (step_09)", () => {
  it("FR-9 — reads file and injects sanitised marked HTML", async () => {
    withFs({ "/v/A/Stack 01/A.md": "# Heading\n\nSome **bold** text." });
    const cache = createPreviewCache();
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    document.body.appendChild(h.el);
    await renderPreview(h, cache);
    const body = h.el.querySelector(".fv-collection-note-box-body");
    expect(body?.innerHTML).not.toBe("");
    expect(body?.innerHTML).toContain("<strong");
    expect(h.state).toBe("rendered");
    h.el.remove();
  });

  it("FR-28 — renderPreview reuses cache on hit; no bridge.readFile call", async () => {
    const readSpy = vi.spyOn(bridge, "readFile").mockImplementation(async () => {
      throw new Error("should not be called");
    });
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 100, size: 0 },
    });
    const cache = createPreviewCache();
    cache.set("/v/A/Stack 01/A.md", { html: "<p>cached</p>", mtimeMs: 100 });
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    await renderPreview(h, cache);
    expect(readSpy).not.toHaveBeenCalled();
    expect(h.el.querySelector(".fv-collection-note-box-body")?.innerHTML).toContain(
      "cached",
    );
  });

  it("FR-29 — caches measured height after render", async () => {
    withFs({ "/v/A/Stack 01/A.md": "hello" });
    const cache = createPreviewCache();
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    document.body.appendChild(h.el);
    // jsdom does not measure layout, but the cache.setHeight call still fires.
    const setHeightSpy = vi.spyOn(cache, "setHeight");
    await renderPreview(h, cache);
    expect(setHeightSpy).toHaveBeenCalled();
    h.el.remove();
  });

  it("EC-16 — broken kind renders dimmed text; no file read", async () => {
    const readSpy = vi.spyOn(bridge, "readFile");
    const cache = createPreviewCache();
    const h = createPlaceholder("/v/X/Missing.md", broken, "Missing", makeHandlers());
    await renderPreview(h, cache);
    expect(readSpy).not.toHaveBeenCalled();
    const body = h.el.querySelector(".fv-collection-note-box-body");
    expect(body?.textContent).toContain("referenced note not found");
    expect(h.el.classList.contains("is-broken")).toBe(true);
  });
});

describe("note-box: recycle (step_09)", () => {
  it("FR-28 — recycleToPlaceholder restores placeholder with cached height", async () => {
    withFs({ "/v/A/Stack 01/A.md": "hello" });
    const cache = createPreviewCache();
    cache.set("/v/A/Stack 01/A.md", { html: "<p>cached</p>", mtimeMs: 100 });
    cache.setHeight("/v/A/Stack 01/A.md", 250);
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    document.body.appendChild(h.el);
    await renderPreview(h, cache);
    recycleToPlaceholder(h, cache);
    expect(h.state).toBe("placeholder");
    expect(h.el.style.height).toBe("250px");
    expect(h.el.querySelector(".fv-collection-note-box-body")?.children.length).toBe(0);
    h.el.remove();
  });
});

describe("note-box: beginInlineRename (step_09)", () => {
  it("FR-7 — commits new filename on Enter", async () => {
    const handlers = makeHandlers();
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      handlers,
    );
    document.body.appendChild(h.el);
    const promise = beginInlineRename(h);
    const input = h.el.querySelector(
      ".fv-collection-note-box-rename-input",
    ) as HTMLInputElement;
    input.value = "B";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const result = await promise;
    expect(result).toBe("B");
    h.el.remove();
  });

  it("FR-7 — returns null on Escape", async () => {
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    document.body.appendChild(h.el);
    const promise = beginInlineRename(h);
    const input = h.el.querySelector(
      ".fv-collection-note-box-rename-input",
    ) as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const result = await promise;
    expect(result).toBeNull();
    h.el.remove();
  });
});

describe("note-box: context items (step_09)", () => {
  it("FR-12 — canonical context items match exact spec", () => {
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    expect(buildNoteBoxContextItems(h).map((i) => i.label)).toEqual([
      "Rename",
      "Move up",
      "Move down",
      "Move to other Stack…",
      "Add reference to another Stack…",
      "Delete",
    ]);
  });

  it("FR-24 — reference context items match exact spec", () => {
    const h = createPlaceholder(
      "/v/X/Other.md",
      reference,
      "Other",
      makeHandlers(),
    );
    expect(buildNoteBoxContextItems(h).map((i) => i.label)).toEqual([
      "Open canonical",
      "Remove reference (from this Stack)",
      "Edit in place",
    ]);
  });

  it("EC-16 — broken context items have only Remove reference", () => {
    const h = createPlaceholder(
      "/v/X/Missing.md",
      broken,
      "Missing",
      makeHandlers(),
    );
    expect(buildNoteBoxContextItems(h).map((i) => i.label)).toEqual([
      "Remove reference (from this Stack)",
    ]);
  });
});

describe("note-box: XSS sanitisation (step_09)", () => {
  it("XSS — marked output sanitises raw <script> in note body", async () => {
    withFs({
      "/v/A/Stack 01/A.md":
        "# Title\n\n<script>alert('xss')</script>\n",
    });
    const cache = createPreviewCache();
    const h = createPlaceholder(
      "/v/A/Stack 01/A.md",
      canonical,
      "A",
      makeHandlers(),
    );
    document.body.appendChild(h.el);
    await renderPreview(h, cache);
    const body = h.el.querySelector(".fv-collection-note-box-body");
    expect(body?.innerHTML).not.toContain("<script");
    h.el.remove();
  });
});
