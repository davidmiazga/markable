# Window Launch Size Invariants

## Status: HARD INVARIANT — DO NOT CHANGE WITHOUT EXPLICIT APPROVAL

This file is the single canonical reference for window launch size values.
Any agent reading context before touching `settings.ts`, `lib.rs`, or any
settings-related code MUST read this file first.

---

## The Invariants

| Invariant | Value | Notes |
|-----------|-------|-------|
| `DEFAULT_SETTINGS.window.sizeW` | `"50%"` | 50% of screen width |
| `DEFAULT_SETTINGS.window.sizeH` | `"80%"` | 80% of screen height — NOT 50% |
| `lib.rs` width multiplier | `0.5` | `phys.width as f64 / scale * 0.5` |
| `lib.rs` height multiplier | `0.8` | `phys.height as f64 / scale * 0.8` |

The height value is 80%, not 50%. This is the value that has regressed
repeatedly. Both locations must agree at all times.

---

## Why These Values

- **50% width** — keeps the editor in a focused column without feeling cramped.
  Mirrors the default column width of Obsidian and Typora on first launch.
- **80% height** — macOS design convention. Leaves the menu bar and Dock
  visible while maximising document real estate. A 50% height would produce
  a horizontally letterboxed window that looks broken on standard 16:9 screens.
- **Centered** — the window.center() / appWindow.setPosition() call ensures
  the window lands at the optical center of the display regardless of which
  monitor is primary.

First-run UX is the only time the user sees these defaults. A wrong height on
first launch creates a lasting negative impression that is hard to undo via
settings.

---

## Locations That Must All Agree

All three of the following must use consistent percentage values. If you
change one, change all three:

1. **`src/lib/settings.ts`** — `DEFAULT_SETTINGS.window.sizeW` and
   `DEFAULT_SETTINGS.window.sizeH`
2. **`src-tauri/src/lib.rs`** — the `.setup()` hook multipliers `0.5` and `0.8`
3. **`tests/settings/window-defaults.test.ts`** — the regression test that
   will fail immediately if either source-of-truth drifts

---

## Regression History

This invariant has regressed at least once. The failure mode is:

- An agent reads `DEFAULT_SETTINGS` from memory or a partial read and
  reconstructs it with `sizeH: "50%"` instead of `"80%"`.
- The `lib.rs` setup hook is correct but the frontend `DEFAULT_SETTINGS` is
  wrong, so fresh installs (no persisted settings file) launch at 50% height.
- The two locations are in different files and different languages, making
  cross-file consistency easy to miss in a partial context window.

The test in `tests/settings/window-defaults.test.ts` catches this the moment
`npm run test:run` is executed.

---

## Enforcement

`tests/settings/window-defaults.test.ts` asserts the exact string values of
`sizeW` and `sizeH` in `DEFAULT_SETTINGS`. This test runs as part of the
normal CI suite (`npm run test:run`). A failing test here means a regression
has been introduced and MUST be fixed before merge.

Do not modify the expected values in the test file without updating this spec
and both source locations, and obtaining explicit approval.

---

## Recovery Procedure (when the window launches at the wrong size)

Fixing the source code is not enough — the app persists window settings to disk
and loads them on startup, overriding `DEFAULT_SETTINGS`. Both the code AND the
cached settings file must be corrected.

**Step 1 — Fix the source code (two locations):**

```typescript
// src/lib/settings.ts — DEFAULT_SETTINGS.window
sizeW: "50%",
sizeH: "80%",   // ← must be "80%", not "50%"
```

Also check the `??` fallback in `applyWindowSettings` in the same file:
```typescript
const modeW = settings.sizeW ?? "50%";
const modeH = settings.sizeH ?? "80%";   // ← must be "80%", not "50%"
```

```rust
// src-tauri/src/lib.rs — .setup() hook
let logical_w = phys.width  as f64 / scale * 0.5;
let logical_h = phys.height as f64 / scale * 0.8;   // ← must be 0.8
```

**Step 2 — Verify the regression test passes:**

```bash
npm run test:run -- tests/settings/window-defaults.test.ts
```

All 6 tests must pass before proceeding.

**Step 3 — Patch the cached settings file on disk:**

The persisted settings file is at:
```
~/Library/Application Support/com.markable.app/settings.json
```

Run this one-liner to update `sizeH` in place without touching other settings:

```bash
python3 -c "
import json
path = '/Users/daveslaptop/Library/Application Support/com.markable.app/settings.json'
with open(path) as f:
    data = json.load(f)
data['window']['sizeH'] = '80%'
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print('Done. sizeH is now:', data['window']['sizeH'])
"
```

**Step 4 — Restart the app.**

The window will now launch at 50% × 80%.

### Why Step 3 is required

`loadSettings()` in `settings.ts` merges the persisted file over `DEFAULT_SETTINGS`
with `{ ...structuredClone(DEFAULT_SETTINGS), ...result.value }`. Any field present
in the saved file wins — including a stale `sizeH: "50%"`. Fixing the source code
only affects users who have never launched the app before (no persisted file).
Existing installs need the on-disk file patched as well.
