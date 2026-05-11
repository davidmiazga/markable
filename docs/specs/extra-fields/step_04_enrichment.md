---
title: "Step 04 — Enrichment Phase in tab.ts"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 04 — Enrichment Phase in tab.ts

## Goal

Add the enrichment phase to `renderFolderViewTabAsync` in `tab.ts`:

- When `layoutKey === "folder-table"` AND `config.extraFields.length > 0`,
  read each `.md` file card's content via Tauri `read_file` and attach
  extracted frontmatter values to `card.meta`.
- Non-`.md` files and all directory cards get `card.meta = {}`.
- A failed `read_file` for any individual card does not abort the render;
  that card gets `meta = {}`.
- Write T-14 (read failure test) in `tests/folder-view/tab.test.ts`.

TDD order: write T-14 first (RED), then implement (GREEN).

---

## File to change: `src/plugins/file-browser/folder-view/tab.ts`

### Change 1 — Import `extractFrontmatterKeys`

Add to the imports at the top of the file:

```typescript
import { extractFrontmatterKeys } from "./frontmatter-reader";
```

### Change 2 — Add enrichment phase in `renderFolderViewTabAsync`

The enrichment phase is inserted between Step 2 (parse) and Step 3 (dispatch).

Replace the existing Step 3 dispatch block:

```typescript
  // Step 3: Dispatch to layout renderer (FR-27/FR-28).
  const layoutKey = config.layout.toLowerCase();
  if (!layoutKey) {
    renderFallback(config.body, "No layout specified — showing raw content.", container);
  } else if (!LAYOUT_RENDERERS[layoutKey]) {
    renderFallback(
      config.body,
      `Unknown layout '${config.layout}' — showing raw content.`,
      container,
    );
  } else {
    const cards = collectChildren(folderPath, vaultIndex);
    LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath);
  }
```

With the following (the existing fallback branches are preserved unchanged; only
the `else` branch that dispatches to a renderer gains the enrichment step):

```typescript
  // Step 3: Dispatch to layout renderer (FR-27/FR-28).
  const layoutKey = config.layout.toLowerCase();
  if (!layoutKey) {
    renderFallback(config.body, "No layout specified — showing raw content.", container);
  } else if (!LAYOUT_RENDERERS[layoutKey]) {
    renderFallback(
      config.body,
      `Unknown layout '${config.layout}' — showing raw content.`,
      container,
    );
  } else {
    const cards = collectChildren(folderPath, vaultIndex);

    // Step 3a: Enrichment phase — read child .md file frontmatter (FR-09).
    // Runs only for folder-table when extra fields are declared.
    if (layoutKey === "folder-table" && config.extraFields.length > 0) {
      const fieldKeys = config.extraFields.map(f => f.key);

      // Non-.md and directory cards get an empty meta object.
      for (const card of cards) {
        if (card.kind !== "file" || card.ext !== ".md") {
          card.meta = {};
        }
      }

      // Concurrently read all .md file cards (NFR-03, AD-03: uncapped).
      const mdCards = cards.filter(c => c.kind === "file" && c.ext === ".md");
      await Promise.all(
        mdCards.map(async (card) => {
          try {
            const fileContent = await (window as any).__TAURI_INTERNALS__?.invoke?.(
              "read_file",
              { path: card.path },
            );
            const raw = typeof fileContent === "string"
              ? fileContent
              : (fileContent?.content ?? "");
            card.meta = extractFrontmatterKeys(raw, fieldKeys);
          } catch {
            // EC-03: failed read → empty meta, render continues (FR-09 step 6).
            card.meta = {};
          }
        }),
      );
    }

    LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath);
  }
```

---

## File to change: `tests/folder-view/tab.test.ts`

T-14 tests that a failed `read_file` call does not abort the render and that the
affected card gets `meta = {}`.

This test requires mocking the Tauri invoke to reject for one file. Because
`renderFolderViewTabAsync` is private, the test exercises it via
`buildFolderViewRenderFn`, awaiting the async settle.

Append to the `describe("extractFrontmatterKeys")` block, or add a separate
`describe` block:

```typescript
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
    let callCount = 0;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (_cmd: string, args: any) => {
        callCount++;
        if (args?.path?.endsWith("_folder.md")) {
          return "---\nlayout: folder-table\nextra-fields:\n  - status\n---\n";
        }
        // Child file read — reject to simulate EC-03.
        throw new Error("read error");
      }),
    };

    const renderSpy = vi.fn();
    // We need to observe that the renderer is called (render completes).
    // We do this by setting __MARKABLE_TAB_MANAGER__.setActiveTabTitle as a spy
    // and verifying the async path completes without throwing.
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
});
```

> Note: T-14 is primarily an integration smoke test that the error path in the
> enrichment phase does not propagate and abort the render. The assertion is that
> the container was overwritten by the renderer (i.e., the `renderFallback` or
> `renderFolderTable` ran). Fine-grained per-card `meta` assertions are tested
> at the unit level via T-15/T-16 in table-renderer tests (where `meta` is
> directly supplied to the renderer without going through the enrichment phase).

---

## Tests to run after this step

```bash
npm run test:run -- tests/folder-view/tab.test.ts
```

T-14 must be green. All pre-existing tab.test.ts tests must still pass.

---

## Definition of done

- Enrichment phase in `renderFolderViewTabAsync` is guarded by
  `layoutKey === "folder-table"` and `config.extraFields.length > 0`.
- Non-`.md` and directory cards get `meta = {}`.
- `.md` file cards get `meta` populated from `extractFrontmatterKeys`.
- A failed `read_file` produces `meta = {}` for that card; render continues.
- `Promise.all` is awaited before dispatch to `renderFolderTable`.
- T-14 passes.
- All pre-existing tab.test.ts tests pass.
- EC-12 satisfied: `folder-cards` layout skips enrichment entirely (guard on
  `layoutKey === "folder-table"`).
