---
title: "File Browser — Post-Rename/Move Link Update (FR-02.11)"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# File Browser — Post-Rename/Move Link Update (FR-02.11)

## Validation Status

**PENDING — awaiting user approval.**

---

## 1. Feature Summary

After a file is renamed or moved within the active vault, the system queries the vault index to find all notes that contain an outbound wiki-link pointing to the affected file's old name. If any such notes exist, a dismissible notification banner appears inside the File Browser panel offering the user a one-click bulk link-update operation. The update is performed by a dedicated Rust command that rewrites every matched `[[old-name]]` occurrence across all linking files using the temp-file-swap pattern, ensuring no partial writes. The operation is opt-in and best-effort: only the bare `[[filename-stem]]` wiki-link form is matched; links that embed the full path, an alias, or a display-text override with the old stem in a non-standard position may not be caught.

---

## 2. Functional Requirements

### FR-02.11.1 — Trigger: Post-Rename Detection

After a successful file rename (committed via `renameNode` / the Rust `rename_file` command), the system must:

- Determine the old filename stem (the portion of the filename before `.md`, e.g. `meeting` from `meeting.md`).
- Query the active vault index for all entries whose `outboundLinks` array contains the old stem.
- If one or more linking entries are found, show the link-update banner (FR-02.11.3).
- If zero linking entries are found, take no action and show no banner.
- This check applies to `.md` file renames only. Folder renames do not trigger a link-update banner.

### FR-02.11.2 — Trigger: Post-Move Detection

After a successful file move (committed via `moveNode` / the Rust `move_file` command), the system must apply the same detection logic as FR-02.11.1 using the moved file's stem. A move does not change the filename stem, so the stem before and after the move is identical. The link-update banner is therefore only relevant when the vault contains notes that use `[[stem]]` wiki-links AND the user intends to update them to reflect the new location in a future path-aware link format. For the current spec (bare-stem matching only), the banner informs the user that links to `[[stem]]` exist and offers to re-confirm them — but since the stem has not changed, the "Update" action in the move case is a no-op rewrite (find `[[stem]]` → replace with `[[stem]]`). The banner must still appear to ensure the user is aware of linking notes.

> Note for Architect: the move-case banner is low-value unless the system evolves to support path-aware wiki-links. The Architect may recommend suppressing the banner on moves where the stem is unchanged, provided this decision is documented as an architectural note in the spec.

### FR-02.11.3 — Notification Banner UI

When triggered (FR-02.11.1 or FR-02.11.2), the system must display a notification banner within the File Browser panel with the following properties:

- **Placement**: inserted at the top of the `.file-browser-panel` container, above the file tree and search header. Only one banner may be visible at a time; a new banner replaces any existing one.
- **Message text**: `"[N] note[s] link to '[old-name]'. Update links?"` where N is the count of linking files and the singular/plural form of "note" is grammatically correct (i.e. "1 note links" not "1 notes links").
- **"Update" button**: triggers the bulk link-update operation (FR-02.11.4).
- **"Dismiss" button**: removes the banner without performing any file writes (FR-02.11.5).
- The banner must be keyboard-accessible: "Update" and "Dismiss" buttons are focusable and respond to Enter/Space.
- The banner must use CSS variables for all colors and typography (no hardcoded values).

### FR-02.11.4 — Update Action

When the user clicks "Update":

- The UI updates the banner message to `"Updating links…"` immediately (optimistic feedback).
- The system invokes the Rust command `update_wiki_links` with: the list of linking file paths (`filesToUpdate`), the old stem (`oldLink`), and the new stem (`newLink`).
- `update_wiki_links` signature: `(files_to_update: Vec<String>, old_link: String, new_link: String) -> Result<{ updated: Vec<String>, failed: Vec<String> }, String>`.
- Each file in `filesToUpdate` is processed independently using the temp-file-swap pattern; a failure on one file does not abort processing of the others.
- On complete success (zero failures): banner message updates to `"Updated [N] note[s]."` and the banner auto-dismisses after 3 seconds.
- On partial failure: banner message updates to `"Updated [N], failed [M]."` and the banner persists (does not auto-dismiss) so the user can read the outcome.
- On total failure (the command returns an `Err`): banner message updates to `"Link update failed: [error message]."` and the banner persists.
- After the update completes (success or partial), the vault index must be reloaded so that `outboundLinks` entries reflect the new stems.

### FR-02.11.5 — Dismiss Action

When the user clicks "Dismiss":

- The banner is removed from the DOM immediately.
- No file writes are performed.
- No state is persisted: if the user immediately renames the same file again (or performs any other rename/move), the detection logic runs fresh from the current vault index state.

### FR-02.11.6 — Scope of Wiki-Link Matching

The `update_wiki_links` Rust command matches and replaces only the bare `[[filename-stem]]` form. The following link variants are explicitly out of scope for matching:

