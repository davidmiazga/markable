# Step 06: Theme Persistence

**Covers:** R6, NF3
**Edge Cases:** EC-17, EC-18, EC-19
**Depends on:** Step 02 (settings singleton), existing theme system in `main.ts`
**Files Modified:** `src/main.ts`, `src/lib/settings.ts`

---

## Objective

Persist the active theme name across launches. Implement a fallback chain: active -> fallback -> bundled default. Load the theme before `window.show()` to prevent flash. Update `theme.fallback` only after a successful theme load.

---

## 1. Current Theme System Analysis

The existing theme system in `main.ts` uses:
- `currentTheme: "light" | "dark" | "system"` variable
- `setTheme()` function that sets `data-theme` attribute on `<html>`
- Theme menu events: `theme-light`, `theme-dark`, `theme-system`, `theme-next`, `theme-prev`

The settings schema uses `theme.active` (string) and `theme.fallback` (string). The current theme values ("light", "dark", "system") map directly to these strings.

---

## 2. Theme Application with Fallback Chain

Replace the existing `setTheme()` in `main.ts` with a settings-aware version:

```typescript
/**
 * Apply a theme by name, with fallback chain.
 *
 * Fallback order (R6):
 * 1. Try the requested theme name
 * 2. If it fails, try theme.fallback from settings
 * 3. If that fails, use the hardcoded bundled default ("default-dark")
 *
 * @param themeName - Theme identifier (e.g., "light", "dark", "system", "default-dark")
 * @param persist - Whether to save the theme to settings (default: true)
 */
async function setTheme(themeName: string, persist: boolean = true): Promise<void> {
  const BUNDLED_DEFAULT = "default-dark";

  const success = tryApplyTheme(themeName);

  if (success) {
    // Update theme.fallback to this known-good theme (AC-6.6)
    if (persist) {
      await updateSettings((s) => ({
        ...s,
        theme: {
          active: themeName,
          fallback: themeName,  // Update fallback on success
        },
      }));
    }
    console.log(`Theme applied: ${themeName}`);
    return;
  }

  // EC-17: Active theme failed. Try fallback.
  console.warn(`Theme "${themeName}" failed to load. Trying fallback.`);
  const settings = getCurrentSettings();
  const fallbackName = settings.theme.fallback;

  if (fallbackName && fallbackName !== themeName) {
    const fallbackSuccess = tryApplyTheme(fallbackName);
    if (fallbackSuccess) {
      if (persist) {
        await updateSettings((s) => ({
          ...s,
          theme: { ...s.theme, active: fallbackName },
        }));
      }
      console.log(`Fallback theme applied: ${fallbackName}`);
      return;
    }
  }

  // EC-19: Both failed. Use bundled default.
  console.warn(`Fallback theme "${fallbackName}" also failed. Using bundled default.`);
  tryApplyTheme(BUNDLED_DEFAULT);
  if (persist) {
    await updateSettings((s) => ({
      ...s,
      theme: { active: BUNDLED_DEFAULT, fallback: BUNDLED_DEFAULT },
    }));
  }
}
```

---

## 3. tryApplyTheme Implementation

```typescript
/**
 * Attempt to apply a theme by name.
 * Returns true if the theme was applied successfully, false otherwise.
 *
 * Currently supports built-in themes: "light", "dark", "system", "default-dark", "default-light".
 * Future: will load CSS files from the themes directory.
 */
function tryApplyTheme(themeName: string): boolean {
  try {
    // Map theme names to data-theme attribute values
    const themeMap: Record<string, string | null> = {
      "light": "light",
      "default-light": "light",
      "dark": "dark",
      "default-dark": "dark",
      "system": null,  // null means "use system preference"
    };

    if (themeName === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
      return true;
    }

    const dataTheme = themeMap[themeName];
    if (dataTheme === undefined) {
      // EC-17: Unknown theme name
      console.warn(`Unknown theme: "${themeName}"`);
      return false;
    }

    document.documentElement.setAttribute("data-theme", dataTheme);
    return true;
  } catch (err) {
    // EC-18: Theme application error (should be rare for built-in themes)
    console.error(`Error applying theme "${themeName}":`, err);
    return false;
  }
}
```

**Design note:** For the current phase, themes are limited to "light", "dark", and "system" (built-in). The `tryApplyTheme` function is designed to be extended when custom CSS theme loading is implemented. At that point, it would load a CSS file from disk and inject it as a `<style>` element. If the CSS file is missing or corrupt (EC-18), it returns false and the fallback chain kicks in.

