/**
 * insert-count.logic.ts
 *
 * Pure logic functions for the Insert Count plugin. Separated from the IIFE
 * plugin file so they can be unit-tested directly without eval or DOM setup.
 *
 * This mirrors the command-bar / fuzzy-ranker.ts split pattern. The plugin
 * file imports these functions and re-uses them; tests import from here.
 *
 * All functions are stateless — no module-level mutation, no side effects.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

/**
 * The three user-configurable values for an Insert Count invocation.
 * Persisted via api.loadSettings() / api.saveSettings().
 */
export interface InsertCountSettings {
  /** The first value inserted (at index 0). Defaults to 1. */
  start: number;
  /** Added to `start` once per position: value = start + index * step. Defaults to 1. */
  step: number;
  /**
   * Optional text pattern. If it contains "#", all occurrences are replaced
   * with the number. If it has no "#", the number is appended after the pattern.
   * Empty string → bare number only.
   */
  wrap: string;
}

/**
 * A single insertion point in the document.
 * Produced by resolveInsertionPositions() and consumed by buildChanges().
 */
export interface InsertionPosition {
  /** Document offset (character position) at which to insert text. */
  offset: number;
  /** Zero-based index in the sequence. Formatted value = start + index * step. */
  index: number;
}

/**
 * Minimal structural interface for CM6 EditorState, duck-typed so tests can
 * supply plain objects without importing @codemirror/state.
 *
 * The real EditorState satisfies this interface at runtime.
 */
export interface EditorStateLike {
  readOnly: boolean;
  selection: {
    ranges: Array<{ from: number; to: number; head: number; anchor: number }>;
  };
  doc: {
    lineAt(pos: number): { number: number; from: number; to: number; length: number };
    line(n: number): { number: number; from: number; to: number; length: number };
  };
}

/**
 * Minimal CM6 ChangeSpec — a pure insertion when from === to.
 * Matches @codemirror/state ChangeSpec exactly; typed here to keep the
 * logic file free of CM6 package imports.
 */
export interface ChangeSpec {
  from: number;
  to: number;
  insert: string;
}

// ── formatValue ───────────────────────────────────────────────────────────────

/**
 * Compute the formatted string for a single position in the sequence.
 *
 * FR-03.6 substitution rules (in priority order):
 *  1. wrap is empty  → return the bare number string.
 *  2. wrap contains "#"  → replace ALL occurrences via replaceAll (EC-12).
 *  3. wrap has no "#"  → append the number after the wrap string (EC-10).
 *
 * @param start  Starting value (value at index 0).
 * @param step   Increment per position.
 * @param wrap   Optional text pattern string.
 * @param index  Zero-based position index.
 * @returns      The formatted string to insert.
 */
export function formatValue(start: number, step: number, wrap: string, index: number): string {
  // Compute the numeric value for this position.
  const value = start + index * step;
  const numStr = String(value);

  // Rule 1: empty pattern → bare number.
  if (!wrap) return numStr;

  // Rule 2: "#" token present → replace all occurrences (replaceAll handles EC-12).
  if (wrap.includes("#")) {
    return wrap.replaceAll("#", numStr);
  }

  // Rule 3: no "#" token → append number after pattern string.
  return wrap + numStr;
}

// ── validateInputs ─────────────────────────────────────────────────────────────

/**
 * Validate the raw string values from the Start and Step dialog inputs.
 *
 * Returns a plain result object so the dialog DOM code and unit tests can
 * consume validation results without sharing internal state.
 *
 * @param startStr  Raw string from the "Start at" input.
 * @param stepStr   Raw string from the "Count by" input.
 * @returns         { valid, startError, stepError }
 */
export function validateInputs(
  startStr: string,
  stepStr: string,
): { valid: boolean; startError: string; stepError: string } {
  let valid = true;
  let startError = "";
  let stepError = "";

  // Start: must be non-empty and a whole integer (positive, zero, or negative).
  const trimmedStart = startStr.trim();
  if (!trimmedStart) {
    // EC-15: empty field.
    startError = "Required";
    valid = false;
  } else if (!isInteger(trimmedStart)) {
    // EC-13: non-integer (decimal or non-numeric).
    startError = "Must be a whole number";
    valid = false;
  }

  // Step: must be non-empty, whole integer, and non-zero (EC-08, FR-05.2).
  const trimmedStep = stepStr.trim();
  if (!trimmedStep) {
    stepError = "Required";
    valid = false;
  } else if (!isInteger(trimmedStep)) {
    // EC-14: non-integer step.
    stepError = "Must be a whole number";
    valid = false;
  } else if (parseInt(trimmedStep, 10) === 0) {
    // EC-08: zero step is explicitly forbidden.
    stepError = "Step cannot be zero";
    valid = false;
  }

  return { valid, startError, stepError };
}

