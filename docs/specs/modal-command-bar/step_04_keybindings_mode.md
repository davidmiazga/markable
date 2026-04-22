---
title: "Step 04 — Keybindings Mode + Key-Capture Sub-State"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 04 — Keybindings Mode + Key-Capture Sub-State

## Goal and Scope

Implement Keybindings mode (the actions list with current key badges) and the key-capture sub-state (the inline assignment flow). At the end of this step:

- `openBar("keybindings")` shows all actions with their current binding and a "(default)" or "(custom)" label
- Pressing Enter on an action enters key-capture sub-state
- A valid key combo saves the binding, dispatches the cache-invalidation event, and closes the bar
- Conflicts, system-reserved combos, same-action combos, and write failures are all handled
- The "Reset to default" button removes a custom binding
- Escape anywhere in the key-capture flow returns to Keybindings mode search
- The plugin disabled mid-capture edge case (EC-30) is handled

---

## Files to Create

### `src/plugins/command-bar/keybindings-mode.ts`

All pure functions, fully testable without DOM or window globals.

```typescript
// ── Types ──────────────────────────────────────────────────────────────────

/** A CommandDef entry from keybindings-panel.ts (available via __MARKABLE_COMMANDS__) */
export interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}

/** A keybinding mode result row */
export interface KeybindingResult {
  id: string;              // "kb:${cmd.id}"
  actionId: string;
  label: string;
  activeKey: string;       // resolved binding (custom or default)
  isDefault: boolean;      // true when using defaultKey
  isUnbound: boolean;      // true when activeKey === "" (EC-29)
  dimmed: boolean;
  action: () => void;      // enters key-capture for this action
  _matchPositions?: number[];
}

export interface KeyCaptureResult {
  /** The action being assigned */
  actionId: string;
  actionLabel: string;
  /** The current active binding before capture begins */
  existingKey: string;
}

export type ConflictType = "action" | "system-reserved" | "self";

export interface ConflictInfo {
  type: ConflictType;
  conflictingActionId: string | null;    // null for system-reserved
  conflictingActionLabel: string | null; // null for system-reserved
}

/** Dependency bag for buildKeybindingResults() */
export interface KeybindingBuilderDeps {
  commands: CommandDef[];
  customBindings: Record<string, string>;
  enterCapture: (actionId: string) => void;
}

// ── System-reserved combos (FR-05.8, EC-19, EC-20) ───────────────────────

const SYSTEM_RESERVED_COMBOS: ReadonlySet<string> = new Set([
  "Cmd-Q",
  "Cmd-W",
  "Cmd-Tab",
  "Cmd-M",
  "Cmd-H",
]);

export function isSystemReserved(combo: string): boolean {
  return SYSTEM_RESERVED_COMBOS.has(combo);
}

// ── Key capture from KeyboardEvent ───────────────────────────────────────

const MODIFIER_ONLY_KEYS = new Set(["Meta", "Shift", "Alt", "Control"]);

/**
 * Returns true when the event is a modifier-only keystroke (EC-18).
 * Modifier-only keys are ignored in key-capture sub-state.
 */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIER_ONLY_KEYS.has(e.key);
}

/**
 * Convert a KeyboardEvent to a Markable key string (e.g. "Cmd-Shift-S").
 * Returns null for modifier-only keys (EC-18).
 *
 * Key string format: modifiers in order Cmd, Alt, Shift, Ctrl, then the key.
 * The non-modifier key is uppercased if length === 1 (letter/digit), or used
 * verbatim for named keys (ArrowLeft, Enter, Backspace, etc.).
 */
export function captureKeyFromEvent(e: KeyboardEvent): string | null {
  if (isModifierOnly(e)) return null;
  const parts: string[] = [];
  if (e.metaKey)  parts.push("Cmd");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.ctrlKey)  parts.push("Ctrl");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("-");
}

// ── Conflict detection ────────────────────────────────────────────────────

/**
 * Check whether `combo` conflicts with any existing action.
 *
 * Checks custom bindings first, then default bindings for any command not
 * in custom. Returns ConflictInfo describing the conflict, or null if free.
 *
 * EC-21: if `combo` is already bound to `targetActionId`, returns type "self"
 * (not a blocker — the binding would be unchanged).
 */
export function checkConflict(
  combo: string,
  targetActionId: string,
  commands: CommandDef[],
  customBindings: Record<string, string>,
): ConflictInfo | null {
  if (isSystemReserved(combo)) {
    return { type: "system-reserved", conflictingActionId: null, conflictingActionLabel: null };
  }

  // Check custom bindings
  for (const [actionId, keyStr] of Object.entries(customBindings)) {
    if (keyStr === combo) {
      if (actionId === targetActionId) return { type: "self", conflictingActionId: actionId, conflictingActionLabel: null };
      const cmd = commands.find((c) => c.id === actionId);
      return { type: "action", conflictingActionId: actionId, conflictingActionLabel: cmd?.label ?? actionId };
    }
  }

  // Check default bindings for commands NOT in custom
  for (const cmd of commands) {
    if (cmd.id in customBindings) continue;
    if (cmd.defaultKey === combo) {
      if (cmd.id === targetActionId) return { type: "self", conflictingActionId: cmd.id, conflictingActionLabel: cmd.label };
      return { type: "action", conflictingActionId: cmd.id, conflictingActionLabel: cmd.label };
    }
  }

  return null;
}

// ── Result builder ────────────────────────────────────────────────────────

/**
 * Build Keybindings mode results: one row per command.
 * Does NOT include heading or file results.
 *
 * The command bar itself (`command-bar-open`, `command-bar-open-files`,
 * `command-bar-open-keybindings`) are included — users can rebind them.
 */
export function buildKeybindingResults(deps: KeybindingBuilderDeps): KeybindingResult[] {
  const { commands, customBindings, enterCapture } = deps;
  const results: KeybindingResult[] = [];

  for (const cmd of commands) {
    const activeKey = customBindings[cmd.id] ?? cmd.defaultKey;
    const isDefault = !(cmd.id in customBindings);
    const isUnbound = activeKey === "";
    const actionId = cmd.id;

    results.push({
      id: `kb:${cmd.id}`,
      actionId: cmd.id,
      label: cmd.label,
      activeKey,
      isDefault,
      isUnbound,
      dimmed: false,
      action: () => enterCapture(actionId),
    });
  }

  return results;
}

// ── Key display formatting ─────────────────────────────────────────────────

/**
 * Format a combo string for display (e.g. "Cmd-Shift-S" → "⌘⇧S").
 * Returns "(unbound)" for empty strings (EC-29).
 */
export function formatKeyDisplay(key: string): string {
  if (!key) return "(unbound)";
  return key.split("-").map((part) => {
    switch (part) {
      case "Cmd":   return "⌘";
      case "Shift": return "⇧";
      case "Alt":   return "⌥";
      case "Ctrl":  return "⌃";
      default:      return part;
    }
  }).join("");
}
```

