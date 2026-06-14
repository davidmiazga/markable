---
title: "Step 16 — Settings Persistence"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 16 — Last-Opened-Stack + Scroll-Position Persistence

## Goal

Persist per-vault, per-Collection navigation state across app launches: last-opened Stack and per-Stack scroll position. Pure additive change to `MarkableSettings`. The window-size invariant must remain untouched.

## Files touched

- **Edit** `src/lib/settings.ts`
- **Edit** `src/plugins/file-browser/collections/renderer.ts` (read on init, write on navigation)
- **New** `tests/collections/settings-persistence.test.ts`

## Settings shape

```typescript
// settings.ts additive type

export interface CollectionsPerVaultState {
  /** Map<collectionPath, lastOpenedStackPath>. */
  lastOpenedStackByCollection?: Record<string, string>;
  /** Map<stackPath, scrollTop in pixels>. */
  scrollPositionByStack?: Record<string, number>;
}

// In MarkableSettings:
plugins["file-browser"] = {
  ...,
  collections?: {
    [vaultId: string]: CollectionsPerVaultState;
  };
};
```

Default: `{}` for `collections`. Reading is null-safe with `??`.

**DO NOT** touch `window.sizeW` (`"50%"`) or `window.sizeH` (`"80%"`). The CLAUDE.md invariant test `tests/settings/window-defaults.test.ts` MUST stay green.

## Function signatures to add

```typescript
// renderer.ts (additive)

function loadCollectionsState(vaultId: string): CollectionsPerVaultState;
function saveLastOpenedStack(vaultId: string, collectionPath: string, stackPath: string): Promise<void>;
function saveScrollPosition(vaultId: string, stackPath: string, scrollTop: number): Promise<void>;

// Read on navigation:
// - On entering a Collection, look up lastOpenedStackByCollection[collectionPath].
//   If present and the Stack still exists, auto-navigate to it.
//   Else render the Home canvas.
// - On entering a Stack, look up scrollPositionByStack[stackPath] and pass to
//   renderStackPanel as initialScrollTop.

// Write on navigation:
// - On navigateToStack(path), saveLastOpenedStack.
// - On navigateToHome from a Stack, clear that Collection's lastOpenedStack (optional;
//   easier: just save the new path on next nav).
// - On Stack scroll, debounce-save scrollPosition (e.g., trailing 250 ms).
```

## Failing tests to write FIRST

`tests/collections/settings-persistence.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `default settings have collections: undefined or {}` | additive default | typeof === "object" or undefined; reads are null-safe |
| `saveLastOpenedStack writes to plugins["file-browser"].collections[vaultId].lastOpenedStackByCollection[collectionPath]` | C-7 | saveSettings spy receives merged object |
| `saveScrollPosition writes to plugins["file-browser"].collections[vaultId].scrollPositionByStack[stackPath]` | C-7 | saveSettings spy receives merged object |
| `saveScrollPosition debounces (250 ms trailing); rapid scroll fires saveSettings once` | perf | fake timers; one saveSettings call |
| `loadCollectionsState returns {} if no settings present` | safety | empty object |
| `entering a Collection with lastOpenedStack auto-navigates to that Stack` | C-7 | renderer state.view === "stack"; activeStackPath matches saved value |
| `entering a Collection whose saved Stack no longer exists falls back to Home` | safety | view === "home" |
| `entering a Stack restores its saved scrollTop` | C-7 | stackPanel.el.scrollTop === saved value |
| `window-size invariant still passes` | NFR-3, EC-14 | tests/settings/window-defaults.test.ts continues to pass (re-run as part of this test file's setup) |
| `clearing collections settings entirely does not break Collection render` | resilience | with `collections: undefined`, opening a Collection still renders correctly |

## Implementation outline

1. **settings.ts**: extend the `MarkableSettings` interface and the `DEFAULT_SETTINGS` object. Add the `CollectionsPerVaultState` interface. **Do not** add Collections-related defaults to `DEFAULT_SETTINGS.window`; that section is the invariant. Restrict the patch to `DEFAULT_SETTINGS.plugins["file-browser"]`.
2. **vaultId resolution**: use whichever existing identifier the project already keys per-vault settings on. The folder-icon work (step_06c_custom_settings) used the absolute vault root path; reuse the same key.
3. **Renderer integration**:
   - `loadCollectionsState(vaultId)` reads from the current `MarkableSettings` snapshot held by `settings-panel.ts` (existing pattern: `getCurrentSettings()`).
   - Save helpers compose a partial update and call the existing `updateSettings()` Tauri pathway — no new bridge wrapper.
   - Debounce scroll saves with a simple closure timer; flush on `stackPanel.destroy` so we don't lose the last position.
4. **Auto-restore Stack on Collection open**: in `renderCollectionHome`, before calling `navigateToHome`, peek at the saved last-opened Stack; if it resolves to an existing folder under this Collection, call `navigateToStack` instead.

## Refactor opportunities

If multiple features want to persist per-vault per-folder UI state, abstract `vaultId/folderId` keying into a small helper. Defer — only Collections uses this pattern in MVP.

## Definition of Done

```bash
npm run test:run -- tests/collections/settings-persistence.test.ts
npm run test:run -- tests/settings/window-defaults.test.ts
```
Expected: 10 tests pass for the new file. The window-defaults test stays green (verify both before/after this step). Plugin rebuild required.