/**
 * Returns true if the trimmed string represents a valid integer
 * (optional leading minus, then one or more digits, nothing else).
 * Rejects decimals ("1.5"), scientific notation ("1e5"), and
 * non-numeric strings ("abc").
 *
 * Used by both validateInputs() (logic layer) and the dialog input handlers.
 *
 * @param s  String to test. Should already be trimmed.
 */
export function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s.trim());
}

// ── resolveInsertionPositions ─────────────────────────────────────────────────

/**
 * Determine insertion positions from the current CM6 editor state.
 *
 * Priority order (AD-05):
 *   Mode A — Multi-cursor: more than one selection range.
 *   Mode B — Single selection spanning multiple lines.
 *   Mode C — Single cursor or single-line selection.
 *
 * The returned array is always sorted by ascending offset. CM6 requires
 * ChangeSpec entries to be in document order (ascending `from`).
 *
 * @param state  CM6 EditorState (or EditorStateLike mock for tests).
 * @returns      Array of InsertionPosition, sorted ascending by offset.
 */
export function resolveInsertionPositions(state: EditorStateLike): InsertionPosition[] {
  const ranges = Array.from(state.selection.ranges);

  // ── Mode A: multiple cursor ranges ─────────────────────────────────────────
  // Each range's `from` position becomes an insertion point.
  // Sort defensively: CM6 usually provides ranges in document order, but
  // sorting guarantees ascending `from` for CM6's ChangeSet (EC-23).
  if (ranges.length > 1) {
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    return sorted.map((r, i) => ({ offset: r.from, index: i }));
  }

  // ── Single range handling ───────────────────────────────────────────────────
  const range = ranges[0];
  const from = range.from;
  const to = range.to;

  // ── Mode C: bare cursor (no selection) ─────────────────────────────────────
  // EC-03: single cursor inserts only the Start value once at `from`.
  if (from === to) {
    return [{ offset: from, index: 0 }];
  }

  // ── Determine line span ─────────────────────────────────────────────────────
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  // ── Mode C (single-line selection): EC-07 ──────────────────────────────────
  // If both ends of the selection are on the same line, treat as Mode C:
  // insert at `from` (the anchor/smaller position).
  if (startLine.number === endLine.number) {
    return [{ offset: from, index: 0 }];
  }

  // ── Mode B: selection spanning multiple lines ──────────────────────────────
  // Insert at the cursor's column on each covered line (UK-02, FR-03.3).
  // `head` is where the cursor blinks; its column determines the insertion column.
  const headLine = state.doc.lineAt(range.head);
  const cursorCol = range.head - headLine.from;

  const positions: InsertionPosition[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    // If the line is shorter than cursorCol, clamp to line end (FR-03.3 / UK-02).
    const col = Math.min(cursorCol, line.length);
    positions.push({ offset: line.from + col, index: positions.length });
  }

  return positions;
}

// ── buildChanges ──────────────────────────────────────────────────────────────

/**
 * Produce an array of CM6 ChangeSpec objects for a single dispatch call.
 *
 * Each spec is a pure insertion (from === to), which pushes existing text right.
 * The array is in ascending offset order (guaranteed by resolveInsertionPositions).
 *
 * CM6's ChangeSet handles offset collision for same-line multi-cursor cases
 * automatically — we do NOT adjust offsets manually (EC-23, AD-04).
 *
 * @param positions  Insertion positions sorted by ascending offset.
 * @param config     Start, step, and wrap values for formatting.
 * @returns          Array of CM6 ChangeSpec objects ready for view.dispatch().
 */
export function buildChanges(positions: InsertionPosition[], config: InsertCountSettings): ChangeSpec[] {
  return positions.map((pos) => ({
    from: pos.offset,
    to: pos.offset, // Pure insertion — no text is replaced.
    insert: formatValue(config.start, config.step, config.wrap, pos.index),
  }));
}

// ── computePostInsertionCursor ─────────────────────────────────────────────────

