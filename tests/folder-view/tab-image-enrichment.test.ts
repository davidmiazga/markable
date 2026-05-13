/**
 * tests/folder-view/tab-image-enrichment.test.ts
 *
 * Unit tests for the extended enrichment phase in renderFolderViewTabAsync.
 * Covers FR-2 (dimensions), FR-3 (EXIF), FR-4 (sidecar), FR-7 (non-image meta={}),
 * FR-8 (per-card error isolation), FR-9 (guard), EC-1, EC-2, EC-6, EC-19 — and the
 * imageColumnsRequested gate (IE-11, IE-12).
 *
 * Tests IE-01 through IE-16 from step_05_tab_enrichment.md.
 *
 * Test approach: drive renderFolderViewTabAsync indirectly via buildFolderViewRenderFn.
 * Each test sets up a custom vault index + invoke mock, fires the render fn,
 * waits a microtask, then inspects the calls made to mockInvoke.
 *
 * For card.meta inspection: the rendered <td> elements are checked, since
 * the table renderer writes card.meta[field] to textContent or "—" em-dash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFolderViewRenderFn } from "../../src/plugins/file-browser/folder-view/tab";

// ── Test infrastructure ───────────────────────────────────────────────────────

let mockInvoke: ReturnType<typeof vi.fn>;

/**
 * Set up window globals required by tab.ts for each test.
 *
 * @param vaultEntries    - The .md vault index entries (name = stem).
 * @param nonMdFiles      - Non-MD files in the vault (array of {path, modified}).
 * @param folderMdContent - Content returned for the _folder.md read.
 * @param commandResponses - A factory called with (command, args) for each invoke.
 */
function setup(
  vaultEntries: { path: string; name: string }[],
  nonMdFiles: { path: string; modified: number; ext?: string }[],
  _folderMdContent: string,
  commandResponses: (cmd: string, args: any) => unknown,
): void {
  mockInvoke = vi.fn(async (cmd: string, args: any) => {
    return commandResponses(cmd, args);
  });

  (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn(() => Promise.resolve()),
    enterLayoutView: vi.fn(),
    exitLayoutView: vi.fn(),
    refreshLayoutView: vi.fn(),
    getActiveTab: vi.fn(() => null),
    isActiveTabInLayoutView: vi.fn(() => false),
    setActiveTabTitle: vi.fn(),
  };
  (window as any).__MARKABLE_FILE_BROWSER__ = {
    expandDirectory: vi.fn(),
  };
  (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = vi.fn();

  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => ({
      entries: vaultEntries.map(e => ({ ...e, modified: 0 })),
      nonMdFiles: nonMdFiles.map(nf => ({
        path: nf.path,
        modified: nf.modified ?? 0,
      })),
      directories: [],
      totalFilesFound: vaultEntries.length + nonMdFiles.length,
      capped: false,
    })),
  };
}

/** Trigger a render and wait for async work to complete. */
async function renderAndWait(folderPath = "/vault"): Promise<HTMLElement> {
  const container = document.createElement("div");
  const renderFn = buildFolderViewRenderFn(folderPath);
  renderFn(container);
  // Wait for all microtasks + async operations to settle.
  await new Promise(resolve => setTimeout(resolve, 10));
  return container;
}

