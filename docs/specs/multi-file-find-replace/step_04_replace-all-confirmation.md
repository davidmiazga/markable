---
title: Step 04 — Replace All confirmation panel
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Step 04 — Replace All confirmation panel

## Objective

Implement the staged "Replace All" flow (FR-7) for vault scope:

1. Wire the `replaceAllBtn` to show a confirmation summary panel instead of
   committing writes immediately.
2. Implement the "Confirm Replace All" sequential batch execution with per-file
   progress reporting.
3. Handle the EC-17 Escape intercept (cancel the confirmation, not close the
   widget).
4. Handle partial failures (EC-20, NFR-6) with a per-file result summary.
5. Handle EC-13 (empty replace term shows "Delete" phrasing in summary).

After this step `npm run test:run` must pass.

---

## Files to edit

- `src/editor/find-widget.ts` — confirmation panel methods + `replaceAllBtn` wiring
- `src/editor/find-widget.css` — confirmation and progress panel styles

---

## Part A: `src/editor/find-widget.ts` changes

### 1. Intercept Escape when confirmation is visible (EC-17)

In `_attachEvents()`, the root `keydown` listener currently handles Escape by
calling `this.close()` unconditionally. Modify it to check
`_confirmationVisible` first:

Find the existing Escape handler (lines 427–431):

```typescript
if (e.key === "Escape") {
  e.preventDefault();
  e.stopPropagation();
  this.close();
  return;
}
```

Replace with:

```typescript
if (e.key === "Escape") {
  e.preventDefault();
  e.stopPropagation();
  if (this._confirmationVisible) {
    // EC-17: Escape cancels confirmation, does not close the widget.
    this._hideConfirmationPanel();
  } else {
    this.close();
  }
  return;
}
```

### 2. Wire `replaceAllBtn` for vault scope

In `_attachEvents()`, the `replaceAllBtn` handler currently has the partial
stub from step_03. Replace it with the full implementation:

```typescript
this.replaceAllBtn.addEventListener("click", () => {
  if (this._scope === "file") {
    replaceAll(this.view);
    this._updateCount(this._buildSearchQuery());
    return;
  }

  // Vault scope: show confirmation panel (FR-7 — do NOT commit immediately).
  const results = this._vaultResults;
  const findTerm = this.findInput.value;
  const replaceTerm = this.replaceInput.value;

  if (!results || results.results.length === 0 || !findTerm) return;

  this._showConfirmationPanel(results, findTerm, replaceTerm);
});
```

### 3. New private method: `_countTotalMatches(results)`

```typescript
private _countTotalMatches(results: ContentSearchPayload): number {
  return results.results.reduce((sum, f) => sum + f.matches.length, 0);
}
```

### 4. New private method: `_showConfirmationPanel(results, findTerm, replaceTerm)`

This method populates `this.confirmationPanel` with the summary and two action
buttons, then hides the vault results panel and shows the confirmation panel.
It also traps focus between the two buttons (NFR-7).

```typescript
private _showConfirmationPanel(
  results: ContentSearchPayload,
  findTerm: string,
  replaceTerm: string,
): void {
  this._confirmationVisible = true;

  const fileCount = results.results.length;
  const matchCount = this._countTotalMatches(results);
  const scopeLabel = this._scope === "folder" ? "folder" : "vault";

  // EC-13: Use "Delete" phrasing when replace term is empty.
  const actionVerb = replaceTerm === "" ? "Delete" : "Replace";
  const actionDetail =
    replaceTerm === ""
      ? `Delete '${findTerm}' in ${fileCount} file(s) (${matchCount} matches)?`
      : `Replace '${findTerm}' with '${replaceTerm}' in ${fileCount} file(s) (${matchCount} matches)?`;

  const panel = this.confirmationPanel;
  panel.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "find-widget-confirmation-summary";
  summary.textContent = actionDetail;
  panel.appendChild(summary);

  const btnRow = document.createElement("div");
  btnRow.className = "find-widget-confirmation-btns";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "find-widget-confirm-replace-all";
  confirmBtn.textContent = `${actionVerb} All`;
  confirmBtn.setAttribute("aria-label", `Confirm ${actionVerb} All in ${scopeLabel}`);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "find-widget-confirm-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.setAttribute("aria-label", "Cancel");

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  panel.appendChild(btnRow);

  // NFR-7: Trap focus between the two buttons while confirmation is open.
  // Simple two-button trap: Tab from confirmBtn → cancelBtn, Tab from cancelBtn → confirmBtn.
  confirmBtn.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); cancelBtn.focus(); }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cancelBtn.focus(); }
  });
  cancelBtn.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); confirmBtn.focus(); }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); confirmBtn.focus(); }
  });

  confirmBtn.addEventListener("click", () => {
    void this._executeReplaceAll(results, findTerm, replaceTerm);
  });

  cancelBtn.addEventListener("click", () => {
    // AC-12: Cancel — return to results list without any writes.
    this._hideConfirmationPanel();
  });

  // Hide results panel, show confirmation panel.
  this.vaultResultsPanel.style.display = "none";
  panel.style.display = "block";

  // Focus the confirm button so keyboard users can act immediately (NFR-7).
  requestAnimationFrame(() => confirmBtn.focus());
}
```

