/**
 * tests/folder-view/table-renderer-bulk.test.ts
 *
 * Integration tests for checkbox column wiring inside renderFolderTable.
 * Covers FR-1, FR-2, FR-7, NFR-5, NFR-6, NFR-7, EC-16, EC-20, EC-21.
 */

import { it, expect, vi, beforeEach } from "vitest";
import { renderFolderTable }
  from "../../src/plugins/file-browser/folder-view/table-renderer";
import { createSelectionState } from "../../src/plugins/file-browser/folder-view/bulk-selection";
import { buildToolbar, updateToolbar } from "../../src/plugins/file-browser/folder-view/bulk-toolbar";
import type { FolderViewConfig, FolderCard }
  from "../../src/plugins/file-browser/folder-view/types";
import type { BulkContext }
  from "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
  return {
    layout: "folder-table",
    title: "Test Folder",
    sort: "name-asc",
    cardWidth: 160,
    layoutMode: "grid",
    showModified: false,
    body: "",
    aspectRatio: "1/1",
    fit: "cover",
    minHeight: 40,
    maxHeight: 200,
    showName: true,
    showPreview: true,
    showExtensions: false,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],
    fields: null,
    previewPane:   false,
    previewHeight: "60%",
    ...overrides,
  };
}

function makeDirCard(name: string, path = `/vault/${name}`): FolderCard {
  return { path, name, kind: "directory", ext: "", modified: 0 };
}

function makeFileCard(name: string, ext = ".md", path?: string): FolderCard {
  const fullPath = path ?? `/vault/${name}${ext === ".md" ? "" : ext}`;
  return { path: fullPath, name, kind: "file", ext, modified: 0 };
}

function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "custom-tab-host";
  return div;
}

// ── IntersectionObserver stub for lazy-loading tests ─────────────────────────

class MockIntersectionObserver {
  private _cb: Function;
  constructor(cb: Function) { this._cb = cb; }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  triggerIntersect() {
    this._cb([{ isIntersecting: true }]);
  }
}

// ── BulkContext factory ───────────────────────────────────────────────────────

function makeBulkContext(): BulkContext {
  const selectionState = createSelectionState();
  const toolbarRefs = buildToolbar(
    selectionState,
    async () => {},
    async () => {},
    async () => {},
  );
  return {
    selectionState,
    toolbarRefs,
    syncToolbar: () => updateToolbar(toolbarRefs, selectionState),
    onMove:   async () => {},
    onDelete: async () => {},
    onYaml:   async () => {},
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn(),
    openMediaInTab: vi.fn(),
    refreshLayoutView: vi.fn(),
  };
  (window as any).__MARKABLE_FILE_BROWSER__ = {
    expandDirectory: vi.fn(),
  };
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

// ── I-01: checkbox <th> is first column in both section theads ────────────────

it("I-01: checkbox <th> is first column in both section theads (FR-1)", () => {
  const container = makeContainer();
  const cards = [makeDirCard("docs"), makeFileCard("note")];
  renderFolderTable(makeConfig(), cards, container, "/vault", makeBulkContext());

  const theads = container.querySelectorAll("thead");
  for (const thead of theads) {
    const firstTh = thead.querySelector("tr th:first-child");
    expect(firstTh?.classList.contains("fv-th-checkbox")).toBe(true);
  }
});

// ── I-02: each data row has a checkbox <td> as first child ────────────────────

it("I-02: each data row has a checkbox <td> as first child (FR-1)", () => {
  const container = makeContainer();
  const cards = [makeDirCard("docs"), makeFileCard("note")];
  renderFolderTable(makeConfig(), cards, container, "/vault", makeBulkContext());

  const rows = container.querySelectorAll("tbody tr.fv-row");
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const firstTd = row.querySelector("td:first-child");
    expect(firstTd?.classList.contains("fv-td-checkbox")).toBe(true);
  }
});

// ── I-03: toolbar exists as first child of .folder-view-host ─────────────────

it("I-03: toolbar element exists in DOM as first child of .folder-view-host (FR-3)", () => {
  const container = makeContainer();
  const cards = [makeFileCard("note")];
  renderFolderTable(makeConfig(), cards, container, "/vault", makeBulkContext());

  const host = container.querySelector(".folder-view-host")!;
  const firstChild = host.firstElementChild;
  expect(firstChild?.classList.contains("fv-bulk-toolbar")).toBe(true);
});

// ── I-04: toolbar hidden on initial render ────────────────────────────────────

it("I-04: toolbar has no --visible class on initial render (FR-3)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig(), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const toolbar = container.querySelector(".fv-bulk-toolbar");
  expect(toolbar?.classList.contains("fv-bulk-toolbar--visible")).toBe(false);
});

// ── I-05: checking a file row checkbox makes toolbar visible ──────────────────

