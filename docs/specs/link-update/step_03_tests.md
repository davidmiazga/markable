---
title: "Step 03 — Missing EC tests"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 03 — Missing EC Tests

## Requirement Traceability

- NFR-02.11.6 — Test coverage
- EC-01, EC-02, EC-04, EC-05, EC-08, EC-09, EC-11, EC-18 (null container variant)

---

## Context

All new tests go in `tests/plugins/file-browser/file-browser.test.ts`, appended
after the existing `renameNode link-update banner (EC-18)` describe block (line
1736). They use the same import set, fixture helpers (`makeVault`, `makeVaultIndex`,
`setupVaultManager`, `makeContainer`), and mock conventions already established in
the file.

The `makeIndexWithBacklink` fixture defined at line 1627 is reused across several
tests; extract it to a shared scope at the top of the new describe block rather
than redefining it inline.

For EC-11 (auto-dismiss after 3 s), use `vi.useFakeTimers()` / `vi.runAllTimers()`
/ `vi.useRealTimers()` in a `beforeEach`/`afterEach` pair so timers do not leak
across tests.

---

## Tests to Add

Add a single top-level `describe` block:

```
describe("link-update banner — edge cases (FR-02.11)", () => { ... })
```

### EC-01 — No linking files: no banner shown

- Setup: vault index with zero entries having `outboundLinks` containing the
  renamed stem.
- Action: call `renameNode("/notes/solo.md", "solo-renamed", container)`.
- Assert: `container.querySelector(".file-browser-link-banner")` is `null`.
- Fixture: use `makeVaultIndex(["/notes/solo.md"])` which produces entries with
  empty `outboundLinks`.

### EC-02 — Singular "1 note links to …"

- Setup: vault index with exactly one linking entry (use `makeIndexWithBacklink`
  which already has one linking note).
- Action: `renameNode("/notes/old-note.md", "new-note", container)`.
- Assert: the banner `textContent` contains `"1 note links"` (singular, no trailing
  "s" on "note").
- Assert: the banner `textContent` does NOT contain `"1 notes"`.

### EC-04 — Rename to same name: no banner

- Setup: vault index with one linking entry (use `makeIndexWithBacklink`).
- Action: `renameNode("/notes/old-note.md", "old-note", container)`.
  (new name equals old stem — this may be blocked by `filenameExistsInDir` if the
  file is in the index; if so, mock `__TAURI_INTERNALS__.invoke` to resolve and
  remove the file from the index, OR use a path not present in the index. The
  simplest approach: use a file path not in the index so the exists-check passes,
  then rename to the same stem.)
- Implementation note: the simplest test fixture is a vault index that does NOT
  contain `/notes/same-stem.md` as an entry (so the exists check passes), but DOES
  contain a linking note. Then rename `/notes/same-stem.md` to `"same-stem"`.
- Assert: `container.querySelector(".file-browser-link-banner")` is `null`.

### EC-05 — Move with same stem: no banner

- Setup: vault index with one linking entry.
- Action: call `moveNode("/notes/old-note.md", "/notes/subdir", container)` where
  the mocked `move_file` invoke returns `"/notes/subdir/old-note.md"`.
- Assert: `container.querySelector(".file-browser-link-banner")` is `null`.
- Note: because `getFileStem("/notes/old-note.md") === getFileStem("/notes/subdir/old-note.md")`,
  the guard `oldStem !== newStem` is false and the banner is suppressed per AD-01.

### EC-08 — Partial failure banner message persists

- Setup: vault index with linking entry; mock `update_wiki_links` to return
  `{ updated: ["/notes/a.md"], failed: ["/notes/b.md"] }`.
- Action: show the banner via `showLinkUpdateBanner(container, "old", "new", ["/notes/a.md", "/notes/b.md"])`,
  then click the Update button.
- Assert after async settle: the banner's message span contains
  `"Updated 1, failed 1."`.
- Assert: the banner is still present in the DOM (no auto-dismiss for partial
  failure).
- Use `vi.useFakeTimers()` and confirm that after `vi.runAllTimers()` the banner is
  STILL present.

### EC-09 — Total failure banner message persists

- Setup: mock `update_wiki_links` to reject with `"disk full"`.
- Action: show the banner, click Update.
- Assert after async settle: message span contains `"Link update failed: disk full"`.
- Assert: banner is still present after `vi.runAllTimers()`.

### EC-11 — Success: auto-dismiss after 3 s

- Setup: mock `update_wiki_links` to resolve with
  `{ updated: ["/notes/a.md"], failed: [] }`.
- Use `vi.useFakeTimers()`.
- Action: show the banner, click Update.
- Assert after async settle: message span contains `"Updated 1 note."`.
- Assert before timer advance: banner is still in DOM.
- Advance timers by 3000 ms (`vi.advanceTimersByTime(3000)`).
- Assert: banner is no longer in the DOM.

### EC-18 variant — Null container: no DOM error

- Action: call `checkAndShowLinkBanner(null, "old", "new")` directly (import the
  function from `file-browser-ops` if it is exported; if it is not exported, test
  indirectly by calling `renameNode` with a null-returning `_panelContainer` setup,
  OR export `checkAndShowLinkBanner` from `file-browser-ops.ts`).
- Assert: no exception is thrown.
- Assert: no `.file-browser-link-banner` is appended to `document.body`.
- Note: `checkAndShowLinkBanner` is currently a private (non-exported) function.
  The Developer must either export it (preferred — makes it unit-testable) or test
  it indirectly by setting up a condition where the vault manager has no vault index
  and verifying the call path is safe.

---

## Acceptance Criteria

1. All eight test cases above are present in `file-browser.test.ts`.
2. `npm test` reports zero failures.
3. No `vi.useFakeTimers()` call is left without a corresponding `vi.useRealTimers()`
   or `afterEach` teardown.
4. The EC-11 and EC-08/EC-09 tests correctly distinguish "banner still present" from
   "banner auto-dismissed" using timer control, not `setTimeout` sleeps.

---

## Import Additions Required

If `checkAndShowLinkBanner` is exported from `file-browser-ops.ts` as part of this
step, add it to the import statement in `file-browser.test.ts`:

```typescript
import {
  // ... existing imports ...
  checkAndShowLinkBanner,
  moveNode,
} from "../../../src/plugins/file-browser/file-browser-ops";
```

`moveNode` is also not currently imported in the test file; it must be added for
the EC-05 test.

---

## Files Touched

- `tests/plugins/file-browser/file-browser.test.ts`
- `src/plugins/file-browser/file-browser-ops.ts` (export `checkAndShowLinkBanner`
  if needed for EC-18 direct test)