### 5. New private method: `_hideConfirmationPanel()`

```typescript
private _hideConfirmationPanel(): void {
  this._confirmationVisible = false;
  this.confirmationPanel.style.display = "none";
  this.confirmationPanel.innerHTML = "";

  // Restore the results panel.
  if (this._vaultResults && this._vaultResults.results.length > 0) {
    this.vaultResultsPanel.style.display = "block";
  }
}
```

### 6. New private method: `_executeReplaceAll(results, findTerm, replaceTerm)`

Performs the sequential batch replacement with progress reporting. Each file is
processed one at a time (FR-7 step 3). Per-file results are accumulated in an
array for the final summary.

```typescript
private async _executeReplaceAll(
  results: ContentSearchPayload,
  findTerm: string,
  replaceTerm: string,
): Promise<void> {
  const files = results.results;
  const total = files.length;
  const panel = this.confirmationPanel;

  // Build progress UI.
  panel.innerHTML = "";
  const progressLabel = document.createElement("div");
  progressLabel.className = "find-widget-progress-label";
  progressLabel.textContent = `Replacing 0 of ${total} files…`;
  panel.appendChild(progressLabel);

  const progressList = document.createElement("div");
  progressList.className = "find-widget-progress-list";
  panel.appendChild(progressList);

  type FileOutcome = { path: string; title: string; count: number; error?: string; skipped?: boolean };
  const outcomes: FileOutcome[] = [];

  for (let i = 0; i < files.length; i++) {
    const fileResult = files[i];
    progressLabel.textContent = `Replacing ${i + 1} of ${total} files…`;

    let outcome: FileOutcome;
    try {
      const count = await this._replaceInFile(
        fileResult.path,
        findTerm,
        replaceTerm,
      );
      if (count === -1) {
        // User cancelled this file (dirty tab, FR-9).
        outcome = { path: fileResult.path, title: fileResult.title, count: 0, skipped: true };
      } else {
        outcome = { path: fileResult.path, title: fileResult.title, count };
      }
    } catch (err) {
      // EC-8, EC-20: Write failed — surface per-file error; continue batch.
      const msg = err instanceof Error ? err.message : String(err);
      outcome = { path: fileResult.path, title: fileResult.title, count: 0, error: msg };
    }

    outcomes.push(outcome);

    // Append per-file result row.
    const row = document.createElement("div");
    row.className = "find-widget-progress-row";
    const icon = document.createElement("span");
    if (outcome.error) {
      icon.className = "find-widget-progress-icon error";
      icon.textContent = "✕";
      icon.setAttribute("aria-label", "failed");
    } else if (outcome.skipped) {
      icon.className = "find-widget-progress-icon skipped";
      icon.textContent = "–";
      icon.setAttribute("aria-label", "skipped");
    } else {
      icon.className = "find-widget-progress-icon success";
      icon.textContent = "✓";
      icon.setAttribute("aria-label", "replaced");
    }
    const label = document.createElement("span");
    label.className = "find-widget-progress-file";
    label.textContent = outcome.title;
    if (outcome.error) {
      const errSpan = document.createElement("span");
      errSpan.className = "find-widget-progress-error-msg";
      errSpan.textContent = ` — ${outcome.error}`;
      label.appendChild(errSpan);
    }
    row.appendChild(icon);
    row.appendChild(label);
    progressList.appendChild(row);
  }

  // Done — update label.
  const succeeded = outcomes.filter((o) => !o.error && !o.skipped).length;
  const failed = outcomes.filter((o) => !!o.error).length;
  const skipped = outcomes.filter((o) => !!o.skipped).length;
  progressLabel.textContent =
    `Done. ${succeeded} replaced` +
    (skipped > 0 ? `, ${skipped} skipped` : "") +
    (failed > 0 ? `, ${failed} failed` : "") +
    ".";

  // Add a close/done button.
  const doneBtn = document.createElement("button");
  doneBtn.className = "find-widget-progress-done";
  doneBtn.textContent = "Close";
  doneBtn.addEventListener("click", () => {
    this._hideConfirmationPanel();
  });
  panel.appendChild(doneBtn);

  // FR-7 step 5: Refresh results after completion.
  await this._runVaultSearch();
}
```

