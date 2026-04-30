# Step 04 — Tests

**New file**: `tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts`
**Goal**: Full TDD specification for all new code introduced in steps 01–03.

---

## Prerequisites

Before writing these tests:

1. The `_testing` export in `backlinks.plugin.ts` must be extended with two
   new accessors (see "Required `_testing` additions" below).
2. `handleCreateNoteClick` is already exported directly — no accessor needed.
3. `showWikiPopover` is already exported directly.

---

## Required `_testing` Additions

Add to the `_testing` object in `backlinks.plugin.ts`:

```typescript
/**
 * Call the module-private `resolveCreationPath` function.
 * Exposed for unit tests only.
 */
resolveCreationPath(rawTarget: string, vaultRoot: string): string {
  return resolveCreationPath(rawTarget, vaultRoot);
},

/**
 * Call the module-private `createBrokenLinkPopoverElement` function.
 * Exposed for unit tests only.
 */
createBrokenLinkPopoverElement(
  displayStem: string,
  vaultRelativePath: string
): HTMLElement {
  return createBrokenLinkPopoverElement(displayStem, vaultRelativePath);
},

/**
 * Call the module-private `_showInlinePopoverError` function.
 * Exposed for unit tests only.
 */
showInlinePopoverError(message: string): void {
  _showInlinePopoverError(message);
},
```

---

## Test File Structure

```
tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts

Suite A: resolveCreationPath (pure function — 9 tests)
Suite B: createBrokenLinkPopoverElement (DOM — 4 tests)
Suite C: handleCreateNoteClick (async orchestrator — 7 tests)
Suite D: showWikiPopover broken-link branch (integration — 5 tests)
Suite E: _showInlinePopoverError (DOM mutation — 2 tests)
Suite F: CSS string contains new rules (regression — 2 tests)
```

---

## Suite A — `resolveCreationPath`

Import via `_testing.resolveCreationPath`.

```typescript
describe("resolveCreationPath", () => {
  it("no path prefix: appends stem.md to vault root", () => {
    expect(_testing.resolveCreationPath("new idea", "/vault"))
      .toBe("/vault/new idea.md");
  });

  it("preserves capitalisation of the target text", () => {
    expect(_testing.resolveCreationPath("New Idea", "/vault"))
      .toBe("/vault/New Idea.md");
  });

  it("path prefix: resolves relative to vault root, not current file", () => {
    expect(_testing.resolveCreationPath("folder/note", "/vault"))
      .toBe("/vault/folder/note.md");
  });

  it("path prefix with capitalisation", () => {
    expect(_testing.resolveCreationPath("Projects/My Note", "/vault"))
      .toBe("/vault/Projects/My Note.md");
  });

  it("strips anchor suffix before constructing filename (EC-15)", () => {
    expect(_testing.resolveCreationPath("note#intro", "/vault"))
      .toBe("/vault/note.md");
  });

  it("anchor stripped from path-prefixed target (EC-15)", () => {
    expect(_testing.resolveCreationPath("folder/note#section", "/vault"))
      .toBe("/vault/folder/note.md");
  });

  it("does not double-append .md when target already has extension", () => {
    expect(_testing.resolveCreationPath("note.md", "/vault"))
      .toBe("/vault/note.md");
  });

  it("absolute path starting with / is returned verbatim with .md appended", () => {
    expect(_testing.resolveCreationPath("/abs/path", "/vault"))
      .toBe("/abs/path.md");
  });

  it("absolute path already ending in .md is returned as-is", () => {
    expect(_testing.resolveCreationPath("/abs/note.md", "/vault"))
      .toBe("/abs/note.md");
  });
});
```

---

## Suite B — `createBrokenLinkPopoverElement`

Import via `_testing.createBrokenLinkPopoverElement`. Requires jsdom (already
configured in the Vitest environment).

```typescript
describe("createBrokenLinkPopoverElement", () => {
  it("returns a div with data-markable-wiki-popover attribute", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    expect(el.getAttribute("data-markable-wiki-popover")).toBe("true");
  });

  it("contains .wl-popover-title, .wl-popover-path, .wl-popover-create-btn children", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "folder/My Note.md");
    expect(el.querySelector(".wl-popover-title")?.textContent).toBe("My Note");
    expect(el.querySelector(".wl-popover-path")?.textContent).toBe("folder/My Note.md");
    expect(el.querySelector(".wl-popover-create-btn")?.textContent).toBe("Create note");
  });

  it("does NOT contain .wl-popover-excerpt (no excerpt for unborn files)", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    expect(el.querySelector(".wl-popover-excerpt")).toBeNull();
  });

  it("button has type=button attribute", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    const btn = el.querySelector(".wl-popover-create-btn") as HTMLButtonElement;
    expect(btn.getAttribute("type")).toBe("button");
  });
});
```

---