it("I-05: checking a file row checkbox makes toolbar visible (FR-2, FR-3)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig(), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const checkbox = container.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));

  const toolbar = container.querySelector(".fv-bulk-toolbar");
  expect(toolbar?.classList.contains("fv-bulk-toolbar--visible")).toBe(true);
});

// ── I-06: count label shows "1 selected" after one check ─────────────────────

it("I-06: count label shows '1 selected' after one check (FR-2)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig(), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const checkbox = container.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));

  const countLabel = container.querySelector(".fv-bulk-toolbar__count");
  expect(countLabel?.textContent).toBe("1 selected");
});

// ── I-07: checking all rows in files section → master checked ─────────────────

it("I-07: checking all rows in files section makes master checked (not indeterminate) (FR-1)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ showFolders: false }),
    [makeFileCard("note1"), makeFileCard("note2")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>(".fv-td-checkbox input"));
  for (const cb of checkboxes) {
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
  }

  const masterCb = container.querySelector<HTMLInputElement>(".fv-th-checkbox input")!;
  expect(masterCb.checked).toBe(true);
  expect(masterCb.indeterminate).toBe(false);
});

// ── I-08: checking some rows → master indeterminate ───────────────────────────

it("I-08: checking some rows makes master checkbox indeterminate (FR-1)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ showFolders: false }),
    [makeFileCard("note1"), makeFileCard("note2")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>(".fv-td-checkbox input"));
  // Only check the first one.
  checkboxes[0].checked = true;
  checkboxes[0].dispatchEvent(new Event("change"));

  const masterCb = container.querySelector<HTMLInputElement>(".fv-th-checkbox input")!;
  expect(masterCb.indeterminate).toBe(true);
});

// ── I-09: clicking checkbox cell does NOT call openFileInTab ──────────────────

it("I-09: clicking checkbox cell does NOT call openFileInTab (FR-1)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const checkboxTd = container.querySelector<HTMLElement>(".fv-td-checkbox")!;
  checkboxTd.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const openFileInTab = (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab;
  expect(openFileInTab).not.toHaveBeenCalled();
});

// ── I-10: clicking row body DOES call openFileInTab ───────────────────────────

it("I-10: clicking row body calls openFileInTab (FR-1)", () => {
  const container = makeContainer();
  // Path must include .md extension so handleRowClick's endsWith(".md") check passes.
  renderFolderTable(
    makeConfig({ showFolders: false }),
    [makeFileCard("note", ".md", "/vault/note.md")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const row = container.querySelector<HTMLElement>("tbody tr.fv-row")!;
  row.dispatchEvent(new MouseEvent("click", { bubbles: false }));

  const openFileInTab = (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab;
  expect(openFileInTab).toHaveBeenCalled();
});

// ── I-11: sort click clears selection and hides toolbar ───────────────────────

it("I-11: sort click (name header) clears selection and hides toolbar (FR-7, EC-16)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", makeBulkContext());

  // Select the row.
  const checkbox = container.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  expect(container.querySelector(".fv-bulk-toolbar--visible")).not.toBeNull();

  // Click the Name header to sort.
  const nameTh = container.querySelector<HTMLElement>(".fv-th-name")!;
  nameTh.click();

  // Toolbar must be hidden and selection cleared.
  expect(container.querySelector(".fv-bulk-toolbar--visible")).toBeNull();
});

// ── I-12: both sections: checkboxes accumulate in shared toolbar count ─────────

it("I-12: both sections checked items accumulate in shared toolbar count (EC-21)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ foldersTitle: "Folders" }),
    [makeDirCard("docs"), makeFileCard("note")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>(".fv-td-checkbox input"));
  for (const cb of checkboxes) {
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
  }

  const countLabel = container.querySelector(".fv-bulk-toolbar__count");
  // 1 dir + 1 file = 2 selected.
  expect(countLabel?.textContent).toBe("2 selected");
});

// ── I-13: master checkbox aria-label for Folders section ─────────────────────

it("I-13: master checkbox for Folders section has aria-label='Select all Folders' (FR-8)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ foldersTitle: "Folders", showFiles: false }),
    [makeDirCard("docs")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const masterCb = container.querySelector<HTMLInputElement>(".fv-th-checkbox input")!;
  expect(masterCb.getAttribute("aria-label")).toBe("Select all Folders");
});

// ── I-14: row checkboxes have aria-label="Select <name>" ─────────────────────

it("I-14: row checkboxes have aria-label='Select <name>' (FR-8)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ showFolders: false }),
    [makeFileCard("my-note")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const rowCb = container.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  expect(rowCb.getAttribute("aria-label")).toBe("Select my-note");
});

// ── I-15: toolbar root has role=toolbar and aria-label=Bulk actions ───────────

it("I-15: toolbar root has role=toolbar and aria-label=Bulk actions (FR-8)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig(), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const toolbar = container.querySelector(".fv-bulk-toolbar")!;
  expect(toolbar.getAttribute("role")).toBe("toolbar");
  expect(toolbar.getAttribute("aria-label")).toBe("Bulk actions");
});

