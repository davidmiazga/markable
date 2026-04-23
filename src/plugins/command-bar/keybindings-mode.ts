/**
 * keybindings-mode.ts — Pure functions for the Keybindings mode of the Command Bar.
 *
 * This module contains all domain logic for listing commands, resolving active
 * bindings, detecting conflicts, and formatting key combos for display. It has
 * no DOM dependencies and no window global access, making every function here
 * directly unit-testable in isolation.
 *
 * Consumed by command-bar.plugin.ts, which supplies the window globals and DOM
 * state that drive the key-capture sub-state.
 */

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

/**
 * Key combos that macOS reserves at the OS level. Assigning these will
 * trigger a system-reserved confirmation dialog (second-chance prompt)
 * rather than silently allowing the override.
 *
 * Cmd-Q: Quit application
 * Cmd-W: Close window/tab
 * Cmd-Tab: Application switcher
 * Cmd-M: Minimize window
 * Cmd-H: Hide application
 */
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

/**
 * Keys whose presence alone (without another non-modifier key) does NOT
 * constitute a complete key combo. We wait for a "real" key before resolving
 * the combo string. This prevents accidentally assigning "Cmd" as a binding
 * when the user just presses and releases the Command key (EC-18).
 */
const MODIFIER_ONLY_KEYS = new Set(["Meta", "Shift", "Alt", "Control"]);

/**
 * Returns true when the event is a modifier-only keystroke (EC-18).
 * Modifier-only keys are ignored in key-capture sub-state — we keep waiting
 * for the user to press an actual character or named key alongside the modifier.
 *
 * @param e - The keyboard event to inspect.
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
 *
 * @param e - The keyboard event from the capture listener.
 * @returns A combo string like "Cmd-Shift-S" or null if modifier-only.
 */
export function captureKeyFromEvent(e: KeyboardEvent): string | null {
  if (isModifierOnly(e)) return null;
  const parts: string[] = [];
  // Modifiers are ordered: Cmd, Alt, Shift, Ctrl (consistent with keybindings-panel.ts).
  if (e.metaKey)  parts.push("Cmd");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.ctrlKey)  parts.push("Ctrl");
  // Single-char keys (letters, digits) are uppercased; named keys (ArrowLeft, etc.) are verbatim.
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("-");
}

// ── Conflict detection ────────────────────────────────────────────────────

/**
 * Check whether `combo` conflicts with any existing action.
 *
 * Resolution order:
 *   1. System-reserved: always flagged regardless of any bindings.
 *   2. Custom bindings: if any action has `combo` as its custom binding, that wins.
 *   3. Default bindings: for actions NOT in customBindings, check the default key.
 *      (An action whose default key is shadowed by a custom binding is no longer
 *       considered to "own" that default key — the custom binding takes precedence.)
 *
 * EC-21: if `combo` is already bound to `targetActionId`, returns type "self"
 * (not a blocker — the binding would be unchanged; bar can close silently).
 *
 * @param combo           - The combo the user pressed (e.g. "Cmd-S").
 * @param targetActionId  - The action the user is trying to assign to.
 * @param commands        - Full list of CommandDef entries.
 * @param customBindings  - Current custom bindings map (actionId → combo).
 * @returns ConflictInfo or null if the combo is free.
 */
export function checkConflict(
  combo: string,
  targetActionId: string,
  commands: CommandDef[],
  customBindings: Record<string, string>,
): ConflictInfo | null {
  // Step 1: OS-reserved combos always produce a system-reserved conflict (EC-19, EC-20).
  if (isSystemReserved(combo)) {
    return { type: "system-reserved", conflictingActionId: null, conflictingActionLabel: null };
  }

  // Step 2: Check custom bindings first — they shadow defaults.
  for (const [actionId, keyStr] of Object.entries(customBindings)) {
    if (keyStr === combo) {
      if (actionId === targetActionId) {
        // EC-21: same action already has this combo as a custom binding.
        return { type: "self", conflictingActionId: actionId, conflictingActionLabel: null };
      }
      const cmd = commands.find((c) => c.id === actionId);
      return { type: "action", conflictingActionId: actionId, conflictingActionLabel: cmd?.label ?? actionId };
    }
  }

  // Step 3: Check default bindings for commands NOT in customBindings.
  // An action in customBindings no longer "owns" its defaultKey — the custom binding
  // has overridden it, so its defaultKey is effectively freed.
  for (const cmd of commands) {
    if (cmd.id in customBindings) continue; // custom binding already checked above
    if (cmd.defaultKey === combo) {
      if (cmd.id === targetActionId) {
        // EC-21: same action already owns this default key.
        return { type: "self", conflictingActionId: cmd.id, conflictingActionLabel: cmd.label };
      }
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
 * Each result carries:
 *   - `activeKey`: the resolved binding (custom if present, otherwise default)
 *   - `isDefault`: true when no custom binding exists for this action
 *   - `isUnbound`: true when the active key is an empty string (EC-29)
 *   - `action`: closure that calls `enterCapture(actionId)` to start key-capture sub-state
 *
 * The command-bar commands themselves (`command-bar-open`, etc.) are included
 * — users can rebind them.
 *
 * @param deps - Dependency bag: commands list, current custom bindings, enterCapture callback.
 * @returns Array of KeybindingResult, one per command.
 */
export function buildKeybindingResults(deps: KeybindingBuilderDeps): KeybindingResult[] {
  const { commands, customBindings, enterCapture } = deps;
  const results: KeybindingResult[] = [];

  for (const cmd of commands) {
    const activeKey = customBindings[cmd.id] ?? cmd.defaultKey;
    const isDefault = !(cmd.id in customBindings);
    const isUnbound = activeKey === "";
    // Capture actionId in a local const so the closure captures the current value,
    // not the loop variable (classic JS loop-closure pitfall).
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
 *
 * Modifier mapping:
 *   Cmd   → ⌘  (Command)
 *   Shift → ⇧  (Shift)
 *   Alt   → ⌥  (Option/Alt)
 *   Ctrl  → ⌃  (Control)
 *
 * @param key - A combo string like "Cmd-Shift-S" or "" for unbound.
 * @returns Display string with Unicode modifier symbols.
 */
export function formatKeyDisplay(key: string): string {
  if (!key) return "(unbound)";
  return key.split("-").map((part) => {
    switch (part) {
      case "Cmd":   return "⌘";
      case "Shift": return "⇧";
      case "Alt":   return "⌥";
      case "Ctrl":  return "⌃";
      // Named keys (ArrowLeft, Enter, etc.) and letter/digit characters pass through verbatim.
      default:      return part;
    }
  }).join("");
}