/**
 * Compute the document offset for the collapsed cursor after all insertions.
 *
 * FR-03.5: after Insert, the cursor collapses to immediately after the last
 * inserted string.
 *
 * The `selection` field passed to CM6's view.dispatch() is interpreted in
 * POST-dispatch (new-document) coordinates. We therefore must account for
 * the cumulative shift introduced by all insertions before the last one.
 *
 * Algorithm:
 *   shift = sum of lengths of formatted strings for positions 0 .. (n-2)
 *   cursor = lastPosition.offset + shift + lastFormatted.length
 *
 * Positions are sorted ascending, so every insertion before `last` shifts
 * the final position by its string length.
 *
 * @precondition `positions` must be sorted in ascending order by `offset`.
 *   This invariant is always satisfied when the array comes from
 *   `resolveInsertionPositions()`, which sorts defensively before returning.
 *   Violating the precondition produces an incorrect cursor position because
 *   the shift accumulation assumes earlier entries have smaller offsets.
 *
 * @param positions  Insertion positions sorted by ascending offset.
 * @param config     Start, step, and wrap values (same as passed to buildChanges).
 * @returns          Post-dispatch document offset for the collapsed cursor.
 */
export function computePostInsertionCursor(
  positions: InsertionPosition[],
  config: InsertCountSettings,
): number {
  if (positions.length === 0) return 0;

  const last = positions[positions.length - 1];
  const lastFormatted = formatValue(config.start, config.step, config.wrap, last.index);

  // Accumulate the total characters inserted before the last position.
  // Each earlier insertion shifts subsequent offsets by that string's length.
  let shift = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    shift += formatValue(config.start, config.step, config.wrap, positions[i].index).length;
  }

  return last.offset + shift + lastFormatted.length;
}

// ── persistSettings ───────────────────────────────────────────────────────────

/**
 * Persist the insert-count settings via the plugin API.
 *
 * Extracted from applyInsertions so that function stays under 20 lines.
 * EC-26: saveSettings rejection is caught and logged here; the insertion
 * has already been applied to the document and is NOT rolled back.
 * FR-04.3, EC-16: settings are saved only after a confirmed insertion.
 *
 * @param config  Validated InsertCountSettings to persist.
 * @param api     MarkablePluginAPI instance (or compatible mock).
 */
async function persistSettings(
  config: InsertCountSettings,
  api: { saveSettings(data: Record<string, unknown>): Promise<void> },
): Promise<void> {
  try {
    await api.saveSettings({ start: config.start, step: config.step, wrap: config.wrap });
  } catch (err) {
    console.warn("[insert-count] Failed to save settings:", err);
  }
}

// ── applyInsertions ────────────────────────────────────────────────────────────

/**
 * Apply the insertion sequence to the editor as a single CM6 transaction.
 *
 * This function is exported so integration tests can call it directly with
 * a mocked view and api (Group F in step_05_tests.md).
 *
 * The api parameter is threaded in explicitly (rather than closing over a
 * module-level variable) so tests can inject a mock without eval.
 *
 * EC-27: Read-only guard — if view.state.readOnly is true, skip dispatch
 * and skip settings persistence. No crash, no error shown to the user.
 * NFR-01, EC-05: All insertions are one view.dispatch() call → single Undo.
 * Settings persistence delegates to persistSettings() (EC-26, FR-04.3).
 *
 * @param view    CM6 EditorView (or compatible mock with .state and .dispatch).
 * @param config  Validated InsertCountSettings from the dialog.
 * @param api     MarkablePluginAPI instance for saveSettings (may be null in tests).
 */
export async function applyInsertions(
  view: { state: EditorStateLike; dispatch: (spec: { changes: ChangeSpec[]; selection?: { anchor: number }; scrollIntoView?: boolean }) => void } | null,
  config: InsertCountSettings,
  api: { saveSettings(data: Record<string, unknown>): Promise<void> } | null,
): Promise<void> {
  // EC-01: No editor view → silent no-op.
  if (!view) return;

  // EC-27: Read-only guard.
  if (view.state.readOnly) {
    console.warn("[insert-count] Editor is read-only; skipping dispatch.");
    return;
  }

  const positions = resolveInsertionPositions(view.state);
  if (positions.length === 0) return;

  const changes = buildChanges(positions, config);
  const anchor = computePostInsertionCursor(positions, config);

  // Single CM6 transaction — NFR-01, EC-05. scrollIntoView keeps cursor visible.
  view.dispatch({ changes, selection: { anchor }, scrollIntoView: true });

  // Persist settings only after the insertion is confirmed (FR-04.3, EC-16).
  if (api) await persistSettings(config, api);
}