// ── I-16: fields mode — checkbox is leftmost column ──────────────────────────

it("I-16: fields mode: checkbox column still appears as leftmost column (NFR-5)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ fields: ["name", "modified"], showFolders: false }),
    [makeFileCard("note")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const firstTh = container.querySelector("thead tr th:first-child");
  expect(firstTh?.classList.contains("fv-th-checkbox")).toBe(true);

  const firstTd = container.querySelector("tbody tr.fv-row td:first-child");
  expect(firstTd?.classList.contains("fv-td-checkbox")).toBe(true);
});

// ── I-17: legacy mode — checkbox is leftmost column ──────────────────────────

it("I-17: legacy mode: checkbox column still appears as leftmost column (NFR-5)", () => {
  const container = makeContainer();
  renderFolderTable(
    makeConfig({ fields: null, showFolders: false }),
    [makeFileCard("note")],
    container,
    "/vault",
    makeBulkContext(),
  );

  const firstTh = container.querySelector("thead tr th:first-child");
  expect(firstTh?.classList.contains("fv-th-checkbox")).toBe(true);
});

// ── I-18: fv-row--selected class applied when checkbox checked ────────────────

it("I-18: checking row checkbox applies fv-row--selected class (FR-9)", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", makeBulkContext());

  const row = container.querySelector<HTMLElement>("tbody tr.fv-row")!;
  const cb = row.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  cb.checked = true;
  cb.dispatchEvent(new Event("change"));

  expect(row.classList.contains("fv-row--selected")).toBe(true);
});

// ── I-19: lazily-rendered rows work correctly (EC-20) ─────────────────────────

it("I-19: lazily-rendered rows work correctly after IntersectionObserver fires (EC-20)", () => {
  const container = makeContainer();
  // Create 60 file cards to trigger lazy loading (threshold is 50).
  const cards = Array.from({ length: 60 }, (_, i) => makeFileCard(`note${i}`));
  let observer!: MockIntersectionObserver;

  // Capture the observer instance created during render.
  const OrigMock = MockIntersectionObserver;
  vi.stubGlobal("IntersectionObserver", class extends OrigMock {
    constructor(cb: Function) {
      super(cb);
      observer = this;
    }
  });

  renderFolderTable(makeConfig({ showFolders: false }), cards, container, "/vault", makeBulkContext());

  // Before the sentinel fires, only 50 rows should be visible.
  const rowsBefore = container.querySelectorAll("tbody tr.fv-row");
  expect(rowsBefore.length).toBe(50);

  // Trigger the IntersectionObserver to render the next batch.
  observer.triggerIntersect();

  const rowsAfter = container.querySelectorAll("tbody tr.fv-row");
  expect(rowsAfter.length).toBe(60);

  // The newly-rendered rows should also have checkbox cells.
  for (const row of rowsAfter) {
    const firstTd = row.querySelector("td:first-child");
    expect(firstTd?.classList.contains("fv-td-checkbox")).toBe(true);
  }
});

// ── I-20: BulkContext passed from outside — renderer uses shared SelectionState ─

it("I-20: renderFolderTable with external BulkContext uses the shared SelectionState (EC-12)", () => {
  // Build a BulkContext externally, simulating what tab.ts will do after Step 01.
  const selectionState = createSelectionState();
  const toolbarRefs = buildToolbar(
    selectionState,
    async () => {},
    async () => {},
    async () => {},
  );
  const syncToolbar = () => updateToolbar(toolbarRefs, selectionState);

  const bulkContext: BulkContext = {
    selectionState,
    toolbarRefs,
    syncToolbar,
    onMove:   async () => {},
    onDelete: async () => {},
    onYaml:   async () => {},
  };

  const container = makeContainer();
  const card = makeFileCard("note", ".md", "/vault/note.md");
  renderFolderTable(makeConfig({ showFolders: false }), [card], container, "/vault", bulkContext);

  // Check a row checkbox — the path must be added to the *external* selectionState,
  // not to a renderer-internal one. This is the key behavioral guarantee of Step 01.
  const checkbox = container.querySelector<HTMLInputElement>(".fv-td-checkbox input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));

  // The external selectionState.paths must contain the card's path.
  expect(selectionState.paths.has("/vault/note.md")).toBe(true);
});

// ── I-21: no-context → no toolbar, no checkboxes ─────────────────────────────

it("I-21: renderFolderTable without BulkContext renders no toolbar and no checkboxes", () => {
  const container = makeContainer();
  renderFolderTable(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault");

  // No toolbar, no checkbox column — "select" was not in fields.
  expect(container.querySelector(".fv-bulk-toolbar")).toBeNull();
  expect(container.querySelector(".fv-th-checkbox")).toBeNull();
  expect(container.querySelector(".fv-td-checkbox")).toBeNull();
});
