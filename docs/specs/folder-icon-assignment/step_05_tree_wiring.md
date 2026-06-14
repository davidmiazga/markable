---
title: "Step 05 — Tree Wiring (iconClass per directory node)"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 05 — Tree Wiring (iconClass per directory node)

## Goal

Wire the iconId pipeline into the render path:

1. Real `buildFolderIconMap()` calls the bridge from step_04.
2. `buildTreeFromIndex()` learns an optional `folderIconMap` parameter
   and uses it to set per-directory `iconClass`.
3. `renderTreeContent()` calls `buildFolderIconMap()` once per render,
   awaiting it before constructing the tree.
4. **Amendment 2026-06-05.** Add the custom-SVG post-mount injection
   pass: nodes whose iconValue resolves (per `interpretIconValue()`)
   to `kind: "custom"` have their `.folder-icon-custom` slot filled
   with sanitised inline SVG read from disk. Reads are off the render
   hot path (NFR-2) and cached by `(path, mtimeMs)` (FR-17).

After this step, the tree visibly renders both curated catalog icons
and user-supplied custom SVGs for any folder whose `_folder.md` has
a recognised `icon:` value. The picker is still absent — externally
edited `_folder.md` files are the only way to see the result so far.

## Inputs

- Requirements: FR-4, FR-5, FR-6, FR-10, FR-15, FR-17, NFR-1, NFR-2,
  NFR-3, EC-1, EC-2, EC-3, EC-4, EC-5, EC-12, EC-13, EC-14, EC-16,
  EC-17, EC-23.
- Constraint: C-2 (mirror `getVaultIconClass` shape; default-fallback
  is `"folder-icon"`), C-10 (reuse `stripScripts()`; no DOMPurify),
  C-12 (custom-SVG cache lives in TS, never in `_folder.md`).
- Precedent: `buildFolderViewSet()` is called once per render at line
  1883 of `file-browser.plugin.ts`. We follow the same pattern.

## Files

| Action | File |
|---|---|
| Edit | `src/plugins/file-browser/folder-icon-store.ts` (replace `buildFolderIconMap` stub from step_03 with the real implementation) |
| Edit | `src/plugins/file-browser/file-tree.ts` (re-export `getFolderIconClass`; extend `buildTreeFromIndex` signature) |
| Edit | `src/plugins/file-browser/file-browser.plugin.ts` (await `buildFolderIconMap()` in `renderTreeContent`, thread the result into `buildTreeFromIndex`, **and** add the custom-SVG post-mount injection pass) |
| Create | `src/plugins/file-browser/folder-icon-custom-cache.ts` (in-memory cache + sanitisation pipeline for custom SVGs — `getCustomSvg(path): Promise<string \| null>`) |
| Create | `tests/folder-icons/render.test.ts` |
| Create | `tests/folder-icons/index-flow.test.ts` |
| Create | `tests/folder-icons/custom-render.test.ts` (EC-16 missing path, EC-17 XSS sanitisation, cache hit/miss) |

## Changes

### A. Replace the stub `buildFolderIconMap` in `folder-icon-store.ts`

```typescript
// folder-icon-store.ts
import { readFolderIconMap } from "../../lib/bridge";

/**
 * Build a Map<folderPath, iconId> by batch-reading each _folder.md in
 * `folderMdPaths` via the Rust read_folder_icon_map command.
 *
 * - folderMdPaths: list of absolute _folder.md paths (typically derived
 *   from the existing buildFolderViewSet() result by appending the
 *   filename — see file-browser.plugin.ts hook below).
 * - Returns a Map keyed by the parent folder path (not the _folder.md
 *   path), so the file-tree builder can look up by directory.
 * - Entries whose icon value is null/absent are omitted from the map;
 *   the renderer's default fallback handles them (NFR-1).
 * - On bridge error, returns an empty Map. The render still works
 *   — every directory falls back to "folder-icon".
 */
export async function buildFolderIconMap(
  folderMdPaths: string[],
): Promise<Map<string, string>> {
  if (folderMdPaths.length === 0) return new Map();
  const result = await readFolderIconMap(folderMdPaths);
  if (!result.ok) return new Map();

  const out = new Map<string, string>();
  for (const [folderMd, iconValue] of result.value) {
    if (!iconValue) continue;
    // Strip trailing "/_folder.md" to get the parent directory path.
    const sep = folderMd.lastIndexOf("/_folder.md");
    if (sep <= 0) continue;
    out.set(folderMd.slice(0, sep), iconValue);
  }
  return out;
}
```

