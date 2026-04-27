---
title: "Step 01 — Wikilink Autocomplete: Vault-Index Source"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 01 — Wikilink Autocomplete: Vault-Index Source

## Goal

Modify `wikiLinkCompletionSource` inside `buildAutocompleteExtension()` so that when
a vault is active the completion dropdown sources its options from `VaultIndexEntry[]`
rather than `_cachedFileList`. Add `detail` (vault-relative path) and conditional
`info` (title when it differs from name). Remove self-file exclusion from both paths.
Verify pipe-suppression is explicit. Rebuild the plugin IIFE.

## Files Changed

| File | Change |
|------|--------|
| `src/plugins/backlinks/backlinks.plugin.ts` | Modify `buildAutocompleteExtension` |
| `src-tauri/plugins/core/backlinks.js` | Rebuilt bundle (do not edit manually) |
| `tests/plugins/backlinks/backlinks.test.ts` | Add vault-mode autocomplete tests |

## Requirements Coverage

| Requirement | Location |
|-------------|----------|
| FR-A.1 trigger unchanged | `matchBefore(/\[\[([^\]\n]*)/)` — preserved |
| FR-A.2 vault source + detail/info | new vault-mode branch |
| FR-A.2 self-file not excluded | `null` passed as currentFile in both paths |
| FR-A.3 no-vault fallback | existing `_cachedFileList` path, unchanged |
| FR-A.4 insertion | `apply` callback unchanged |
| FR-A.5 pipe suppression | explicit `if (prefix.includes("\|")) return null` |
| FR-A.6 closed link suppression | `getCompletionContext` preserved |
| FR-A.7 works in both preview modes | no change needed — already CM6 state-level |
| FR-A.8 no async in hot path | vault index is in-memory; no invoke calls |
| EC-A.01 – EC-A.13 | all covered in tests |

---

## Implementation

### 1. Modify `buildAutocompleteExtension()` in `backlinks.plugin.ts`

The only code that changes is inside `wikiLinkCompletionSource`. Everything outside
that closure (the `cmAuto` guard, the `autocompletion({override: [...]})` call) is
unchanged.

Replace the body of `wikiLinkCompletionSource` with the logic described below.
Preserve the existing JSDoc.

#### New `wikiLinkCompletionSource` logic (pseudo-code)

```
const before = context.matchBefore(/\[\[([^\]\n]*)/)
if (!before) return null

const prefix = before.text.slice(2)   // text after [[

// FR-A.5 / EC-A.06: pipe means we are in display-text portion — suppress
if (prefix.includes("|")) return null

// FR-A.6 / EC-A.05: already closed — suppress
if (prefix.includes("]]")) return null

// ── Vault mode (FR-A.2) ────────────────────────────────────────────────
const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__
const vaultIndex = vaultManager?.getVaultIndex?.()

if (vaultIndex && vaultIndex.entries.length > 0) {
  const vaultRoot: string = vaultManager.getActiveVault()?.rootPaths?.[0] ?? ""
  const lowerPrefix = prefix.toLowerCase()

  const options = vaultIndex.entries
    .filter((entry: VaultIndexEntry) =>
      entry.name.toLowerCase().startsWith(lowerPrefix)
    )
    .sort((a: VaultIndexEntry, b: VaultIndexEntry) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
    .map((entry: VaultIndexEntry) => {
      // Vault-relative path without extension (AD-04)
      let detail: string
      if (vaultRoot && entry.path.startsWith(vaultRoot)) {
        detail = entry.path.slice(vaultRoot.length + 1).replace(/\.md$/, "")
      } else {
        detail = entry.name
      }

      // title shown as info only when it differs from name (AD-03)
      const infoFn = entry.title !== entry.name
        ? () => entry.title
        : undefined

      return {
        label: entry.name,
        detail,
        info: infoFn,
        apply: <same apply callback as existing, using entry.name as label>,
        type: "file",
      }
    })

  // EC-A.02 / EC-A.03: empty options array — CM6 hides dropdown automatically
  return { from: before.from + 2, options, filter: false }
}

// ── No-vault fallback (FR-A.3) ─────────────────────────────────────────
// Pass null for currentFile — FR-A.2 removes self-exclusion in all modes (AD-02)
const matchingFiles = filterCompletions(_cachedFileList, prefix, null)
if (matchingFiles.length === 0) return null

const options = matchingFiles.map((filename: string) => {
  const label = filename.endsWith(".md") ? filename.slice(0, -3) : filename
  return {
    label,
    apply: <same apply callback as existing>,
    type: "file",
  }
})

return { from: before.from + 2, options, filter: true }
```

#### `apply` callback (same for both paths)

```typescript
apply: (view: any, _completion: any, from: number, to: number) => {
  const docLength = view.state.doc.length
  const after = view.state.doc.sliceString(to, Math.min(to + 2, docLength))
  const closingBrackets = after === "]]" ? "" : "]]"
  view.dispatch({
    changes: { from, to, insert: label + closingBrackets },
    selection: { anchor: from + label.length + closingBrackets.length },
  })
}
```

This is identical to the existing `apply` logic — no change.

#### Key differences from the old code

| Old | New |
|-----|-----|
| `filterCompletions(_cachedFileList, prefix, currentFilename)` — always ran | Vault-mode path bypasses `filterCompletions` entirely |
| `currentFilename` was derived and passed to exclude self | `null` passed in both modes (AD-02) |
| No `|` guard (worked by accident) | Explicit `if (prefix.includes("\|")) return null` |
| No `detail` or `info` on completions | Vault mode adds `detail` and conditional `info` |
| `filter: true` caused CM6 to re-filter | Vault mode uses `filter: false` (we pre-filtered) |

