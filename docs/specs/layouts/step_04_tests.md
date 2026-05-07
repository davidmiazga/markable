---
title: "Step 04 — Tests"
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Step 04 — Tests

Delivers the automated test suite covering Part A (Custom Render Tab) and Part B
(Layout Engine). All tests must pass with `npm run test:run` and must not
introduce regressions to existing tests.

**Files to create:**
- `tests/tabs/custom-tab.test.ts`
- `tests/plugins/layouts/layout-engine.test.ts`

---

## Testing strategy

### Part A: Custom Render Tab (`tests/tabs/custom-tab.test.ts`)

Tests use Vitest + happy-dom (already configured in the project). The `TabManager`
class is imported directly (not the singleton) so each test creates an isolated
instance.

**DOM setup**: Each test creates a minimal DOM:
```
<body>
  <div id="app">
    <div id="editor"></div>
    <div id="custom-tab-host"></div>
  </div>
  <div id="tab-strip"></div>
  <div id="titlebar-title"></div>
</body>
```

`TabManager.init()` requires an `EditorView`. Use a mock `EditorView` that
satisfies the interface (the existing test files in `tests/tabs/` provide this
pattern — read them before implementing).

**Global mocks**: The tests must mock `window.__MARKABLE_OPEN_CUSTOM_TAB__`,
`window.__MARKABLE_RENDER_MD__`, and `window.__MARKABLE_ACTION_EXTENSIONS__`
as they would be set by `main.ts`.

### Part B: Layout Engine (`tests/plugins/layouts/layout-engine.test.ts`)

All `layout-engine.ts` exports are pure functions (no side effects at import
time). Tests call the functions directly. Async functions (`render`) are tested
with `await` and a mock `invoke` that returns canned file contents.

---

## `tests/tabs/custom-tab.test.ts`

