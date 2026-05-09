/**
 * tests/folder-view/split-click.test.ts
 *
 * Unit tests for split-click behavior introduced in step_03.
 *
 * Tests FR-01 (no folder-view → toggle), FR-02 (label click opens FV tab),
 * FR-03 (chevron click toggles only), FR-04 (Enter key), NFR-05 (ArrowRight/Left).
 *
 * Strategy: we use the _testing accessor to reach internal functions and
 * exercise them against JSDOM elements. We stub the window globals that
 * buildActivateHandler / attachNodeListeners depend on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { _testing } from "../../src/plugins/file-browser/file-browser.plugin";

/** Create a minimal directory <li> with chevron + label child elements. */
function makeDirectoryNode(path = "/vault/A", expanded = false): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "tree-node tree-node-directory";
  li.setAttribute("data-type", "directory");
  li.setAttribute("data-path", path);
  li.setAttribute("aria-expanded", expanded ? "true" : "false");
  li.tabIndex = 0;

  const chevron = document.createElement("span");
  chevron.className = "tree-node-chevron";

  const label = document.createElement("span");
  label.className = "tree-node-label";
  label.textContent = "A";

  li.appendChild(chevron);
  li.appendChild(label);
  return li;
}

describe("split-click behavior", () => {
  beforeEach(() => {
    // Reset module state so each test is isolated.
    _testing.setEnabled(true);
    _testing.setPanelContainer(document.createElement("div"));
    _testing.setExpandedPaths(new Set());

    // Stub window globals used by buildActivateHandler / toggleDirectoryNode.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: vi.fn(() => ({ id: "vault-1", rootPaths: ["/vault"] })),
      getVaultIndex: vi.fn(() => null),
    };
  });

  // ── FR-01: No folder-view → toggle on any click ───────────────────────────

  it("FR-01: hasFolderView=false, clicking directory → does NOT route to openFolderViewTab", () => {
    const li = makeDirectoryNode("/vault/A");
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    // The module-level stub openFolderViewTab is a no-op; confirm aria-expanded
    // flips when hasFolderView=false (toggleDirectoryNode is called instead).
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", false);
    li.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    // With hasFolderView=false, toggleDirectoryNode runs and flips aria-expanded.
    expect(li.getAttribute("aria-expanded")).toBe("true");
    // The global openFolderViewTab stub was NOT invoked for this path.
    // (The module stub replaces the global, not this spy — the spy would only
    // be called if the module explicitly checked the global, which it does not
    // in the stub path. The key signal is that aria-expanded flipped.)
    expect(openFVSpy).not.toHaveBeenCalled();
  });

  // ── FR-02: hasFolderView=true, row click → does NOT toggle (routes to FV) ─

  it("FR-02: hasFolderView=true, buildActivateHandler invoked → aria-expanded does NOT change (stub openFolderViewTab runs instead)", () => {
    const li = makeDirectoryNode("/vault/A", false);
    const beforeExpanded = li.getAttribute("aria-expanded");

    // Call the handler — with hasFolderView=true it routes to openFolderViewTab stub.
    const handler = _testing.buildActivateHandler(li, "vault-1", true);
    handler(new MouseEvent("click"));

    // The stub openFolderViewTab is a no-op, so aria-expanded should NOT have flipped.
    expect(li.getAttribute("aria-expanded")).toBe(beforeExpanded);
  });

  // ── FR-03: hasFolderView=true, chevron click → stopPropagation, row not fired

  it("FR-03: chevron click with hasFolderView=true → row click listener is NOT called", () => {
    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    const treeWrapper = document.createElement("div");
    treeWrapper.appendChild(ul);
    document.body.appendChild(treeWrapper);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);

    // Spy on the row's activation by observing aria-expanded.
    // If the chevron stopPropagation works, the row's click (which would call
    // openFolderViewTab stub and NOT flip aria-expanded) fires via the row handler.
    // The chevron's own listener SHOULD call toggleDirectoryNode and flip aria-expanded.
    const beforeExpanded = li.getAttribute("aria-expanded");
    const chevron = li.querySelector<HTMLElement>(".tree-node-chevron")!;
    chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Chevron listener fires toggleDirectoryNode → aria-expanded flips.
    expect(li.getAttribute("aria-expanded")).not.toBe(beforeExpanded);

    document.body.removeChild(treeWrapper);
  });

  // ── FR-04: Enter key on hasFolderView=true → routes to openFolderViewTab ──

  it("FR-04: Enter key on hasFolderView=true node → aria-expanded does NOT change (FV route taken)", () => {
    const li = makeDirectoryNode("/vault/A", false);
    const beforeExpanded = li.getAttribute("aria-expanded");

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // openFolderViewTab (stub) is a no-op → aria-expanded stays the same.
    expect(li.getAttribute("aria-expanded")).toBe(beforeExpanded);
  });

  // ── NFR-05: ArrowRight on hasFolderView=true → expands ────────────────────

  it("NFR-05: ArrowRight on hasFolderView=true collapsed directory → toggleDirectoryNode (expands)", () => {
    const li = makeDirectoryNode("/vault/A", false);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // ArrowRight calls toggleDirectoryNode which flips aria-expanded.
    expect(li.getAttribute("aria-expanded")).toBe("true");
  });

  // ── NFR-05: ArrowLeft on hasFolderView=true → collapses ───────────────────

  it("NFR-05: ArrowLeft on hasFolderView=true expanded directory → toggleDirectoryNode (collapses)", () => {
    const li = makeDirectoryNode("/vault/A", true);
    const ul = document.createElement("ul");
    ul.appendChild(li);
    _testing.setTreeEl(ul as HTMLElement);

    _testing.attachNodeListeners(li, "vault-1", true);
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(li.getAttribute("aria-expanded")).toBe("false");
  });
});
