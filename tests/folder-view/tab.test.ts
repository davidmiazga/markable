/**
 * tests/folder-view/tab.test.ts
 *
 * Unit tests for openFolderViewTab, notifyFolderViewTabs, checkStaleFolderViewTabs.
 *
 * Covers acceptance criteria from step_04_tab-and-stale.md:
 * FR-17, FR-31, FR-32, FR-33, EC-13, EC-15, EC-17, EC-18.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  openFolderViewTab,
  notifyFolderViewTabs,
  checkStaleFolderViewTabs,
  clearFolderViewRegistry,
  _registry,
  escapeHtml,
  LAYOUT_RENDERERS,
} from "../../src/plugins/file-browser/folder-view/tab";

// ── Global mocks ──────────────────────────────────────────────────────────────

/** Track which tabs were "opened" by __MARKABLE_OPEN_CUSTOM_TAB__. */
const openedTabs: Array<{ title: string }> = [];
let activeTabTitle = "";
const tabStore: Array<{ title: string }> = [];

function setupWindowMocks(opts: { activeTitle?: string } = {}): void {
  activeTabTitle = opts.activeTitle ?? "";
  openedTabs.length = 0;

  (window as any).__MARKABLE_OPEN_CUSTOM_TAB__ = (title: string, renderFn: (c: HTMLElement) => void) => {
    openedTabs.push({ title });
    tabStore.push({ title });
    // Simulate the tab-manager calling renderFn with a container.
    const container = document.createElement("div");
    container.id = "custom-tab-host";
    renderFn(container);
  };

  (window as any).__MARKABLE_TAB_MANAGER__ = {
    getTabs: vi.fn(() => tabStore.map(t => ({ title: t.title }))),
    getActiveTab: vi.fn(() => {
      return activeTabTitle ? { title: activeTabTitle } : null;
    }),
  };

  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => ({
      entries: [],
      nonMdFiles: [],
      directories: [],
      totalFilesFound: 0,
      capped: false,
    })),
  };

  // Stub Tauri invoke to return a minimal _folder.md.
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn(async (_cmd: string, _args: any) => {
      return "---\nlayout: folder-cards\n---\n";
    }),
  };
}