---

## Files to Modify

### `src/plugins/command-bar/command-bar.plugin.ts`

1. **Import `keybindings-mode.ts`**:
   ```typescript
   import {
     buildKeybindingResults,
     captureKeyFromEvent,
     checkConflict,
     isSystemReserved,
     isModifierOnly,
     formatKeyDisplay,
     type KeybindingResult,
     type KeybindingBuilderDeps,
     type ConflictInfo,
     type ConflictType,
   } from "./keybindings-mode";
   ```

2. **Add key-capture module-level state**:
   ```typescript
   let _captureViewEl: HTMLElement | null = null;    // DOM reference set in onEnable
   let _capturingFor: string | null = null;          // action id being assigned; null = not in capture
   let _captureQuery: string = "";                   // saved query to restore on Escape (EC-17)
   let _captureActionLabel: string = "";             // saved label for display
   let _captureExistingKey: string = "";             // saved current binding for display
   ```

3. **Extend `buildOverlayDOM()`** — add `.cb-capture-view` between results and footer:
   ```typescript
   const captureView = document.createElement("div");
   captureView.className = "cb-capture-view cb-capture-view--hidden";
   captureView.setAttribute("aria-live", "assertive");
   panel.insertBefore(captureView, footer);   // before footer, after results
   ```
   `_captureViewEl` is assigned in `onEnable`.

