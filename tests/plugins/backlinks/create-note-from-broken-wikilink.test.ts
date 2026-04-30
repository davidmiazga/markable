/**
 * Tests for "Create note from broken wiki-link" feature (Steps 01–03).
 *
 * These tests cover all new functions introduced in the feature:
 *
 *   Suite A: resolveCreationPath  — pure function, 9 cases
 *   Suite B: createBrokenLinkPopoverElement — DOM structure, 4 cases
 *   Suite C: handleCreateNoteClick — async orchestrator, 7 cases
 *   Suite D: showWikiPopover broken-link branch — integration, 5 cases
 *   Suite E: _showInlinePopoverError — DOM mutation, 2 cases
 *   Suite F: CSS string regression — 2 cases
 *
 * Source: src/plugins/backlinks/backlinks.plugin.ts (Steps 01–03 additions)
 * Spec: docs/specs/create-note-from-broken-wikilink/step_04_tests.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dismissWikiPopover,
  showWikiPopover,
  handleCreateNoteClick,
  injectWikiPopoverStyles,
  removeWikiPopoverStyles,
  _testing,
} from "../../../src/plugins/backlinks/backlinks.plugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock broken-link span with the cm-wiki-link-broken class and a
 * stubbed getBoundingClientRect so positionPopover does not throw.
 *
 * @param target - The wiki-link target text (placed in data-wiki-target).
 * @returns An HTMLSpanElement styled as a broken wiki-link span.
 */
function makeBrokenSpan(target: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "cm-live-link cm-wiki-link cm-wiki-link-broken";
  span.setAttribute("data-wiki-target", target);
  vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 120,
    left: 50,
    right: 150,
    width: 100,
    height: 20,
    x: 50,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect);
  return span;
}

// ---------------------------------------------------------------------------
// Suite A — resolveCreationPath (pure function)
// ---------------------------------------------------------------------------

