/**
 * tests/collections/detection.test.ts — step_05 + refactor R03
 *
 * The MVP-era `isCollectionFolder` / `detectCollectionLayout` predicates
 * (originally in `collections/detection-glue.ts`) were deleted in refactor
 * step_R03 — Collections now flows through the standard
 * `LAYOUT_RENDERERS[config.layout]` dispatch path in `tab.ts`. The
 * `LAYOUT_RENDERERS` registration test moved to `dispatch.test.ts`.
 *
 * What survives in this file: the regression guard that `buildFolderViewSet`
 * (which scans the vault index for `_folder.md` parent directories) does
 * NOT include the `_folder.md` path itself in the returned set (EC-15 /
 * EC-17 of the requirements doc — vault-index exclusion of `_folder.md`).
 */

import { describe, it, expect } from "vitest";
import { buildFolderViewSet } from "../../src/plugins/file-browser/folder-view/detection";
import type { VaultIndex } from "../../src/lib/vault-types";

describe("vault-index sidecar exclusion (step_05 / refactor R03)", () => {
  it("EC-15 / EC-17 — buildFolderViewSet detects _folder.md without including it as a note entry", () => {
    // The vault-indexer keeps _folder.md in entries[] as a Markdown file (name:"_folder").
    // buildFolderViewSet's job is to find such entries and report the parent dir;
    // separately, the file-browser excludes name === "_folder" from the card grid.
    const index: VaultIndex = {
      vaultId: "test",
      builtAt: 0,
      entries: [
        {
          path: "/v/A/_folder.md",
          name: "_folder",
          modified: 0,
          size: 0,
          title: "",
          tags: [],
          outboundLinks: [],
        },
        {
          path: "/v/A/note.md",
          name: "note",
          modified: 0,
          size: 0,
          title: "",
          tags: [],
          outboundLinks: [],
        },
      ],
      totalFilesFound: 2,
      skippedCount: 0,
      capped: false,
    };
    const set = buildFolderViewSet(index);
    // /v/A is reported because _folder.md lives inside it.
    expect(set.has("/v/A")).toBe(true);
    // No path ending in "_folder.md" is itself a set entry — set holds parent
    // directories, not the sidecar paths.
    for (const p of set) {
      expect(p.endsWith("_folder.md")).toBe(false);
    }
  });
});