4. **Add `buildResultsForMode("keybindings")` branch**:
   In `buildResultsForMode()`, add:
   ```typescript
   if (mode === "keybindings") {
     return buildKeybindingModeResults() as any as CommandBarResult[];
   }
   ```

   ```typescript
   function buildKeybindingModeResults(): KeybindingResult[] {
     const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
     const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
     const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
     const customBindings: Record<string, string> = appSettings.keybindings ?? {};

     if (cmds.length === 0) {
       console.warn("[CommandBar] __MARKABLE_COMMANDS__ is empty. Keybindings mode has no results.");
       return [];
     }

     return buildKeybindingResults({
       commands: cmds,
       customBindings,
       enterCapture: enterKeyCapture,
     });
   }
   ```

5. **Update `openBar()`** — for keybindings mode, build results synchronously:
   ```typescript
   if (targetMode === "keybindings") {
     _lastBuildError = null;
     try {
       _allResults = buildResultsForMode("keybindings", _settings);
     } catch (err) {
       _lastBuildError = String(err);
       _allResults = [];
     }
     _visibleResults = _allResults;
     _selectedId = firstSelectableId(_visibleResults);
     renderKeybindingResults(_resultsEl!, _visibleResults as any, "", _selectedId);
     updateAriaActiveDescendant(_inputEl!, _selectedId);
     scrollSelectedIntoView(_resultsEl!);
   }
   ```

6. **Add `renderKeybindingResults()` function**:
   ```typescript
   export function renderKeybindingResults(
     container: HTMLElement,
     results: KeybindingResult[],
     query: string,
     selectedId: string | null,
   ): void {
     container.innerHTML = "";

     if (results.length === 0) {
       const empty = document.createElement("div");
       empty.className = "cb-empty";
       empty.textContent = "No actions available";  // EC-16
       container.appendChild(empty);
       return;
     }

     // Section header "Actions"
     const header = document.createElement("div");
     header.className = "cb-section-header";
     header.textContent = "Actions";
     container.appendChild(header);

     let resultIndex = 0;
     for (const result of results) {
       const row = document.createElement("div");
       row.className = "cb-result";
       if (result.id === selectedId) {
         row.classList.add("cb-result--selected");
         row.setAttribute("aria-selected", "true");
       } else {
         row.setAttribute("aria-selected", "false");
       }
       row.setAttribute("role", "option");
       row.setAttribute("data-id", result.id);
       row.id = `cb-result-${resultIndex}`;

       // Label
       const labelEl = document.createElement("div");
       labelEl.className = "cb-result-label";
       if (query && result._matchPositions?.length) {
         labelEl.appendChild(renderHighlightedLabel(result.label, result._matchPositions));
       } else {
         labelEl.textContent = result.label;
       }
       row.appendChild(labelEl);

       // Binding status: "(default)" or "(custom)"
       const statusEl = document.createElement("span");
       statusEl.className = "cb-result-binding-status";
       statusEl.textContent = result.isUnbound ? "(unbound)" : (result.isDefault ? "(default)" : "(custom)");
       row.appendChild(statusEl);

       // Key badge
       if (!result.isUnbound) {
         const keyBadge = document.createElement("kbd");
         keyBadge.className = "cb-result-key cb-result-key-badge";
         keyBadge.textContent = formatKeyDisplay(result.activeKey);
         row.appendChild(keyBadge);
       }

       container.appendChild(row);
       resultIndex++;
     }
   }
   ```

