---
title: "Step 03 — YAML Store (read / set / remove icon)"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 03 — YAML Store (read / set / remove icon)

## Goal

Implement the read/write contract for the `icon` field in
`_folder.md`, atomically and **without clobbering other frontmatter
fields** (EC-8). The store layer is independent of the modal UI and
the tree renderer; it speaks only to bridge.ts.

**Amendment 2026-06-05.** The store remains the same shape but now
treats `iconValue` as an **opaque string** — it can be either a
catalog iconId (`book`, `lightbulb`) or an absolute path to a custom
SVG file (`/Users/dave/glyphs/notion.svg`). The store does **not**
validate which kind it is; that's the resolver's job (step_01) and
the picker's job (step_06). The store's sole concern is YAML
round-trip safety, including:
- Paths with spaces / unicode (EC-22) must round-trip byte-identical
  through the YAML writer. The writer **must quote** path-shaped
  values (those containing `/`, `\`, spaces, `:`, or any
  YAML-special character) to prevent ambiguous parsing.

## Inputs

- Requirements: FR-1, FR-2, FR-9, FR-11, EC-6, EC-7, EC-8, EC-10,
  EC-11, EC-22, NFR-4 (atomic writes), and FR-12 (the store stores
  whatever the resolver-aware caller passes in).
- Constraint: C-3 (do not fork the parser), C-5 (reuse temp-file-swap
  via existing `write_file`), C-4 (no raw `invoke`).
- Reuse: `yaml-frontmatter.ts` (`parseYamlFrontmatter`, `applyYamlKey`,
  `removeYamlKey`, `reconstructFile`).

## Files

| Action | File |
|---|---|
| Create | `src/plugins/file-browser/folder-icon-store.ts` |
| Create | `tests/folder-icons/store.test.ts` |

## API Contract

```typescript
// src/plugins/file-browser/folder-icon-store.ts
import { readFile, writeFile } from "../../lib/bridge";
import {
  parseYamlFrontmatter,
  applyYamlKey,
  removeYamlKey,
  reconstructFile,
} from "./folder-view/yaml-frontmatter";
import type { FileResult } from "../../lib/errors";

const FOLDER_MD_NAME = "_folder.md";

/**
 * Compute the absolute path of a folder's _folder.md sidecar.
 */
export function folderMdPath(folderPath: string): string {
  // POSIX-style join — matches the rest of the file browser.
  return folderPath.replace(/\/+$/, "") + "/" + FOLDER_MD_NAME;
}

/**
 * Read the `icon:` value from a folder's _folder.md, or undefined if:
 *   - the file does not exist
 *   - the file has no frontmatter
 *   - the frontmatter is malformed
 *   - the `icon` key is absent or empty
 *
 * Never throws. Errors are silenced (EC-2, EC-11).
 */
export async function readFolderIcon(
  folderPath: string,
): Promise<string | undefined> {
  const result = await readFile(folderMdPath(folderPath));
  if (!result.ok) return undefined;

  const parsed = parseYamlFrontmatter(result.value);
  if (!parsed.hasFrontmatter || parsed.malformed) return undefined;

  for (const line of parsed.frontmatterLines) {
    // Match `icon:` followed by space or tab; tolerate quoted/unquoted values.
    if (line.startsWith("icon: ") || line.startsWith("icon:\t") || line === "icon:") {
      const raw = line.slice("icon:".length).trim();
      if (!raw) return undefined;
      // Strip surrounding double-quotes if present (mirror writer's quoting).
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        return raw.slice(1, -1).replace(/\\"/g, '"');
      }
      return raw;
    }
  }
  return undefined;
}

/**
 * Set or remove the `icon:` field in a folder's _folder.md.
 *
 * iconValue === undefined  → remove the key (EC-7). Other frontmatter
 *                            keys and the body are preserved verbatim.
 * iconValue === string     → upsert the key. The value is opaque to
 *                            this layer — may be a catalog iconId or
 *                            an absolute SVG path (FR-12). Path-shaped
 *                            values (containing `/`, `\`, space, `:`,
 *                            or other YAML-special chars) MUST be
 *                            written quoted; catalog iconIds (pure
 *                            kebab-case slugs) are written unquoted.
 *                            `applyYamlKey()` handles quoting if it
 *                            already detects YAML-special chars; if
 *                            not, this function wraps the value in
 *                            double-quotes before calling. Verify
 *                            during implementation. If _folder.md
 *                            does not exist, it is created with only
 *                            the icon field in frontmatter and an
 *                            empty body (EC-6).
 *
 * Writes are atomic (temp-file-swap, via the existing write_file
 * Tauri command).
 *
 * Returns FileResult so callers can surface bridge errors. EC-11
 * (malformed YAML) is treated as "no frontmatter": the writer creates
 * a fresh, well-formed frontmatter block with just the icon key,
 * overwriting the malformed block. Body lines are preserved when
 * recoverable; if the parser flagged the file as malformed, the body
 * lines returned by parseYamlFrontmatter are everything after the
 * (missing) closing delimiter — preserve them as best-effort.
 */
export async function setFolderIcon(
  folderPath: string,
  iconValue: string | undefined,
): Promise<FileResult<void>> {
  const path = folderMdPath(folderPath);

  // Read existing content; tolerate ENOENT (EC-6).
  const readResult = await readFile(path);
  const existingContent = readResult.ok ? readResult.value : "";

  // Parse into frontmatter + body. parseYamlFrontmatter handles all
  // three cases: well-formed, malformed (no closing delim), no
  // frontmatter at all.
  const parsed = parseYamlFrontmatter(existingContent);

  // Normalize to a "hasFrontmatter" structure we can write back.
  let frontmatterLines = parsed.hasFrontmatter ? parsed.frontmatterLines : [];
  let bodyLines = parsed.bodyLines;

  // EC-11: when malformed (opening --- but no closing ---), parsed
  // returns hasFrontmatter=false and bodyLines = all lines. We reset
  // to an empty frontmatter + empty body so the rewrite is clean.
  if (parsed.malformed) {
    frontmatterLines = [];
    bodyLines = [""]; // single empty line = empty body after reconstruct
  }

  if (iconValue === undefined) {
    frontmatterLines = removeYamlKey(frontmatterLines, "icon");
  } else {
    frontmatterLines = applyYamlKey(frontmatterLines, "icon", iconValue);
  }

  // Reconstruct. If frontmatter is now empty AND there were no
  // pre-existing frontmatter or body, write an empty string rather
  // than a stray "\n".
  const newContent = reconstructFile({
    hasFrontmatter: frontmatterLines.length > 0,
    frontmatterLines,
    bodyLines,
  });

  return writeFile(path, newContent);
}

/**
 * Build a Map<folderPath, iconId> by scanning a list of _folder.md
 * absolute paths. **This wrapper delegates the heavy I/O to the Rust
 * command introduced in step_04** and exists here as the TS-facing
 * surface so callers don't reach into bridge.ts directly.
 *
 * Returns an empty Map if the bridge call fails (renderer falls back
 * to generic folder-icon on every node — NFR-1 safe).
 */
export async function buildFolderIconMap(
  folderMdPaths: string[],
): Promise<Map<string, string>> {
  // Implementation deferred to step_04 + step_05 wiring. This stub
  // exists so step_03 can ship without a forward-reference. step_05
  // replaces the stub body.
  if (folderMdPaths.length === 0) return new Map();
  return new Map();
}
```

> **Why a stub `buildFolderIconMap` here?** The store module owns the
> reading-from-disk contract. Step 04 adds the Rust command; step 05
> wires the real implementation into this stub. Keeping the stub in
> step 03 lets the store's public surface stabilise without a
> forward-reference, and step 05's diff is then a single function body.

## Failing tests (write FIRST — Red)

```typescript
// tests/folder-icons/store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  readFolderIcon,
  setFolderIcon,
  folderMdPath,
} from "../../src/plugins/file-browser/folder-icon-store";

