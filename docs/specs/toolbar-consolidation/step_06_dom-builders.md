---
title: "Step 06 — DOM Builders"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 06 — DOM Builders

## What to Build

Port all DOM-construction and positioning functions from the three original plugins, plus
create the new unified sidebar panel builder that houses both the markdown and table
controls in a single container with two inner swap divs.

This step fills sections 9 and 10 of the module (DOM builders + positioning helpers).

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Insert sections 9 and 10 between section 8 (pure table logic) and section 11 (context
resolver). The context resolver section already exists as a stub from step_05; insert
before it.

---

## Precise Specification

### Section 9 — DOM builders

#### 9a: Markdown toolbar DOM

Port verbatim from the original `markdown-toolbar.plugin.ts` section 9 (`buildToolbarDOM`).
This function creates the 10-button `.md-toolbar` element and returns it along with a
button `NodeListOf`.

Signature:
```typescript
export function buildToolbarDOM(): {
  toolbar: HTMLElement;
  buttons: NodeListOf<HTMLButtonElement>;
}
```

Exports `buildToolbarDOM` for test access.

#### 9b: Image popover DOM

Port verbatim from the original `image-toolbar.plugin.ts` section 13 (`buildPopover`).
This function creates the `.img-toolbar` floating popover element.

Signature:
```typescript
export function buildPopover(): HTMLElement
```

Exports `buildPopover`, `positionPopover`, `showPopover`, `hideToolbar` for test access
(matching current `image-toolbar.test.ts` imports).

Also port:
- `positionPopover(popover: HTMLElement, anchor: DOMRect): void` — handles EC-36 (flip
  above viewport) and EC-37 (clamp right edge). Preserve verbatim.
- `showPopover(ctx: ImageContext): void`
- `hideToolbar(): void`

#### 9c: Table floating elements DOM

Port verbatim from the original `table-toolbar.plugin.ts` section 7 (`buildTopBar`,
`buildRowHandle`, `buildBottomPill`).

Signatures:
```typescript
export function buildTopBar(): HTMLElement
export function buildRowHandle(): HTMLElement
export function buildBottomPill(): HTMLElement
```

Also port from section 8:
- `updateFloatingPositions(ctx: TableContext, view: EditorViewType): void`
- `updateFloatingVisibility(visible: boolean): void`
- `clampHorizontal(el: HTMLElement, editorRect: DOMRect): void`
- `startRowDrag(e: MouseEvent, ctx: TableContext, view: EditorViewType): void`
- `updateTopBarButtonStates(ctx: TableContext): void`

Export `buildTopBar`, `buildRowHandle`, `buildBottomPill`, `clampHorizontal`,
`updateTopBarButtonStates`, `updateFloatingVisibility` for test access.

#### 9d: Unified sidebar panel DOM

This is the only NEW DOM builder in this step — it does not exist in the originals.

```typescript
export function buildSidebarPanel(): HTMLElement
```

The returned element has this structure:
```html
<div class="unified-toolbar-sidebar-panel">
  <div id="unified-toolbar-md-content">
    <!-- 10 markdown format buttons copied from buildToolbarDOM layout,
         but in "sidebar" arrangement (matching original markdown-toolbar sidebar mode) -->
  </div>
  <div id="unified-toolbar-tbl-content" style="display:none">
    <!-- Table operation buttons copied from original buildSidebarPanel in table-toolbar,
         matching layout exactly -->
  </div>
</div>
```

Rules:
- On construction, `#unified-toolbar-md-content` is visible (`display: ''`).
- `#unified-toolbar-tbl-content` starts hidden (`display: 'none'`).
- Both inner divs contain the same button elements as their respective original
  sidebar panel implementations.
- The `_buttons` NodeList for the markdown sub-toolbar must point at the buttons inside
  `#unified-toolbar-md-content` (so `updateActiveButtons` / `updateDisabledState` still
  work).
- The table sidebar buttons inside `#unified-toolbar-tbl-content` must be accessible
  via `updateSidebarButtonStates(ctx)` (ported from original table-toolbar section 9).