7. **Add `enterKeyCapture(actionId: string)` function**:
   ```typescript
   function enterKeyCapture(actionId: string): void {
     if (!_captureViewEl || !_resultsEl || !_inputEl) return;

     const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
     const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
     const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
     const customBindings: Record<string, string> = appSettings.keybindings ?? {};

     const cmd = cmds.find((c) => c.id === actionId);
     if (!cmd) return;

     _capturingFor = actionId;
     _captureQuery = _inputEl.value;
     _captureActionLabel = cmd.label;
     _captureExistingKey = customBindings[actionId] ?? cmd.defaultKey;

     // Hide results, show capture view
     _resultsEl.classList.add("cb-results--hidden");
     _captureViewEl.classList.remove("cb-capture-view--hidden");
     renderCaptureView("waiting", null);

     // Update input
     _inputEl.value = "";
     _inputEl.placeholder = "Press keys…";
   }
   ```

8. **Add `exitKeyCapture()` function** — restore search state (EC-17):
   ```typescript
   function exitKeyCapture(): void {
     if (!_captureViewEl || !_resultsEl || !_inputEl) return;

     _capturingFor = null;

     // Restore search view
     _captureViewEl.classList.add("cb-capture-view--hidden");
     _resultsEl.classList.remove("cb-results--hidden");

     // Restore query and placeholder
     _inputEl.value = _captureQuery;
     _inputEl.placeholder = MODE_PLACEHOLDERS["keybindings"];
     filterAndRender(_captureQuery.trim());
   }
   ```

9. **Add `renderCaptureView()` function** — renders the capture view DOM:
   ```typescript
   type CaptureViewState =
     | "waiting"
     | { type: "conflict"; info: ConflictInfo }
     | { type: "system-reserved-confirm"; combo: string }
     | { type: "error"; message: string };

   export function renderCaptureView(
     state: CaptureViewState | "waiting",
     _unused: null,
   ): void {
     if (!_captureViewEl) return;
     _captureViewEl.innerHTML = "";

     const actionEl = document.createElement("div");
     actionEl.className = "cb-capture-action";
     actionEl.textContent = _captureActionLabel;
     _captureViewEl.appendChild(actionEl);

     const existingEl = document.createElement("div");
     existingEl.className = "cb-capture-existing";
     existingEl.textContent = _captureExistingKey
       ? `Current binding: ${formatKeyDisplay(_captureExistingKey)}`
       : "Currently unbound";
     _captureViewEl.appendChild(existingEl);

     if (state === "waiting") {
       const prompt = document.createElement("div");
       prompt.className = "cb-capture-prompt";
       prompt.textContent = "Waiting for key combo…";
       _captureViewEl.appendChild(prompt);

       // Reset to default button (FR-07.9)
       if (_captureExistingKey) {
         const resetBtn = document.createElement("button");
         resetBtn.type = "button";
         resetBtn.className = "cb-capture-btn";
         resetBtn.textContent = "Reset to default";
         resetBtn.addEventListener("click", () => handleResetToDefault());
         _captureViewEl.appendChild(resetBtn);
       }
     } else if (typeof state === "object" && state.type === "conflict") {
       const warn = document.createElement("div");
       warn.className = "cb-conflict-warning";
       warn.textContent = `⚠ Already bound to: ${state.info.conflictingActionLabel ?? "System reserved"}`;
       _captureViewEl.appendChild(warn);

       const btns = document.createElement("div");
       btns.className = "cb-capture-buttons";

       const overrideBtn = document.createElement("button");
       overrideBtn.type = "button";
       overrideBtn.className = "cb-capture-btn cb-capture-btn--primary";
       overrideBtn.textContent = "Override";
       overrideBtn.addEventListener("click", () => {
         void handleOverride((state as any)._pendingCombo);
       });
       btns.appendChild(overrideBtn);

       const cancelBtn = document.createElement("button");
       cancelBtn.type = "button";
       cancelBtn.className = "cb-capture-btn";
       cancelBtn.textContent = "Cancel";
       cancelBtn.addEventListener("click", () => exitKeyCapture());
       btns.appendChild(cancelBtn);

       _captureViewEl.appendChild(btns);
     } else if (typeof state === "object" && state.type === "system-reserved-confirm") {
       const warn = document.createElement("div");
       warn.className = "cb-conflict-warning";
       warn.textContent = "This shortcut is reserved by macOS. Are you sure?";
       _captureViewEl.appendChild(warn);

       const btns = document.createElement("div");
       btns.className = "cb-capture-buttons";

       const assignBtn = document.createElement("button");
       assignBtn.type = "button";
       assignBtn.className = "cb-capture-btn cb-capture-btn--primary";
       assignBtn.textContent = "Assign Anyway";
       assignBtn.addEventListener("click", () => void handleOverride(state.combo));
       btns.appendChild(assignBtn);

       const cancelBtn = document.createElement("button");
       cancelBtn.type = "button";
       cancelBtn.className = "cb-capture-btn";
       cancelBtn.textContent = "Cancel";
       cancelBtn.addEventListener("click", () => exitKeyCapture());
       btns.appendChild(cancelBtn);

       _captureViewEl.appendChild(btns);
     } else if (typeof state === "object" && state.type === "error") {
       const errEl = document.createElement("div");
       errEl.className = "cb-conflict-warning";
       errEl.textContent = `Could not save binding: ${state.message}`;
       _captureViewEl.appendChild(errEl);
     }
   }
   ```

   Note: `_pendingCombo` needs to be stored at module level for the Override closure to access it. Add:
   ```typescript
   let _pendingCombo: string = "";
   ```

