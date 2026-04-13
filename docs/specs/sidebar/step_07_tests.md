---
title: "Step 07 — Tests"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 07 — Tests

## Goal

Provide unit test coverage for the sidebar infrastructure core logic (NFR-6). Verify Auto TOC regression (step_06). Define acceptance criteria for visual verification.

**Dependencies:** all prior steps complete.

---

## Files Changed

| File | Action |
|---|---|
| `tests/sidebar-manager.test.ts` | Create |
| `tests/auto-toc.test.ts` | No changes — must pass as-is |

---

## Test File: `tests/sidebar-manager.test.ts`

### Vitest environment note

The existing test suite uses `vitest` with a `jsdom` environment (see `vitest.config.ts`). The sidebar-manager tests follow the same pattern. Mock the settings module to avoid Tauri bridge calls. The existing `tests/mocks/` directory may contain relevant setup — check for a Tauri mock before writing a new one.

### Imports and setup

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the settings module so no Tauri invoke() calls are made.
vi.mock("../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({ sidebar: undefined })),
  updateSettings: vi.fn(() => Promise.resolve()),
  updateSettingsInMemory: vi.fn(),
  saveSettingsDebounced: vi.fn(),
  DEFAULT_SIDEBAR_SLOT: { open: false, activeTabId: null, width: 220, panels: {} },
}));

// Import AFTER mocking so the module picks up the mock.
import {
  init as initSidebar,
  register as registerSidebarPanel,
  unregister as unregisterSidebarPanel,
  toggleSide,
  restoreFromSettings,
} from "../src/sidebar/sidebar-manager";
```

### DOM scaffold (beforeEach)

```typescript
beforeEach(() => {
  // Reset module state between tests by resetting the DOM.
  document.body.innerHTML = `
    <div id="titlebar"></div>
    <div id="app">
      <div id="editor"></div>
      <div id="statusbar" class="hidden"></div>
    </div>
  `;
  // Reset the initialized flag by re-importing (use vi.resetModules() pattern
  // or expose a _reset() test-only function from sidebar-manager.ts).
});
```

**Implementation note:** `sidebar-manager.ts` should export a `_resetForTests(): void` function that resets `initialized`, `registeredPanels`, `slotRuntime`, and `appRowEl` to their initial values. This function is used only in tests and is not exported from `src/sidebar/index.ts`. Guard it with a comment: `/** @internal Test-only reset. Do not call in production code. */`

### Test Suite Structure

```
describe("SidebarManager — init", () => {
  it("creates #app-row and moves #editor into it")
  it("is idempotent — calling init twice does not create duplicate #app-row elements")
  it("places #app-row before #statusbar when statusbar exists")
})

describe("SidebarManager — register", () => {
  it("creates #sidebar-right when first right-side panel is registered")
  it("creates #sidebar-left when first left-side panel is registered")
  it("calls descriptor.render(container) immediately on registration")
  it("does not render a tab bar for a single panel")
  it("renders a tab bar when two panels are registered on the same side")
  it("tab bar has one button per panel with correct title text")
  it("only the first panel is active (visible) when two panels are registered")
  it("logs a warning and rejects duplicate panel ids (EC-12)")
  it("shows an error placeholder when render() throws (EC-13)")
  it("accordion defaults to expanded (contentEl.style.display is not 'none')")
})

describe("SidebarManager — unregister", () => {
  it("calls descriptor.destroy(container) before removing from DOM")
  it("calls destroy even when accordion is collapsed (EC-6)")
  it("proceeds with DOM removal even when destroy() throws (EC-14)")
  it("removes the panel wrapper from the DOM")
  it("removes #sidebar-right from DOM when last panel is unregistered (EC-5)")
  it("switches active tab to next panel when active panel is unregistered (EC-4)")
  it("is a no-op when panelId was not registered")
  it("is a no-op when pluginId does not match owning plugin (EC-19)")
  it("removes tab bar when panel count drops to 1 after unregistration")
})

describe("SidebarManager — toggleSide", () => {
  it("is a no-op when no panels are registered on the side (EC-8)")
  it("hides the sidebar element when currently open")
  it("shows the sidebar element when currently hidden")
  it("calls updateSettings with open: false when hiding")
  it("calls updateSettings with open: true when showing")
})