### B. Extend `buildTreeFromIndex` in `file-tree.ts`

The function currently has the signature:

```typescript
export function buildTreeFromIndex(
  entries: VaultIndexEntry[],
  rootPaths: string[],
  expandedPaths: Set<string>,
  activeVault: VaultEntry,
  directories: string[],
  smartFolderNodes: TreeNode[],
): TreeNode[]
```

Add a final optional parameter:

```typescript
export function buildTreeFromIndex(
  entries: VaultIndexEntry[],
  rootPaths: string[],
  expandedPaths: Set<string>,
  activeVault: VaultEntry,
  directories: string[],
  smartFolderNodes: TreeNode[],
  folderIconMap?: Map<string, string>,  // NEW
): TreeNode[]
```

Inside `buildSubtree`, the two places that currently set
`iconClass: "folder-icon"` (lines 313 and 344 in the live file) become:

```typescript
iconClass: getFolderIconClass(folderIconMap?.get(currentPath)),
```

Add the import at the top of `file-tree.ts`:

```typescript
import { getFolderIconClass } from "./folder-icons";
export { getFolderIconClass } from "./folder-icons"; // re-export for symmetry
```

> `getFolderIconClass(undefined)` returns the literal `"folder-icon"`,
> so the **default behaviour is byte-identical** to today's. NFR-1.

### C. Hook `renderTreeContent` in `file-browser.plugin.ts`

Find the block (around lines 1880–1895):

```typescript
const folderViewSet = buildFolderViewSet(vaultIndex);
_lastFolderViewSet = folderViewSet;
```

Add immediately after:

```typescript
// Step 05: batch-read the icon: field from every _folder.md once per
// render. NFR-2: no per-node file I/O. The map is keyed by parent
// directory path so buildTreeFromIndex can look up by node.path.
const folderMdPaths: string[] = [];
for (const dir of folderViewSet) folderMdPaths.push(dir + "/_folder.md");
const folderIconMap = await buildFolderIconMap(folderMdPaths);
```

Then update the call:

```typescript
const tree = buildTreeFromIndex(
  allEntries,
  activeVault.rootPaths,
  _expandedPaths,
  activeVault,
  vaultIndex.directories,
  sfNodes,
  folderIconMap,  // NEW
);
```

`renderTreeContent` is already async-callable (it dispatches off
`vault-manager` events). Confirm by reading the surrounding code that
adding `await` here does not break callers (callers that call
`renderTreeContent` synchronously will still observe the prior render
state until the next event tick — that is acceptable per existing UX
norms).

Add the import:

```typescript
import { buildFolderIconMap } from "./folder-icon-store";
import { getCustomSvg, hasReportedMissingPath, markPathReported } from "./folder-icon-custom-cache";
```

### C2. Custom-SVG post-mount injection pass *(amendment 2026-06-05)*

After the tree DOM is mounted, walk the rendered nodes once and inject
inline SVG into any `.folder-icon-custom` slot whose folder-icon value
resolves to `kind: "custom"`. This runs **after** mount, outside the
synchronous render hot path (NFR-2 still holds — file I/O is awaited
between paint frames, not during DOM construction).

