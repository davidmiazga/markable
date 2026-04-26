---
title: "Step 01 — Mode Infrastructure"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 01 — Mode Infrastructure

## Goal and Scope

Introduce the mode system scaffolding that all subsequent steps build on. This step does NOT change any search or results behavior — existing Commands mode behavior is preserved exactly. At the end of this step:

- The bar has a `_mode` variable, a mode badge button, and mode-specific placeholder/footer text
- `openBar()` accepts an optional `BarMode` argument
- `Cmd-P` opens the bar in Files mode, `Cmd-Shift-K` opens it in Keybindings mode, `Cmd-Shift-P` continues to open it in Commands mode
- Prefix switching (`>` and `#` in Files mode) switches modes
- Backspace-to-files switching works from Commands and Keybindings modes (empty input only)
- The `"markable-keybindings-changed"` CustomEvent listener is wired in `main.ts`
- All 84 existing tests still pass

The bar does NOT yet show file results or keybinding results — those modes show an empty list until Steps 2 and 4 respectively. This is intentional: the mode infrastructure is testable in isolation.

---

## Files to Modify

### `src/plugins/command-bar/command-bar.plugin.ts`

1. **Add `BarMode` type** (near top, with other types):
   ```typescript
   export type BarMode = "files" | "commands" | "keybindings";
   ```

2. **Add new module-level state variables** (in the module-level state block):
   ```typescript
   let _mode: BarMode = "files";
   let _badgeEl: HTMLButtonElement | null = null;
   let _presetRowEl: HTMLElement | null = null;
   let _footerEl: HTMLElement | null = null;
   let _openGeneration: number = 0;
   ```

3. **Update `CommandBarSettings` interface** — add `activePreset`, mark `showRecentFiles` as deprecated but keep for backwards compat:
   ```typescript
   interface CommandBarSettings {
     showCommands: boolean;
     showHeadings: boolean;
     showRecentFiles: boolean;   // deprecated; ignored on load (FR-09.2); kept for export compat
     activePreset: string;
   }
   ```

4. **Update `DEFAULT_SETTINGS`**:
   ```typescript
   const DEFAULT_SETTINGS: CommandBarSettings = {
     showCommands: true,
     showHeadings: true,
     showRecentFiles: true,   // ignored; exists only for test compat
     activePreset: "Default",
   };
   ```

5. **Add mode-specific constants**:
   ```typescript
   const MODE_PLACEHOLDERS: Record<BarMode, string> = {
     files:       "Open file or tab…",
     commands:    "Type a command or search headings…",
     keybindings: "Search actions to assign shortcut…",
   };

   const MODE_FOOTER_HINTS: Record<BarMode, string> = {
     files:       "Enter to open  ·  Esc to close",
     commands:    "Enter to run  ·  Esc to close",
     keybindings: "Enter to assign shortcut  ·  Esc to close",
   };

   const MODE_BADGE_LABELS: Record<BarMode, string> = {
     files:       "Files",
     commands:    "Commands",
     keybindings: "Keybindings",
   };

   const MODE_CYCLE: BarMode[] = ["files", "commands", "keybindings"];
   ```

6. **Update `buildOverlayDOM()`** — add badge button before input, preset row placeholder, and footer bar. The badge and footer are always present in DOM but the preset row is hidden via CSS class in non-keybindings modes:
   ```typescript
   export function buildOverlayDOM(): HTMLElement {
     // ... existing overlay/panel setup ...

     // Mode badge — inserted before the input element inside .cb-input-row
     const badge = document.createElement("button");
     badge.type = "button";
     badge.className = "cb-mode-badge";
     badge.setAttribute("aria-label", "Switch mode");
     badge.textContent = "Files";
     inputRow.appendChild(badge);

     // input (existing, appended after badge)
     // ... existing input setup ...

     // Preset row — hidden by default; shown only in keybindings mode (Step 5)
     const presetRow = document.createElement("div");
     presetRow.className = "cb-preset-row cb-preset-row--hidden";
     panel.appendChild(presetRow);

     // results (existing)
     // ...

     // Footer hint bar
     const footer = document.createElement("div");
     footer.className = "cb-footer";
     footer.textContent = MODE_FOOTER_HINTS["files"];
     panel.appendChild(footer);

     return overlay;
   }
   ```
   `_badgeEl`, `_presetRowEl`, `_footerEl` are assigned in `onEnable` after `buildOverlayDOM()` returns.

7. **Add `setMode(mode: BarMode)` function** (exported for testing):
   ```typescript
   export function setMode(mode: BarMode): void {
     _mode = mode;
     if (_badgeEl) _badgeEl.textContent = MODE_BADGE_LABELS[mode];
     if (_inputEl) _inputEl.placeholder = MODE_PLACEHOLDERS[mode];
     if (_footerEl) _footerEl.textContent = MODE_FOOTER_HINTS[mode];
     if (_presetRowEl) {
       _presetRowEl.classList.toggle("cb-preset-row--hidden", mode !== "keybindings");
     }
   }
   ```