10. **Add `saveBinding(actionId, combo)` async function**:
    ```typescript
    async function saveBinding(actionId: string, combo: string): Promise<void> {
      const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
      const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
      const currentBindings: Record<string, string> = { ...(appSettings.keybindings ?? {}) };

      // Remove this combo from any other action that has it (FR-05.6 Override case)
      for (const [id, key] of Object.entries(currentBindings)) {
        if (key === combo && id !== actionId) {
          delete currentBindings[id];
        }
      }

      currentBindings[actionId] = combo;

      // Write via the same Tauri command that bridge.saveSettings() uses
      try {
        await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
          settings: JSON.stringify({ keybindings: currentBindings }),
        });
      } catch (err) {
        throw err; // rethrown; caller renders error state (EC-22)
      }

      // Dispatch cache-invalidation event (AD-CB-06, FR-07.10)
      document.dispatchEvent(
        new CustomEvent("markable-keybindings-changed", {
          detail: { keybindings: currentBindings },
        })
      );
    }
    ```

    **Important note for Developer**: The Tauri `save_settings` command in `bridge.ts` expects the full settings object, not a partial merge. The plugin must read the current full settings, merge the keybindings update, and write the merged result. The above snippet only passes `{ keybindings: ... }` which is a partial object. The actual implementation must call `getSettings()` first to get the full settings object, then merge. See `src/lib/bridge.ts` — `saveSettings()` calls `invoke("save_settings", { settings: json })` where `json` is the complete `MarkableSettings` object. The plugin must replicate this: read full settings via `__MARKABLE_GET_SETTINGS__()`, merge the keybindings key, then write the full merged object.

11. **Add `handleOverride(combo)` async function**:
    ```typescript
    async function handleOverride(combo: string): Promise<void> {
      if (!_capturingFor) return;
      try {
        await saveBinding(_capturingFor, combo);
        closeBar();
      } catch (err) {
        // EC-22: write failed; show inline error, do not close
        renderCaptureView({ type: "error", message: String(err) }, null);
      }
    }
    ```

12. **Add `handleResetToDefault()` function** (FR-07.9):
    ```typescript
    async function handleResetToDefault(): Promise<void> {
      if (!_capturingFor) return;
      const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
      const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
      const currentBindings: Record<string, string> = { ...(appSettings.keybindings ?? {}) };

      delete currentBindings[_capturingFor];

      try {
        await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
          settings: JSON.stringify({ keybindings: currentBindings }),
        });
        document.dispatchEvent(
          new CustomEvent("markable-keybindings-changed", {
            detail: { keybindings: currentBindings },
          })
        );
        closeBar();
      } catch (err) {
        renderCaptureView({ type: "error", message: String(err) }, null);
      }
    }
    ```

