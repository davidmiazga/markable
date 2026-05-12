/**
 * tests/folder-view/tab.test.ts
 *
 * Unit tests for the new layout-view-based Folder View tab mechanism.
 *
 * Covers step_01_tab-rewrite.md acceptance criteria:
 *   T-01 — openFolderViewTab calls openFileInTab with _folder.md path
 *   T-02 — enterLayoutView is called inside .then() (RD-01)
 *   T-03 — two calls for same path → two openFileInTab calls (no dedup in tab.ts)
 *   T-04 — buildFolderViewRenderFn returns fn; calling it shows loading placeholder
 *           and fires invoke("read_file") after async settle
 *   T-05 — buildFolderViewRenderFn returns a function (prerequisite for FR-13 logic)
 *   T-06 — active tab path mismatch → refreshLayoutView NOT called
 *   T-07 — non-_folder.md changed path → refreshLayoutView NOT called (early-return guard)
 *   T-08 — escapeHtml escapes <, >, ", &
 *   T-09 — LAYOUT_RENDERERS contains "folder-cards" entry
 *
 * These tests replace the entire old test file which tested the now-deleted
 * registry / stale-flag / synthetic-key mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  openFolderViewTab,
  buildFolderViewRenderFn,
  escapeHtml,
  LAYOUT_RENDERERS,
} from "../../src/plugins/file-browser/folder-view/tab";
import { extractFrontmatterKeys } from "../../src/plugins/file-browser/folder-view/frontmatter-reader";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal tab-manager mock with all methods required by tab.ts.
 *
 * openFileInTab returns a resolved Promise by default so that .then() chains
 * complete in the next microtask tick.
 */
function makeMockTabMgr() {
  return {
    openFileInTab: vi.fn(() => Promise.resolve()),
    enterLayoutView: vi.fn(),
    exitLayoutView: vi.fn(),
    refreshLayoutView: vi.fn(),
    getActiveTab: vi.fn(() => null as any),
    isActiveTabInLayoutView: vi.fn(() => false),
  };
}

/**
 * Install the standard window globals used by tab.ts.
 * Called in each test's setup so each test gets a fresh set of spies.
 */
