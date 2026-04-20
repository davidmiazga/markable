---
title: "Step 05 — MermaidWidget: async render + error path"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 05: MermaidWidget

**Requirement:** FR-04 (Rendering Strategy), FR-05 (Error Display), AD-07 (Async render deferred-DOM), AD-08 (Unique render IDs), NFR-06 (SVG output), NFR-08 (XSS safety)
**Files modified:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Replace the temporary `MermaidWidget` stub from step_04 with the full implementation. This widget:
- Returns a placeholder `<div>` synchronously from `toDOM()` (CM6 requirement)
- Asynchronously calls `mermaid.render()` and injects the resulting SVG into the placeholder
- Displays a styled error placeholder on render failure (FR-05)
- Implements `eq()` to compare source strings for DOM reuse (FR-04.4)
- Uses a module-level counter for unique render IDs (AD-08, EC-19)

---

## Implementation Instructions

Remove the temporary `MermaidWidget` stub added in step_04. Replace it with the following full implementation. Insert this block in `diagrams.plugin.ts` after the `buildDiagramDecorations` function and before the `onEnable` stub.

### MermaidWidget class

```typescript
/**
 * CM6 WidgetType for a mermaid fenced code block.
 *
 * Implements the deferred-DOM async render pattern (AD-07, OQ-04):
 *   toDOM() returns a placeholder <div> synchronously (CM6 sync requirement).
 *   An async Promise chain then calls mermaid.render() and mutates the
 *   placeholder's innerHTML when the render resolves.
 *
 * This DOM mutation occurs outside CM6's transaction model, which is
 * intentional and safe for display-only widgets. CM6 does not track widget-
 * internal DOM content after initial placement.
 *
 * eq() compares source strings so CM6 can reuse the existing DOM node when
 * the mermaid source has not changed (e.g. cursor moves in and out without
 * editing). Same source = same SVG output = no re-render needed (FR-04.4, EC-14).
 *
 * ignoreEvent() returns false so mouse clicks pass through to CM6, moving
 * the cursor into the block range and triggering source reveal (FR-04.5).
 *
 * Unique IDs (AD-08, EC-19): each MermaidWidget instance uses a fresh render ID
 * derived from the module-level _renderCounter. The counter increments in the
 * constructor so IDs are unique across all widget instances in a document.
 * IDs never reuse values across enable cycles — the counter is never reset.
 * This makes ID collision (EC-19) practically impossible.
 *
 * XSS safety (NFR-08): Mermaid 11.x uses securityLevel: "strict" by default,
 * which sanitizes SVG output and removes any embedded <script> elements.
 * The plugin sets securityLevel explicitly in mermaid.initialize() (step_07)
 * as a belt-and-suspenders guard. EC-15 is handled by Mermaid itself.
 */
export class MermaidWidget extends (WidgetType as typeof WidgetTypeClass) {
  /** Raw Mermaid source passed to mermaid.render(). */
  readonly source: string;
  /** Unique render element ID for this widget instance. */
  private readonly renderId: string;

  constructor(source: string) {
    super();
    this.source = source;
    // Increment before assignment so IDs start at 1 (never 0).
    _renderCounter++;
    this.renderId = `mermaid-widget-${_renderCounter}`;
  }

  /**
   * Equality check. CM6 calls this when it has an existing DOM node for a
   * widget at the same document position and considers reusing it.
   *
   * Two widgets are equal iff their source strings are identical. When the
   * user edits the mermaid source and the cursor moves away, the new source
   * differs and eq() returns false — CM6 calls toDOM() to create a fresh node
   * and re-renders the SVG (EC-13).
   *
   * When the cursor enters and exits without editing, the source is unchanged
   * and eq() returns true — CM6 reuses the existing DOM node, skipping the
   * async render entirely (EC-14).
   */
  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  /**
   * Create the DOM element for this widget.
   *
   * Returns a placeholder <div> immediately (synchronous — CM6 requirement).
   * The placeholder has class "cm-mermaid-block cm-mermaid-loading" which
   * displays a "Rendering diagram…" indicator via CSS ::before (NFR-01).
   *
   * An async Promise chain immediately fires to call mermaid.render():
   *   - On success: the returned SVG string is injected into the placeholder
   *     via innerHTML and the loading class is removed.
   *   - On failure: the placeholder is populated with an error element (FR-05).
   *
   * Tab-switch safety (EC-22): if the user switches tabs while the render is
   * in flight, the Promise still resolves and mutates the placeholder div.
   * If the div has been detached from the DOM (tab no longer active), the
   * mutation is harmless — no error is thrown, no crash occurs.
   *
   * Very large diagram (EC-05): Mermaid may take longer than 300ms for complex
   * diagrams. The loading placeholder is shown immediately (within one frame)
   * so the user sees feedback. NFR-01 timing goal applies to simple diagrams;
   * complex ones exceed it by design.
   */
  toDOM(): HTMLElement {
    const placeholder = document.createElement("div");
    placeholder.className = "cm-mermaid-block cm-mermaid-loading";

    // Apply max-width from current settings as a CSS custom property on the element.
    // This overrides the CSS variable default set in the stylesheet (step_03).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const maxWidth = (_settings as any).maxRenderWidth ?? DEFAULT_SETTINGS.maxRenderWidth;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    placeholder.style.setProperty("--mermaid-max-width", `${maxWidth}px`);

    // Fire the async render immediately. The Promise runs in the microtask queue.
    // toDOM() returns the placeholder synchronously before the Promise settles.
    void this._renderAsync(placeholder);

    return placeholder;
  }

  /**
   * Perform the async Mermaid render and mutate the placeholder div.
   *
   * This method is private to the class. It is called from toDOM() and
   * must not be called from outside the widget.
   *
   * @param placeholder - The <div> returned by toDOM() that will be mutated.
   */
  private async _renderAsync(placeholder: HTMLElement): Promise<void> {
    // Guard: if source is empty (EC-01, EC-02), show an error state immediately.
    // Mermaid returns an empty/invalid SVG for empty source; skip the render call.
    if (!this.source.trim()) {
      this._showError(placeholder, this.source, "Empty diagram source");
      return;
    }

    try {
      // mermaid.render() returns Promise<{ svg: string; bindFunctions?: (el: Element) => void }>.
      // We use only the svg string.
      const { svg } = await mermaid.render(this.renderId, this.source);

      // Remove loading class and inject the SVG.
      // innerHTML is safe here: Mermaid's securityLevel: "strict" sanitizes the output (NFR-08, EC-15).
      placeholder.classList.remove("cm-mermaid-loading");
      placeholder.innerHTML = svg;
    } catch (err) {
      // Mermaid rejected the render — invalid syntax or unsupported diagram type (EC-04).
      const message = err instanceof Error ? err.message : String(err);
      this._showError(placeholder, this.source, message);
    }
  }

  /**
   * Populate the placeholder with an error display (FR-05).
   *
   * Called when mermaid.render() throws or when source is empty.
   * Removes the loading class and adds the error class.
   * The raw source is shown in a <pre> block when showErrorSource is true (FR-08.1).
   *
   * @param placeholder - The container div to populate.
   * @param source      - Raw Mermaid source (shown in <pre> if showErrorSource is true).
   * @param message     - Error message text to display.
   */
  private _showError(placeholder: HTMLElement, source: string, message: string): void {
    placeholder.classList.remove("cm-mermaid-loading");
    placeholder.classList.add("cm-mermaid-error");

    const label = document.createElement("span");
    label.className = "cm-mermaid-error-label";
    label.textContent = `Diagram error: ${message}`;
    placeholder.appendChild(label);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const showSource = (_settings as any).showErrorSource ?? DEFAULT_SETTINGS.showErrorSource;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (showSource && source) {
      const pre = document.createElement("pre");
      // textContent for XSS safety — do not use innerHTML for user source.
      pre.textContent = source;
      placeholder.appendChild(pre);
    }
  }

  /**
   * Allow mouse events to pass through to CM6.
   * Returning false lets clicks move the cursor into the block's document range,
   * which triggers the StateField to remove the decoration and reveal raw source.
   */
  ignoreEvent(): boolean {
    return false;
  }
}
```

