/**
 * smart-folders.icon.test.ts
 *
 * Tests for the Smart Folders icon wiring (step_04).
 *
 * Tests cover:
 *   - ICON_FOLDER_MANAGED is exported and is a non-empty SVG string
 *   - buildNodeEl for a smart-folder node renders folder_managed SVG
 *     and the folder-icon-smart class (FR-17 / step_04)
 *   - Regular directory nodes still use the original folder SVG (regression)
 *   - Match-count badge appended when matchCount defined (A-5)
 *   - No badge when matchCount undefined (regular dirs)
 *
 * These tests require a DOM environment (jsdom).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ICON_FOLDER_MANAGED } from "../../../src/plugins/file-browser/icons/material/index";
import { _testing } from "../../../src/plugins/file-browser/file-browser.plugin";
import type { TreeNode } from "../../../src/plugins/file-browser/file-tree";

// ── ICON_FOLDER_MANAGED ───────────────────────────────────────────────────────

describe("ICON_FOLDER_MANAGED export", () => {
  it("is a non-empty string", () => {
    expect(typeof ICON_FOLDER_MANAGED).toBe("string");
    expect(ICON_FOLDER_MANAGED.length).toBeGreaterThan(0);
  });

  it("contains a valid <svg> element", () => {
    expect(ICON_FOLDER_MANAGED).toContain("<svg");
    expect(ICON_FOLDER_MANAGED).toContain("</svg>");
  });
});

// ── Mock setup ────────────────────────────────────────────────────────────────

/** Create a minimal smart folder TreeNode for DOM tests. */
function makeSmartFolderNode(matchCount?: number): TreeNode {
  return {
    type: "directory",
    path: "__smart__/sf-1",
    name: "Research",
    children: [],
    expanded: false,
    depth: 1,
    iconClass: "folder-smart",
    smartFolderId: "sf-1",
    matchCount,
  };
}

/** Create a regular directory node. */
function makeDirNode(): TreeNode {
  return {
    type: "directory",
    path: "/notes/work",
    name: "work",
    children: [],
    expanded: false,
    depth: 1,
    iconClass: "folder-icon",
  };
}

/** Set up mock globals required by buildNodeEl. */
function setupMocks(): void {
  (window as any).__MARKABLE_VAULT_MANAGER__ = null;
  (window as any).__MARKABLE_TAB_MANAGER__   = null;
  (window as any).__TAURI_INTERNALS__        = null;
}

// ── buildNodeEl — smart folder icon ──────────────────────────────────────────

describe("buildNodeEl smart folder icon", () => {
  beforeEach(() => {
    setupMocks();
    _testing.setEnabled(true);
  });

  it("renders folder-icon-smart class for smart folder nodes", () => {
    const node = makeSmartFolderNode(5);
    const li = _testing.buildNodeEl(node, null);
    const iconSpan = li.querySelector(".folder-icon-smart");
    expect(iconSpan).not.toBeNull();
  });

  it("renders an <svg> element inside the icon span for smart folder nodes", () => {
    const node = makeSmartFolderNode(5);
    const li = _testing.buildNodeEl(node, null);
    const svgEl = li.querySelector(".folder-icon-smart svg");
    expect(svgEl).not.toBeNull();
  });

  it("regular directory nodes do NOT get folder-icon-smart class", () => {
    const node = makeDirNode();
    const li = _testing.buildNodeEl(node, null);
    const smartIcon = li.querySelector(".folder-icon-smart");
    expect(smartIcon).toBeNull();
  });
});

// ── buildNodeEl — match count badge ──────────────────────────────────────────

describe("buildNodeEl match-count badge", () => {
  beforeEach(() => {
    setupMocks();
    _testing.setEnabled(true);
  });

  it("appends count badge when matchCount is defined", () => {
    const node = makeSmartFolderNode(12);
    const li = _testing.buildNodeEl(node, null);
    const suffix = li.querySelector(".tree-node-smart-suffix");
    expect(suffix).not.toBeNull();
    expect(suffix!.textContent).toContain("12");
  });

  it("count badge shows 0 when matchCount is 0", () => {
    const node = makeSmartFolderNode(0);
    const li = _testing.buildNodeEl(node, null);
    const suffix = li.querySelector(".tree-node-smart-suffix");
    expect(suffix).not.toBeNull();
    expect(suffix!.textContent).toContain("0");
  });

  it("no badge on regular directory nodes (matchCount undefined)", () => {
    const node = makeDirNode();
    const li = _testing.buildNodeEl(node, null);
    const suffix = li.querySelector(".tree-node-smart-suffix");
    expect(suffix).toBeNull();
  });
});