describe("SidebarManager — accordion", () => {
  it("collapses content area on chevron click (display: none)")
  it("expands content area on second chevron click")
  it("persists accordion state via updateSettings")
  it("restores collapsed state from settings on register")
})

describe("SidebarManager — restoreFromSettings", () => {
  it("does not show sidebar if open: true but no panels registered (EC-11, EC-23)")
  it("applies open: false to hide the sidebar slot")
  it("applies open: true to show the sidebar slot when panels are registered")
  it("sets the active panel from persisted activeTabId")
})

describe("SidebarManager — toggle cycle stability (NFR-3)", () => {
  it("register → unregister → register produces one sidebar slot, one panel, no duplicate listeners")
})

describe("SidebarManager — settings writes (NFR-4)", () => {
  it("uses updateSettings (immediate) for accordion toggle")
  it("uses updateSettingsInMemory during drag and saveSettingsDebounced on drag end")
  it("uses updateSettings (immediate) for open/closed toggle")
})
```

### Test count target

Minimum 25 tests covering all major paths. Edge cases EC-1 through EC-23 that are testable in jsdom must each have at least one test.

---

## Regression: `tests/auto-toc.test.ts`

Run without modification:
```bash
npx vitest run tests/auto-toc.test.ts
```

All tests in this file test `scanHeadings` and `findActiveIndex` as pure functions. Neither function is modified in step_06. Zero failures expected.

---

## Visual Verification Checklist

These items require a running `npm run tauri dev` session. They cannot be automated by Vitest.

### Infrastructure

- [ ] `#app-row` exists in the DOM after app launch (inspect via DevTools).
- [ ] `#editor` is a child of `#app-row`, not of `#app` directly.
- [ ] `#statusbar` remains a direct child of `#app` (not inside `#app-row`).
- [ ] No sidebar slots exist in DOM when all panel-contributing plugins are disabled.

### Auto TOC panel

- [ ] Enable Auto TOC plugin → `#sidebar-right` appears on the right of the editor, populated with headings.
- [ ] Single panel: no tab bar is rendered above the TOC.
- [ ] Accordion chevron is visible in the panel header; clicking it collapses the TOC content area.
- [ ] Click a heading in the TOC → editor cursor jumps to that heading and editor receives focus.
- [ ] Edit a heading text → TOC updates within ~150 ms.
- [ ] Disable Auto TOC → panel disappears, editor expands to fill full width.
- [ ] Re-enable Auto TOC → panel appears again, correctly populated.
- [ ] Toggle off/on three times rapidly → no visual artifacts, no duplicates.

### Keyboard shortcuts

- [ ] `Cmd-Shift-]` with Auto TOC enabled → right sidebar hides (editor expands).
- [ ] `Cmd-Shift-]` again → right sidebar restores to previous width.
- [ ] `Cmd-Shift-[` with no left panel registered → no-op (no error in console).
- [ ] `Cmd-[` / `Cmd-]` continue to outdent/indent list items correctly (no regression).

### Sidebar width resize

- [ ] Drag the resize handle right (for `#sidebar-right`) → sidebar gets narrower, editor fills the space.
- [ ] Drag below 150 px → clamps at 150 px.
- [ ] Drag above 600 px → clamps at 600 px.
- [ ] Restart app → sidebar reopens at persisted width.

### Theming

- [ ] Switch to light theme → sidebar background, borders, and text adopt light theme tokens.
- [ ] Switch to custom solarized-dark → same result with that theme's tokens.

### Settings persistence

- [ ] Collapse accordion in TOC panel → restart app → panel opens collapsed.
- [ ] Hide sidebar via keyboard shortcut → restart app → sidebar remains hidden.
- [ ] Resize sidebar → restart app → sidebar opens at persisted width.

---

## Acceptance Criteria for "Step Done"

1. `npx vitest run tests/sidebar-manager.test.ts` — all tests pass.
2. `npx vitest run tests/auto-toc.test.ts` — all tests pass (no modification).
3. `npx vitest run` — full suite green (no regressions).
4. All visual verification items checked off above.
5. No TODO comments exist in `src/sidebar/` or the modified `auto-toc.plugin.ts`.
6. TypeScript compiler (`npx tsc --noEmit`) reports zero errors.
