/**
 * tests/view-modal/migration-on-write.test.ts
 *
 * Tests for the `_folder.md` codeblock writer + migration-on-write
 * (step_02). Covers EC-8 (legacy file rewritten as codeblock), EC-17
 * (default toggles ON), EC-19 (non-folder-view keys preserved), and
 * EC-20 (Collections legacy `type: collection` stripped).
 *
 * FR mapping: FR-50, FR-51, FR-52, FR-60, FR-61, FR-63.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SelectFormState } from "../../src/lib/select-builder";
import {
  composeFolderMdCodeblockContent,
  writeFolderMdCodeblock,
  FOLDER_VIEW_CONFIG_KEYS,
} from "../../src/plugins/file-browser/folder-view/codeblock-writer";
import * as bridge from "../../src/lib/bridge";

/**
 * Minimal default-style state matching create-mode defaults (FR-2 / Q-2):
 *   Cards layout, path "./", no filter, sort name-asc, all three toggles
 *   ON, content width normal. EC-17 default.
 */
function defaultState(overrides: Partial<SelectFormState> = {}): SelectFormState {
  return {
    rules: [],
    path: "./",
    display: "cards",
    displayOption: "",
    groupBy: "",
    sort: "name-asc",
    order: [],
    showModified: true,
    showExtensions: true,
    previewPane: true,
    kanbanField: "",
    contentWidth: "normal",
    ...overrides,
  };
}