---

## Key Design Decisions (step_05)

### Unique render IDs (AD-08, EC-19)

`_renderCounter` is a module-level integer declared in step_03. It is incremented in `MermaidWidget`'s constructor. IDs take the form `mermaid-widget-N` where N is the counter value at construction time. Because the counter never resets (even across enable/disable cycles), IDs are globally unique within the JS context lifetime. Two blocks in the same document will always receive different IDs. Mermaid's internal ID-collision error (EC-19) cannot occur.

### Empty/whitespace source (EC-01, EC-02)

`toDOM()` checks `this.source.trim()` before calling `mermaid.render()`. Empty or whitespace-only source goes directly to `_showError()` with the message "Empty diagram source". This avoids a potentially confusing Mermaid error for what is clearly user input-in-progress.

### Tab switch during async render (EC-22)

If the user switches tabs while `_renderAsync` is in flight, the placeholder `div` becomes detached from the active view's DOM tree. When the Promise settles and `placeholder.innerHTML = svg` or `_showError()` executes, the mutation targets a detached DOM element. This is harmless — no crash, no error, the result is simply discarded. When the tab is re-activated, the StateField recomputes fresh decorations and calls `toDOM()` again.

### innerHTML safety (NFR-08, EC-15)

Mermaid 11.x initializes with `securityLevel: "strict"` which strips `<script>` tags from SVG output before returning it. The plugin also sets `securityLevel: "strict"` explicitly in `mermaid.initialize()` (step_07). User source text in error placeholders is always set via `textContent` (never `innerHTML`) to prevent any XSS from user-authored diagram content.

---

## Acceptance Criteria

- [ ] `MermaidWidget` class exists with `constructor(source)`, `eq()`, `toDOM()`, `ignoreEvent()`
- [ ] `toDOM()` returns a placeholder div synchronously with class `cm-mermaid-block cm-mermaid-loading`
- [ ] `eq()` returns true when source strings are identical (EC-14)
- [ ] `eq()` returns false when source strings differ (EC-13)
- [ ] Empty source shows error placeholder, not a blank div (EC-01)
- [ ] Invalid source (Mermaid rejects) shows error placeholder with message and source (EC-04)
- [ ] Error source is rendered via `textContent`, not `innerHTML`
- [ ] The `_renderCounter` is incremented per instance (EC-19)
- [ ] No TODO comments in this class
- [ ] `npm run build:plugins` compiles without TypeScript errors

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | MODIFY | Replace stub MermaidWidget with full implementation |