```typescript
// In renderTreeContent, after the tree HTML/DOM is mounted:

// Collect (slotEl, rawValue) pairs for every folder whose icon value
// is a custom path. The data-icon-value attribute is set by the tree
// builder for nodes whose iconClass is "folder-icon-custom" — see §B
// amendment below.
const customSlots: Array<{ el: HTMLElement; path: string }> = [];
for (const el of treeRoot.querySelectorAll<HTMLElement>(".folder-icon-custom")) {
  const path = el.dataset.iconPath;
  if (path) customSlots.push({ el, path });
}

// Resolve each custom SVG via the cache. Misses do disk I/O; hits are
// instant. All reads run concurrently.
await Promise.all(customSlots.map(async ({ el, path }) => {
  const sanitized = await getCustomSvg(path);
  if (sanitized) {
    // Replace the slot's contents with the sanitised inline SVG.
    el.innerHTML = sanitized;
    return;
  }
  // EC-16: path missing or unreadable. Fall back to generic glyph.
  el.classList.remove("folder-icon-custom");
  el.classList.add("folder-icon");
  el.innerHTML = ""; // _iconSet.folder() (or equivalent) re-injects on next render
  if (!hasReportedMissingPath(path)) {
    markPathReported(path);
    showToast(`Custom icon not found: ${path}. Reverting to default.`);
  }
}));
```

The `data-icon-path` attribute is set by `buildTreeFromIndex` (step §B
amendment): when a directory node's iconValue resolves to
`kind: "custom"`, the tree node carries both `iconClass:
"folder-icon-custom"` and a sibling string field `iconCustomPath` that
the renderer (`appendIconAndLabel`) attaches to the slot element as a
`data-icon-path` attribute.

### B2. Update `buildTreeFromIndex` to expose the custom path *(amendment)*

Extend the `TreeNode` type with one optional field:

```typescript
export interface TreeNode {
  // ...existing fields...
  iconClass: string;
  /** When iconClass === "folder-icon-custom", the absolute SVG path. */
  iconCustomPath?: string;
}
```

In the two directory-creation sites in `buildSubtree`, replace the
single-line `iconClass: getFolderIconClass(...)` assignment with:

```typescript
const rawValue = folderIconMap?.get(currentPath);
const kind = interpretIconValue(rawValue);
// (assign both fields)
iconClass: kind.cssClass,
iconCustomPath: kind.kind === "custom" ? kind.path : undefined,
```

`appendIconAndLabel` (renderer in `file-browser.plugin.ts`) sets
`el.dataset.iconPath = node.iconCustomPath` when present, so the
post-mount pass can find it via `el.dataset.iconPath`.

### C3. The `folder-icon-custom-cache.ts` module