Also port from original `table-toolbar.plugin.ts` section 9:
- `buildSidebarPanel() → HTMLElement` (original table-only version — port its internals
  into the `#unified-toolbar-tbl-content` div within the new unified builder, not as a
  separate exported function)
- `updateSidebarButtonStates(ctx: TableContext): void`

Export `updateSidebarButtonStates` for test access.

#### 9e: EC-38 — hidden toolbar keyboard tabindex

When a sub-toolbar is hidden (via `display: none`), all its buttons are excluded from
the tab order automatically by the browser (elements with `display: none` are not
focusable). No `tabindex` manipulation is required because the implementation uses
`display: none` for hiding rather than `visibility: hidden`. Add a comment to
`buildSidebarPanel` noting this.

### Section 10 — Positioning helpers

Port verbatim from the originals. Each positioning helper remains associated with its
sub-toolbar:

- From markdown-toolbar section 10: `updateActiveButtons`, `updateDisabledState`,
  `updatePosition` (markdown toolbar floating position).
- From image-toolbar: the positioning helpers are already included in 9b above
  (`positionPopover`, `showPopover`).
- From table-toolbar: the positioning helpers are already included in 9c above
  (`updateFloatingPositions`, `clampHorizontal`).

Update section header to `── 10. Positioning helpers ──`.

Exports: `updateActiveButtons`, `updateDisabledState` (matching existing markdown-toolbar
test imports).

---

## Acceptance Criteria

### AC-6.1 — buildToolbarDOM creates 10 buttons
`buildToolbarDOM().buttons.length === 10`.

### AC-6.2 — buildPopover creates .img-toolbar element
`buildPopover().classList.contains("img-toolbar")` is `true`.

### AC-6.3 — positionPopover flips when above viewport (EC-36)
When `anchor.top - popoverHeight < 0`, the popover is positioned below `anchor.bottom`
instead of above `anchor.top`.

### AC-6.4 — positionPopover clamps right edge (EC-37)
When `left + popoverWidth > window.innerWidth`, `left` is clamped so the popover does
not overflow.

### AC-6.5 — buildTopBar, buildRowHandle, buildBottomPill each return an HTMLElement
Each function returns a non-null HTMLElement.

### AC-6.6 — buildSidebarPanel structure
`buildSidebarPanel()` returns an element that:
- Contains a child with id `unified-toolbar-md-content`.
- Contains a child with id `unified-toolbar-tbl-content`.
- The `#unified-toolbar-md-content` child has `display !== "none"` by default.
- The `#unified-toolbar-tbl-content` child has `display === "none"` by default.

### AC-6.7 — Sidebar panel content swap (EC-12, EC-13)
After calling the swap helper (used in step_07) with context `"table"`:
- `document.getElementById("unified-toolbar-tbl-content").style.display` is `""`.
- `document.getElementById("unified-toolbar-md-content").style.display` is `"none"`.

After calling the swap helper with context `"default"`:
- Both values are reversed.

### AC-6.8 — Hidden elements not tab-focusable (EC-38)
An element with `display: none` in jsdom is confirmed not focusable. Document this as
a comment; no assertion needed since it is browser-enforced behaviour.

---

## Risks and Dependencies

- **Risk**: The table sidebar panel builder in the original (`buildSidebarPanel` in
  `table-toolbar.plugin.ts`) is exported for tests. In the unified file, its contents
  are inlined into `buildSidebarPanel` as the `#unified-toolbar-tbl-content` inner div.
  The original export name `buildSidebarPanel` is superseded by the unified `buildSidebarPanel`.
  The table-toolbar test that imports the original `buildSidebarPanel` will be migrated
  in step_09 to test the new unified builder's `#unified-toolbar-tbl-content` sub-section.
- **Risk**: `_buttons` NodeList must point to the markdown buttons inside the sidebar panel
  in sidebar mode, and to the floating toolbar buttons in floating mode. `onEnable` (step_08)
  assigns `_buttons` based on mode. Make sure `buildSidebarPanel` and `buildToolbarDOM`
  both populate `_buttons` through their callers in `onEnable`.
- **Dependency**: Steps 01–05 must be complete. Section 9 references types and state
  variables defined in sections 1–8.
