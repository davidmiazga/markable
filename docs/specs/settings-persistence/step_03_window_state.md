# Step 03: Window State Persistence

**Covers:** R2, TC-3
**Edge Cases:** EC-10, EC-11, EC-12, EC-13, EC-24, EC-25
**Depends on:** Step 02 (settings bridge, in-memory singleton, debounce)
**Files Modified:** `src/main.ts`, `src/lib/settings.ts`, `src-tauri/capabilities/default.json`

---

## Objective

Listen for window move/resize events, save window state with 1000ms debounce, restore window position/size/fullscreen on launch, and handle off-screen detection.

---

## 1. Tauri Permissions

Add these permissions to `src-tauri/capabilities/default.json`:

```json
"core:window:allow-outer-position",
"core:window:allow-outer-size",
"core:window:allow-set-position",
"core:window:allow-set-size",
"core:window:allow-is-maximized",
"core:window:allow-is-fullscreen",
"core:window:allow-set-fullscreen",
"core:window:allow-maximize",
"core:window:allow-unmaximize",
"core:window:allow-center"
```

These are required because the `core:default` permission set does not include window position/size read/write operations.

---

## 2. Window State Restore on Launch

Add a new function in `src/lib/settings.ts` or directly in `src/main.ts`:

```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

/**
 * Apply saved window position and size.
 * Handles sentinel values (defaults) and off-screen detection.
 *
 * Called during initApp(), after loadSettings() but before window.show().
 */
export async function applyWindowSettings(settings: WindowSettings): Promise<void> {
  const appWindow = getCurrentWebviewWindow();

  // Handle sentinel values: width=0 or height=0 means "use defaults"
  // Sentinel means first launch or reset-to-defaults scenario.
  if (settings.width <= 0 || settings.height <= 0) {
    // Use the default size from tauri.conf.json (800x600).
    // Center the window on the primary display.
    await appWindow.center();
    return;
  }

  // Off-screen detection (EC-10, EC-11)
  // Check if the saved position places the window on a visible area.
  // We use a simple heuristic: if the window's top-left corner is at
  // negative coordinates beyond a threshold, or if the window is entirely
  // off the visible screen area, reset to center.
  //
  // The definitive check requires screen geometry from JavaScript:
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;

  const isOffScreen = isWindowOffScreen(
    settings.x,
    settings.y,
    settings.width,
    settings.height,
    screenWidth,
    screenHeight
  );

  if (isOffScreen) {
    console.warn("Saved window position is off-screen. Centering on primary display.");
    await appWindow.center();
    return;
  }

  // Restore position and size
  try {
    await appWindow.setSize(new PhysicalSize(settings.width, settings.height));
    await appWindow.setPosition(new PhysicalPosition(settings.x, settings.y));
  } catch (err) {
    console.error("Failed to restore window position/size:", err);
    await appWindow.center();
  }

  // Restore fullscreen state (EC-12)
  if (settings.fullscreen) {
    try {
      await appWindow.setFullscreen(true);
    } catch (err) {
      console.error("Failed to restore fullscreen:", err);
    }
  }

  // Restore maximized state (only if not fullscreen)
  if (settings.maximized && !settings.fullscreen) {
    try {
      await appWindow.maximize();
    } catch (err) {
      console.error("Failed to restore maximized state:", err);
    }
  }
}
```

---

## 3. Off-Screen Detection (EC-10, EC-11)

```typescript
/**
 * Check if a window position would place it off-screen.
 *
 * EC-10: External monitor disconnected -- window is entirely off-screen.
 * EC-11: Negative coordinates -- less than 50px visible on any edge.
 *
 * Returns true if the window should be reset to defaults.
 */
export function isWindowOffScreen(
  x: number,
  y: number,
  width: number,
  height: number,
  screenWidth: number,
  screenHeight: number
): boolean {
  const MIN_VISIBLE_PX = 50;

  // Calculate how much of the window overlaps with the screen
  const visibleRight = Math.min(x + width, screenWidth) - Math.max(x, 0);
  const visibleBottom = Math.min(y + height, screenHeight) - Math.max(y, 0);

  // If less than MIN_VISIBLE_PX is visible on either axis, it is off-screen
  if (visibleRight < MIN_VISIBLE_PX || visibleBottom < MIN_VISIBLE_PX) {
    return true;
  }

  return false;
}
```

**Design note:** This uses `window.screen.width` and `window.screen.height`, which on macOS return the primary screen dimensions. This is a reasonable heuristic. If the user had the window on a secondary monitor that is still connected, `window.screen` may not reflect that monitor's geometry. However, this is the best we can do without a native screen enumeration API. The behavior is "safe" -- it will center on the primary display if uncertain, which is better than placing the window off-screen.

---

## 4. Window State Event Listeners