### Test file scaffold

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TabManager } from "../../../src/tabs/tab-manager";
// Mock bridge functions to avoid Tauri IPC in tests.
vi.mock("../../../src/lib/bridge", () => ({
  readFile: vi.fn().mockResolvedValue({ ok: true, value: "" }),
  writeFile: vi.fn().mockResolvedValue({ ok: true }),
  // ... other bridge functions
}));
vi.mock("../../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn().mockReturnValue({ plugins: {}, openFiles: [] }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
}));
```

### Test cases

```typescript
describe("openCustomRenderTab", () => {
  // TC-01: creates a tab with kind "custom"
  it("creates a tab entry with kind custom", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    const fn = vi.fn();
    tm.openCustomRenderTab("My View", fn);
    const tabs = tm.getTabs();
    expect(tabs.some(t => t.kind === "custom" && t.title === "My View")).toBe(true);
  });

  // TC-02: adds has-custom-tab to body
  it("adds has-custom-tab class to body", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    tm.openCustomRenderTab("Test", vi.fn());
    expect(document.body.classList.contains("has-custom-tab")).toBe(true);
  });

  // TC-03: activating a non-custom tab removes has-custom-tab
  it("removes has-custom-tab when switching to editor tab", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    // Open an editor tab.
    tm.openNewTab();
    const editorTabId = tm.getTabs().find(t => t.kind === "editor")!.id;
    // Open custom tab.
    tm.openCustomRenderTab("Layout", vi.fn());
    expect(document.body.classList.contains("has-custom-tab")).toBe(true);
    // Switch back to editor tab.
    tm.activateTab(editorTabId);
    expect(document.body.classList.contains("has-custom-tab")).toBe(false);
  });

  // TC-04: duplicate title replaces tab in-place
  it("replaces existing custom tab with same title", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    tm.openCustomRenderTab("Layout", fn1);
    const countAfterFirst = tm.getTabCount();
    tm.openCustomRenderTab("Layout", fn2);
    expect(tm.getTabCount()).toBe(countAfterFirst); // no new tab
    expect(fn2).toHaveBeenCalled(); // new renderFn was called
  });

  // TC-05: renderFn is called with host element
  it("calls renderFn with #custom-tab-host element", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    const fn = vi.fn();
    tm.openCustomRenderTab("Test", fn);
    expect(fn).toHaveBeenCalledWith(document.getElementById("custom-tab-host"));
  });

  // TC-06: renderFn that throws produces error fallback
  it("shows layout-error when renderFn throws", async () => {
    const tm = new TabManager();
    await tm.init(mockEditorView);
    const fn = () => { throw new Error("oops"); };
    tm.openCustomRenderTab("Broken", fn);
    const host = document.getElementById("custom-tab-host")!;
    expect(host.querySelector(".layout-error")).not.toBeNull();
  });

  // TC-07: saveSession excludes custom tabs
  it("saveSession does not include custom tabs in openFiles", async () => {
    const { updateSettings } = await import("../../../src/lib/settings");
    const tm = new TabManager();
    await tm.init(mockEditorView);
    tm.openCustomRenderTab("My Layout", vi.fn());
    await tm.saveSession();
    // updateSettings should have been called with openFiles that has no custom entries.
    const lastCall = (updateSettings as any).mock.calls.at(-1)?.[0];
    const result = typeof lastCall === "function" ? lastCall({ openFiles: [] }) : lastCall;
    expect(result?.openFiles?.some((f: any) => f.kind === "custom")).toBeFalsy();
  });

  // TC-08: closing custom tab skips dirty-check dialog
  it("closeTab on custom tab does not show confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const tm = new TabManager();
    await tm.init(mockEditorView);
    tm.openCustomRenderTab("Layout", vi.fn());
    const customTabId = tm.getTabs().find(t => t.kind === "custom")!.id;
    await tm.closeTab(customTabId);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // TC-09: openCustomRenderTab without #custom-tab-host logs error and returns
  it("logs error when #custom-tab-host is missing", async () => {
    document.getElementById("custom-tab-host")?.remove();
    const consoleSpy = vi.spyOn(console, "error");
    const tm = new TabManager();
    await tm.init(mockEditorView);
    const initialCount = tm.getTabCount();
    tm.openCustomRenderTab("Layout", vi.fn());
    expect(tm.getTabCount()).toBe(initialCount); // no tab added
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("custom-tab-host"));
  });

  // TC-10: MarkablePluginAPI.openCustomRenderTab delegates to tabManager
  it("MarkablePluginAPI.openCustomRenderTab calls tabManager.openCustomRenderTab", async () => {
    // Test by spying on the tabManager singleton.
    const { tabManager } = await import("../../../src/tabs/tab-manager");
    const spy = vi.spyOn(tabManager, "openCustomRenderTab");
    const { buildMarkablePluginAPI } = await import("../../../src/plugins/markable-plugin-api");
    const api = buildMarkablePluginAPI("test-plugin", {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    });
    const fn = vi.fn();
    api.openCustomRenderTab("Title", fn);
    expect(spy).toHaveBeenCalledWith("Title", fn);
  });

  // TC-11: window.__MARKABLE_OPEN_CUSTOM_TAB__ calls openCustomRenderTab
  it("__MARKABLE_OPEN_CUSTOM_TAB__ global calls tabManager.openCustomRenderTab", () => {
    const { tabManager } = require("../../../src/tabs/tab-manager");
    const spy = vi.spyOn(tabManager, "openCustomRenderTab");
    const global = (window as any).__MARKABLE_OPEN_CUSTOM_TAB__;
    expect(typeof global).toBe("function");
    const fn = vi.fn();
    global("Title", fn);
    expect(spy).toHaveBeenCalledWith("Title", fn);
  });

  // TC-12: window.__MARKABLE_RENDER_MD__ returns marked output
  it("__MARKABLE_RENDER_MD__ returns marked.parse output", () => {
    const renderMd = (window as any).__MARKABLE_RENDER_MD__;
    expect(typeof renderMd).toBe("function");
    const result = renderMd("**bold**");
    expect(result).toContain("<strong>bold</strong>");
  });

  // TC-13: window.__MARKABLE_ACTION_EXTENSIONS__ is a Map
  it("__MARKABLE_ACTION_EXTENSIONS__ is a Map", () => {
    const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__;
    expect(ext instanceof Map).toBe(true);
  });

  // TC-14: handleAction calls the registered extension
  it("handleAction dispatches to __MARKABLE_ACTION_EXTENSIONS__ entry", () => {
    const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__ as Map<string, () => void>;
    const handler = vi.fn();
    ext.set("test-custom-action", handler);
    const handleAction = (window as any).__MARKABLE_HANDLE_ACTION__;
    if (typeof handleAction === "function") handleAction("test-custom-action");
    expect(handler).toHaveBeenCalled();
    ext.delete("test-custom-action");
  });
});
```

---

## `tests/plugins/layouts/layout-engine.test.ts`

### Test file scaffold

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  // Internal exports needed for testing — add named exports in layout-engine.ts:
  tokenize,        // exported for testing
  resolvePath,     // exported for testing
  escape,          // exported for testing
  applyFilters,    // exported for testing
  stripScripts,
  wireDataPathListeners,
  render,
} from "../../../src/plugins/layouts/layout-engine";
```

