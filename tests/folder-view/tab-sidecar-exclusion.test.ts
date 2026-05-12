/**
 * tests/folder-view/tab-sidecar-exclusion.test.ts
 *
 * Tests for sidecar .md file exclusion in collectChildren (FR-9, step_04).
 * A sidecar is a .md file whose stem (entry.name) ends in a known image extension.
 *
 * Covers SC-01 through SC-10 from step_04_tab_sidecar_exclusion.md.
 */

import { describe, it, expect } from "vitest";
import { collectChildren, IMAGE_EXTENSIONS } from "../../src/plugins/file-browser/folder-view/tab";
import type { VaultIndex } from "../../src/lib/vault-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal VaultIndex containing the given .md entries and non-MD files.
 *
 * @param mdEntries  - Array of {path, name} tuples for vault .md entries.
 * @param nonMdPaths - Paths for non-MD files in the vault.
 */
function makeVaultIndex(
  mdEntries: { path: string; name: string }[],
  nonMdPaths: string[] = [],
): VaultIndex {
  return {
    entries: mdEntries.map(e => ({
      path: e.path,
      name: e.name,
      modified: 0,
    })) as any,
    nonMdFiles: nonMdPaths.map(p => ({ path: p, modified: 0 })) as any,
    directories: [],
    totalFilesFound: mdEntries.length + nonMdPaths.length,
    capped: false,
    vaultId: "test-vault",
    builtAt: 0,
    skippedCount: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("collectChildren — sidecar exclusion (FR-9)", () => {
  it("SC-01: photo.jpg.md is excluded from returned cards, but photo.jpg is included as a nonMdFile", () => {
    const vault = makeVaultIndex(
      [
        // The .md sidecar — name is the stem "photo.jpg" (without .md).
        { path: "/vault/photo.jpg.md", name: "photo.jpg" },
      ],
      ["/vault/photo.jpg"],
    );

    const cards = collectChildren("/vault", vault);

    // Sidecar must not appear.
    const sidecarCard = cards.find(c => c.path === "/vault/photo.jpg.md");
    expect(sidecarCard).toBeUndefined();

    // The source image must still appear as a non-md file card.
    const imageCard = cards.find(c => c.path === "/vault/photo.jpg");
    expect(imageCard).toBeDefined();
    expect(imageCard!.kind).toBe("file");
  });

  it("SC-02: banner.png.md is excluded", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/banner.png.md", name: "banner.png" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/banner.png.md")).toBeUndefined();
  });

  it("SC-03: my.project.jpg.md is excluded (EC-20: last dot segment is 'jpg')", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/my.project.jpg.md", name: "my.project.jpg" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/my.project.jpg.md")).toBeUndefined();
  });

  it("SC-04: readme.md (no dot in stem) is included in cards normally", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/readme.md", name: "readme" }],
    );

    const cards = collectChildren("/vault", vault);
    const card = cards.find(c => c.path === "/vault/readme.md");
    expect(card).toBeDefined();
    expect(card!.kind).toBe("file");
  });

  it("SC-05: notes.txt.md is NOT excluded ('txt' is not an image extension)", () => {
    // Sanity check: verify "txt" is not in IMAGE_EXTENSIONS.
    expect(IMAGE_EXTENSIONS.has("txt")).toBe(false);

    const vault = makeVaultIndex(
      [{ path: "/vault/notes.txt.md", name: "notes.txt" }],
    );

    const cards = collectChildren("/vault", vault);
    const card = cards.find(c => c.path === "/vault/notes.txt.md");
    expect(card).toBeDefined();
    expect(card!.kind).toBe("file");
  });

  it("SC-06: sunset.heic.md is excluded ('heic' is an image extension)", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/sunset.heic.md", name: "sunset.heic" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/sunset.heic.md")).toBeUndefined();
  });

  it("SC-07: sunset.heif.md is excluded", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/sunset.heif.md", name: "sunset.heif" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/sunset.heif.md")).toBeUndefined();
  });

  it("SC-08: sunset.webp.md is excluded", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/sunset.webp.md", name: "sunset.webp" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/sunset.webp.md")).toBeUndefined();
  });

  it("SC-09: sunset.gif.md is excluded", () => {
    const vault = makeVaultIndex(
      [{ path: "/vault/sunset.gif.md", name: "sunset.gif" }],
    );

    const cards = collectChildren("/vault", vault);
    expect(cards.find(c => c.path === "/vault/sunset.gif.md")).toBeUndefined();
  });

  it("SC-10 (EC-12): photography.jpg.md is excluded (accepted trade-off: treated as sidecar)", () => {
    // A standalone note named "photography.jpg.md" is indistinguishable from a sidecar
    // by the last-dot heuristic. This is an accepted trade-off documented in the spec.
    const vault = makeVaultIndex(
      [{ path: "/vault/photography.jpg.md", name: "photography.jpg" }],
    );

    const cards = collectChildren("/vault", vault);
    // The file is excluded because "jpg" is an image extension in the stem.
    expect(cards.find(c => c.path === "/vault/photography.jpg.md")).toBeUndefined();
  });
});

describe("IMAGE_EXTENSIONS constant", () => {
  it("exports the expected set of image extensions", () => {
    expect(IMAGE_EXTENSIONS.has("jpg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("jpeg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("png")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("gif")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("webp")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("heic")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("heif")).toBe(true);
    // Non-image extensions should NOT be present.
    expect(IMAGE_EXTENSIONS.has("txt")).toBe(false);
    expect(IMAGE_EXTENSIONS.has("pdf")).toBe(false);
    expect(IMAGE_EXTENSIONS.has("md")).toBe(false);
  });
});