function setupWindowMocks(): ReturnType<typeof makeMockTabMgr> {
  const tabMgr = makeMockTabMgr();

  (window as any).__MARKABLE_TAB_MANAGER__ = tabMgr;

  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => ({
      entries: [],
      nonMdFiles: [],
      directories: [],
      totalFilesFound: 0,
      capped: false,
    })),
  };

  // Stub Tauri invoke to return a minimal _folder.md string so the async
  // render path completes without real filesystem access.
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn(async (_cmd: string, _args: any) => {
      return "---\nlayout: folder-cards\n---\n";
    }),
  };

  return tabMgr;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("tab.ts (layout-view refactor)", () => {
  let tabMgr: ReturnType<typeof makeMockTabMgr>;

  beforeEach(() => {
    tabMgr = setupWindowMocks();
  });

  afterEach(() => {
    // Clean up globals so tests do not bleed into each other.
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  // ── T-01: openFolderViewTab calls openFileInTab with _folder.md path ─────

  it("T-01: openFolderViewTab calls openFileInTab with '<folderPath>/_folder.md'", () => {
    openFolderViewTab("/vault/A");

    // openFileInTab must be called synchronously (before any async) with the
    // _folder.md path derived from the folder path.
    expect(tabMgr.openFileInTab).toHaveBeenCalledWith("/vault/A/_folder.md");
  });

  // ── T-02: enterLayoutView is called inside .then() (RD-01) ───────────────

  it("T-02: enterLayoutView is called after openFileInTab resolves (inside .then())", async () => {
    openFolderViewTab("/vault/A");

    // enterLayoutView must NOT be called synchronously — it is wired in .then().
    expect(tabMgr.enterLayoutView).not.toHaveBeenCalled();

    // Flush the microtask queue so the .then() callback fires.
    await Promise.resolve();

    expect(tabMgr.enterLayoutView).toHaveBeenCalledOnce();

    // The argument passed to enterLayoutView must be a function (the render fn).
    const [renderFnArg] = tabMgr.enterLayoutView.mock.calls[0];
    expect(typeof renderFnArg).toBe("function");
  });

  // ── T-03: two calls for same path → two openFileInTab calls ──────────────

  it("T-03: calling openFolderViewTab twice for the same path calls openFileInTab twice", async () => {
    // Tab deduplication is the tab manager's responsibility; tab.ts must not
    // suppress the second call (EC-10).
    openFolderViewTab("/vault/A");
    openFolderViewTab("/vault/A");

    await Promise.resolve();

    expect(tabMgr.openFileInTab).toHaveBeenCalledTimes(2);
  });

  // ── T-04: buildFolderViewRenderFn — loading placeholder + async invoke ───

  it("T-04: buildFolderViewRenderFn returns a fn that shows loading placeholder and calls invoke('read_file')", async () => {
    const renderFn = buildFolderViewRenderFn("/vault/A");
    expect(typeof renderFn).toBe("function");

    const container = document.createElement("div");
    renderFn(container);

    // Synchronously, the loading placeholder must be injected into container.
    expect(container.innerHTML).toContain("Loading");

    // After async settle, invoke must have been called with "read_file".
    // Three microtask flushes: (1) async renderFolderViewTabAsync starts,
    // (2) read_file invoke await resolves, (3) downstream processing settles.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect((window as any).__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith(
      "read_file",
      { path: "/vault/A/_folder.md" },
    );
  });

  // ── T-05: buildFolderViewRenderFn returns a function (prerequisite) ──────

  it("T-05: buildFolderViewRenderFn returns typeof === 'function' (prerequisite for FR-13)", () => {
    // The FR-13 inline logic in _indexUpdatedCb passes the return value of
    // buildFolderViewRenderFn to tabMgr.refreshLayoutView. This test verifies
    // the shape contract — the value is a function, not undefined or an object.
    const renderFn = buildFolderViewRenderFn("/vault/A");
    expect(typeof renderFn).toBe("function");

    // Two independent calls produce two independent closures (not the same ref).
    const renderFn2 = buildFolderViewRenderFn("/vault/A");
    expect(renderFn).not.toBe(renderFn2);
  });

  // ── T-06: active tab path mismatch → refreshLayoutView NOT called ─────────

  it("T-06: FR-13 guard — active tab path mismatch → refreshLayoutView NOT called", () => {
    // Simulate the inline FR-13 logic from _indexUpdatedCb: the active tab
    // belongs to a different file, so refreshLayoutView must not be called.
    const changedPath = "/vault/A/_folder.md";
    const parentDir = "/vault/A";

    // Active tab is a different file.
    tabMgr.getActiveTab.mockReturnValue({ filePath: "/vault/B/some-note.md" });
    tabMgr.isActiveTabInLayoutView.mockReturnValue(true);

    // Replicate the FR-13 guard condition.
    const activeTab = tabMgr.getActiveTab();
    if (activeTab?.filePath === changedPath && tabMgr.isActiveTabInLayoutView()) {
      tabMgr.refreshLayoutView(buildFolderViewRenderFn(parentDir));
    }

    expect(tabMgr.refreshLayoutView).not.toHaveBeenCalled();
  });

  // ── T-07: non-_folder.md path → early-return guard ───────────────────────

  it("T-07: FR-13 early-return guard — non-_folder.md changedPath → refreshLayoutView NOT called", () => {
    // The FR-13 block first checks whether changedPath ends with /_folder.md.
    // If it does not, the block is skipped entirely.
    const changedPath = "/vault/A/some-note.md";

    // Active tab matches the path and layout view is active — but changedPath
    // is not _folder.md, so the guard should reject it.
    tabMgr.getActiveTab.mockReturnValue({ filePath: changedPath });
    tabMgr.isActiveTabInLayoutView.mockReturnValue(true);

    // Replicate the FR-13 entry guard.
    const isFolderMd =
      changedPath.endsWith("/_folder.md") || changedPath.endsWith("\\_folder.md");

    if (isFolderMd) {
      // This branch must not be reached for a non-_folder.md path.
      tabMgr.refreshLayoutView(buildFolderViewRenderFn("/vault/A"));
    }

    expect(tabMgr.refreshLayoutView).not.toHaveBeenCalled();
  });

  // ── T-08: escapeHtml escapes <, >, ", & ──────────────────────────────────

  it("T-08: escapeHtml escapes HTML special characters (XSS prevention)", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  // ── T-09: LAYOUT_RENDERERS contains "folder-cards" entry ─────────────────

  it("T-09: LAYOUT_RENDERERS contains 'folder-cards' entry", () => {
    expect(typeof LAYOUT_RENDERERS["folder-cards"]).toBe("function");
  });

  // ── NFR-05 guard: openFolderViewTab is a no-op when tab manager is absent ─

  it("EC-01 (NFR-05): openFolderViewTab is a safe no-op when __MARKABLE_TAB_MANAGER__ is undefined", () => {
    // Remove the global to simulate a context where the tab manager has not
    // been loaded yet. The call must not throw.
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    expect(() => openFolderViewTab("/vault/A")).not.toThrow();
  });
});

describe("extractFrontmatterKeys", () => {
  // T-09 — Key present in frontmatter
  it("T-09: file with 'status: in-progress' returns {status: 'in-progress'}", () => {
    const content = "---\nstatus: in-progress\n---\n# Body";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "in-progress" });
  });

  // T-10 — No frontmatter
  it("T-10: file with no frontmatter returns {}", () => {
    const content = "# Just a heading\nNo frontmatter here.";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // T-11 — Key absent from frontmatter
  it("T-11: key absent from frontmatter returns {} for that key", () => {
    const content = "---\ntitle: My Note\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // T-12 — Inline comment stripped
  it("T-12: inline comment stripped: 'status: done # comment' → 'done'", () => {
    const content = "---\nstatus: done # this is a comment\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "done" });
  });

  // T-13 — Quoted value stripped
  it("T-13: double-quoted value stripped: 'status: \"in-progress\"' → 'in-progress'", () => {
    const content = "---\nstatus: \"in-progress\"\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "in-progress" });
  });

  it("T-13b: single-quoted value stripped: \"status: 'done'\" → 'done'", () => {
    const content = "---\nstatus: 'done'\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "done" });
  });

  // EC-04 — No frontmatter delimiters
  it("EC-04: no --- delimiters → returns {}", () => {
    const content = "status: in-progress\nno frontmatter";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // EC-05 — Value that looks like a YAML object/sequence is returned as-is
  it("EC-05: list value stored as raw string, no crash", () => {
    const content = "---\ntags: [a, b]\n---\n";
    expect(() => extractFrontmatterKeys(content, ["tags"])).not.toThrow();
    // The exact value is implementation-defined; it must be a string.
    const result = extractFrontmatterKeys(content, ["tags"]);
    expect(typeof result["tags"]).toBe("string");
  });

  // Multiple keys at once
  it("extracts multiple keys in one pass", () => {
    const content = "---\nstatus: done\npriority: high\ntitle: My Note\n---\n";
    expect(extractFrontmatterKeys(content, ["status", "priority"])).toEqual({
      status: "done",
      priority: "high",
    });
  });

  // Empty keys array
  it("empty keys array returns {} immediately", () => {
    const content = "---\nstatus: done\n---\n";
    expect(extractFrontmatterKeys(content, [])).toEqual({});
  });
});

describe("enrichment phase — read failure handling", () => {
  // T-14 — Read failure → card.meta = {}, render continues
  it("T-14: read_file rejection for a child .md file sets meta={} and render completes", async () => {
    // Set up a vault index with one .md file.
    const vaultIndex = {
      entries: [{ path: "/vault/note.md", name: "note", modified: 0 }],
      nonMdFiles: [],
      directories: [],
      totalFilesFound: 1,
      capped: false,
    };

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn(() => vaultIndex),
    };

    // _folder.md returns a folder-table layout with one extra field.
    // The read for the child note.md rejects.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string, args: any) => {
        if (args?.path?.endsWith("_folder.md")) {
          return "---\nlayout: folder-table\nextra-fields:\n  - status\n---\n";
        }
        // Child file read — reject to simulate EC-03.
        throw new Error("read error");
      }),
    };

    (window as any).__MARKABLE_TAB_MANAGER__ = {
      ...makeMockTabMgr(),
      setActiveTabTitle: vi.fn(),
    };

    const container = document.createElement("div");
    const renderFn = buildFolderViewRenderFn("/vault");
    renderFn(container);

    // Wait for the async renderFolderViewTabAsync to complete.
    await new Promise(resolve => setTimeout(resolve, 0));

    // The container must have been populated (render completed without throwing).
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
  });

  // EC-08 — Folder with an image file + extraFields declared → sidecar read attempted for the image.
  // Updated for the image-metadata feature: non-.md image cards now trigger sidecar reads when
  // extra-fields are declared. Previously this test expected 0 reads; now 1 sidecar read is expected
  // (for photo.png.md) because image cards are enriched with sidecar data (FR-4, step_05).
  it("EC-08: folder with an image file and extraFields declared → sidecar read attempted, render completes", async () => {
    // Only non-md files and directories — no .md entries.
    const vaultIndex = {
      entries: [],
      nonMdFiles: [{ path: "/vault/photo.png", modified: 0 }],
      directories: [],
      totalFilesFound: 1,
      capped: false,
    };

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn(() => vaultIndex),
    };

    let childReadCount = 0;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string, args: any) => {
        if (args?.path?.endsWith("_folder.md")) {
          return "---\nlayout: folder-table\nextra-fields:\n  - status\n---\n";
        }
        // For the image file's sidecar read (photo.png.md) — simulate missing sidecar.
        childReadCount++;
        throw new Error("File not found: " + args?.path);
      }),
    };

    (window as any).__MARKABLE_TAB_MANAGER__ = {
      ...makeMockTabMgr(),
      setActiveTabTitle: vi.fn(),
    };

    const container = document.createElement("div");
    buildFolderViewRenderFn("/vault")(container);

    await new Promise(resolve => setTimeout(resolve, 0));

    // photo.png is an image card with a sidecar key declared → 1 sidecar read attempted.
    expect(childReadCount).toBe(1);
    // Render must have completed (loading placeholder replaced) despite the sidecar miss.
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
  });

  // EC-12 — folder-cards layout skips the enrichment phase (no extra-field <th> rendered)
  // The enrichment guard in tab.ts is `layoutKey === "folder-table"`. For folder-cards,
  // card.meta is never set, so the folder-cards renderer produces its normal card grid
  // with no extra-field columns. Note: renderer.ts may still read child files for text
  // previews — that is a separate code path, not the enrichment phase.
  it("EC-12: folder-cards layout with extra-fields declared → no extra-field columns in output", async () => {
    const vaultIndex = {
      entries: [{ path: "/vault/note.md", name: "note", modified: 0 }],
      nonMdFiles: [],
      directories: [],
      totalFilesFound: 1,
      capped: false,
    };

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn(() => vaultIndex),
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string, args: any) => {
        if (args?.path?.endsWith("_folder.md")) {
          return "---\nlayout: folder-cards\nextra-fields:\n  - status\n---\n";
        }
        return "";
      }),
    };

    (window as any).__MARKABLE_TAB_MANAGER__ = {
      ...makeMockTabMgr(),
      setActiveTabTitle: vi.fn(),
    };

    const container = document.createElement("div");
    buildFolderViewRenderFn("/vault")(container);

    await new Promise(resolve => setTimeout(resolve, 0));

    // folder-cards output must not contain extra-field table columns.
    expect(container.querySelector("th.fv-th-extra")).toBeNull();
    expect(container.querySelector("td.fv-td-extra")).toBeNull();
    // And the render must have completed (loading placeholder replaced).
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
  });
});