describe("resolveCreationPath", () => {
  it("no path prefix: appends stem.md to vault root", () => {
    expect(_testing.resolveCreationPath("new idea", "/vault")).toBe(
      "/vault/new idea.md"
    );
  });

  it("preserves capitalisation of the target text", () => {
    expect(_testing.resolveCreationPath("New Idea", "/vault")).toBe(
      "/vault/New Idea.md"
    );
  });

  it("path prefix: resolves relative to vault root, not current file", () => {
    expect(_testing.resolveCreationPath("folder/note", "/vault")).toBe(
      "/vault/folder/note.md"
    );
  });

  it("path prefix with capitalisation", () => {
    expect(_testing.resolveCreationPath("Projects/My Note", "/vault")).toBe(
      "/vault/Projects/My Note.md"
    );
  });

  it("strips anchor suffix before constructing filename (EC-15)", () => {
    expect(_testing.resolveCreationPath("note#intro", "/vault")).toBe(
      "/vault/note.md"
    );
  });

  it("anchor stripped from path-prefixed target (EC-15)", () => {
    expect(_testing.resolveCreationPath("folder/note#section", "/vault")).toBe(
      "/vault/folder/note.md"
    );
  });

  it("does not double-append .md when target already has extension", () => {
    expect(_testing.resolveCreationPath("note.md", "/vault")).toBe(
      "/vault/note.md"
    );
  });

  it("absolute path starting with / is returned verbatim with .md appended", () => {
    expect(_testing.resolveCreationPath("/abs/path", "/vault")).toBe(
      "/abs/path.md"
    );
  });

  it("absolute path already ending in .md is returned as-is", () => {
    expect(_testing.resolveCreationPath("/abs/note.md", "/vault")).toBe(
      "/abs/note.md"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite B — createBrokenLinkPopoverElement (DOM builder)
// ---------------------------------------------------------------------------

describe("createBrokenLinkPopoverElement", () => {
  it("returns a div with data-markable-wiki-popover attribute", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    expect(el.getAttribute("data-markable-wiki-popover")).toBe("true");
  });

  it("contains .wl-popover-title, .wl-popover-path, .wl-popover-create-btn children", () => {
    const el = _testing.createBrokenLinkPopoverElement(
      "My Note",
      "folder/My Note.md"
    );
    expect(el.querySelector(".wl-popover-title")?.textContent).toBe("My Note");
    expect(el.querySelector(".wl-popover-path")?.textContent).toBe(
      "folder/My Note.md"
    );
    expect(el.querySelector(".wl-popover-create-btn")?.textContent).toBe(
      "Create note"
    );
  });

  it("does NOT contain .wl-popover-excerpt (no excerpt for unborn files)", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    expect(el.querySelector(".wl-popover-excerpt")).toBeNull();
  });

  it("button has type=button attribute", () => {
    const el = _testing.createBrokenLinkPopoverElement("My Note", "My Note.md");
    const btn = el.querySelector(
      ".wl-popover-create-btn"
    ) as HTMLButtonElement;
    expect(btn.getAttribute("type")).toBe("button");
  });
});

// ---------------------------------------------------------------------------
// Suite C — handleCreateNoteClick (async orchestrator)
// ---------------------------------------------------------------------------

describe("handleCreateNoteClick", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    /*
     * Ensure the plugin is enabled and the version counter is in a known state
     * before each test. dismissWikiPopover increments the version, providing
     * a baseline that tests can read via _testing.getHoverFetchVersion().
     */
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
    /*
     * Read the current version, then dismiss (which increments the version).
     * The old capturedVersion no longer matches — handleCreateNoteClick must abort.
     */
    const currentVersion = _testing.getHoverFetchVersion();
    dismissWikiPopover(); // increments version — currentVersion is now stale
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

    /* Install a fake active popover with a button so the error can be shown. */
    const fakePopover = document.createElement("div");
    fakePopover.innerHTML =
      '<button class="wl-popover-create-btn">Create note</button>';
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/folder/note.md", "note", v);

    /* ensure_directory failed so write_file should not be called. */
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "ensure_directory",
      expect.any(Object)
    );
    /* Error message should replace the button in the popover. */
    expect(fakePopover.querySelector(".wl-popover-create-btn")).toBeNull();
    expect(fakePopover.querySelector(".wl-popover-error-msg")).not.toBeNull();

    fakePopover.remove();
  });

  it("shows inline error and does NOT call reloadVaultIndex when write_file throws (FR-5)", async () => {
    invokeMock
      .mockResolvedValueOnce(undefined) // ensure_directory succeeds
      .mockRejectedValueOnce(new Error("I/O error")); // write_file fails

    const fakePopover = document.createElement("div");
    fakePopover.innerHTML =
      '<button class="wl-popover-create-btn">Create note</button>';
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
    const reloadMock = (window as any).__MARKABLE_VAULT_MANAGER__
      .reloadVaultIndex;
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

    /* Install a fake active popover so dismissWikiPopover has something to remove. */
    const fakePopover = document.createElement("div");
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "note", v);

    expect(_testing.getActivePopoverEl()).toBeNull();
    /* The element should have been removed from the DOM. */
    expect(document.body.contains(fakePopover)).toBe(false);
  });

  /**
   * EC-4: when write_file rejects (e.g. OS error: invalid argument from a
   * filename with illegal characters), handleCreateNoteClick must display an
   * inline error and NOT proceed to reloadVaultIndex or openFileInTab.
   */
  it("EC-4: shows inline error when write_file rejects", async () => {
    invokeMock
      .mockResolvedValueOnce(undefined) // ensure_directory succeeds
      .mockRejectedValueOnce(new Error("OS error: invalid argument")); // write_file fails

    /* Install a fake active popover with a button so the error can be shown. */
    const fakePopover = document.createElement("div");
    fakePopover.innerHTML =
      '<button class="wl-popover-create-btn">Create note</button>';
    document.body.appendChild(fakePopover);
    _testing.setActivePopoverEl(fakePopover);

    const reloadMock = (window as any).__MARKABLE_VAULT_MANAGER__.reloadVaultIndex;
    const openMock = (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab;

    const v = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/bad:name.md", "bad:name", v);

    /* write_file failed so reloadVaultIndex and openFileInTab must not run. */
    expect(reloadMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();

    /* The button should be replaced by an error element. */
    expect(fakePopover.querySelector(".wl-popover-create-btn")).toBeNull();
    expect(fakePopover.querySelector(".wl-popover-error-msg")).not.toBeNull();

    fakePopover.remove();
  });

  /**
   * EC-10: calling handleCreateNoteClick a second time for the same path must
   * not crash.  The second call uses an updated (current) version so it passes
   * the EC-11 guard and calls write_file again.
   */
  it("EC-10: calling handleCreateNoteClick twice for the same path calls write_file twice", async () => {
    invokeMock.mockResolvedValue(undefined);

    /* First call — use the current version. */
    const v1 = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "note", v1);

    /*
     * After the first successful call, dismissWikiPopover was called which
     * increments _hoverFetchVersion.  Read the new version for the second call.
     */
    const v2 = _testing.getHoverFetchVersion();
    await handleCreateNoteClick("/vault/note.md", "note", v2);

    /*
     * Each successful call invokes ensure_directory + write_file, so the mock
     * should have been called 4 times total (2 × 2).
     */
    const writeCalls = invokeMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "write_file"
    );
    expect(writeCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Suite D — showWikiPopover broken-link branch (integration)
// ---------------------------------------------------------------------------

describe("showWikiPopover — broken-link branch", () => {
  beforeEach(() => {
    _testing.setEnabled(true);
    dismissWikiPopover();
    /*
     * The invoke mock throws by default to catch any unexpected Tauri calls
     * from the broken-link path (which must NOT read a file).
     */
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
    /*
     * Set currentFile so the valid-link path can proceed. The invoke mock
     * will reject (simulating a file not found), which causes the existing
     * !result.ok branch — no popover shown. This is the pre-existing behaviour.
     */
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(new Error("not found")),
    };

    const span = document.createElement("span");
    /* No cm-wiki-link-broken class — triggers the valid-link path. */
    span.setAttribute("data-wiki-target", "existing-note");
    vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 50,
      right: 150,
      width: 100,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    await showWikiPopover(span, "existing-note");
    /* File read failed with !result.ok — existing behaviour: no popover shown. */
    expect(_testing.getActivePopoverEl()).toBeNull();

    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("version mismatch during broken-link branch causes no popover (EC-11)", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
    };
    const span = makeBrokenSpan("new-idea");
    /*
     * Start showWikiPopover and immediately dismiss. The broken-link path is
     * synchronous (no await before rendering), so the popover IS created and
     * then immediately dismissed by the call below.
     * After dismissWikiPopover, _activePopoverEl is null.
     */
    const p = showWikiPopover(span, "new-idea");
    dismissWikiPopover(); // increments version — popover removed
    await p;
    expect(_testing.getActivePopoverEl()).toBeNull();
  });

  /**
   * EC-12: when __MARKABLE_CURRENT_FILE__ is null (untitled/unsaved document),
   * the broken-link path must still render the Create note popover.
   * The broken-link branch only needs the vault root, not the current file.
   */
  it("EC-12: showWikiPopover shows create-popover when currentFile is null", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
      reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
    };

    const span = makeBrokenSpan("orphan-note");
    await showWikiPopover(span, "orphan-note");

    const popover = _testing.getActivePopoverEl();
    expect(popover).not.toBeNull();
    expect(popover?.querySelector(".wl-popover-create-btn")).not.toBeNull();

    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  /**
   * CRITICAL-2: End-to-end integration test for the Create note button.
   *
   * This test validates that the button wired inside showWikiPopover actually
   * triggers ensure_directory and write_file when clicked.  The bug fixed by
   * CRITICAL-1 (clickVersion captured before dismissWikiPopover caused a
   * permanent version mismatch) would make this test fail with invokeMock
   * never called for ensure_directory.
   */
  it("CRITICAL-2: clicking the Create note button calls ensure_directory and write_file", async () => {
    /*
     * Replace the "should not be called" mock set in beforeEach with one that
     * resolves so both Tauri commands succeed.
     */
    const invokeMock = vi.fn().mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault"] }),
      reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn().mockResolvedValue(true),
    };

    const span = makeBrokenSpan("my-note");
    await showWikiPopover(span, "my-note");

    const btn = _testing
      .getActivePopoverEl()
      ?.querySelector(".wl-popover-create-btn") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    btn!.click();
    /* Flush all pending microtasks so the async handler completes. */
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(invokeMock).toHaveBeenCalledWith(
      "ensure_directory",
      expect.any(Object)
    );
    expect(invokeMock).toHaveBeenCalledWith("write_file", expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// Suite E — _showInlinePopoverError (DOM mutation)
// ---------------------------------------------------------------------------

describe("_showInlinePopoverError", () => {
  afterEach(() => {
    _testing.setActivePopoverEl(null);
    dismissWikiPopover();
  });

  it("replaces .wl-popover-create-btn with .wl-popover-error-msg", () => {
    const popover = document.createElement("div");
    popover.innerHTML =
      '<button class="wl-popover-create-btn">Create note</button>';
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
    /* Must not throw even when there is no active popover. */
    expect(() => _testing.showInlinePopoverError("oops")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite F — CSS regression: WIKI_POPOVER_CSS contains new class rules
// ---------------------------------------------------------------------------

describe("WIKI_POPOVER_CSS contains new class rules", () => {
  it("contains .wl-popover-create-btn rule", () => {
    injectWikiPopoverStyles();
    const styleEl = document.querySelector(
      "[data-markable-wiki-popover-styles]"
    );
    expect(styleEl?.textContent).toContain(".wl-popover-create-btn");
    removeWikiPopoverStyles();
  });

  it("contains .wl-popover-error-msg rule", () => {
    injectWikiPopoverStyles();
    const styleEl = document.querySelector(
      "[data-markable-wiki-popover-styles]"
    );
    expect(styleEl?.textContent).toContain(".wl-popover-error-msg");
    removeWikiPopoverStyles();
  });
});