- `[[path/to/filename-stem]]` — path-qualified wiki-links.
- `[[filename-stem|Display Text]]` — links with a display-text alias where the stem appears before the pipe character (these will be matched if the regex is `\[\[old-stem\]\]` but not if a display text is present — the Architect must clarify the exact regex).
- `[[Display Text|filename-stem]]` — links where the stem appears after the pipe (these would not be matched by a simple find-and-replace on `[[old-stem]]`).
- Markdown inline links `[text](path/to/file.md)`.

This is a known limitation. Users are informed of it via the "best-effort" framing in the notification banner tooltip (optional enhancement, not required in v1).

### FR-02.11.7 — Vault Index as the Source of Truth

The detection query (FR-02.11.1 / FR-02.11.2) reads from the in-memory vault index, specifically the `outboundLinks` field of each index entry. It does not perform a live disk scan. This means:

- If the vault index is stale (e.g., a note was edited outside Markable and the watcher has not yet updated the index), the detection may produce false negatives or false positives.
- A stale index is an accepted limitation for v1. The system does not force a full re-index before showing the banner.

### FR-02.11.8 — Banner Lifecycle with Subsequent Operations

- If the user performs a second rename or move before dismissing an existing banner, the new banner replaces the old one.
- The banner is not persisted across sessions. On app restart, no banner is shown regardless of any prior unresolved link update.
- If the user switches vaults while a banner is visible, the banner is removed as part of the vault-switch panel reset.

---

## 3. Non-Functional Requirements

**NFR-02.11.1: Detection latency** — The vault index query that determines linking files (FR-02.11.1 / FR-02.11.2) must complete and the banner must appear within 100ms of the rename or move operation completing on disk. The query is an in-memory filter over the `outboundLinks` arrays; no disk I/O is required.

**NFR-02.11.2: Update throughput** — The `update_wiki_links` command must process each file using the temp-file-swap pattern. For a typical vault (up to 500 files), the full batch must complete in under 2 seconds on a solid-state drive.

**NFR-02.11.3: No main-thread blocking** — The `update_wiki_links` Tauri command runs on the Rust side. The renderer must not block the UI thread while the update is in progress. The "Updating links…" message provides feedback during the async wait.

**NFR-02.11.4: Atomicity per file** — Each individual file update is atomic (temp-file-swap). If the process is interrupted mid-batch (crash, power loss), each file on disk is in a consistent state — either fully updated or unmodified. There are no partial rewrites.

**NFR-02.11.5: CSS variable compliance** — All banner styles use CSS variables. No hardcoded hex colors or font stacks.

**NFR-02.11.6: Test coverage** — The link-update banner logic must be covered in `tests/plugins/file-browser/file-browser.test.ts`. Minimum required test cases are enumerated in the Edge Case Inventory (Section 4). The Rust `update_wiki_links` command must be covered by `cargo test` in `src-tauri/src/commands/`.

---

## 4. Edge Case Inventory

The following items are the mandatory test checklist for the Code Reviewer. Every item must have a corresponding test or a documented rationale for exclusion.

**EC-01: No notes link to the renamed file** — After rename, `checkAndShowLinkBanner` finds zero entries in the vault index whose `outboundLinks` includes the old stem. Expected: no banner is shown. The rename completes silently.

**EC-02: Exactly one note links to the renamed file** — Banner message reads "1 note links to '[old-name]'. Update links?" (singular form). Clicking "Update" processes one file. Success message reads "Updated 1 note."

**EC-03: Many notes link to the renamed file (N > 1)** — Banner message reads "[N] notes link to '[old-name]'. Update links?" (plural form). All N files are submitted to `update_wiki_links`. Success message reads "Updated [N] notes."

**EC-04: Rename to a name that is identical to the old name** — The user opens the inline rename input and presses Enter without changing the text. Expected: the rename is effectively a no-op (same `oldPath` and `newPath`). The link-update detection runs with `oldStem === newStem`. The `update_wiki_links` command would replace `[[stem]]` with `[[stem]]` — a no-op rewrite. The banner should either be suppressed (preferred) or shown with a no-op update. The Architect must decide and document the behavior.

**EC-05: Move file within the same vault — stem unchanged** — After a move, `oldStem === newStem`. The vault index is reloaded and the query runs. Notes that link to `[[stem]]` are found. The banner appears but the update action is a no-op rewrite (replaces `[[stem]]` with `[[stem]]`). Expected: no file content changes on disk after "Update" is clicked. The banner auto-dismisses after 3 seconds.

**EC-06: Move file to a folder in a different vault** — Cross-vault moves are not supported in the current file tree (drag-and-drop is scoped to the active vault). Expected: this case cannot occur via the UI. If it does occur (e.g., programmatic call), `moveNode` operates on the active vault's index only and the banner reflects the active vault's link state.