13. **Update `onOverlayKeydown()`** to handle key-capture sub-state:
    ```typescript
    function onOverlayKeydown(e: KeyboardEvent): void {
      // When in key-capture sub-state, intercept ALL keys (FR-05.3, EC-19, EC-20)
      if (_capturingFor !== null) {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
          exitKeyCapture();  // EC-17
          return;
        }

        if (isModifierOnly(e)) return;  // EC-18: wait for non-modifier

        const combo = captureKeyFromEvent(e)!;
        const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
        const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
        const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
        const customBindings: Record<string, string> = appSettings.keybindings ?? {};

        const conflict = checkConflict(combo, _capturingFor, cmds, customBindings);

        if (conflict === null) {
          // Free combo — save immediately
          void handleOverride(combo);
          return;
        }

        if (conflict.type === "self") {
          // EC-21: same action, same key — treat as no-op (binding unchanged, close bar)
          closeBar();
          return;
        }

        if (conflict.type === "system-reserved") {
          _pendingCombo = combo;
          renderCaptureView({ type: "system-reserved-confirm", combo }, null);
          return;
        }

        // Regular conflict — show Override/Cancel (FR-05.6)
        _pendingCombo = combo;
        const conflictState: any = { type: "conflict", info: conflict, _pendingCombo: combo };
        renderCaptureView(conflictState, null);
        return;
      }

      // Normal keydown handling (existing switch statement)
      switch (e.key) {
        // ... existing cases ...
      }
    }
    ```

14. **Update `closeBar()`** to exit key-capture state (EC-30):
    ```typescript
    function closeBar(): void {
      if (!_overlayEl || !_inputEl || !_isOpen) return;

      // EC-30: exit key-capture cleanly if active
      if (_capturingFor !== null) {
        _capturingFor = null;
        _captureViewEl?.classList.add("cb-capture-view--hidden");
        _resultsEl?.classList.remove("cb-results--hidden");
      }

      _isOpen = false;
      _mode = "files";
      closeCommandBar(_overlayEl, _inputEl);
      _selectedId = null;
      _visibleResults = [];
    }
    ```

15. **Update `onDisable()`** to null `_captureViewEl` and reset capture state:
    ```typescript
    // In onDisable, after existing nulling:
    _captureViewEl = null;
    _capturingFor = null;
    _captureQuery = "";
    _pendingCombo = "";
    ```

16. **Add CSS for key-capture view** to `CSS_TEXT`:
    ```css
    .cb-capture-view {
      padding: 16px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .cb-capture-view--hidden {
      display: none;
    }

    .cb-results--hidden {
      display: none;
    }

    .cb-capture-action {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .cb-capture-existing {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .cb-capture-prompt {
      font-size: 13px;
      color: var(--text-secondary);
      font-style: italic;
    }

    .cb-conflict-warning {
      font-size: 13px;
      color: var(--accent-color);
    }

    .cb-capture-buttons {
      display: flex;
      gap: 8px;
    }

    .cb-capture-btn {
      padding: 5px 12px;
      border-radius: 5px;
      border: 1px solid var(--border-color);
      background: var(--code-bg);
      color: var(--text-primary);
      font-family: var(--ui-font);
      font-size: 12px;
      cursor: pointer;
    }

    .cb-capture-btn--primary {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
    }

    .cb-result-binding-status {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .cb-result-key-badge {
      font-family: var(--key-font);
      font-size: 11px;
      padding: 2px 5px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--text-secondary);
      white-space: nowrap;
      flex-shrink: 0;
    }
    ```

---

## Exported Interfaces and Functions (from `keybindings-mode.ts`)