// Helper: stub readFile / writeFile to act on an in-memory map.
function withFs(initial: Record<string, string>) {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) return { ok: true, value: fs.get(path)! };
    return { ok: false, error: { message: "ENOENT", command: "read_file", path } } as any;
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(async (path: string, content: string) => {
    fs.set(path, content);
    return { ok: true, value: undefined };
  });
  return fs;
}

describe("folder-icon-store: readFolderIcon (step_03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("EC-2 — returns undefined when _folder.md has no icon field", async () => {
    withFs({ "/v/A/_folder.md": "---\nlayout: bookshelf\n---\nbody\n" });
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("EC-1/EC-6 — returns undefined when _folder.md does not exist", async () => {
    withFs({});
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("EC-5 — returns undefined when icon is empty string", async () => {
    withFs({ "/v/A/_folder.md": "---\nicon: \n---\n" });
    expect(await readFolderIcon("/v/A")).toBeUndefined();
  });

  it("returns iconId when set", async () => {
    withFs({ "/v/A/_folder.md": "---\nicon: book\n---\n" });
    expect(await readFolderIcon("/v/A")).toBe("book");
  });

  it("EC-11 — returns undefined on malformed frontmatter", async () => {
    withFs({ "/v/A/_folder.md": "---\nicon: book\nlayout: bookshelf\n" }); // no closing ---
    expect(await readFolderIcon("/v/A")).toBeUndefined();
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
      "/v/A/_folder.md": "---\nlayout: bookshelf\nsort: name-asc\n---\nthe body\n",
    });
    await setFolderIcon("/v/A", "lightbulb");
    const after = fs.get("/v/A/_folder.md")!;
    expect(after).toContain("layout: bookshelf");
    expect(after).toContain("sort: name-asc");
    expect(after).toContain("icon: lightbulb");
    expect(after).toContain("the body");
  });

  it("EC-7 — removing icon deletes the icon line cleanly", async () => {
    const fs = withFs({
      "/v/A/_folder.md": "---\nlayout: bookshelf\nicon: book\n---\nbody\n",
    });
    await setFolderIcon("/v/A", undefined);
    const after = fs.get("/v/A/_folder.md")!;
    expect(after).not.toMatch(/^icon:/m);
    expect(after).toContain("layout: bookshelf");
    expect(after).toContain("body");
  });

  it("EC-7 — removing the only key leaves a file with no frontmatter and empty body intact", async () => {
    const fs = withFs({
      "/v/A/_folder.md": "---\nicon: book\n---\n",
    });
    await setFolderIcon("/v/A", undefined);
    // reconstructFile drops empty-frontmatter wrappers (EC-23 of the
    // yaml-frontmatter contract). Resulting file is body-only / empty.
    const after = fs.get("/v/A/_folder.md")!;
    expect(after.includes("icon:")).toBe(false);
  });

  it("EC-11 — malformed frontmatter is overwritten with a fresh block", async () => {
    const fs = withFs({
      "/v/A/_folder.md": "---\nicon: book\n(no closing delim)\nstray body line\n",
    });
    const r = await setFolderIcon("/v/A", "lightbulb");
    expect(r.ok).toBe(true);
    const after = fs.get("/v/A/_folder.md")!;
    expect(after.startsWith("---\nicon: lightbulb\n---\n")).toBe(true);
  });

  it("EC-10 — two sequential calls do not corrupt the file (single-writer ordering at picker layer; store is atomic per call)", async () => {
    const fs = withFs({});
    await setFolderIcon("/v/A", "book");
    await setFolderIcon("/v/A", "lightbulb");
    expect(fs.get("/v/A/_folder.md")).toBe("---\nicon: lightbulb\n---\n");
  });

  it("folderMdPath strips trailing slashes", () => {
    expect(folderMdPath("/v/A/")).toBe("/v/A/_folder.md");
    expect(folderMdPath("/v/A")).toBe("/v/A/_folder.md");
  });

  it("EC-22 — absolute SVG path with spaces and unicode round-trips", async () => {
    const fs = withFs({});
    const path = "/Users/dave/My Icons/café.svg";
    const r = await setFolderIcon("/v/A", path);
    expect(r.ok).toBe(true);
    // After write, reading back should yield the same path verbatim.
    const back = await readFolderIcon("/v/A");
    expect(back).toBe(path);
    // The file content should quote the value (YAML safety): the
    // written line must contain the quoted form OR an equivalent
    // round-trippable form. Either is acceptable; the round-trip
    // assertion above is the strict invariant.
    const written = fs.get("/v/A/_folder.md")!;
    expect(written).toContain("icon:");
    expect(written).toContain("café.svg");
  });

  it("EC-22 — path containing a colon is written safely and round-trips", async () => {
    const fs = withFs({});
    // Windows-style drive paths can contain `:`; even on macOS users
    // sometimes have `:` in iCloud-mirrored filenames. YAML requires
    // quoting.
    const path = "/Users/dave/Icons/2026-06-05: review.svg";
    await setFolderIcon("/v/A", path);
    expect(await readFolderIcon("/v/A")).toBe(path);
  });
});
```

## Green

Implement `folder-icon-store.ts` exactly as the API contract describes.
All write paths must end at `writeFile()` from `bridge.ts` (which calls
the existing `write_file` Tauri command that uses atomic_write).

## Refactor

- After tests pass, consider extracting the inline "strip surrounding
  quotes" logic into a tiny helper. Optional.
- Confirm by inspection that `setFolderIcon` never calls `invoke`
  directly (C-4) — it only imports `readFile` / `writeFile` from
  bridge.ts.
- Confirm by inspection that no temp-file logic exists in TS — atomicity
  is delegated 100% to the Rust `atomic_write` helper used by
  `write_file`.

## Definition of Done

- [ ] All tests in `tests/folder-icons/store.test.ts` pass.
- [ ] `npm run test:run -- tests/folder-icons/store.test.ts` exits 0.
- [ ] No new Tauri call introduced (only reuse of `readFile` /
      `writeFile`).
- [ ] No raw `invoke()` calls in this module (C-4).
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).
