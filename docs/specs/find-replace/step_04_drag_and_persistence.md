# Step 04 — Drag and Position Persistence

**Goal:** Implement the draggable header, viewport clamping, and settings read/write for the widget position. This step also updates `src/lib/settings.ts` with the new `findWidget` field.

**Precondition:** step_03 complete (widget logic is functional).

---

## Files to Change

| File | Change type |
|---|---|
| `src/lib/settings.ts` | Add `FindWidgetPosition` interface and `findWidget` field |
| `src/editor/find-widget.ts` | Add drag, `_restorePosition()`, `_savePosition()` |

---

## 1. `src/lib/settings.ts` Changes

### Add `FindWidgetPosition` interface

```typescript
export interface FindWidgetPosition {
  x: number;
  y: number;
}
```

### Update `MarkableSettings` interface

```typescript
export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
  findWidget: FindWidgetPosition | null;  // TC-6: optional, null = use default position
}
```

### Update `DEFAULT_SETTINGS`

```typescript
export const DEFAULT_SETTINGS: MarkableSettings = {
  version: 1,
  window: { ... },  // unchanged
  editor: { ... },  // unchanged
  theme: { ... },   // unchanged
  recentFiles: [],
  findWidget: null,  // FR-8.1: null means use default position (upper-right)
};
```

### Migration note

No schema version bump is required. The existing `loadSettings()` implementation does:

```typescript
currentSettings = result.value;
```

Where `result.value` is whatever was deserialized from JSON. If an old settings file lacks `findWidget`, the field will be `undefined` after deserialization. `loadSettings()` must be updated to merge with defaults:

```typescript
// In loadSettings(), after result.ok branch:
currentSettings = { ...structuredClone(DEFAULT_SETTINGS), ...result.value };
```

**This merge pattern is already used implicitly** — verify that the existing `loadSettings` does not need modification. If `result.value` is the raw deserialized object, `findWidget` will be `undefined` (not `null`). To ensure `null` is treated the same as `undefined` at the call site, update `_restorePosition()` in `find-widget.ts` to check `settings.findWidget != null` (the `!= null` check covers both `null` and `undefined`).

---

## 2. `src/editor/find-widget.ts` — Drag Implementation

### Imports to add

```typescript
import { getCurrentSettings, updateSettings } from "../lib/settings";
import type { FindWidgetPosition } from "../lib/settings";
```

### Drag state fields

```typescript
private _isDragging: boolean = false;
private _dragOffsetX: number = 0;
private _dragOffsetY: number = 0;
```

### `_attachDrag()` private method

Called once at the end of `_buildDom()`.

```typescript
private _attachDrag(): void {
  this.header.addEventListener('mousedown', (e: MouseEvent) => {
    // Only respond to primary button (left click)
    if (e.button !== 0) return;

    this._isDragging = true;

    // Calculate offset from widget top-left to mouse position
    const rect = this.root.getBoundingClientRect();
    this._dragOffsetX = e.clientX - rect.left;
    this._dragOffsetY = e.clientY - rect.top;

    // FR-7.3: Clear 'right' so 'left' takes effect during drag
    this.root.style.right = 'auto';
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;

    // FR-7.5: Prevent text selection in editor during drag
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';

    e.preventDefault();
  });

  // FR-7.2: Listen on document so drag continues past widget boundary
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!this._isDragging) return;

    let newX = e.clientX - this._dragOffsetX;
    let newY = e.clientY - this._dragOffsetY;

    // FR-7.6 / EC-22: Clamp to visible viewport
    newX = this._clampX(newX);
    newY = this._clampY(newY);

    this.root.style.left = `${newX}px`;
    this.root.style.top = `${newY}px`;
  });

  // FR-7.4: End drag and save position on mouseup
  document.addEventListener('mouseup', () => {
    if (!this._isDragging) return;

    this._isDragging = false;

    // FR-7.5: Restore text selection
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';

    // FR-8.2 / FR-8.5: Save position at drag-end, not on every mousemove
    const x = parseFloat(this.root.style.left) || 0;
    const y = parseFloat(this.root.style.top) || 0;
    this._savePosition({ x, y });
  });
}
```

### `_clampX()` and `_clampY()` private methods