```typescript
export type ConflictType = "action" | "system-reserved" | "self";
export interface ConflictInfo { ... }
export interface KeybindingResult { ... }
export interface CommandDef { ... }
export function isSystemReserved(combo: string): boolean;
export function isModifierOnly(e: KeyboardEvent): boolean;
export function captureKeyFromEvent(e: KeyboardEvent): string | null;
export function checkConflict(combo, targetActionId, commands, customBindings): ConflictInfo | null;
export function buildKeybindingResults(deps): KeybindingResult[];
export function formatKeyDisplay(key: string): string;
```

---

## TDD Anchors

New describe block: `"Step 04 — Keybindings Mode + Key-Capture"`:

```
// isSystemReserved
it("Cmd-Q is system reserved (EC-19)")
it("Cmd-W is system reserved (EC-20)")
it("Cmd-Tab is system reserved")
it("Cmd-S is NOT system reserved")

// isModifierOnly
it("returns true for bare Meta, Shift, Alt, Control keys (EC-18)")
it("returns false for Cmd-S")

// captureKeyFromEvent
it("returns null for modifier-only keys (EC-18)")
it("captures Cmd-Shift-S correctly")
it("uppercases single-character key")
it("uses verbatim name for ArrowLeft")

// checkConflict
it("returns null for a free combo")
it("returns 'self' when combo matches targetActionId (EC-21)")
it("returns 'action' conflict when combo matches another action")
it("returns 'system-reserved' for Cmd-Q (EC-19)")
it("custom bindings take priority over defaults in conflict scan")

// buildKeybindingResults
it("returns one result per command")
it("marks default binding as isDefault=true")
it("marks custom binding as isDefault=false")
it("EC-29: marks empty defaultKey as isUnbound=true")
it("EC-16: returns empty array when commands list is empty")

// formatKeyDisplay
it("formats Cmd-Shift-S as ⌘⇧S")
it("returns '(unbound)' for empty string (EC-29)")

// DOM/integration tests (require DOM)
it("enterKeyCapture hides results and shows capture view")
it("exitKeyCapture restores results and restores query (EC-17)")
it("Escape in key-capture exits capture (EC-17)")
it("modifier-only keypress in capture is ignored (EC-18)")
it("system-reserved combo shows second confirmation (EC-19)")
it("EC-20: Cmd-W in capture shows system-reserved flow, does not close tab")
it("free combo saves binding and closes bar")
it("conflicting combo shows Override/Cancel buttons")
it("Override saves binding removing conflict and closes bar")
it("Cancel in conflict view returns to search")
it("EC-21: same-action combo closes bar without conflict warning")
it("EC-22: save failure shows inline error, bar does not close")
it("Reset to default removes custom binding and closes bar (FR-07.9)")
it("EC-30: closeBar from outside while capturing cleans up capture state")
```

---

## Definition of Done

- [ ] `src/plugins/command-bar/keybindings-mode.ts` exists with all exported pure functions
- [ ] `buildKeybindingResults()` returns correct results with isDefault/isUnbound flags
- [ ] `captureKeyFromEvent()` handles modifier-only correctly
- [ ] `checkConflict()` returns correct ConflictType for all cases including EC-21
- [ ] `isSystemReserved()` covers all 5 reserved combos
- [ ] `enterKeyCapture()` transitions DOM to capture view
- [ ] `exitKeyCapture()` restores query and search view (EC-17)
- [ ] All 5 key-capture flows work: free combo, conflict (override/cancel), system-reserved (confirm/cancel), same-action (EC-21), write-failure (EC-22)
- [ ] "Reset to default" removes custom binding (FR-07.9)
- [ ] `closeBar()` exits capture cleanly (EC-30)
- [ ] `__MARKABLE_EDITOR_VIEW__.focus()` is called on bar close from any state (NFR-07)
- [ ] `markable-keybindings-changed` CustomEvent is dispatched after every successful write
- [ ] All 84 existing tests pass
- [ ] All new keybindings mode tests pass
