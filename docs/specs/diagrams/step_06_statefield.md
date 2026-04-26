---
title: "Step 06 — StateField: factory + onEnable/onDisable wiring"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 06: StateField Wiring

**Requirement:** FR-02 (StateField and Decoration), AD-02 (CM6 globals), AD-03 (StateField required), AD-06 (StateField factory)
**Files modified:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Implement the `createDiagramsField()` factory function and wire it into `onEnable` / `onDisable`. After this step the plugin is functionally complete for basic rendering (theme awareness added in step_07, settings in step_08).

The StateField is created fresh inside `onEnable` — not as a module-level constant — to guarantee no residual state carries over across enable/disable cycles (EC-12, AD-06).

---

## Implementation Instructions

### Part 1: StateField factory

Remove the stub comment `// createDiagramsField() factory — added in step_06` and replace it with this function, inserted after `buildDiagramDecorations`:

```typescript
/**
 * A custom StateEffect used to signal theme changes to the StateField.
 *
 * When the Mermaid theme changes (step_07), this effect is dispatched on the
 * editor to force the StateField's update() to recompute all decorations with
 * the new theme. The effect carries no payload — its presence is the signal.
 *
 * Defined here (near the StateField factory) so both step_06 and step_07 can
 * reference it without declaring it in a separate location.
 */
export const themeChangedEffect = StateEffect.define<null>();

/**
 * Create a fresh CM6 StateField<DecorationSet> for diagram decorations.
 *
 * Factory pattern (AD-06): called inside onEnable, not at module level.
 * Each enable cycle gets a new StateField with a new internal slot ID.
 * This prevents slot ID leakage across disable/re-enable cycles (EC-12).
 *
 * Recomputation triggers (FR-02.3):
 *   - tr.docChanged: document content changed (user typed, pasted, etc.)
 *   - tr.selection:  cursor or selection moved (reveal/hide decoration)
 *   - tr.effects containing themeChangedEffect: Mermaid theme changed (step_07)
 *
 * Transactions with none of these signals are returned unchanged (performance
 * optimization: skips O(N) Lezer tree walk for non-impacting transactions).
 */
function createDiagramsField(): ReturnType<typeof StateField.define> {
  return StateField.define<DecorationSet>({
    /**
     * Called once when the field is installed into the editor.
     * Builds the initial DecorationSet from the current document state.
     */
    create(state: EditorState): DecorationSet {
      return buildDiagramDecorations(state);
    },

    /**
     * Called on every CM6 transaction. Recomputes only when needed.
     *
     * The `themeChangedEffect` check ensures that a theme change dispatched
     * from step_07's reinitIfNeeded() triggers a full recompute even if the
     * document and selection are unchanged (EC-10).
     */
    update(value: DecorationSet, tr: Transaction): DecorationSet {
      const hasThemeEffect = tr.effects.some((e) => e.is(themeChangedEffect));
      if (!tr.docChanged && !tr.selection && !hasThemeEffect) {
        return value; // Reuse existing decorations
      }
      return buildDiagramDecorations(tr.state);
    },

    /**
     * Wire the field's DecorationSet to CM6's internal decoration pipeline.
     * EditorView.decorations.from(field) is the CM6-idiomatic way to register
     * a StateField as a decoration provider.
     */
    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}
```

### Part 2: Update onEnable

Replace the current `onEnable` stub body with the full implementation. The settings load and Mermaid initialization stubs are filled in by steps 07 and 08; only the StateField registration is added here:

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Settings load — filled in by step_08.
  _settings = { ...DEFAULT_SETTINGS };

  // Mermaid initialization — filled in by step_07.
  // (At this step, mermaid.initialize() is NOT called yet. Diagrams will
  //  render with Mermaid's built-in default theme until step_07 adds the
  //  initialization call.)

  injectPluginCSS();

  // Create a fresh StateField instance for this enable cycle (AD-06).
  _diagramsField = createDiagramsField();

  // Register the StateField with the editor via the plugin API.
  // CM6 installs the field into its shared Compartment immediately.
  api.addExtensions([_diagramsField]);

  // Theme-change observer — registered by step_07.
}
```

`onDisable` was written in step_03 and already calls `api.removeExtensions()` and clears `_diagramsField`. No changes needed to `onDisable` in this step.

---

## How the StateField integrates with CM6

The `provide()` callback passes `EditorView.decorations.from(field)` back to CM6. This tells the editor: "whenever you need to render decorations, read the value of this StateField and use it as the DecorationSet." The field is the single source of truth for all diagram decorations.

When `onDisable` calls `api.removeExtensions()`, the PluginManager removes this field from the shared Compartment. CM6 recomputes the active extensions without it, which removes all diagram decorations from the view. The raw fenced blocks become visible (US-07, EC-11).

---

## Notes on `themeChangedEffect`

`themeChangedEffect` is declared in step_06 even though it is first dispatched in step_07. The reason: it must be in scope for the `StateField.update()` method, which is defined here. Importing or exporting it later would require re-editing this step's code. Declaring it here with a `// step_07 dispatches this` comment is the cleanest arrangement.

The `StateEffect.define<null>()` call uses `null` as the payload type because the effect carries no data — its mere presence in `tr.effects` is the signal. This follows the CM6 convention for signal-only effects.

---

## Acceptance Criteria

- [ ] `themeChangedEffect` is exported and is a `StateEffect.define<null>()` instance
- [ ] `createDiagramsField()` is a function (not a module-level constant)
- [ ] `StateField.update()` returns existing value when docChanged, selection, and themeChangedEffect are all absent
- [ ] `StateField.update()` calls `buildDiagramDecorations()` when any trigger is present
- [ ] `onEnable` calls `createDiagramsField()` and `api.addExtensions([_diagramsField])`
- [ ] Enabling the plugin in the app causes mermaid blocks to render as placeholder divs (async render fires)
- [ ] Disabling the plugin removes all decorations and shows raw fenced source
- [ ] Rapid enable/disable cycle leaves no duplicate StateFields or CSS tags (EC-12)
- [ ] `npm run build:plugins` compiles without TypeScript errors

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | MODIFY | Add themeChangedEffect, createDiagramsField(), update onEnable |