describe("composeFolderMdCodeblockContent (step_02)", () => {
  it("composes minimal codeblock when no existing file (EC-17 default state)", () => {
    const out = composeFolderMdCodeblockContent(null, defaultState());
    expect(out).toContain("```select");
    expect(out).toContain("path: ./");
    expect(out).toContain("display: cards");
    expect(out).toContain("sort: name-asc");
    expect(out).toContain("preview-pane: true");
    expect(out).toContain("```");
    // No frontmatter on a fresh write.
    expect(out.startsWith("---")).toBe(false);
  });

  it("strips legacy `layout:` from frontmatter (EC-8)", () => {
    const out = composeFolderMdCodeblockContent(
      "---\nlayout: cards\n---\n",
      defaultState(),
    );
    expect(out).not.toContain("layout: cards");
    // No frontmatter survives when nothing besides folder-view keys existed.
    expect(out.startsWith("---")).toBe(false);
    expect(out).toContain("```select");
  });

  it("preserves non-folder-view frontmatter keys (EC-19)", () => {
    const out = composeFolderMdCodeblockContent(
      "---\nlayout: cards\nicon: book\n---\n",
      defaultState(),
    );
    expect(out).toContain("icon: book");
    expect(out).not.toContain("layout: cards");
    expect(out).toContain("```select");
  });

  it("strips legacy `type: collection` (EC-20)", () => {
    const out = composeFolderMdCodeblockContent(
      "---\ntype: collection\n---\n",
      defaultState({ display: "collection-home" } as Partial<SelectFormState>),
    );
    expect(out).not.toContain("type: collection");
    expect(out).toContain("display: collection-home");
  });

  it("strips all folder-view-config keys at once (AD-5 pin)", () => {
    const input = [
      "---",
      "layout: cards",
      "sort: modified-desc",
      "show-tags: true",
      "card-width: 240",
      "icon: book",
      "---",
      "",
    ].join("\n");
    const out = composeFolderMdCodeblockContent(input, defaultState());
    // Only the icon survives.
    expect(out).toContain("icon: book");
    expect(out).not.toContain("layout: cards");
    expect(out).not.toContain("sort: modified-desc");
    expect(out).not.toContain("show-tags: true");
    expect(out).not.toContain("card-width: 240");
  });

  it("emits `content-width:` only when non-default", () => {
    const outNormal = composeFolderMdCodeblockContent(null, defaultState({ contentWidth: "normal" }));
    expect(outNormal).not.toContain("content-width:");

    const outWide = composeFolderMdCodeblockContent(null, defaultState({ contentWidth: "wide" }));
    expect(outWide).toContain("content-width: wide");

    const outFull = composeFolderMdCodeblockContent(null, defaultState({ contentWidth: "full" }));
    expect(outFull).toContain("content-width: full");
  });

  it("emits `where:` rules in the existing select-fence shape", () => {
    const state = defaultState({
      rules: [
        { type: "tag", operator: "is", value: "book" },
        { type: "extension", operator: "is", value: ".md" },
      ] as unknown as SelectFormState["rules"],
    });
    const out = composeFolderMdCodeblockContent(null, state);
    expect(out).toContain("where:");
    // The rule serialiser emits `- type: ...` / `  operator: ...` / `  value: ...`
    expect(out).toContain("- type: tag");
    expect(out).toContain("operator: is");
    expect(out).toContain("value: book");
    expect(out).toContain("- type: extension");
  });

  it("empty frontmatter after stripping → frontmatter block removed entirely", () => {
    const out = composeFolderMdCodeblockContent(
      "---\nlayout: cards\n---\n",
      defaultState(),
    );
    expect(out.startsWith("---")).toBe(false);
    expect(out).toContain("```select");
  });

  it("existing body content after frontmatter is preserved BELOW the codeblock", () => {
    const input = [
      "---",
      "layout: cards",
      "---",
      "# My Notes",
      "",
      "Some text.",
      "",
    ].join("\n");
    const out = composeFolderMdCodeblockContent(input, defaultState());
    expect(out).toContain("```select");
    expect(out).toContain("# My Notes");
    expect(out).toContain("Some text.");
    // The codeblock sits ABOVE retained body content for easy re-read.
    expect(out.indexOf("```select")).toBeLessThan(out.indexOf("# My Notes"));
  });

  it("existing select codeblock in body is replaced, not duplicated", () => {
    const input = [
      "---",
      "layout: cards",
      "---",
      "",
      "```select",
      "display: kanban",
      "```",
      "",
    ].join("\n");
    const out = composeFolderMdCodeblockContent(input, defaultState());
    // Exactly one occurrence of the opening fence (counted by line).
    const fenceCount = out.split("\n").filter(l => l.trim().startsWith("```select")).length;
    expect(fenceCount).toBe(1);
    // The new fence carries the new display (cards), not the old one (kanban).
    expect(out).toContain("display: cards");
    expect(out).not.toContain("display: kanban");
  });

  it("FOLDER_VIEW_CONFIG_KEYS includes the AD-5 locked list", () => {
    const required = [
      "layout", "sort", "show-modified", "show-extensions", "show-tags",
      "show-count", "preview-pane", "preview-height", "content-width",
      "card-width", "layout-mode", "aspect-ratio", "fit", "min-height",
      "max-height", "show-name", "show-folders", "show-files",
      "folders-title", "files-title", "content-area-override",
      "extra-fields", "fields", "exclude", "kanban-field", "kanban-order",
      "order", "group-by", "where", "cover", "type",
    ];
    for (const key of required) {
      expect(FOLDER_VIEW_CONFIG_KEYS).toContain(key);
    }
  });
});

describe("writeFolderMdCodeblock — atomic single write (step_02)", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let readSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    readSpy = vi.spyOn(bridge, "readFile");
  });

  afterEach(() => {
    writeSpy.mockRestore();
    readSpy.mockRestore();
  });

  it("calls bridge.writeFile exactly once on fresh create", async () => {
    readSpy.mockResolvedValue({ ok: false, error: { kind: "NotFound", message: "" } } as never);
    const res = await writeFolderMdCodeblock("/vault/Projects", defaultState());
    expect(res.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    // The path includes _folder.md.
    expect(writeSpy.mock.calls[0]?.[0]).toMatch(/_folder\.md$/);
  });

  it("calls bridge.writeFile exactly once on migration", async () => {
    readSpy.mockResolvedValue({ ok: true, value: "---\nlayout: cards\nicon: book\n---\n" } as never);
    const res = await writeFolderMdCodeblock("/vault/Projects", defaultState());
    expect(res.ok).toBe(true);
    // FR-61: one atomic write, not two.
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const content = writeSpy.mock.calls[0]?.[1];
    expect(content).toContain("icon: book");
    expect(content).not.toContain("layout: cards");
    expect(content).toContain("```select");
  });
});