```typescript
// src/plugins/file-browser/folder-icon-custom-cache.ts
import { readFile } from "../../lib/bridge";
import { statFile } from "../../lib/bridge";  // see step_05 note on stat_file
import { stripScripts } from "./folder-view/shared";

/**
 * Cache entry: keyed by absolute path. Includes the file's mtimeMs at
 * read-time so the cache invalidates on disk mutation.
 */
interface CustomSvgCacheEntry {
  mtimeMs: number;
  sanitizedHtml: string;
}

const cache = new Map<string, CustomSvgCacheEntry>();
const reportedMissing = new Set<string>();

/**
 * Resolve a custom SVG path to a sanitised inline SVG string.
 * Returns null on read error or invalid SVG. Caller is expected to
 * fall back to the generic folder-icon class (EC-16).
 *
 * Sanitisation pipeline (FR-15, C-10):
 *   1. stripScripts() — removes <script> blocks and inline on*="..."
 *      event handlers. Already exists in shared.ts:81.
 *   2. SVG-specific extras (NOT in shared.ts; added here):
 *      a. Strip `javascript:` URL schemes from `href` and `xlink:href`.
 *      b. Remove `<foreignObject>` elements entirely (they can contain
 *         arbitrary HTML which slips past the script regex).
 *   3. The result is stored verbatim — the picker preview uses the
 *      same pipeline so test coverage applies to both.
 *
 * No DOMPurify dependency (C-10).
 */
export async function getCustomSvg(path: string): Promise<string | null> {
  // Read mtime first; if cache hit on (path, mtime), return cached.
  const statResult = await statFile(path);
  if (!statResult.ok) return null;

  const { mtimeMs } = statResult.value;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.sanitizedHtml;

  // Cache miss (or mtime changed) — read + sanitise.
  const readResult = await readFile(path);
  if (!readResult.ok) return null;

  const raw = readResult.value;
  // Validation guard: only proceed if the file looks like SVG. The
  // picker's validator already rejected non-SVG at add-time, but a
  // defensive check is cheap (the file may have been edited externally
  // between add and render).
  if (!/<svg[\s>]/i.test(raw)) return null;

  let sanitised = stripScripts(raw);
  // Strip javascript: schemes (case-insensitive). Catches both `href=`
  // and `xlink:href=` and any other attribute with the URL scheme.
  sanitised = sanitised.replace(/(["'\s])javascript:/gi, "$1");
  // Strip <foreignObject> blocks (HTML escape hatch).
  sanitised = sanitised.replace(
    /<foreignObject\b[\s\S]*?<\/foreignObject>/gi,
    "",
  );

  cache.set(path, { mtimeMs, sanitizedHtml: sanitised });
  return sanitised;
}

export function hasReportedMissingPath(path: string): boolean {
  return reportedMissing.has(path);
}

export function markPathReported(path: string): void {
  reportedMissing.add(path);
}

/** Test helper: clear the cache between specs. Not exported in prod. */
export function __clearCustomSvgCache(): void {
  cache.clear();
  reportedMissing.clear();
}
```

> **Note on `statFile`.** If `src/lib/bridge.ts` does not already
> expose a stat wrapper that returns `mtimeMs`, add it here as part of
> step_05. The simplest option is a thin wrapper over the existing
> Rust `read_file_with_stat` or `stat_file` command (verify which
> exists by grepping `src-tauri/src/commands/`). If neither exists,
> add a minimal `stat_file(path)` command in step_05 (Rust side: ~10
> lines using `std::fs::metadata`). The window-size invariant
> precaution applies to any `src-tauri/src/lib.rs` edit.

### D. Test plan

```typescript
// tests/folder-icons/render.test.ts
import { describe, it, expect } from "vitest";
import {
  buildTreeFromIndex,
  getFolderIconClass,
} from "../../src/plugins/file-browser/file-tree";
import type { VaultEntry, VaultIndexEntry } from "../../src/lib/vault-types";

const vault: VaultEntry = {
  id: "v1", name: "V", rootPaths: ["/v"], created: "", lastOpened: "",
  excludePatterns: [], maxIndexSize: 500,
};

function tree(folderIconMap?: Map<string, string>) {
  const entries: VaultIndexEntry[] = [
    { path: "/v/A/note.md", name: "note", modified: 0, size: 0, title: "n", tags: [], outboundLinks: [] },
    { path: "/v/B/note.md", name: "note", modified: 0, size: 0, title: "n", tags: [], outboundLinks: [] },
  ];
  return buildTreeFromIndex(
    entries, ["/v"], new Set(), vault, ["/v/A", "/v/B"], [], folderIconMap,
  );
}

describe("buildTreeFromIndex with folderIconMap (step_05)", () => {
  it("EC-1 — default fallback when no map provided", () => {
    const t = tree();
    const dirs = t.flatMap(n => n.children).filter(n => n.type === "directory");
    for (const d of dirs) expect(d.iconClass).toBe("folder-icon");
  });

  it("EC-1 / EC-2 — directories missing from the map fall back to 'folder-icon'", () => {
    const t = tree(new Map());
    const dirs = t.flatMap(n => n.children).filter(n => n.type === "directory");
    for (const d of dirs) expect(d.iconClass).toBe("folder-icon");
  });

  it("applies catalog id when present in the map", () => {
    const t = tree(new Map([["/v/A", "book"]]));
    const a = t.flatMap(n => n.children).find(n => n.path === "/v/A")!;
    const b = t.flatMap(n => n.children).find(n => n.path === "/v/B")!;
    expect(a.iconClass).toBe("folder-icon-book");
    expect(b.iconClass).toBe("folder-icon");
  });

  it("EC-3 — unrecognised iconId falls back to 'folder-icon' (silent)", () => {
    const t = tree(new Map([["/v/A", "nonsense"]]));
    const a = t.flatMap(n => n.children).find(n => n.path === "/v/A")!;
    expect(a.iconClass).toBe("folder-icon");
  });

  it("EC-4 — image-path-shaped iconId falls back to 'folder-icon'", () => {
    const t = tree(new Map([["/v/A", "cover.png"]]));
    const a = t.flatMap(n => n.children).find(n => n.path === "/v/A")!;
    expect(a.iconClass).toBe("folder-icon");
  });

  it("EC-5 — does not lookup empty strings (filtered upstream)", () => {
    // The map by contract never stores empty strings — the upstream
    // buildFolderIconMap drops them — so even if a caller passes one,
    // the resolver still falls back.
    const t = tree(new Map([["/v/A", ""]]));
    const a = t.flatMap(n => n.children).find(n => n.path === "/v/A")!;
    expect(a.iconClass).toBe("folder-icon");
  });
});
```