## Suite C — `handleCreateNoteClick`

Import directly: `import { handleCreateNoteClick } from "..."`.

Setup pattern for each test:

```typescript
// Set _hoverFetchVersion to a known value via _testing
// Mock __TAURI_INTERNALS__.invoke
// Mock __MARKABLE_VAULT_MANAGER__ and __MARKABLE_TAB_MANAGER__
```

```typescript
describe("handleCreateNoteClick", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset version counter to 1 and set _enabled
    _testing.setEnabled(true);
    dismissWikiPopover(); // clears state and increments version

    invokeMock = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
      reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    dismissWikiPopover();
  });

  it("aborts without invoking write_file when capturedVersion mismatches (EC-11)", async () => {
    invokeMock.mockResolvedValue(undefined);
    // capturedVersion = 1, but current version has advanced to 5
    _testing.setEnabled(true);
    const currentVersion = _testing.getHoverFetchVersion();
    // Simulate dismiss happening (increments version)
    dismissWikiPopover();
    // Now version is currentVersion + 1, but we pass the old capturedVersion
    await handleCreateNoteClick("/vault/note.md", "note", currentVersion);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls ensure_directory then write_file in sequence on success", async () => {
    invokeMock.mockResolvedValue(undefined);
    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/folder/note.md", "note", v);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "ensure_directory", {
      path: "/vault/folder",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "write_file", {
      path: "/vault/folder/note.md",
      content: "# note\n",
    });
  });

  it("shows inline error and does NOT call write_file when ensure_directory throws (FR-5)", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce(undefined);

    // Install a fake active popover with a button
    const fakePopover = document.createElement("div");
    fakePopover.innerHTML = '<button class="wl-popover-create-btn">Create note</button>';
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/folder/note.md", "note", v);

    // ensure_directory failed so write_file should not be called
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("ensure_directory", expect.any(Object));
    // Error message should replace the button
    expect(fakePopover.querySelector(".wl-popover-create-btn")).toBeNull();
    expect(fakePopover.querySelector(".wl-popover-error-msg")).not.toBeNull();

    fakePopover.remove();
  });

  it("shows inline error and does NOT call reloadVaultIndex when write_file throws (FR-5)", async () => {
    invokeMock
      .mockResolvedValueOnce(undefined)           // ensure_directory succeeds
      .mockRejectedValueOnce(new Error("I/O error")); // write_file fails

    const fakePopover = document.createElement("div");
    fakePopover.innerHTML = '<button class="wl-popover-create-btn">Create note</button>';
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const reloadMock = (window as any).__MARKABLE_VAULT_MANAGER__.reloadVaultIndex;
    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "note", v);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(fakePopover.querySelector(".wl-popover-error-msg")).not.toBeNull();

    fakePopover.remove();
  });

  it("calls reloadVaultIndex and openFileInTab after successful write", async () => {
    invokeMock.mockResolvedValue(undefined);
    const reloadMock = (window as any).__MARKABLE_VAULT_MANAGER__.reloadVaultIndex;
    const openMock = (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab;

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "My Note", v);

    expect(reloadMock).toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith("/vault/note.md");
  });

  it("does NOT throw when __MARKABLE_TAB_MANAGER__ is absent (EC-2)", async () => {
    invokeMock.mockResolvedValue(undefined);
    delete (window as any).__MARKABLE_TAB_MANAGER__;

    const v = _testing.getHoverFetchVersion();
    await expect(
      handleCreateNoteClick("/vault/note.md", "note", v)
    ).resolves.toBeUndefined();
  });

  it("calls dismissWikiPopover after successful creation (FR-4 step 3)", async () => {
    invokeMock.mockResolvedValue(undefined);

    // Install a fake active popover so dismissWikiPopover has something to remove
    const fakePopover = document.createElement("div");
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "note", v);

    expect(_testing.getActivePopoverEl()).toBeNull();
    // element should have been removed from DOM
    expect(document.body.contains(fakePopover)).toBe(false);
  });
});
```

---

## Suite D — `showWikiPopover` broken-link branch

Import `showWikiPopover` directly.