8. **Update `openBar()` to accept optional mode argument** (FR-11.3):
   ```typescript
   function openBar(mode?: BarMode): void {
     const targetMode = mode ?? "files";

     if (_isOpen) {
       if (_mode === targetMode) {
         // Same mode: toggle close (FR-01.8, EC-13)
         closeBar();
         return;
       } else {
         // Different mode: switch without closing (FR-01.8, EC-12)
         setMode(targetMode);
         _inputEl!.value = "";
         _openGeneration++;
         filterAndRender("");
         return;
       }
     }

     _isOpen = true;
     _openGeneration++;
     setMode(targetMode);
     openCommandBar(_overlayEl!, _inputEl!);
     // Results building delegated to Step 2/3/4 via buildResultsForMode()
     // For now: fall through to existing buildAllResults() only for commands mode
     // ...
   }
   ```

9. **Update `closeBar()`** — reset `_mode` to `"files"` on close (FR-01.9):
   ```typescript
   function closeBar(): void {
     if (!_overlayEl || !_inputEl || !_isOpen) return;
     _isOpen = false;
     _mode = "files";   // FR-01.9: always reset on close
     closeCommandBar(_overlayEl, _inputEl);
     _selectedId = null;
     _visibleResults = [];
   }
   ```

10. **Add prefix-switching logic inside `onInput()`**:
    ```typescript
    function onInput(this: HTMLInputElement): void {
      const raw = this.value;

      // Prefix switching: only when in files mode and the input is exactly one prefix character
      if (_mode === "files" && raw === ">") {
        setMode("commands");
        this.value = "";
        filterAndRender("");
        return;
      }
      if (_mode === "files" && raw === "#") {
        setMode("keybindings");
        this.value = "";
        filterAndRender("");
        return;
      }

      filterAndRender(raw.trim());
    }
    ```

11. **Add Backspace-to-files switching inside `onOverlayKeydown()`** — add a case before the `switch` statement for Backspace when input is empty and mode is not files:
    ```typescript
    // Backspace on empty input in non-files mode → return to files (FR-06.3)
    if (e.key === "Backspace" && _inputEl!.value === "" && _mode !== "files") {
      e.preventDefault();
      e.stopPropagation();
      setMode("files");
      filterAndRender("");
      return;
    }
    ```
    Note: this check fires only when the input is already empty (FR-06.4 — if there is text, Backspace deletes normally).

12. **Add badge click handler in `attachListeners()`**:
    ```typescript
    _badgeEl!.addEventListener("click", onBadgeClick);
    ```

13. **Add `onBadgeClick()` named handler function**:
    ```typescript
    function onBadgeClick(): void {
      // FR-08.3: cycle modes Files → Commands → Keybindings → Files
      // EC-11: cancel key-capture if active (Step 4 will call exitKeyCapture here)
      const currentIdx = MODE_CYCLE.indexOf(_mode);
      const nextMode = MODE_CYCLE[(currentIdx + 1) % MODE_CYCLE.length];
      setMode(nextMode);
      if (_inputEl) _inputEl.value = "";
      _openGeneration++;
      filterAndRender("");
    }
    ```

14. **Register `__MARKABLE_COMMAND_BAR_OPEN__`** with the mode-aware signature:
    ```typescript
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__ = (mode?: BarMode) => openBar(mode);
    ```

15. **Add new CSS** for badge, footer, and preset row (added to `CSS_TEXT`):
    ```css
    .cb-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .cb-mode-badge {
      flex-shrink: 0;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background: var(--code-bg);
      color: var(--text-secondary);
      font-family: var(--ui-font);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    .cb-mode-badge:hover {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
    }

    .cb-footer {
      padding: 6px 14px;
      font-size: 11px;
      color: var(--text-secondary);
      border-top: 1px solid var(--border-color);
      user-select: none;
    }

    .cb-preset-row {
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .cb-preset-row--hidden {
      display: none;
    }
    ```

### `src/keybindings/keybindings-panel.ts`

1. **Change `file-print` defaultKey from `"Cmd-P"` to `""`** (confirmed decision — `Cmd-P` is reassigned to Files mode; `file-print` retains no default key and remains accessible via the menu or Commands bar):
   ```typescript
   { id: "file-print", label: "Print", defaultKey: "", section: "File" },
   ```

2. **Add two new COMMANDS entries** (in the View section):
   ```typescript
   { id: "command-bar-open-files",       label: "Open Files",       defaultKey: "Cmd-P",       section: "View" },
   { id: "command-bar-open-keybindings", label: "Open Keybindings", defaultKey: "Cmd-Shift-K", section: "View" },
   ```

