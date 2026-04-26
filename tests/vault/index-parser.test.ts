/**
 * tests/vault/index-parser.test.ts
 *
 * Unit tests for the pure functions exported by src/lib/index-parser.ts:
 *  - parseFrontMatter
 *  - extractWikiLinks
 *  - isStale
 *  - applyIndexUpdate
 *
 * All functions are pure (no side effects, no Tauri dependencies) so no mocking
 * of Tauri APIs is required here. The only external import is WIKI_LINK_RE from
 * backlinks.plugin.ts — that module exports a pure regex, no Tauri usage.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks required by transitive imports ─────────────────────────────────────
// index-parser imports WIKI_LINK_RE from backlinks.plugin.ts, which in turn
// imports from @tauri-apps/api/core in some paths. We mock those here.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));

import {
  parseFrontMatter,
  extractWikiLinks,
  isStale,
  applyIndexUpdate,
} from "../../src/lib/index-parser";
import type { VaultIndex, VaultIndexEntry } from "../../src/lib/vault-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal VaultIndex for testing. */
function makeIndex(vaultId: string, entryPaths: string[] = []): VaultIndex {
  return {
    vaultId,
    builtAt: 1000,
    entries: entryPaths.map((p) => makeEntry(p)),
    totalFilesFound: entryPaths.length,
    skippedCount: 0,
    capped: false,
  };
}