Add to `src/main.ts`, after `loadSettings()` and before `showWindow()`:

```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

async function setupWindowStateListeners(): Promise<void> {
  const appWindow = getCurrentWebviewWindow();

  // Listen for window move events
  await appWindow.onMoved(async (position) => {
    // Update in-memory settings (no disk write yet)
    updateSettingsInMemory((s) => ({
      ...s,
      window: {
        ...s.window,
        x: position.x,
        y: position.y,
      },
    }));
    // Debounced save (EC-13, EC-24: only final position saved)
    saveSettingsDebounced();
  });

  // Listen for window resize events
  await appWindow.onResized(async (size) => {
    // Check if maximized or fullscreen changed
    const isMaximized = await appWindow.isMaximized();
    const isFullscreen = await appWindow.isFullscreen();

    updateSettingsInMemory((s) => ({
      ...s,
      window: {
        ...s.window,
        width: size.width,
        height: size.height,
        maximized: isMaximized,
        fullscreen: isFullscreen,
      },
    }));
    saveSettingsDebounced();
  });
}
```

---

## 5. Integration in initApp()

Update `src/main.ts` initApp():

```typescript
async function initApp() {
  console.log("Initializing Markable 2.0...");

  // 1. Load settings
  const settings = await loadSettings();

  // 2. Apply window position/size (before creating editor)
  await applyWindowSettings(settings.window);

  // 3. Create editor
  const editorContainer = document.getElementById("editor");
  // ... existing editor creation ...

  // 4. Apply editor settings (Step 04)
  // 5. Apply theme (Step 06)

  // 6. Set up window state listeners
  await setupWindowStateListeners();

  // 7. Set up menu event listeners (existing)
  await listen<{ action: string }>("menu-event", (event) => {
    // ... existing switch ...
  });

  // 8. Show window
  await showWindow();
}
```

**Important ordering:** `applyWindowSettings` is called before `showWindow()`. The window position and size are set while the window is still hidden. The user sees the window appear at the correct position and size from the first frame.

---

## 6. Edge Case Coverage

| Edge Case | How Handled |
|-----------|-------------|
| EC-10: External monitor disconnected | `isWindowOffScreen()` detects that saved position has <50px visible overlap with primary screen. Resets to center. |
| EC-11: Negative coordinates | Same `isWindowOffScreen()` check. If less than 50px is visible, reset to center. |
| EC-12: Fullscreen + display change | Fullscreen is restored via `setFullscreen(true)` which always uses the current primary display. |
| EC-13: Rapid move/resize | `saveSettingsDebounced()` at 1000ms. Only the final state is written. `updateSettingsInMemory()` is synchronous and cheap. |
| EC-24: Two saves in debounce window | `clearTimeout` in `saveSettingsDebounced()` cancels the previous timer. Only the latest state is saved. |
| EC-25: Crash during write | Atomic write in Rust (Step 01) ensures either old or new file survives. Never a partial write. |

---

## 7. Tests

Add to `tests/settings.test.ts`:

```typescript
describe("isWindowOffScreen", () => {
  const screenW = 1920;
  const screenH = 1080;

  it("returns false for a window fully on screen", () => {
    expect(isWindowOffScreen(100, 100, 800, 600, screenW, screenH)).toBe(false);
  });

  it("returns true for a window entirely off right edge", () => {
    expect(isWindowOffScreen(2000, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for a window entirely off bottom edge", () => {
    expect(isWindowOffScreen(100, 2000, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for a window entirely off left edge", () => {
    expect(isWindowOffScreen(-900, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns false for partially visible window (>50px visible)", () => {
    // Window at x=-700, width=800 => 100px visible on screen
    expect(isWindowOffScreen(-700, 100, 800, 600, screenW, screenH)).toBe(false);
  });

  it("returns true for barely visible window (<50px visible)", () => {
    // Window at x=-780, width=800 => 20px visible on screen
    expect(isWindowOffScreen(-780, 100, 800, 600, screenW, screenH)).toBe(true);
  });

  it("returns true for sentinel values (width=0, height=0)", () => {
    expect(isWindowOffScreen(0, 0, 0, 0, screenW, screenH)).toBe(true);
  });
});
```

---

## Done Criteria

- [ ] Window position and size are restored on launch (before window.show())
- [ ] Sentinel values (width=0, height=0) trigger centering
- [ ] Off-screen detection works for all four edges
- [ ] Fullscreen state is restored
- [ ] Maximized state is restored (when not fullscreen)
- [ ] `onMoved` and `onResized` listeners save window state
- [ ] Saves are debounced at 1000ms
- [ ] All required permissions added to `capabilities/default.json`
- [ ] `isWindowOffScreen` unit tests pass
- [ ] `tsc --noEmit` passes