### `src/main.ts`

1. **Wire the two new command bar shortcuts** in `handleAction()`:
   ```typescript
   case "command-bar-open-files":
     (window as any).__MARKABLE_COMMAND_BAR_OPEN__?.("files");
     break;
   case "command-bar-open-keybindings":
     (window as any).__MARKABLE_COMMAND_BAR_OPEN__?.("keybindings");
     break;
   ```

2. **Update the existing `command-bar-open` case** to open in Commands mode:
   ```typescript
   case "command-bar-open":
     (window as any).__MARKABLE_COMMAND_BAR_OPEN__?.("commands");
     break;
   ```

3. **Add the `"markable-keybindings-changed"` CustomEvent listener** near the end of `initApp()` (after the keybindings panel is created):
   ```typescript
   document.addEventListener("markable-keybindings-changed", (e: Event) => {
     const detail = (e as CustomEvent<{ keybindings: Record<string, string> }>).detail;
     if (detail?.keybindings) {
       updateSettings({ keybindings: detail.keybindings });
     }
   });
   ```

---

## Interfaces and Types to Export (for test isolation)

```typescript
// From command-bar.plugin.ts
export type BarMode = "files" | "commands" | "keybindings";
export function setMode(mode: BarMode): void;

// Existing exports (unchanged)
export function buildCommandResults(deps: CommandBuilderDeps): CommandBarResult[];
export function buildHeadingResults(deps: HeadingBuilderDeps): CommandBarResult[];
export function buildRecentFileResults(deps: RecentFilesBuilderDeps): CommandBarResult[];
export function buildOverlayDOM(): HTMLElement;
export function renderResults(...): void;
export function firstSelectableId(results: CommandBarResult[]): string | null;
export function renderDetailExtra(container: HTMLElement): void;
export { renderHighlightedLabel };
```

---

## TDD Anchors

The following tests prove this step is complete. All should be added to `tests/plugins/command-bar/command-bar.test.ts` in a new describe block `"Step 01 — Mode Infrastructure"`:

```
it("setMode updates _mode badge text to 'Files', 'Commands', 'Keybindings'")
it("MODE_PLACEHOLDERS has correct placeholder for each mode")
it("MODE_FOOTER_HINTS has correct hint for each mode")
it("buildOverlayDOM returns element containing .cb-mode-badge button")
it("buildOverlayDOM returns element containing .cb-footer")
it("buildOverlayDOM returns element containing .cb-preset-row with cb-preset-row--hidden class")
it("badge click cycles Files → Commands → Keybindings → Files")
it("prefix '>' in files mode switches to commands mode and clears input")
it("prefix '#' in files mode switches to keybindings mode and clears input")
it("'>' in commands mode is treated as a normal search character (EC-08)")
it("'#' in keybindings mode is treated as a normal search character (EC-09)")
it("Backspace on empty input in commands mode returns to files mode (FR-06.3)")
it("Backspace on empty input in keybindings mode returns to files mode (FR-06.3)")
it("Backspace on non-empty input in commands mode does not switch modes (FR-06.4)")
it("Backspace on empty input in files mode is a no-op (EC-10)")
it("openBar('commands') while bar already open in commands mode closes bar (EC-13)")
it("openBar('files') while bar already open in commands mode switches to files mode (EC-12)")
it("closeBar resets _mode to 'files' (FR-01.9)")
it("__MARKABLE_COMMAND_BAR_OPEN__ accepts optional mode argument")
```

Additionally, run the full existing test suite to verify the 84 tests still pass after the `showRecentFiles` default-setting change and the `buildOverlayDOM` DOM update.

---

## Definition of Done

- [ ] `BarMode` type is exported
- [ ] `setMode()` is exported and updates badge text, placeholder, footer text, and preset row visibility
- [ ] `buildOverlayDOM()` produces `.cb-mode-badge`, `.cb-footer`, and `.cb-preset-row` elements
- [ ] `openBar(mode?)` accepts optional mode; toggle-same closes; switch-different switches without closing
- [ ] `closeBar()` resets `_mode` to `"files"`
- [ ] Prefix `>` and `#` switch modes from Files mode only; do not fire when already in target mode
- [ ] Backspace on empty input returns to Files mode from Commands or Keybindings mode
- [ ] Badge click cycles through all three modes
- [ ] `file-print` defaultKey changed to `""` (confirmed: no default key; accessible via menu and Commands bar)
- [ ] Two new COMMANDS entries added: `command-bar-open-files` (Cmd-P), `command-bar-open-keybindings` (Cmd-Shift-K)
- [ ] `main.ts` handles the two new action ids and the `"markable-keybindings-changed"` event
- [ ] All 84 existing tests pass
- [ ] New mode infrastructure tests pass