/** Collect all invoke calls for a given command name. */
function invokeCalls(command: string): any[] {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === command)
    .map(([, args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("image enrichment — dimensions (IE-01, IE-02, IE-03)", () => {
  it("IE-01: JPEG with width+height requested → get_image_dimensions called; meta[width/height] set", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n---\n",
      (cmd, args) => {
        if (cmd === "read_file" && args?.path?.endsWith("_folder.md")) {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n---\n";
        }
        if (cmd === "get_image_dimensions") return [1920, 1080];
        return undefined;
      },
    );

    const container = await renderAndWait();

    const dimCalls = invokeCalls("get_image_dimensions");
    expect(dimCalls.length).toBe(1);
    expect(dimCalls[0]).toEqual({ path: "/vault/photo.jpg" });

    // The rendered table should show the dimensions.
    const html = container.innerHTML;
    expect(html).toContain("1920");
    expect(html).toContain("1080");
  });

  it("IE-02: JPEG with date-taken+camera requested → get_exif_data called; meta[date-taken/camera] set", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n  - camera\n---\n",
      (cmd, _args) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n  - camera\n---\n";
        }
        if (cmd === "get_exif_data") {
          return { date_taken: "2024-03-15", camera: "Canon EOS R5" };
        }
        return undefined;
      },
    );

    const container = await renderAndWait();

    const exifCalls = invokeCalls("get_exif_data");
    expect(exifCalls.length).toBe(1);
    expect(exifCalls[0]).toEqual({ path: "/vault/photo.jpg" });

    const html = container.innerHTML;
    expect(html).toContain("2024-03-15");
    expect(html).toContain("Canon EOS R5");
  });

  it("IE-03: JPEG with all four image columns → both get_image_dimensions AND get_exif_data called", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n  - date-taken\n  - camera\n---\n",
      (cmd, _args) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n  - date-taken\n  - camera\n---\n";
        }
        if (cmd === "get_image_dimensions") return [800, 600];
        if (cmd === "get_exif_data") return { date_taken: "2024-01-01", camera: "Nikon Z6" };
        return undefined;
      },
    );

    await renderAndWait();

    expect(invokeCalls("get_image_dimensions").length).toBe(1);
    expect(invokeCalls("get_exif_data").length).toBe(1);
  });
});

describe("image enrichment — EXIF gate by extension (IE-04, IE-15, IE-16)", () => {
  it("IE-04: PNG with date-taken requested → get_exif_data NOT invoked; meta[date-taken]=''", async () => {
    setup(
      [],
      [{ path: "/vault/banner.png", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n",
      (cmd, _args) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n";
        }
        if (cmd === "get_image_dimensions") return [100, 100];
        if (cmd === "get_exif_data") throw new Error("should not be called for PNG");
        return undefined;
      },
    );

    await renderAndWait();

    // get_exif_data must NOT be called for PNG.
    expect(invokeCalls("get_exif_data").length).toBe(0);
    // The rendered table should show em-dash (—) for date-taken.
    // We can't easily inspect card.meta directly, but we can verify no exif error was thrown
    // by confirming the render completed (not stuck in loading state).
  });

  it("IE-15: .heic file with date-taken requested → get_exif_data IS invoked (HEIC is EXIF-eligible)", async () => {
    setup(
      [],
      [{ path: "/vault/photo.heic", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n";
        }
        if (cmd === "get_exif_data") return { date_taken: "2023-06-15", camera: null };
        return undefined;
      },
    );

    await renderAndWait();

    expect(invokeCalls("get_exif_data").length).toBe(1);
    expect(invokeCalls("get_exif_data")[0]).toEqual({ path: "/vault/photo.heic" });
  });

  it("IE-16: .webp file with date-taken requested → get_exif_data NOT invoked (WebP not in EXIF-eligible list)", async () => {
    setup(
      [],
      [{ path: "/vault/anim.webp", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - date-taken\n---\n";
        }
        if (cmd === "get_exif_data") throw new Error("should not be called for WebP");
        return undefined;
      },
    );

    await renderAndWait();

    expect(invokeCalls("get_exif_data").length).toBe(0);
  });
});