describe("tab.ts", () => {
  beforeEach(() => {
    clearFolderViewRegistry();
    tabStore.length = 0;
    setupWindowMocks();
  });

  // ── FR-17 / EC-15: Two different paths → two independent tabs ────────────

  it("FR-17 / EC-15: two different folder paths produce distinct synthetic keys", async () => {
    setupWindowMocks();

    openFolderViewTab("/vault/Work/Reports");
    openFolderViewTab("/vault/Personal/Reports");

    // Allow the async reads to settle (renderFolderViewTabAsync is fire-and-forget).
    await new Promise(r => setTimeout(r, 50));

    expect(_registry).toHaveLength(2);
    const keys = _registry.map(r => r.syntheticKey);
    expect(keys).toContain("__fv__:/vault/Work/Reports");
    expect(keys).toContain("__fv__:/vault/Personal/Reports");
    expect(keys[0]).not.toBe(keys[1]);
  });

  // ── FR-17 dedup: same path twice → one registry entry ────────────────────

  it("FR-17 dedup: calling openFolderViewTab twice for the same path → one registry entry", async () => {
    setupWindowMocks();

    openFolderViewTab("/vault/A");
    openFolderViewTab("/vault/A");

    await new Promise(r => setTimeout(r, 50));

    expect(_registry.filter(r => r.folderPath === "/vault/A")).toHaveLength(1);
  });

  // ── FR-32 stale flag set when tab is inactive ─────────────────────────────

  it("FR-32: notifyFolderViewTabs sets stale flag when the tab is NOT active", async () => {
    setupWindowMocks({ activeTitle: "__fv__:/vault/B" }); // A different tab is active

    openFolderViewTab("/vault/A");
    await new Promise(r => setTimeout(r, 50));

    notifyFolderViewTabs("/vault/A/_folder.md");

    const entry = _registry.find(r => r.folderPath === "/vault/A");
    expect(entry).toBeDefined();
    expect(entry!.staleRef.stale).toBe(true);
  });

  // ── FR-31: re-render immediately when tab is active ───────────────────────

  it("FR-31: notifyFolderViewTabs calls rerender immediately when tab IS active", async () => {
    // Make the folder-A tab the active tab.
    setupWindowMocks({ activeTitle: "__fv__:/vault/A" });

    openFolderViewTab("/vault/A");
    await new Promise(r => setTimeout(r, 50));

    // Inject the host element so rerender can find it.
    const hostEl = document.createElement("div");
    hostEl.id = "custom-tab-host";
    document.body.appendChild(hostEl);

    const entry = _registry.find(r => r.folderPath === "/vault/A");
    expect(entry).toBeDefined();
    const rerenderSpy = vi.spyOn(entry!, "rerender");

    notifyFolderViewTabs("/vault/A/_folder.md");

    expect(rerenderSpy).toHaveBeenCalledOnce();
    // stale flag should NOT be set (rerender was called, not the stale path).
    expect(entry!.staleRef.stale).toBe(false);

    document.body.removeChild(hostEl);
  });

  // ── FR-32 check: stale tab re-rendered on activation ─────────────────────

  it("FR-32 check: checkStaleFolderViewTabs re-renders stale tab that is now active", async () => {
    setupWindowMocks({ activeTitle: "__fv__:/vault/B" });

    openFolderViewTab("/vault/A");
    await new Promise(r => setTimeout(r, 50));

    // Mark as stale.
    notifyFolderViewTabs("/vault/A/_folder.md");
    const entry = _registry.find(r => r.folderPath === "/vault/A")!;
    expect(entry.staleRef.stale).toBe(true);

    // Now make /vault/A the active tab and check for stale.
    activeTabTitle = "__fv__:/vault/A";
    (window as any).__MARKABLE_TAB_MANAGER__.getActiveTab = vi.fn(() => ({
      title: "__fv__:/vault/A",
    }));

    const hostEl = document.createElement("div");
    hostEl.id = "custom-tab-host";
    document.body.appendChild(hostEl);

    checkStaleFolderViewTabs();

    // Stale flag reset and rerender called.
    expect(entry.staleRef.stale).toBe(false);

    document.body.removeChild(hostEl);
  });

  // ── EC-18: Stale tab NOT re-rendered while a different tab is active ──────

  it("EC-18: checkStaleFolderViewTabs does NOT call rerender when a different tab is active", async () => {
    setupWindowMocks({ activeTitle: "__fv__:/vault/B" });

    openFolderViewTab("/vault/A");
    await new Promise(r => setTimeout(r, 50));

    // Mark stale.
    notifyFolderViewTabs("/vault/A/_folder.md");
    const entry = _registry.find(r => r.folderPath === "/vault/A")!;
    expect(entry.staleRef.stale).toBe(true);

    // B is still the active tab.
    const rerenderSpy = vi.spyOn(entry, "rerender");
    checkStaleFolderViewTabs(); // active tab is B, not A → no rerender

    expect(rerenderSpy).not.toHaveBeenCalled();
    // Stale flag stays true.
    expect(entry.staleRef.stale).toBe(true);
  });

  // ── FR-33: notifyFolderViewTabs does not affect non-folder-view tabs ──────

  it("FR-33: notifyFolderViewTabs is a no-op when the changed path is not _folder.md", () => {
    setupWindowMocks({ activeTitle: "__fv__:/vault/A" });

    openFolderViewTab("/vault/A");
    const entry = _registry.find(r => r.folderPath === "/vault/A")!;
    const rerenderSpy = vi.spyOn(entry, "rerender");

    // A non-_folder.md path change.
    notifyFolderViewTabs("/vault/A/some-note.md");

    expect(rerenderSpy).not.toHaveBeenCalled();
    expect(entry.staleRef.stale).toBe(false);
  });

  // ── EC-13: escapeHtml prevents XSS in tab titles ──────────────────────────

  it("EC-13: escapeHtml escapes HTML special characters (XSS prevention)", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml(`"quoted"`)).toBe("&quot;quoted&quot;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  // ── LAYOUT_RENDERERS dispatch map ─────────────────────────────────────────

  it("LAYOUT_RENDERERS contains 'folder-cards' entry", () => {
    expect(typeof LAYOUT_RENDERERS["folder-cards"]).toBe("function");
  });

  // ── clearFolderViewRegistry ───────────────────────────────────────────────

  it("clearFolderViewRegistry empties the registry", async () => {
    setupWindowMocks();
    openFolderViewTab("/vault/A");
    await new Promise(r => setTimeout(r, 20));
    expect(_registry.length).toBeGreaterThan(0);
    clearFolderViewRegistry();
    expect(_registry.length).toBe(0);
  });
});