```typescript
// tests/folder-icons/index-flow.test.ts
import { describe, it, expect, vi } from "vitest";
import * as bridge from "../../src/lib/bridge";
import { buildFolderIconMap } from "../../src/plugins/file-browser/folder-icon-store";

describe("buildFolderIconMap propagation (step_05)", () => {
  it("EC-12 — keyed by parent folder path so a renamed folder's new path resolves naturally", async () => {
    // After a Finder rename, the vault index reports the NEW directory
    // path and the NEW _folder.md path. The map keys are the new dir.
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [["/v/NewName/_folder.md", "book"]],
    });
    const map = await buildFolderIconMap(["/v/NewName/_folder.md"]);
    expect(map.get("/v/NewName")).toBe("book");
    expect(map.get("/v/OldName")).toBeUndefined();
  });

  it("EC-13 — moved folder still resolves because the icon lives in the file, not in a path-keyed sidecar", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [["/v/SubA/Moved/_folder.md", "lightbulb"]],
    });
    const map = await buildFolderIconMap(["/v/SubA/Moved/_folder.md"]);
    expect(map.get("/v/SubA/Moved")).toBe("lightbulb");
  });

  it("EC-14 — deleted folder simply absent from the input list, absent from the map", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({ ok: true, value: [] });
    const map = await buildFolderIconMap([]);
    expect(map.size).toBe(0);
  });

  it("bridge failure → empty map (renderer falls back to default for all)", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: false,
      error: { message: "x", command: "read_folder_icon_map" } as any,
    });
    const map = await buildFolderIconMap(["/v/A/_folder.md"]);
    expect(map.size).toBe(0);
  });

  it("null icon values are dropped", async () => {
    vi.spyOn(bridge, "readFolderIconMap").mockResolvedValue({
      ok: true,
      value: [["/v/A/_folder.md", null], ["/v/B/_folder.md", "book"]],
    });
    const map = await buildFolderIconMap(["/v/A/_folder.md", "/v/B/_folder.md"]);
    expect(map.has("/v/A")).toBe(false);
    expect(map.get("/v/B")).toBe("book");
  });
});
```