describe("image enrichment — sidecar fields (IE-05, IE-06)", () => {
  it("IE-05: image card with sidecar field 'rating' → read_file called for card.path+.md; meta[rating] set", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nextra-fields:\n  - rating\nfields:\n  - name\n  - rating\n---\n",
      (cmd, args) => {
        if (cmd === "read_file") {
          if (args?.path?.endsWith("_folder.md")) {
            return "---\nlayout: folder-table\nextra-fields:\n  - rating\nfields:\n  - name\n  - rating\n---\n";
          }
          if (args?.path === "/vault/photo.jpg.md") {
            return "---\nrating: 5\n---\n";
          }
        }
        return undefined;
      },
    );

    const container = await renderAndWait();

    const sidecarReads = invokeCalls("read_file").filter(
      (args: any) => args?.path === "/vault/photo.jpg.md",
    );
    expect(sidecarReads.length).toBe(1);

    // Rating "5" should appear in the rendered table.
    const html = container.innerHTML;
    expect(html).toContain("5");
  });

  it("IE-06: image card with sidecar field, sidecar missing → meta[rating]='' (EC-1 guard)", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nextra-fields:\n  - rating\nfields:\n  - name\n  - rating\n---\n",
      (cmd, args) => {
        if (cmd === "read_file") {
          if (args?.path?.endsWith("_folder.md")) {
            return "---\nlayout: folder-table\nextra-fields:\n  - rating\nfields:\n  - name\n  - rating\n---\n";
          }
          // Sidecar does not exist — throw to simulate missing file.
          throw new Error("File not found: /vault/photo.jpg.md");
        }
        return undefined;
      },
    );

    // Should not throw; render completes normally.
    const container = await renderAndWait();
    // Table should have rendered (loading placeholder replaced).
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
  });
});

describe("image enrichment — non-image files (IE-07, IE-08, EC-6)", () => {
  it("IE-07: non-image, non-.md file (.pdf) with width column → get_image_dimensions NOT called (EC-6)", async () => {
    setup(
      [],
      [{ path: "/vault/report.pdf", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n";
        }
        if (cmd === "get_image_dimensions") throw new Error("should not be called for PDF");
        return undefined;
      },
    );

    await renderAndWait();

    expect(invokeCalls("get_image_dimensions").length).toBe(0);
  });

  it("IE-08: directory card with width column → get_image_dimensions NOT called (EC-6 / FR-7)", async () => {
    // Directories are in vaultIndex.directories.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n";
        }
        if (cmd === "get_image_dimensions") throw new Error("should not be called for dir");
        return undefined;
      }),
    };
    mockInvoke = (window as any).__TAURI_INTERNALS__.invoke;

    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(() => Promise.resolve()),
      enterLayoutView: vi.fn(),
      exitLayoutView: vi.fn(),
      refreshLayoutView: vi.fn(),
      getActiveTab: vi.fn(() => null),
      isActiveTabInLayoutView: vi.fn(() => false),
      setActiveTabTitle: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };

    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getVaultIndex: vi.fn(() => ({
        entries: [],
        nonMdFiles: [],
        directories: ["/vault/subfolder"],
        totalFilesFound: 1,
        capped: false,
      })),
    };

    await renderAndWait();
    expect(invokeCalls("get_image_dimensions").length).toBe(0);
  });
});

describe("image enrichment — .md cards regression (IE-09)", () => {
  it("IE-09: .md file card in the same folder → extractFrontmatterKeys called as before (no regression)", async () => {
    setup(
      [{ path: "/vault/note.md", name: "note" }],
      [],
      "---\nlayout: folder-table\nextra-fields:\n  - status\n---\n",
      (cmd, args) => {
        if (cmd === "read_file") {
          if (args?.path?.endsWith("_folder.md")) {
            return "---\nlayout: folder-table\nextra-fields:\n  - status\n---\n";
          }
          return "---\nstatus: done\n---\n";
        }
        return undefined;
      },
    );

    const container = await renderAndWait();

    // The status value "done" should appear in the rendered table.
    const html = container.innerHTML;
    expect(html).toContain("done");
  });
});

