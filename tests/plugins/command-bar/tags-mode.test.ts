/**
 * tests/plugins/command-bar/tags-mode.test.ts
 *
 * Unit tests for buildTagRows() — the pure data layer for the Tags mode in the
 * Command Bar plugin.
 *
 * Because buildTagRows reads window globals, each test sets up mock globals in
 * beforeEach and cleans them up in afterEach. The function is exported from the
 * plugin for testing purposes only.
 *
 * Environment: happy-dom (configured globally in vitest.config.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTagRows } from "../../../src/plugins/command-bar/command-bar.plugin";

// ---------------------------------------------------------------------------
// Mock data fixtures
// ---------------------------------------------------------------------------

const VAULT_WITH_TAGS = {
  getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
  getVaultIndex: () => ({
    vaultId: "v1",
    entries: [
      {
        path: "/a.md",
        name: "a",
        title: "Note A",
        tags: ["alpha", "beta"],
        outboundLinks: [],
        modified: 0,
        size: 0,
      },
      {
        path: "/b.md",
        name: "b",
        title: "Note B",
        tags: ["alpha", "gamma"],
        outboundLinks: [],
        modified: 0,
        size: 0,
      },
    ],
  }),
};

const META_WITH_TAGS = {
  tags: ["alpha", "beta"],
  fields: {},
  vaultId: "v1",
};

beforeEach(() => {
  (window as any).__MARKABLE_VAULT_MANAGER__ = VAULT_WITH_TAGS;
  (window as any).__MARKABLE_META__ = META_WITH_TAGS;
});

afterEach(() => {
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_META__;
});

// ---------------------------------------------------------------------------
// buildTagRows tests
// ---------------------------------------------------------------------------

describe("buildTagRows", () => {
  it("puts vocab tags in defined section and index-only tags in uncategorised (EC-5)", () => {
    const { defined, uncategorised } = buildTagRows("");
    // alpha and beta are in meta; gamma is only in vault index.
    expect(defined.map((r) => r.tag)).toEqual(["alpha", "beta"]); // sorted
    expect(uncategorised.map((r) => r.tag)).toEqual(["gamma"]);
  });

  it("calculates file counts correctly", () => {
    const { defined } = buildTagRows("");
    const alphaRow = defined.find((r) => r.tag === "alpha")!;
    // Both Note A and Note B have the 'alpha' tag.
    expect(alphaRow.files).toHaveLength(2);
  });

  it("applies case-insensitive substring filter to both sections", () => {
    const { defined, uncategorised } = buildTagRows("alp");
    // "alpha" matches "alp"; "beta" and "gamma" do not.
    expect(defined.map((r) => r.tag)).toEqual(["alpha"]);
    expect(uncategorised).toHaveLength(0);
  });

  it("returns empty sections when filter matches nothing", () => {
    const { defined, uncategorised } = buildTagRows("zzz");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-1: returns empty sections when no vault is open", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => null,
      getVaultIndex: () => null,
    };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-17: returns only defined tags (with 0 file counts) when index is null", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
      getVaultIndex: () => null,
    };
    const { defined, uncategorised } = buildTagRows("");
    // Defined tags still come from __MARKABLE_META__; file counts are 0.
    expect(defined.map((r) => r.tag)).toEqual(["alpha", "beta"]);
    expect(defined.every((r) => r.files.length === 0)).toBe(true);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-2: returns only uncategorised when meta has no defined tags", () => {
    (window as any).__MARKABLE_META__ = { tags: [], fields: {}, vaultId: "v1" };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    // All tags from vault index become uncategorised.
    expect(uncategorised.map((r) => r.tag).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("EC-15: both sections empty when no tags exist anywhere", () => {
    (window as any).__MARKABLE_META__ = { tags: [], fields: {}, vaultId: "v1" };
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "v1", name: "Test Vault" }),
      getVaultIndex: () => ({ vaultId: "v1", entries: [] }),
    };
    const { defined, uncategorised } = buildTagRows("");
    expect(defined).toHaveLength(0);
    expect(uncategorised).toHaveLength(0);
  });

  it("EC-16: filter state does not persist between calls (stateless function)", () => {
    // First call with a filter…
    const first = buildTagRows("alp");
    expect(first.defined).toHaveLength(1);
    // …second call without a filter returns the full list.
    const second = buildTagRows("");
    expect(second.defined).toHaveLength(2);
  });

  it("sorts defined tags alphabetically (case-insensitive)", () => {
    (window as any).__MARKABLE_META__ = {
      tags: ["Zebra", "apple", "Mango"],
      fields: {},
      vaultId: "v1",
    };
    const { defined } = buildTagRows("");
    // Case-insensitive sort: apple < Mango < Zebra
    expect(defined.map((r) => r.tag)).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("marks defined rows as defined=true and uncategorised rows as defined=false", () => {
    const { defined, uncategorised } = buildTagRows("");
    expect(defined.every((r) => r.defined)).toBe(true);
    expect(uncategorised.every((r) => !r.defined)).toBe(true);
  });
});