```typescript
private _clampX(x: number): number {
  // EC-21 / EC-22: Widget must not overflow viewport
  const maxX = window.innerWidth - this.root.offsetWidth;
  return Math.max(0, Math.min(x, Math.max(0, maxX)));
}

private _clampY(y: number): number {
  const maxY = window.innerHeight - this.root.offsetHeight;
  return Math.max(0, Math.min(y, Math.max(0, maxY)));
}
```

### `_savePosition()` private method

```typescript
private _savePosition(pos: FindWidgetPosition): void {
  // FR-8.2: Persist position to settings after drag-end
  updateSettings((s) => ({ ...s, findWidget: pos })).catch((err) => {
    console.error('FindWidget: failed to save position:', err);
  });
}
```

### `_restorePosition()` private method

This is the stub introduced in step_02. Replace it with the full implementation:

```typescript
private _restorePosition(): void {
  const saved = getCurrentSettings().findWidget;

  // FR-8.3 / EC-23: Use saved position if it exists and is on-screen
  if (saved != null) {
    const clampedX = this._clampX(saved.x);
    const clampedY = this._clampY(saved.y);

    // FR-8.4: If clamping moved the position significantly, the display may be smaller.
    // Check if the clamped position is still near the original (within 1px tolerance
    // means it was already valid). If both were clamped to 0, it was off-screen —
    // fall back to default.
    const isFullyOffScreen = (clampedX === 0 && clampedY === 0 && (saved.x < 0 || saved.y < 0));
    if (!isFullyOffScreen) {
      this.root.style.right = 'auto';
      this.root.style.left = `${clampedX}px`;
      this.root.style.top = `${clampedY}px`;
      return;
    }
  }

  // FR-8.1 / AC-6 / AC-8: Default position — upper-right, below title bar
  // D-3: top = 38px (titlebar) + 16px margin = 54px
  this.root.style.left = 'auto';
  this.root.style.right = '16px';
  this.root.style.top = '54px';
}
```

### Off-screen detection improvement

The simple `isFullyOffScreen` check above covers the most common case. For a more robust check, use the same logic as `isWindowOffScreen` in `settings.ts`:

```typescript
private _isPositionVisible(x: number, y: number): boolean {
  const w = this.root.offsetWidth || 320;   // fallback width before first layout
  const h = this.root.offsetHeight || 100;
  // At least 20px must be visible in both axes
  const visibleRight = Math.min(x + w, window.innerWidth) - Math.max(x, 0);
  const visibleBottom = Math.min(y + h, window.innerHeight) - Math.max(y, 0);
  return visibleRight >= 20 && visibleBottom >= 20;
}
```

Update `_restorePosition()` to use `_isPositionVisible(saved.x, saved.y)` instead of the `isFullyOffScreen` heuristic.

---

## 3. `open()` Update

Ensure `_restorePosition()` is called inside `open()` on the first open (when `_isOpen` is false), not on subsequent `open()` calls:

```typescript
open(mode: 'find' | 'replace'): void {
  if (this._isOpen) {
    // EC-2: Already open — focus and select, do not re-initialize position
    this.findInput.focus();
    this.findInput.select();
    return;
  }

  // Restore or set default position before making visible
  this._restorePosition();

  // ... rest of open() from step_02
}
```

---

## Acceptance Criteria

- [ ] `src/lib/settings.ts` has `findWidget: FindWidgetPosition | null` in `MarkableSettings` and `DEFAULT_SETTINGS`.
- [ ] `tsc --noEmit` passes with no TypeScript errors.
- [ ] Widget is draggable by its header. Position updates in real time (AC-24).
- [ ] Widget cannot be dragged off the left, right, top, or bottom screen edge (AC-25, EC-22).
- [ ] After dragging and releasing, `updateSettings` is called with the new position (AC-26).
- [ ] After dragging, closing, and reopening the widget (within the same session), the widget reopens at the dragged position (AC-26).
- [ ] After dragging, restarting the app, and opening the widget, the position is restored from settings (AC-27, FR-8.3).
- [ ] EC-23: If the app is relaunched on a smaller display and the saved position is off-screen, the widget defaults to upper-right (AC-28).
- [ ] EC-26: Switching files closes the widget (step_05). On next open, the saved drag position is used — not reset to default.
- [ ] EC-21: On a 400px-wide viewport, the widget is clamped and fully visible.
- [ ] Text selection in the editor is suppressed during drag (FR-7.5).
- [ ] Text selection is restored after drag ends (FR-7.5).
- [ ] Old settings files (without `findWidget` field) load without errors and default to `null` (backwards-compatible, TC-6).