Note on `filter: false` in vault mode: since we pre-filter using `startsWith(lowerPrefix)`,
setting `filter: false` tells CM6 not to run its own substring filter on top. If `filter: true`
were kept, CM6's built-in filter would re-apply, which could hide valid results that differ in
case from CM6's expected behaviour. Using `filter: false` gives us full control and matches
how the existing code sets `filter: true` in the no-vault path (which lets CM6 further narrow
as the user types — acceptable there since the list is already prefix-filtered).

### 2. Remove `currentFilePath` and `currentFilename` derivation from `wikiLinkCompletionSource`

The old code derived `currentFilePath` and `currentFilename` to pass to `filterCompletions`.
This is no longer needed in vault mode, and in no-vault mode `null` is passed. Remove those
two variable declarations from inside `wikiLinkCompletionSource` entirely. Do not remove the
`filenameFromPath` function (it is used elsewhere in the plugin).

### 3. Build and sync the plugin

After modifying the source, run:

```bash
npm run build:plugins
npm run sync:plugins
```

Verify that `src-tauri/plugins/core/backlinks.js` has a newer mtime than
`src/plugins/backlinks/backlinks.plugin.ts`.

---

## Tests to Add in `tests/plugins/backlinks/backlinks.test.ts`

Add a new `describe("buildAutocompleteExtension — vault mode")` block adjacent to the
existing `describe("buildAutocompleteExtension")` block.

The tests use the same `__CM_AUTOCOMPLETE__` mock pattern as existing tests. Add a
`__MARKABLE_VAULT_MANAGER__` mock on `window` in `beforeEach` and clean it up in
`afterEach`.

### Test scaffold

```typescript
describe("buildAutocompleteExtension — vault mode", () => {
  const mockEntries = [
    { name: "meeting",  path: "/vault/work/meeting.md",  title: "meeting",       tags: [], outboundLinks: [], modified: 0, size: 0 },
    { name: "notes",    path: "/vault/notes.md",          title: "My Notes",      tags: [], outboundLinks: [], modified: 0, size: 0 },
    { name: "readme",   path: "/vault/readme.md",          title: "readme",        tags: [], outboundLinks: [], modified: 0, size: 0 },
  ]

  beforeEach(() => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: () => ({ entries: mockEntries }),
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    }
    // Set up __CM_AUTOCOMPLETE__ mock (same as existing tests)
    // ...
  })

  afterEach(() => {
    delete (window as any).__MARKABLE_VAULT_MANAGER__
  })

  // EC-A.02
  it("returns empty options (not null) when vault index has zero entries", () => { ... })

  // EC-A.03
  it("returns empty options when prefix matches nothing", () => { ... })

  // EC-A.04
  it("detail is vault-relative path without extension", () => { ... })

  // AD-03: title differs from name
  it("info is set when VaultIndexEntry.title differs from name", () => { ... })

  // AD-03: title equals name
  it("info is undefined when VaultIndexEntry.title equals name", () => { ... })

  // FR-A.2: self-file NOT excluded
  it("current file is included in completions (no self-exclusion)", () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/notes.md"
    // assert "notes" appears in options
  })

  // FR-A.5 / EC-A.06
  it("returns null when prefix contains pipe character", () => { ... })

  // EC-A.07
  it("returns all entries when prefix is empty string", () => { ... })

  // EC-A.08
  it("filters by prefix case-insensitively", () => { ... })

  // EC-A.10
  it("falls through to _cachedFileList when vault manager global is absent", () => { ... })

  // EC-A.01
  it("falls through to _cachedFileList when getVaultIndex returns null", () => { ... })

  // entry.path not under vaultRoot — detail falls back to name
  it("detail falls back to entry.name when path is not under vaultRoot", () => { ... })
})
```

Also add to the existing `describe("filterCompletions")` block:

- A test confirming that passing `null` as `currentFile` includes all files (tests
  that `null` correctly removes self-exclusion — this tests the helper itself).

Existing `describe("buildAutocompleteExtension")` tests must continue to pass
unchanged (no-vault path regression guard).

---

## Edge Cases Coverage Mapping

| EC | Test |
|----|------|
| EC-A.01 | vault manager absent → falls through to `_cachedFileList` |
| EC-A.02 | vault entries empty → returns `{ from, options: [] }`, not null |
| EC-A.03 | prefix matches nothing → `options: []` |
| EC-A.04 | two files same name → both in options, `detail` differs |
| EC-A.05 | closed link `[[done]]` → `getCompletionContext` returns null (existing test) |
| EC-A.06 | `[[stem\|` → explicit `prefix.includes("\|")` guard returns null |
| EC-A.07 | empty prefix → all entries returned |
| EC-A.08 | partial prefix `[[not` → only matching entries |
| EC-A.09 | vault index refreshes — no new test needed (CM6 re-runs source on keypress) |
| EC-A.10 | vault manager global undefined → optional chaining returns undefined → no-vault path |
| EC-A.11 | name with spaces/hyphens → inserted verbatim as `label` (existing apply logic) |
| EC-A.12 | fenced code blocks — out of scope per requirements; no test required |
| EC-A.13 | plugin disabled while dropdown open — CM6 handles; no new test |