```typescript
// tests/folder-icons/custom-render.test.ts  (amendment 2026-06-05)
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  getCustomSvg,
  hasReportedMissingPath,
  markPathReported,
  __clearCustomSvgCache,
} from "../../src/plugins/file-browser/folder-icon-custom-cache";

beforeEach(() => {
  __clearCustomSvgCache();
  vi.restoreAllMocks();
});

describe("getCustomSvg — EC-16/EC-17 + cache (step_05)", () => {
  it("EC-16 — returns null when the file is missing", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: false, error: { message: "ENOENT", command: "stat_file" } as any,
    });
    const r = await getCustomSvg("/does/not/exist.svg");
    expect(r).toBeNull();
  });

  it("EC-16 — missing-path toast fires once per path per session", async () => {
    expect(hasReportedMissingPath("/x.svg")).toBe(false);
    markPathReported("/x.svg");
    expect(hasReportedMissingPath("/x.svg")).toBe(true);
  });

  it("EC-17 — strips <script> tags from custom SVG", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("<script");
    expect(r!).toContain("<circle");
  });

  it("EC-17 — strips inline onclick attribute", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle r="5" onclick="alert(1)"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("onclick");
  });

  it("EC-17 — strips javascript: URL schemes", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><a href="javascript:alert(1)"><circle r="5"/></a></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("javascript:");
  });

  it("EC-17 — removes <foreignObject> blocks entirely", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><foreignObject><div onclick="x()">hi</div></foreignObject><circle r="5"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r!.toLowerCase()).not.toContain("<foreignobject");
    expect(r!.toLowerCase()).not.toContain("<div");
    expect(r!).toContain("<circle");
  });

  it("returns null when the file does not look like SVG", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `not an svg`,
    });
    expect(await getCustomSvg("/x.svg")).toBeNull();
  });

  it("FR-17 — cache hit avoids re-reading when mtime is unchanged", async () => {
    const statSpy = vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true, value: { mtimeMs: 1, size: 100 },
    });
    const readSpy = vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true, value: `<svg><circle r="5"/></svg>`,
    });
    await getCustomSvg("/x.svg");
    await getCustomSvg("/x.svg");
    expect(statSpy).toHaveBeenCalledTimes(2); // mtime checked each call
    expect(readSpy).toHaveBeenCalledTimes(1); // body read once
  });

  it("FR-17 — cache invalidates on mtime change", async () => {
    let m = 1;
    vi.spyOn(bridge, "statFile").mockImplementation(async () => ({
      ok: true, value: { mtimeMs: m, size: 100 },
    } as any));
    const readSpy = vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true, value: `<svg><circle r="5"/></svg>`,
    });
    await getCustomSvg("/x.svg");
    m = 2;
    await getCustomSvg("/x.svg");
    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});
```

## Green

1. Write the failing tests above.
2. Update `folder-icon-store.ts` (replace stub).
3. Update `file-tree.ts` (signature + import + the two literal sites).
4. Update `file-browser.plugin.ts` (`await buildFolderIconMap(...)` and
   thread into `buildTreeFromIndex`).
5. Run the focused tests, then the full suite.

## Refactor

- Confirm `buildTreeFromIndex`'s **existing** tests still pass without
  modification — the new parameter is optional and defaults to
  `undefined`, which yields byte-identical iconClass values for every
  legacy callsite.
- Consider moving the `folderMdPaths` construction into a small named
  helper inside `file-browser.plugin.ts` for readability. Optional.

## Manual smoke

- Create a vault folder containing `_folder.md` with `icon: book`.
- Run `npm run tauri dev`.
- Confirm the folder in the tree renders the book glyph.
- Edit `_folder.md` to `icon: nonsense` — folder reverts to generic
  glyph, no console error (debug log only is acceptable).
- Rename the folder in Finder — vault watcher fires, tree re-renders,
  icon assignment travels with the folder (EC-12).

## Definition of Done

- [ ] `tests/folder-icons/render.test.ts` passes.
- [ ] `tests/folder-icons/index-flow.test.ts` passes.
- [ ] All existing `file-tree` tests still pass with no edits required
      (NFR-1 byte-identical default behaviour).
- [ ] `tests/folder-view/tab-sidecar-exclusion.test.ts` and adjacent
      existing folder-view tests still pass.
- [ ] `tests/settings/window-defaults.test.ts` passes.
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).