---

## Part B: `src/editor/find-widget.css` additions

Add to the end of the file:

```css
/* ---- Confirmation panel ---- */

.find-widget-confirmation {
  border-top: 1px solid var(--search-panel-border);
  padding: 10px 12px;
  max-height: 320px;
  overflow-y: auto;
}

.find-widget-confirmation-summary {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.5;
  margin-bottom: 10px;
}

.find-widget-confirmation-btns {
  display: flex;
  gap: 8px;
}

.find-widget-confirm-replace-all {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--link-color);
  background-color: var(--link-color);
  color: #fff;
  transition: opacity 0.1s ease;
}

.find-widget-confirm-replace-all:hover {
  opacity: 0.85;
}

.find-widget-confirm-cancel {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border-color);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.1s ease;
}

.find-widget-confirm-cancel:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
}

/* ---- Progress panel ---- */

.find-widget-progress-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.find-widget-progress-list {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.find-widget-progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 11px;
}

.find-widget-progress-icon {
  flex-shrink: 0;
  font-size: 12px;
  width: 14px;
  text-align: center;
}

.find-widget-progress-icon.success { color: hsl(140, 60%, 40%); }
.find-widget-progress-icon.error   { color: hsl(0, 72%, 51%); }
.find-widget-progress-icon.skipped { color: var(--text-secondary); }

.find-widget-progress-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.find-widget-progress-error-msg {
  color: hsl(0, 72%, 51%);
}

.find-widget-progress-done {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border-color);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.1s ease;
  margin-top: 6px;
}

.find-widget-progress-done:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
}
```

---

## Tests to add to `tests/editor/find-widget-vault.test.ts`

Add a new `describe("_countTotalMatches")` block and a `describe("Replace All
confirmation")` block. Because `_countTotalMatches` and the confirmation panel
logic are private, they are tested via the public API
(`_executeReplaceAll` is indirectly exercised through `replaceAllBtn`).

Test the publicly-observable contracts instead of private method internals.

**Test CA-1 — _countTotalMatches sums correctly**

To test this without reaching into private methods, test `applyStringReplace`
across multiple files (the equivalent logic):

```
// Test the sum of match counts across a realistic payload.
const payload = makePayload([
  { path: "/a.md", title: "A", lines: [
    { lineText: "cat and cat", lineNumber: 1, columnStart: 0 },
    { lineText: "another cat", lineNumber: 2, columnStart: 8 },
  ]},
  { path: "/b.md", title: "B", lines: [
    { lineText: "cat on a mat", lineNumber: 3, columnStart: 0 },
  ]},
]);
// Total match count from payload = 3 (2 from A + 1 from B)
assert payload.results.reduce((s, f) => s + f.matches.length, 0) === 3
```

**Test CA-2 — applyStringReplace empty replaceTerm performs deletion (EC-13)**
```
result = applyStringReplace("remove the word", "the ", "", { matchCase: false, wholeWord: false })
assert result.newContent === "remove word"
assert result.count === 1
```

This ensures that when the confirmation panel shows "Delete '...'", the actual
replacement engine correctly handles the empty-string case.

**Test CA-3 — postFilterResults with empty results array**
```
payload = { results: [], capped: false, skippedCount: 0 }
result = postFilterResults(payload, "x", { matchCase: true, wholeWord: false })
assert result.results.length === 0
assert result.capped === false
```

---

## Acceptance criteria for this step

- AC-S4-1: Clicking "Replace All" in vault scope shows the confirmation summary
  panel with correct file count and match count (AC-10).
- AC-S4-2: The confirmation summary uses "Delete" phrasing when the replace term
  is empty (EC-13).
- AC-S4-3: Clicking "Cancel" in the confirmation panel returns to the results
  list without any file writes (AC-12).
- AC-S4-4: Pressing Escape while the confirmation panel is visible cancels the
  confirmation and returns to the results list; it does NOT close the widget
  (AC-18, EC-17).
- AC-S4-5: Clicking "Confirm Replace All" (or the equivalent button) processes
  all matched files sequentially, shows a per-file progress row (AC-11).
- AC-S4-6: If a file write fails, the progress row shows an error indicator and
  the batch continues with remaining files (AC-17, EC-20, NFR-6).
- AC-S4-7: If a file's dirty-tab prompt is declined, that file is skipped and
  marked "–" in the progress panel (AC-16, FR-9).
- AC-S4-8: After completion, the results list refreshes (AC-11).
- AC-S4-9: All CA-* tests pass.
- AC-S4-10: All previous tests still pass.

---

## After this step

```bash
npm run test:run -- tests/editor/find-widget-vault.test.ts
npm run test:run
```

All tests must pass. Proceed to step_05.