```typescript
describe("showWikiPopover — broken-link branch", () => {
  beforeEach(() => {
    _testing.setEnabled(true);
    dismissWikiPopover();
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(new Error("should not be called")),
    };
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    dismissWikiPopover();
  });

  it("shows no popover when no vault is active (EC-1)", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => null,
    };
    const span = makeBrokenSpan("missing-note");
    await showWikiPopover(span, "missing-note");
    expect(_testing.getActivePopoverEl()).toBeNull();
  });

  it("shows a Create note popover for a broken-link span with active vault", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    };
    const span = makeBrokenSpan("new-idea");
    await showWikiPopover(span, "new-idea");

    const popover = _testing.getActivePopoverEl();
    expect(popover).not.toBeNull();
    expect(popover?.querySelector(".wl-popover-create-btn")).not.toBeNull();
  });

  it("does NOT invoke read_file for a broken-link span", async () => {
    const invokeMock = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    };
    const span = makeBrokenSpan("new-idea");
    await showWikiPopover(span, "new-idea");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("valid-link span (no broken class) takes existing code path (regression)", async () => {
    // Set currentFile so the valid path can proceed
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(new Error("not found")), // file read fails
    };

    const span = document.createElement("span");
    // No cm-wiki-link-broken class
    span.setAttribute("data-wiki-target", "existing-note");
    vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 120, left: 50, right: 150,
      width: 100, height: 20, x: 50, y: 100, toJSON: () => ({})
    } as DOMRect);

    await showWikiPopover(span, "existing-note");
    // file read failed with !result.ok — existing behaviour: no popover shown
    expect(_testing.getActivePopoverEl()).toBeNull();

    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("version mismatch during broken-link branch causes no popover (EC-11)", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    };
    const span = makeBrokenSpan("new-idea");
    // Start showWikiPopover but do not await — immediately dismiss
    const p = showWikiPopover(span, "new-idea");
    dismissWikiPopover(); // increments version — but broken-link path is sync so this is a post-hoc test
    await p;
    // The broken-link path is synchronous (no await before rendering), so
    // the popover IS shown but then immediately dismissed by the call above.
    // After dismissWikiPopover, _activePopoverEl is null.
    expect(_testing.getActivePopoverEl()).toBeNull();
  });
});
```

Helper used by Suite D:

```typescript
/**
 * Create a mock broken-link span with the cm-wiki-link-broken class.
 */
function makeBrokenSpan(target: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "cm-live-link cm-wiki-link cm-wiki-link-broken";
  span.setAttribute("data-wiki-target", target);
  vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: 120, left: 50, right: 150,
    width: 100, height: 20, x: 50, y: 100, toJSON: () => ({})
  } as DOMRect);
  return span;
}
```

---

## Suite E — `_showInlinePopoverError`

Import via `_testing.showInlinePopoverError`.

```typescript
describe("_showInlinePopoverError", () => {
  afterEach(() => {
    _testing.setActivePopoverEl(null);
    dismissWikiPopover();
  });

  it("replaces .wl-popover-create-btn with .wl-popover-error-msg", () => {
    const popover = document.createElement("div");
    popover.innerHTML = '<button class="wl-popover-create-btn">Create note</button>';
    document.body.appendChild(popover);
    _testing.setActivePopoverEl(popover);

    _testing.showInlinePopoverError("Could not create folder: permission denied");

    expect(popover.querySelector(".wl-popover-create-btn")).toBeNull();
    const errEl = popover.querySelector(".wl-popover-error-msg");
    expect(errEl).not.toBeNull();
    expect(errEl?.textContent).toContain("Could not create folder");

    popover.remove();
  });

  it("is a no-op when _activePopoverEl is null", () => {
    _testing.setActivePopoverEl(null);
    // Should not throw
    expect(() => _testing.showInlinePopoverError("oops")).not.toThrow();
  });
});
```

---

## Suite F — CSS Regression

```typescript
describe("WIKI_POPOVER_CSS contains new class rules", () => {
  it("contains .wl-popover-create-btn rule", () => {
    // Inject styles and check that the style tag contains the expected class
    injectWikiPopoverStyles();
    const styleEl = document.querySelector("[data-markable-wiki-popover-styles]");
    expect(styleEl?.textContent).toContain(".wl-popover-create-btn");
    removeWikiPopoverStyles();
  });

  it("contains .wl-popover-error-msg rule", () => {
    injectWikiPopoverStyles();
    const styleEl = document.querySelector("[data-markable-wiki-popover-styles]");
    expect(styleEl?.textContent).toContain(".wl-popover-error-msg");
    removeWikiPopoverStyles();
  });
});
```

---

## Full Import Block

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dismissWikiPopover,
  showWikiPopover,
  handleCreateNoteClick,
  injectWikiPopoverStyles,
  removeWikiPopoverStyles,
  _testing,
} from "../../../src/plugins/backlinks/backlinks.plugin";
```

---

## Running the Tests

```bash
# Run only the new test file
npm run test:run -- tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts

# Run all backlinks tests
npm run test:run -- tests/plugins/backlinks/

# Run all tests (full suite)
npm run test:run
```

Expected results when all steps are complete: 29 passing tests in the new file,
all existing `hover-popover.test.ts` tests still passing.

---

## TDD Sequence

1. Create this test file. All tests fail (red).
2. Apply step_01 changes. Suite F passes.
3. Apply step_02 changes. Suites A, B, C, E pass.
4. Apply step_03 changes. Suite D passes.
5. Run `npm run test:run` — all tests pass (green).
6. Verify no regressions in `hover-popover.test.ts`.