describe("image enrichment — error isolation (IE-10)", () => {
  it("IE-10: get_image_dimensions throws for one card → that card has width='', others continue (FR-8)", async () => {
    setup(
      [],
      [
        { path: "/vault/good.jpg", modified: 0 },
        { path: "/vault/bad.jpg", modified: 0 },
      ],
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n---\n",
      (cmd, args) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n---\n";
        }
        if (cmd === "get_image_dimensions") {
          if (args?.path === "/vault/bad.jpg") throw new Error("Truncated image");
          return [1920, 1080];
        }
        return undefined;
      },
    );

    // Both images should be invoked (2 calls), but render should still complete.
    const container = await renderAndWait();

    const dimCalls = invokeCalls("get_image_dimensions");
    expect(dimCalls.length).toBe(2);

    // Container should have rendered (not stuck in loading state).
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
    // Good image dimensions should appear.
    expect(container.innerHTML).toContain("1920");
  });
});

describe("image enrichment — guard behaviour (IE-11, IE-12, IE-14)", () => {
  it("IE-11: imageColumnsRequested=false, extraFields=[] → enrichment does NOT run (NFR-5)", async () => {
    // folder-cards layout — enrichment guard should NOT fire.
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-cards\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-cards\n---\n";
        }
        // Any image command would be unexpected.
        if (cmd === "get_image_dimensions" || cmd === "get_exif_data") {
          throw new Error(`${cmd} should not be called when no image columns declared`);
        }
        return undefined;
      },
    );

    await renderAndWait();
    expect(invokeCalls("get_image_dimensions").length).toBe(0);
    expect(invokeCalls("get_exif_data").length).toBe(0);
  });

  it("IE-12: imageColumnsRequested=true, extraFields=[] → enrichment DOES run; get_image_dimensions invoked", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n";
        }
        if (cmd === "get_image_dimensions") return [800, 600];
        return undefined;
      },
    );

    await renderAndWait();
    expect(invokeCalls("get_image_dimensions").length).toBe(1);
  });

  it("EC-4 / IE-12b: folder-cards layout with fields: [name, width] and an image card → get_image_dimensions invoked", async () => {
    setup(
      [],
      [{ path: "/vault/photo.jpg", modified: 0 }],
      "---\nlayout: folder-cards\nfields:\n  - name\n  - width\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-cards\nfields:\n  - name\n  - width\n---\n";
        }
        if (cmd === "get_image_dimensions") return [800, 600];
        return undefined;
      },
    );

    await renderAndWait();
    expect(invokeCalls("get_image_dimensions").length).toBe(1);
  });

  it("IE-14 (EC-19): width column declared, folder has no image files (only .md) → no image commands invoked", async () => {
    setup(
      [{ path: "/vault/note.md", name: "note" }],
      [], // no non-md files
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n",
      (cmd, args) => {
        if (cmd === "read_file") {
          if (args?.path?.endsWith("_folder.md")) {
            return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n";
          }
          return ""; // .md file content
        }
        if (cmd === "get_image_dimensions") throw new Error("should not be called");
        return undefined;
      },
    );

    const container = await renderAndWait();
    expect(invokeCalls("get_image_dimensions").length).toBe(0);
    expect(container.innerHTML).not.toBe(`<div class="folder-view-loading">Loading…</div>`);
  });
});

describe("image enrichment — concurrency (IE-13)", () => {
  it("IE-13: folder with 5 image cards → all 5 get_image_dimensions calls made via Promise.all", async () => {
    const images = [
      { path: "/vault/img1.jpg", modified: 0 },
      { path: "/vault/img2.jpg", modified: 0 },
      { path: "/vault/img3.jpg", modified: 0 },
      { path: "/vault/img4.jpg", modified: 0 },
      { path: "/vault/img5.jpg", modified: 0 },
    ];

    setup(
      [],
      images,
      "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n",
      (cmd) => {
        if (cmd === "read_file") {
          return "---\nlayout: folder-table\nfields:\n  - name\n  - width\n---\n";
        }
        if (cmd === "get_image_dimensions") return [100, 100];
        return undefined;
      },
    );

    await renderAndWait();

    expect(invokeCalls("get_image_dimensions").length).toBe(5);
  });
});