/** Build a minimal VaultIndexEntry. */
function makeEntry(path: string, modified = 1000): VaultIndexEntry {
  return {
    path,
    name: path.split("/").pop()?.replace(/\.md$/, "") ?? "note",
    modified,
    size: 100,
    title: "Test Note",
    tags: [],
    outboundLinks: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseFrontMatter
// ─────────────────────────────────────────────────────────────────────────────

describe("parseFrontMatter", () => {
  it("extracts title from front matter", () => {
    const content = "---\ntitle: My Document\n---\n";
    const { title } = parseFrontMatter(content);
    expect(title).toBe("My Document");
  });

  it("extracts tags as inline array", () => {
    const content = "---\ntags: [rust, code, typescript]\n---\n";
    const { tags } = parseFrontMatter(content);
    expect(tags).toEqual(["rust", "code", "typescript"]);
  });

  it("extracts tags as block sequence", () => {
    const content = "---\ntags:\n  - alpha\n  - beta\n  - gamma\n---\n";
    const { tags } = parseFrontMatter(content);
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("no front matter → title null, tags empty", () => {
    const content = "# Just a heading\nsome content";
    const { title, tags } = parseFrontMatter(content);
    expect(title).toBe("Just a heading");
    expect(tags).toEqual([]);
  });

  it("malformed YAML → graceful fallback, no throw (EC-40)", () => {
    const content = "---\nthis: is: not: valid: yaml: :\n---\n";
    expect(() => parseFrontMatter(content)).not.toThrow();
  });

  it("empty front matter → title falls back to H1", () => {
    const content = "---\n---\n# Heading Here\n";
    const { title } = parseFrontMatter(content);
    expect(title).toBe("Heading Here");
  });

  it("empty content → title null, tags empty", () => {
    const { title, tags } = parseFrontMatter("");
    expect(title).toBeNull();
    expect(tags).toEqual([]);
  });

  it("title with surrounding quotes strips them", () => {
    const content = '---\ntitle: "Quoted Title"\n---\n';
    const { title } = parseFrontMatter(content);
    expect(title).toBe("Quoted Title");
  });

  it("title with single quotes strips them", () => {
    const content = "---\ntitle: 'Single Quoted'\n---\n";
    const { title } = parseFrontMatter(content);
    expect(title).toBe("Single Quoted");
  });

  it("H1 extraction from content when no front matter", () => {
    const content = "Some text\n# Main Heading\nmore text";
    const { title } = parseFrontMatter(content);
    expect(title).toBe("Main Heading");
  });

  it("front matter title takes priority over H1", () => {
    const content = "---\ntitle: FM Title\n---\n# H1 Title\n";
    const { title } = parseFrontMatter(content);
    expect(title).toBe("FM Title");
  });

  it("4KB limit: front matter beyond 4096 chars is not parsed", () => {
    // Put front matter after 4KB of padding — should not be extracted.
    const padding = "x".repeat(4097);
    const content = `# H1 Heading\n${padding}\n---\ntitle: Hidden\n---\n`;
    const { title } = parseFrontMatter(content);
    // Should fall back to H1, not the front matter title buried past 4KB.
    expect(title).toBe("H1 Heading");
  });

  it("unclosed front matter reads to EOF without throwing", () => {
    const content = "---\ntitle: Unclosed\n";
    expect(() => parseFrontMatter(content)).not.toThrow();
    const { title } = parseFrontMatter(content);
    expect(title).toBe("Unclosed");
  });

  it("inline tags with spaces are trimmed", () => {
    const content = "---\ntags: [ a , b , c ]\n---\n";
    const { tags } = parseFrontMatter(content);
    expect(tags).toEqual(["a", "b", "c"]);
  });

  it("block sequence tags with quoted values", () => {
    const content = "---\ntags:\n  - 'tag one'\n  - \"tag two\"\n---\n";
    const { tags } = parseFrontMatter(content);
    expect(tags).toEqual(["tag one", "tag two"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractWikiLinks
// ─────────────────────────────────────────────────────────────────────────────

describe("extractWikiLinks", () => {
  it("standard [[link]] → returns ['link']", () => {
    const links = extractWikiLinks("See [[note-a]] for details.");
    expect(links).toEqual(["note-a"]);
  });

  it("piped [[link|text]] → returns ['link']", () => {
    const links = extractWikiLinks("See [[target|display text]].");
    expect(links).toEqual(["target"]);
  });

  it("[[link]] inside code fence → still extracted (fence filtering is CM6's job)", () => {
    const content = "```\n[[inside-fence]]\n```\n[[outside]]";
    const links = extractWikiLinks(content);
    expect(links).toContain("inside-fence");
    expect(links).toContain("outside");
  });

  it("empty string → returns []", () => {
    expect(extractWikiLinks("")).toEqual([]);
  });

  it("no wiki-links → returns []", () => {
    expect(extractWikiLinks("Just plain text.")).toEqual([]);
  });

  it("multiple wiki-links on one line", () => {
    const links = extractWikiLinks("[[a]] and [[b]] and [[c]]");
    const sorted = [...links].sort();
    expect(sorted).toEqual(["a", "b", "c"]);
  });

  it("duplicate wiki-links are deduplicated", () => {
    const links = extractWikiLinks("[[foo]] and [[foo]] again.");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("foo");
  });

  it("self-link [[self]] is included", () => {
    const links = extractWikiLinks("I link to [[self]].");
    expect(links).toContain("self");
  });

  it("wiki-link with path [[folder/note]] returns the full path", () => {
    const links = extractWikiLinks("See [[folder/note|My Note]].");
    expect(links).toContain("folder/note");
  });

  it("wiki-link with pipe returns only the stem (not the display text)", () => {
    const links = extractWikiLinks("[[stem|This is display text]]");
    expect(links).toContain("stem");
    expect(links).not.toContain("This is display text");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isStale
// ─────────────────────────────────────────────────────────────────────────────

describe("isStale", () => {
  it("entry.modified < currentModified → true (file changed)", () => {
    const entry = makeEntry("/note.md", 1000);
    expect(isStale(entry, 2000)).toBe(true);
  });

  it("entry.modified === currentModified → false (no change)", () => {
    const entry = makeEntry("/note.md", 1000);
    expect(isStale(entry, 1000)).toBe(false);
  });

  it("entry.modified > currentModified → false (clock skew — treat as fresh)", () => {
    const entry = makeEntry("/note.md", 2000);
    expect(isStale(entry, 1000)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyIndexUpdate
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIndexUpdate", () => {
  const VAULT_ID = "test-vault";

  it('"created" event adds new entry', () => {
    const index = makeIndex(VAULT_ID, ["/a.md"]);
    const newEntry = makeEntry("/b.md");
    const updated = applyIndexUpdate(
      index,
      { vaultId: VAULT_ID, eventType: "created", path: "/b.md" },
      newEntry
    );
    expect(updated.entries).toHaveLength(2);
    expect(updated.entries.find((e) => e.path === "/b.md")).toBeDefined();
  });

  it('"created" event without updatedEntry is a no-op', () => {
    const index = makeIndex(VAULT_ID, ["/a.md"]);
    const updated = applyIndexUpdate(index, {
      vaultId: VAULT_ID,
      eventType: "created",
      path: "/b.md",
    });
    expect(updated.entries).toHaveLength(1);
  });

  it('"deleted" event removes entry', () => {
    const index = makeIndex(VAULT_ID, ["/a.md", "/b.md"]);
    const updated = applyIndexUpdate(index, {
      vaultId: VAULT_ID,
      eventType: "deleted",
      path: "/a.md",
    });
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries.find((e) => e.path === "/a.md")).toBeUndefined();
  });

  it('"modified" event replaces entry', () => {
    const index = makeIndex(VAULT_ID, ["/a.md"]);
    const updatedEntry: VaultIndexEntry = { ...makeEntry("/a.md"), title: "New Title" };
    const updated = applyIndexUpdate(
      index,
      { vaultId: VAULT_ID, eventType: "modified", path: "/a.md" },
      updatedEntry
    );
    expect(updated.entries[0].title).toBe("New Title");
  });

  it('"renamed" event replaces path key', () => {
    const index = makeIndex(VAULT_ID, ["/old.md"]);
    const renamedEntry = makeEntry("/new.md");
    const updated = applyIndexUpdate(
      index,
      { vaultId: VAULT_ID, eventType: "renamed", path: "/old.md", newPath: "/new.md" },
      renamedEntry
    );
    expect(updated.entries.find((e) => e.path === "/new.md")).toBeDefined();
    expect(updated.entries.find((e) => e.path === "/old.md")).toBeUndefined();
  });

  it('"renamed" event without updatedEntry patches the path', () => {
    const index = makeIndex(VAULT_ID, ["/old.md"]);
    const updated = applyIndexUpdate(index, {
      vaultId: VAULT_ID,
      eventType: "renamed",
      path: "/old.md",
      newPath: "/new.md",
    });
    expect(updated.entries[0].path).toBe("/new.md");
    expect(updated.entries[0].name).toBe("new");
  });

  it("event for different vaultId throws", () => {
    const index = makeIndex("vault-a");
    expect(() =>
      applyIndexUpdate(
        index,
        { vaultId: "vault-b", eventType: "deleted", path: "/x.md" }
      )
    ).toThrow();
  });

  it("applyIndexUpdate returns a NEW object (immutable update)", () => {
    const index = makeIndex(VAULT_ID, ["/a.md"]);
    const updated = applyIndexUpdate(
      index,
      { vaultId: VAULT_ID, eventType: "deleted", path: "/a.md" }
    );
    expect(updated).not.toBe(index);
    expect(index.entries).toHaveLength(1); // original unchanged
  });
});