Layout engine exports for testing (add to `layout-engine.ts`):

```typescript
// Named exports for unit testing. Not part of the plugin's runtime API.
export { tokenize, resolvePath, escape, applyFilters };
```

### Test cases (abbreviated — full list is in the Red-phase section of step_02)

```typescript
describe("tokenize", () => {
  it("TC-01: plain text → single text token", () => {
    expect(tokenize("hello")).toEqual([{ type: "text", value: "hello" }]);
  });
  it("TC-02: {{var}} → var_escaped", () => {
    const tokens = tokenize("{{file.title}}");
    expect(tokens[0]).toMatchObject({ type: "var_escaped", path: "file.title" });
  });
  it("TC-03: {{{var}}} → var_raw", () => {
    const tokens = tokenize("{{{file.rendered}}}");
    expect(tokens[0]).toMatchObject({ type: "var_raw", path: "file.rendered" });
  });
  // ... TC-04 through TC-12 as specified in step_02
});

describe("resolvePath", () => {
  it("TC-13: resolves nested path", () => {
    const ctx = { file: { title: "Hello" } };
    expect(resolvePath("file.title", ctx)).toBe("Hello");
  });
  it("TC-14: missing path returns empty string", () => {
    expect(resolvePath("file.missing.deep", {})).toBe("");
  });
  // TC-15 through TC-17
});

describe("escape", () => {
  it("TC-18: escapes HTML special chars", () => {
    expect(escape("<b>")).toBe("&lt;b&gt;");
  });
  it("TC-19: escapes ampersand", () => {
    expect(escape("a & b")).toBe("a &amp; b");
  });
});

describe("applyFilters", () => {
  // TC-20 through TC-29 — one test per filter behaviour
  it("TC-29: unknown filter returns [unknown filter: X]", () => {
    const result = applyFilters("value", [{ name: "unknown", raw: "nonexistent" }]);
    expect(result).toBe("[unknown filter: nonexistent]");
  });
});

describe("render", () => {
  const mockInvoke = vi.fn();
  const mockRenderMd = (md: string) => `<p>${md}</p>`;
  const ctx = {
    file: { title: "Test", content: "body", rendered: "<p>body</p>", tags: ["a"], yaml: {}, path: "/v/test.md", name: "test", modified: 0 },
    vault: { files: [{ title: "File A", path: "/v/a.md", name: "a", tags: ["project"], modified: 0 }], name: "TestVault", directories: [] },
    meta: { tags: [], fields: {} },
  };

  it("TC-30: double-brace output is HTML-escaped", async () => {
    const html = await render("{{file.title}}", { ...ctx, file: { ...ctx.file!, title: "<b>Bold</b>" } }, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("&lt;b&gt;");
  });

  it("TC-31: triple-brace output is NOT escaped", async () => {
    const html = await render("{{{file.rendered}}}", ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("<p>body</p>");
  });

  it("TC-34: #each array renders one item per element", async () => {
    const tmpl = "{{#each vault.files}}{{this.title}}{{/each}}";
    const html = await render(tmpl, ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("File A");
  });

  it("TC-37: #where hasTag filters correctly", async () => {
    const tmpl = '{{#where vault.files tags hasTag "project"}}{{this.title}}{{/where}}';
    const html = await render(tmpl, ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("File A");
  });

  it("TC-38: #where neq filters out matching", async () => {
    const ctxWithTwo = { ...ctx, vault: { ...ctx.vault, files: [
      { title: "File A", path: "/v/a.md", name: "a", tags: ["project"], modified: 0 },
      { title: "File B", path: "/v/b.md", name: "b", tags: [], modified: 0 },
    ]}};
    const tmpl = '{{#where vault.files title neq "File A"}}{{this.title}}{{/where}}';
    const html = await render(tmpl, ctxWithTwo, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).not.toContain("File A");
    expect(html).toContain("File B");
  });

  it("TC-40: {{embed}} inlines rendered HTML", async () => {
    mockInvoke.mockResolvedValueOnce("# Heading");
    const html = await render('{{embed "docs/note.md"}}', ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("<p># Heading</p>");
  });

  it("TC-41: {{embed}} failure renders error span", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("not found"));
    const html = await render('{{embed "missing.md"}}', ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("layout-error");
  });

  it("TC-43: {{partial}} at depth 3 renders depth-limit comment", async () => {
    mockInvoke.mockResolvedValue("{{partial \"a\"}}");
    // Depth starts at 2 (one below limit).
    const html = await render('{{partial "a"}}', ctx, 2, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("partial depth limit reached");
  });

  it("TC-44: <script> tags are stripped from output", async () => {
    const rawHtml = stripScripts("<div><script>alert(1)</script>Safe</div>");
    expect(rawHtml).not.toContain("<script>");
    expect(rawHtml).toContain("Safe");
  });
});

describe("wireDataPathListeners", () => {
  it("AC-21: data-path elements get click handlers", () => {
    const mockTM = { openFileInTab: vi.fn() };
    (window as any).__MARKABLE_TAB_MANAGER__ = mockTM;
    const container = document.createElement("div");
    container.innerHTML = '<a data-path="/v/file.md">File</a>';
    wireDataPathListeners(container);
    container.querySelector("[data-path]")!.dispatchEvent(new MouseEvent("click"));
    expect(mockTM.openFileInTab).toHaveBeenCalledWith("/v/file.md");
  });
});
```

---

## Regression check

After all tests pass:

```bash
npm run test:run
```

The following existing test files must continue to pass:
- `tests/tabs/` (all existing tab tests)
- `tests/settings/window-defaults.test.ts`
- Any other test files in `tests/`

---

## Manual test notes (for AC-27)

The following edge cases require manual verification and are documented here as
test notes:

| AC | Manual verification |
|---|---|
| AC-23 | Enable layouts plugin with empty vault layouts dir → verify `wikipedia.layout.md` and `bookshelf.layout.md` appear. |
| AC-24 | Create a file with `layout: Wikipedia` in frontmatter → open in editor → verify Wikipedia render tab opens automatically. |
| AC-25 | Disable layouts plugin → verify picker entry removed from command bar, CSS removed, DOM clean. |
| AC-28 | Run `npm run test:run` → 0 failures on all existing tests. |
| AC-29 | Run `npm run build:plugins && npm run sync:plugins` → `layouts.js` present in `src-tauri/plugins/core/`. |
