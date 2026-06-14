/**
 * tests/folder-icons/store.test.ts — step_03
 *
 * Asserts the YAML store layer for `_folder.md icon:` mutations:
 *   - readFolderIcon — returns undefined on absent file, empty value, malformed
 *     frontmatter, or missing key (EC-1, EC-2, EC-5, EC-11).
 *   - setFolderIcon — creates the file when absent (EC-6), preserves unrelated
 *     keys + body (EC-8), removes the key cleanly (EC-7), overwrites malformed
 *     frontmatter with a fresh block (EC-11), and round-trips path-shaped values
 *     with spaces/unicode/colons (EC-22).
 *   - folderMdPath — strips trailing slashes.
 *
 * Bridge calls are mocked with an in-memory file map. The store layer never
 * calls Tauri directly — the test would catch a regression there.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  readFolderIcon,
  setFolderIcon,
  folderMdPath,
} from "../../src/plugins/file-browser/folder-icon-store";

/**
 * Test helper: stub readFile / writeFile to operate on a Map<path, content>.
 * Returns the underlying map so tests can assert post-write state.
 */
function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) {
      return { ok: true as const, value: fs.get(path)! };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(
    async (path: string, content: string) => {
      fs.set(path, content);
      return { ok: true as const, value: undefined };
    },
  );
  return fs;
}

describe("folder-icon-store: folderMdPath (step_03)", () => {
  it("strips a single trailing slash", () => {
    expect(folderMdPath("/v/A/")).toBe("/v/A/_folder.md");
  });

  it("appends _folder.md to a slashless folder path", () => {
    expect(folderMdPath("/v/A")).toBe("/v/A/_folder.md");
  });
});

describe("folder-icon-store: readFolderIcon (step_03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("EC-2 — returns undefined when _folder.md has no icon: field", async () => {
    withFs({ "/v/A/_folder.md": "---\nlayout: bookshelf\n---\nbody\n" });
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("EC-1/EC-6 — returns undefined when _folder.md does not exist", async () => {
    withFs({});
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("EC-5 — returns undefined when icon: is an empty string", async () => {
    withFs({ "/v/A/_folder.md": "---\nicon: \n---\n" });
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("returns the catalog iconId when set", async () => {
    withFs({ "/v/A/_folder.md": "---\nicon: book\n---\n" });
    expect(await readFolderIcon("/v/A")).toBe("book");
  });

  it("EC-11 — returns undefined when frontmatter is malformed (no closing ---)", async () => {
    withFs({
      "/v/A/_folder.md": "---\nicon: book\nlayout: bookshelf\n",
    });
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("strips surrounding double-quotes from quoted values", async () => {
    withFs({ "/v/A/_folder.md": '---\nicon: "book"\n---\n' });
    expect(await readFolderIcon("/v/A")).toBe("book");
  });
});

describe("folder-icon-store: setFolderIcon (step_03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("EC-6 — creates _folder.md with only the icon key when file is absent", async () => {
    const fs = withFs({});
    const r = await setFolderIcon("/v/A", "book");
    expect(r.ok).toBe(true);
    expect(fs.get("/v/A/_folder.md")).toBe("---\nicon: book\n---\n");
  });

  it("EC-8 — upsert preserves unrelated frontmatter keys and body", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nlayout: bookshelf\nsort: name-asc\n---\nthe body\n",
    });
    await setFolderIcon("/v/A", "lightbulb");
    const after = fs.get("/v/A/_folder.md")!;
    expect(after).toContain("layout: bookshelf");
    expect(after).toContain("sort: name-asc");
    expect(after).toContain("icon: lightbulb");
    expect(after).toContain("the body");
  });

  it("EC-7 — removing the icon deletes the icon: line cleanly", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nlayout: bookshelf\nicon: book\n---\nbody\n",
    });
    await setFolderIcon("/v/A", undefined);
    const after = fs.get("/v/A/_folder.md")!;
    expect(after).not.toMatch(/^icon:/m);
    expect(after).toContain("layout: bookshelf");
    expect(after).toContain("body");
  });

  it("EC-7 — removing the only key drops the frontmatter block entirely", async () => {
    // reconstructFile() collapses empty-frontmatter wrappers to body-only.
    // The body-only form contains no `icon:` line.
    const fs = withFs({ "/v/A/_folder.md": "---\nicon: book\n---\n" });
    await setFolderIcon("/v/A", undefined);
    const after = fs.get("/v/A/_folder.md")!;
    expect(after.includes("icon:")).toBe(false);
  });

  it("EC-11 — malformed frontmatter is overwritten with a fresh block", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nicon: book\n(no closing delim)\nstray body line\n",
    });
    const r = await setFolderIcon("/v/A", "lightbulb");
    expect(r.ok).toBe(true);
    const after = fs.get("/v/A/_folder.md")!;
    expect(after.startsWith("---\nicon: lightbulb\n---\n")).toBe(true);
  });

  it("EC-10 — two sequential calls do not corrupt the file (store is atomic per call)", async () => {
    const fs = withFs({});
    await setFolderIcon("/v/A", "book");
    await setFolderIcon("/v/A", "lightbulb");
    expect(fs.get("/v/A/_folder.md")).toBe("---\nicon: lightbulb\n---\n");
  });

  it("EC-22 — absolute SVG path with spaces and unicode round-trips", async () => {
    const fs = withFs({});
    const path = "/Users/dave/My Icons/café.svg";
    const r = await setFolderIcon("/v/A", path);
    expect(r.ok).toBe(true);
    const back = await readFolderIcon("/v/A");
    expect(back).toBe(path);
    const written = fs.get("/v/A/_folder.md")!;
    expect(written).toContain("icon:");
    expect(written).toContain("café.svg");
  });

  it("EC-22 — path containing a colon is written safely and round-trips", async () => {
    const fs = withFs({});
    // Filenames with `:` (e.g. iCloud-mirrored) require YAML quoting because
    // `:` is a key/value delimiter.
    const path = "/Users/dave/Icons/2026-06-05: review.svg";
    await setFolderIcon("/v/A", path);
    expect(await readFolderIcon("/v/A")).toBe(path);
    // sanity check
    expect(fs.has("/v/A/_folder.md")).toBe(true);
  });
});