**EC-07: File not present in the vault index at time of rename** — The renamed file has no index entry (e.g., it was just created and the index has not updated yet). Expected: the `outboundLinks` query returns zero results (no entry to check). No banner is shown. No error.

**EC-08: `update_wiki_links` partially fails — some files updated, some not** — The Rust command returns `{ updated: ["a.md", "b.md"], failed: ["c.md"] }`. Expected: banner message shows "Updated 2, failed 1." The banner does not auto-dismiss. The two successfully updated files are written atomically. `c.md` is unchanged on disk.

**EC-09: `update_wiki_links` totally fails — command returns Err** — The Rust command returns an `Err` string. Expected: banner message shows "Link update failed: [error]." The banner persists. No files are modified.

**EC-10: User dismisses the banner and then renames the same file again** — After dismiss, the banner state is cleared. The second rename triggers a fresh detection pass. If links still exist (e.g., the user renamed back to the original name), a new banner appears. The second banner is independent of the first.

**EC-11: Second rename arrives while a banner is already visible** — A new banner replaces the existing one. The old banner's "Update" and "Dismiss" button event listeners are removed when the old banner element is removed from the DOM. No memory leak from orphaned listeners.

**EC-12: Concurrent renames in rapid succession** — The user renames two files within the 100ms detection window. Each rename call is independent; each invokes `checkAndShowLinkBanner` separately. The second banner replaces the first. The "Update" action on the second banner operates only on the links relevant to the second rename.

**EC-13: Very large vault (approaching maxIndexSize: 500)** — The vault index contains 500 entries, each with a non-empty `outboundLinks` array. The in-memory filter that finds linking paths must complete within the 100ms budget (NFR-02.11.1). Expected: performance test or benchmark assertion confirms this.

**EC-14: `update_wiki_links` is called for a file that no longer exists on disk** — One of the `filesToUpdate` paths points to a file deleted between the time the banner was shown and the "Update" click. Expected: the Rust command skips the missing file, adds it to the `failed` list, and continues processing the remaining files. The TypeScript layer shows the partial-failure message.

**EC-15: Vault index is reloaded by the file watcher between the rename and the banner click** — The index reload (triggered by the `vault-file-changed` watch event) runs between the `checkAndShowLinkBanner` call and the user clicking "Update." The `linkingPaths` captured at banner-show time are stale. Expected: the "Update" action uses the paths captured at banner-show time (snapshot semantics). The Architect must decide whether a pre-click re-query is needed or whether snapshot semantics are acceptable. This decision must be documented.

**EC-16: Wiki-link in the linking file appears multiple times** — `note-a.md` contains `[[old-name]]` three times. Expected: `update_wiki_links` replaces all three occurrences (global replace, not just the first). The file is written once (single temp-file-swap for all replacements in that file).

**EC-17: Wiki-link uses a display-text alias — `[[old-name|Display Text]]`** — The Rust regex for `update_wiki_links` targets `[[old-name]]` (no pipe). The display-text form `[[old-name|Display Text]]` is not matched. Expected: this link is not updated. The banner's result message counts this file as "failed" if it is in `filesToUpdate` but was not rewritten, OR the file is silently counted as "updated 0 occurrences" — the Architect must determine whether zero-occurrence files are in the `updated` or `failed` list and document the behavior.

**EC-18: Vault panel is not mounted / container element is null** — `checkAndShowLinkBanner` is called but `_panelContainer` is null (the panel was closed). Expected: `showLinkUpdateBanner` is not called. No DOM manipulation error. The detection result is silently dropped.

**EC-19: User switches vaults while a banner is visible** — The vault switch re-renders the panel (or tears it down and rebuilds it). Expected: the banner is removed as part of the panel teardown. No stale banner persists after the vault switch completes.

**EC-20: Rename of a file whose stem matches multiple vault index entries (duplicate stems in different folders)** — E.g., `/vault/research/meeting.md` and `/vault/work/meeting.md` both exist. Renaming `/vault/research/meeting.md` to `standup.md` triggers detection on stem `meeting`. The `outboundLinks` filter finds notes linking to `[[meeting]]` — but those links are ambiguous (could point to either file). Expected: the banner shows the count of all notes with `[[meeting]]` in their `outboundLinks`. The "Update" action replaces `[[meeting]]` with `[[standup]]` in all of them, which may break links to the surviving `/vault/work/meeting.md`. This is a known limitation of bare-stem matching. No special disambiguation is required in v1 — the user is responsible for reviewing the result. The banner must not crash or behave incorrectly.

---

## Handoff Summary

- Artifact: docs/requirements/active_task.md
- Status: Requirements Validated (pending user sign-off)
- Edge cases to verify in tests: 20 items in Edge Case Inventory

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