---

## 4. Theme Cycling (Updated)

Update `nextTheme()` and `prevTheme()` to use the new `setTheme()`:

```typescript
const themeOrder: string[] = ["default-light", "default-dark", "system"];

function nextTheme(): void {
  const current = getCurrentSettings().theme.active;
  const idx = themeOrder.indexOf(current);
  const next = themeOrder[(idx + 1) % themeOrder.length];
  setTheme(next);
}

function prevTheme(): void {
  const current = getCurrentSettings().theme.active;
  const idx = themeOrder.indexOf(current);
  const prev = themeOrder[(idx - 1 + themeOrder.length) % themeOrder.length];
  setTheme(prev);
}
```

---

## 5. Theme Loading on Init (TC-5: Before Window Show)

In `initApp()`, apply the theme before `showWindow()`:

```typescript
async function initApp() {
  const settings = await loadSettings();

  // Apply window state
  await applyWindowSettings(settings.window);

  // Apply theme BEFORE editor creation and window show (no-flash)
  await setTheme(settings.theme.active, false);  // persist=false on init (already saved)

  // Create editor
  editor = createEditor(editorContainer, "");

  // Apply editor settings
  applyEditorSettings(settings.editor);

  // ... listeners ...

  await showWindow();
}
```

The `persist: false` parameter on init avoids an unnecessary write-back of the settings on launch. The theme is already saved; we just need to apply it.

---

## 6. Menu Event Handler Updates

Update the menu event handler in `main.ts`:

```typescript
case "theme-next":
  nextTheme();
  break;
case "theme-prev":
  prevTheme();
  break;
case "theme-light":
  setTheme("default-light");
  break;
case "theme-dark":
  setTheme("default-dark");
  break;
case "theme-system":
  setTheme("system");
  break;
```

---

## 7. System Theme Change Listener

When the user has selected "system" theme, changes to the OS dark/light mode should be reflected immediately:

```typescript
// In initApp(), after theme is applied:
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const settings = getCurrentSettings();
  if (settings.theme.active === "system") {
    tryApplyTheme("system");
  }
});
```

---

## 8. Edge Case Coverage

| Edge Case | How Handled |
|-----------|-------------|
| EC-17: `theme.active` does not exist | `tryApplyTheme` returns false for unknown names. Fallback chain activates: try `theme.fallback`, then bundled default. |
| EC-18: Theme CSS corrupt | `tryApplyTheme` catches errors and returns false. For built-in themes this is near-impossible, but the pattern is ready for custom CSS themes in future phases. |
| EC-19: Both active and fallback invalid | After both fail, the hardcoded `BUNDLED_DEFAULT` ("default-dark") is applied. This is a built-in theme that cannot fail. |

The app never crashes due to theme errors (AC-6.4) because:
1. `tryApplyTheme` wraps all logic in try/catch.
2. The fallback chain always terminates at a built-in theme.
3. `setTheme` catches all errors from `updateSettings` (save failures are non-fatal).

---

## 9. Tests

```typescript
describe("tryApplyTheme", () => {
  it("applies dark theme correctly", () => {
    const result = tryApplyTheme("dark");
    expect(result).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies light theme correctly", () => {
    const result = tryApplyTheme("light");
    expect(result).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applies system theme using matchMedia", () => {
    const result = tryApplyTheme("system");
    expect(result).toBe(true);
    // data-theme should be either "light" or "dark" based on matchMedia
    const attr = document.documentElement.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(attr);
  });

  it("returns false for unknown theme", () => {
    const result = tryApplyTheme("nonexistent-theme");
    expect(result).toBe(false);
  });

  it("maps default-dark to dark data-theme", () => {
    const result = tryApplyTheme("default-dark");
    expect(result).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
```

---

## Done Criteria

- [ ] `setTheme()` persists `theme.active` to settings
- [ ] `theme.fallback` is updated only after successful theme load (AC-6.6)
- [ ] Fallback chain works: active -> fallback -> bundled default
- [ ] Theme is applied before `window.show()` (no flash)
- [ ] `theme-light`, `theme-dark`, `theme-system` menu events work
- [ ] `theme-next`, `theme-prev` cycle through themes
- [ ] System theme changes are detected when "system" is active
- [ ] Unknown theme names trigger fallback (EC-17)
- [ ] App never crashes due to theme errors (AC-6.4)
- [ ] Tests pass
