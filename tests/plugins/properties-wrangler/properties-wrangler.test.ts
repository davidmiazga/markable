import { describe, it, expect, afterEach, vi } from "vitest";
import PropertiesWrangler, {
  applyWranglerScanForTest,
  buildScanModel,
  buildVocabTree,
  nestValue,
  reparentPath,
  renderWranglerPanel,
  resetWranglerForTest,
  rewriteNestedList,
} from "../../../src/plugins/properties-wrangler/properties-wrangler.plugin";

function makeMockApi() {
  const registeredPanels: any[] = [];
  return {
    registerSidebarPanel: vi.fn((panel: any) => registeredPanels.push(panel)),
    unregisterSidebarPanel: vi.fn(),
    addExtensions: vi.fn(),
    removeExtensions: vi.fn(),
    _registeredPanels: registeredPanels,
  };
}

function openSheet(host: HTMLElement): HTMLElement {
  const btn = host.querySelector(".pw-manage") as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  expect(btn!.textContent).toBe("Manage");
  btn!.click();
  const overlay = document.getElementById("__properties-wrangler-overlay__");
  expect(overlay).not.toBeNull();
  return overlay!;
}

describe("buildScanModel", () => {
  it("splits tags and field:value categories", () => {
    const model = buildScanModel(
      [
        { tag: "recipe", count: 3 },
        { tag: "status:draft", count: 2 },
        { tag: "status:complete", count: 1 },
      ],
      "/vault",
    );
    expect(model.rootLabel).toBe("/vault");
    expect(model.tags).toEqual([{ value: "recipe", count: 3 }]);
    expect(model.fields.status.map((i) => i.value)).toEqual(["draft", "complete"]);
  });

  it("lists a Tags field as tags, splitting comma-separated values", () => {
    const model = buildScanModel(
      [
        { tag: "Tags:Great", count: 1 },
        { tag: "Tags:Nice,", count: 1 },
        { tag: "Tags:Superduper", count: 1 },
        { tag: "Tags:Great, Nice, Super", count: 1 },
        { tag: "Category:Awesome", count: 1 },
        { tag: "Category:VeryAwesome", count: 1 },
      ],
      "/vault",
    );
    expect(model.tags.map((item) => item.value).sort()).toEqual([
      "Great",
      "Nice",
      "Super",
      "Superduper",
    ]);
    expect(model.fields.tags).toBeUndefined();
    expect(model.fields.category.map((item) => item.value).sort()).toEqual([
      "Awesome",
      "VeryAwesome",
    ]);
  });
});

describe("vocab tree", () => {
  it("nests slash paths under a caret parent", () => {
    const tree = buildVocabTree(["work", "work/project", "food"]);
    expect(tree.map((n) => n.label)).toEqual(["food", "work"]);
    const work = tree.find((n) => n.path === "work");
    expect(work?.children.map((c) => c.path)).toEqual(["work/project"]);
  });

  it("reparents onto a target and rejects a drop on a descendant", () => {
    expect(reparentPath("recipe", "food")).toBe("food/recipe");
    expect(reparentPath("work", "work/project")).toBeNull();
    expect(rewriteNestedList(["work", "work/project"], "work", "life")).toEqual([
      "life",
      "life/project",
    ]);
  });
});

describe("Properties Wrangler lifecycle", () => {
  afterEach(() => {
    resetWranglerForTest();
    vi.unstubAllGlobals();
    document.getElementById("__markable_properties_wrangler_css__")?.remove();
  });

  it("sidebar never shows vault-prompt copy", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    expect(div.textContent).not.toMatch(/Open a vault/);
  });

  it("does not register a sidebar panel", () => {
    const api = makeMockApi();
    PropertiesWrangler.onEnable(api as any);
    expect(api.registerSidebarPanel).not.toHaveBeenCalled();
    expect("sidebarPanelId" in PropertiesWrangler).toBe(false);
    expect(PropertiesWrangler.detail).toMatch(/File Properties/);
    PropertiesWrangler.onDisable(api as any);
    expect(api.unregisterSidebarPanel).not.toHaveBeenCalled();
  });

  it("sidebar shows a Manage link, a caret tree, and no offer-list copy", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "work", count: 1 },
          { tag: "work/project", count: 2 },
        ],
        "/vault",
      ),
    );
    expect(div.querySelector(".pw-manage")?.textContent).toBe("Manage");
    expect(div.querySelector(".pw-manage-btn")).toBeNull();
    expect(div.textContent).not.toMatch(/Open a vault/);
    expect(div.textContent).not.toMatch(/offer list/i);
    expect(div.textContent).not.toMatch(/Add to offer list/);
    expect(div.querySelector(".pw-add-inline")).toBeNull();
    const names = Array.from(div.querySelectorAll(".pw-name")).map((el) => el.textContent);
    expect(names).toContain("work");
    expect(names).toContain("project");
    const carets = Array.from(div.querySelectorAll(".pw-caret")).filter(
      (el) => !el.classList.contains("is-empty"),
    );
    expect(carets.length).toBeGreaterThan(0);
    expect(div.querySelector(".pw-row")).not.toBeNull();
  });

  it("nests a tag under another as a parent/child path", async () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "food", count: 1 },
          { tag: "recipe", count: 2 },
        ],
        "/vault",
      ),
    );
    await nestValue("tags", "recipe", "food");
    const kids = div.querySelector(".pw-kids .pw-name");
    expect(div.querySelector(".pw-name")?.textContent).toBe("food");
    expect(kids?.textContent).toBe("recipe");
  });

  it("nests a category value under another in the same field", async () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "status:draft", count: 1 },
          { tag: "status:review", count: 1 },
        ],
        "/vault",
      ),
    );
    await nestValue("status", "review", "draft");
    expect(div.querySelector(".pw-kids .pw-name")?.textContent).toBe("review");
  });
});

describe("Manage sheet", () => {
  afterEach(() => {
    resetWranglerForTest();
    vi.unstubAllGlobals();
  });

  it("opens the vocabulary list with Category before Tags and no scan step", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel([{ tag: "recipe", count: 2 }, { tag: "status:draft", count: 1 }], "/vault"),
    );
    const sheet = openSheet(div);
    expect(sheet.querySelector(".pw-scan-btn")).toBeNull();
    expect(sheet.querySelector(".pw-setup")).toBeNull();
    expect(sheet.querySelector(".pw-pane-title")?.textContent).toBe("Tags and categories");
    expect(sheet.querySelector(".pw-results-bar .pw-search")).not.toBeNull();
    expect(sheet.querySelector('[aria-label="Add tags"]')?.textContent).toBe("+");
    expect(sheet.textContent).not.toMatch(/offer list/i);
    expect(sheet.textContent).not.toMatch(/Add to offer list/);
    const headings = Array.from(sheet.querySelectorAll(".pw-section")).map((el) => el.textContent);
    expect(headings[0]).toBe("Category");
    expect(headings.filter((h) => h === "Category")).toHaveLength(1);
    expect(headings.indexOf("Status")).toBeLessThan(headings.indexOf("Tags"));
    expect(headings.filter((h) => h === "Tags")).toHaveLength(1);
  });

  it("does not repeat Category when the field is also named category", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel([{ tag: "category:Awesomeness", count: 1 }], "/vault"),
    );
    const sheet = openSheet(div);
    const headings = Array.from(sheet.querySelectorAll(".pw-section")).map((el) => el.textContent);
    expect(headings.filter((h) => h === "Category")).toHaveLength(1);
    const names = Array.from(sheet.querySelectorAll(".pw-name")).map((el) => el.textContent);
    expect(names).toContain("Awesomeness");
  });

  it("lists Tags field values in the Tags section", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "Tags:Great", count: 1 },
          { tag: "Tags:Nice,", count: 1 },
          { tag: "Tags:Superduper", count: 1 },
          { tag: "Tags:Great, Nice, Super", count: 1 },
          { tag: "Category:VeryAwesome", count: 1 },
        ],
        "/vault",
      ),
    );
    const sheet = openSheet(div);
    const names = Array.from(sheet.querySelectorAll(".pw-name")).map((el) => el.textContent);
    expect(names).toEqual(expect.arrayContaining(["Great", "Nice", "Super", "Superduper", "VeryAwesome"]));
    const tagNames = Array.from(sheet.querySelectorAll('[data-section="tags"] .pw-name')).map(
      (el) => el.textContent,
    );
    expect(tagNames).toEqual(expect.arrayContaining(["Great", "Nice", "Super", "Superduper"]));
    expect(tagNames).not.toContain("VeryAwesome");
  });

  it("filters the tree from the search field", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel([{ tag: "recipe", count: 2 }, { tag: "home", count: 1 }], "/vault"),
    );
    const sheet = openSheet(div);
    const search = sheet.querySelector(".pw-search") as HTMLInputElement;
    search.value = "rec";
    search.dispatchEvent(new Event("input"));
    const names = Array.from(sheet.querySelectorAll(".pw-name")).map((el) => el.textContent);
    expect(names).toContain("recipe");
    expect(names).not.toContain("home");
  });

  it("highlights near-duplicates in red with is-dup and unique names are not is-dup", () => {
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "recipe", count: 3 },
          { tag: "Recipe", count: 1 },
          { tag: "home", count: 1 },
        ],
        "/vault",
      ),
    );
    const dups = Array.from(div.querySelectorAll(".pw-row.is-dup .pw-name")).map(
      (el) => el.textContent,
    );
    expect(dups).toEqual(expect.arrayContaining(["recipe", "Recipe"]));
    expect(dups).not.toContain("home");

    const nonDups = Array.from(div.querySelectorAll(".pw-row:not(.is-dup) .pw-name")).map(
      (el) => el.textContent,
    );
    expect(nonDups).toContain("home");
  });

  it("recycle opens a searchable merge list and Apply Merge uses the picked definition", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "merge_vault_property") {
        return Promise.resolve({ filesChanged: 3, replacements: 4 });
      }
      if (cmd === "scan_vault_tags") return Promise.resolve([]);
      return Promise.resolve();
    });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });

    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "recipe", count: 3 },
          { tag: "Recipe", count: 1 },
        ],
        "/vault",
      ),
    );

    const recycle = div.querySelector('[aria-label="Consolidate recipe"]') as HTMLButtonElement;
    expect(recycle).not.toBeNull();
    const icon = recycle.querySelector("svg");
    expect(icon?.getAttribute("viewBox")).toBe("0 -960 960 960");
    expect(icon?.querySelector("path")?.getAttribute("d")).toContain("M280-80");
    expect(div.querySelector(".pw-edit")).toBeNull();
    recycle.click();

    const dialog = document.getElementById("__properties-wrangler-merge__");
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector("h3")?.textContent).toBe('Merge into "recipe"');
    expect(dialog!.querySelector(".pw-merge-warning")).not.toBeNull();
    const confirmCb = dialog!.querySelector(".pw-merge-confirm-cb") as HTMLInputElement;
    expect(confirmCb.checked).toBe(false);

    const chip = dialog!.querySelector(".pw-merge-chip") as HTMLButtonElement;
    expect(chip?.dataset.value).toBe("Recipe");
    const applyBtn = dialog!.querySelector(".pw-merge-apply") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    const search = dialog!.querySelector(".pw-merge-search") as HTMLInputElement;
    search.value = "nope";
    search.dispatchEvent(new Event("input"));
    expect(dialog!.querySelector(".pw-merge-empty")?.textContent).toMatch(/No matches/);
    search.value = "";
    search.dispatchEvent(new Event("input"));

    confirmCb.checked = true;
    confirmCb.dispatchEvent(new Event("change"));
    expect(applyBtn.disabled).toBe(false);

    applyBtn.click();

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "merge_vault_property",
        expect.objectContaining({
          section: "tags",
          fromValues: ["Recipe"],
          to: "recipe",
        }),
      );
    });

    await vi.waitFor(() => {
      expect(dialog!.querySelector(".pw-merge-status")?.textContent).toMatch(/Merged 1 definition/);
    });
  });

  it("Apply Merge is an error when no note file changes, and it does not rewrite the properties file", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "merge_vault_property") {
        return Promise.resolve({ filesChanged: 0, replacements: 0, changedPaths: [] });
      }
      return Promise.resolve();
    });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });

    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "Category:Awesome", count: 1 },
          { tag: "Category:VeryAwesome", count: 1 },
        ],
        "/vault",
      ),
    );
    (div.querySelector('[aria-label="Consolidate VeryAwesome"]') as HTMLButtonElement).click();
    const dialog = document.getElementById("__properties-wrangler-merge__")!;
    const option = Array.from(dialog.querySelectorAll(".pw-merge-option")).find(
      (el) => el.textContent === "Awesome",
    ) as HTMLButtonElement;
    option.click();
    const confirmCb = dialog.querySelector(".pw-merge-confirm-cb") as HTMLInputElement;
    confirmCb.checked = true;
    confirmCb.dispatchEvent(new Event("change"));
    (dialog.querySelector(".pw-merge-apply") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const status = dialog.querySelector(".pw-merge-status");
      expect(status?.textContent).toMatch(/did not change any notes/);
      expect(status?.classList.contains("is-error")).toBe(true);
    });
    expect(invoke).not.toHaveBeenCalledWith("write_file", expect.anything());
  });

  it("Apply Merge loads the written YAML into the open note", async () => {
    const written = "---\nCategory: VeryAwesome\nTags: \n  - Great\n---\n";
    const applyExternalFileContent = vi.fn();
    const invoke = vi.fn().mockImplementation((cmd: string, args?: { path?: string }) => {
      if (cmd === "merge_vault_property") {
        return Promise.resolve({
          filesChanged: 1,
          replacements: 1,
          changedPaths: ["/vault/Test01.md"],
        });
      }
      if (cmd === "read_file" && args?.path === "/vault/Test01.md") return Promise.resolve(written);
      if (cmd === "scan_vault_tags") return Promise.resolve([]);
      return Promise.resolve("");
    });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    vi.stubGlobal("__MARKABLE_TAB_MANAGER__", { applyExternalFileContent });

    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "Category:Awesome", count: 1 },
          { tag: "Category:VeryAwesome", count: 1 },
        ],
        "/vault",
      ),
    );
    (div.querySelector('[aria-label="Consolidate VeryAwesome"]') as HTMLButtonElement).click();
    const dialog = document.getElementById("__properties-wrangler-merge__")!;
    (Array.from(dialog.querySelectorAll(".pw-merge-option")).find(
      (el) => el.textContent === "Awesome",
    ) as HTMLButtonElement).click();
    const confirmCb = dialog.querySelector(".pw-merge-confirm-cb") as HTMLInputElement;
    confirmCb.checked = true;
    confirmCb.dispatchEvent(new Event("change"));
    (dialog.querySelector(".pw-merge-apply") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(applyExternalFileContent).toHaveBeenCalledWith("/vault/Test01.md", written);
    });
    expect(dialog.querySelector(".pw-merge-status")?.textContent).toMatch(/Merged 1 definition/);
  });

  it("right-click offers include and exclude search", () => {
    const search = vi.fn();
    vi.stubGlobal("__MARKABLE_TAG_SEARCH__", search);
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn().mockResolvedValue([]),
    });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "recipe", count: 1 },
          { tag: "Category:draft", count: 1 },
        ],
        "/vault",
      ),
    );

    const tagRow = div.querySelector('.pw-row[data-section="tags"]') as HTMLElement;
    tagRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const include = document.querySelector(".pw-search-include") as HTMLButtonElement;
    const exclude = document.querySelector(".pw-search-exclude") as HTMLButtonElement;
    expect(include.textContent).toBe("Search notes with this");
    expect(exclude.textContent).toBe("Exclude this from search");
    expect(document.getElementById("__properties-wrangler-rename__")).toBeNull();
    include.click();
    expect(search).toHaveBeenCalledWith("tag:#recipe", "include");

    const category = div.querySelector('.pw-row[data-section="category"]') as HTMLElement;
    category.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    (document.querySelector(".pw-search-exclude") as HTMLButtonElement).click();
    expect(search).toHaveBeenCalledWith("-category:#draft", "exclude");
    document.querySelector(".pw-pop")?.remove();
  });

  it("Open tag page creates Tags/recipe.md once, then reopens it", async () => {
    const openFileInTab = vi.fn();
    const invoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "find_tag_page") return Promise.resolve(null);
      return Promise.resolve();
    });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_TAB_MANAGER__", { openFileInTab });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(buildScanModel([{ tag: "recipe", count: 1 }], "/vault"));
    const row = div.querySelector('.pw-row[data-section="tags"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    (document.querySelector(".pw-tag-page") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(openFileInTab).toHaveBeenCalledWith("/vault/Tags/recipe.md");
    });
    expect(invoke).toHaveBeenCalledWith("create_directory", { path: "/vault/Tags" });
    expect(invoke).toHaveBeenCalledWith(
      "write_file",
      expect.objectContaining({
        path: "/vault/Tags/recipe.md",
        content: "---\naliases:\n  - recipe\n---\n",
      }),
    );

    invoke.mockImplementation((cmd: string) => {
      if (cmd === "find_tag_page") return Promise.resolve("/vault/Notes/already.md");
      return Promise.resolve();
    });
    invoke.mockClear();
    openFileInTab.mockClear();
    applyWranglerScanForTest(buildScanModel([{ tag: "recipe", count: 1 }], "/vault"));
    (div.querySelector('.pw-row[data-section="tags"]') as HTMLElement).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    (document.querySelector(".pw-tag-page") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(openFileInTab).toHaveBeenCalledWith("/vault/Notes/already.md");
    });
    expect(invoke).not.toHaveBeenCalledWith("write_file", expect.anything());
    document.querySelector(".pw-pop")?.remove();
  });

  it("an unsafe tag name does not write a tag page", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(buildScanModel([{ tag: "work/project", count: 1 }], "/vault"));
    const row = div.querySelector('.pw-row[data-path="work/project"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    (document.querySelector(".pw-tag-page") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector(".pw-tag-page-error")?.textContent).toMatch(/not a safe file name/);
    });
    expect(invoke).not.toHaveBeenCalledWith("write_file", expect.anything());
    document.querySelector(".pw-pop")?.remove();
  });

  it("shift-click collapses and expands every tag at the same depth", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue([]) });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel(
        [
          { tag: "alpha/one", count: 1 },
          { tag: "beta/two", count: 1 },
        ],
        "/vault",
      ),
    );
    const caret = (path: string): HTMLButtonElement =>
      div.querySelector(`.pw-row[data-path="${path}"] .pw-caret`) as HTMLButtonElement;
    const visible = (path: string): boolean =>
      div.querySelector(`.pw-row[data-path="${path}"]`) !== null;

    caret("alpha").click();
    expect(visible("alpha/one")).toBe(false);
    expect(visible("beta/two")).toBe(true);

    caret("alpha").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(visible("alpha/one")).toBe(false);
    expect(visible("beta/two")).toBe(false);

    caret("alpha").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(visible("alpha/one")).toBe(true);
    expect(visible("beta/two")).toBe(true);
  });

  it("double-click opens Cancel/Apply rename", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "rename_vault_property") {
        return Promise.resolve({ filesChanged: 2, replacements: 3 });
      }
      if (cmd === "scan_vault_tags") return Promise.resolve([]);
      return Promise.resolve();
    });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    vi.stubGlobal("__MARKABLE_VAULT_MANAGER__", {
      getActiveVault: () => ({
        id: "v1",
        name: "Demo",
        rootPaths: ["/vault"],
        excludePatterns: [],
      }),
    });
    const div = document.createElement("div");
    renderWranglerPanel(div);
    applyWranglerScanForTest(
      buildScanModel([{ tag: "food", count: 2 }], "/vault"),
    );
    const name = div.querySelector(".pw-name") as HTMLElement;
    expect(div.querySelector(".pw-edit")).toBeNull();
    name.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const dialog = document.getElementById("__properties-wrangler-rename__");
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector("h3")?.textContent).toBe("Rename");
    const input = dialog!.querySelector("input") as HTMLInputElement;
    const buttons = Array.from(dialog!.querySelectorAll(".pw-rename-actions button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Apply"]);
    input.value = "food#bad";
    (buttons[1] as HTMLButtonElement).click();
    expect(dialog!.querySelector(".pw-rename-status")?.textContent).toMatch(/Invalid name/);
    input.value = "meals";
    (buttons[1] as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "rename_vault_property",
        expect.objectContaining({ from: "food", to: "meals", section: "tags" }),
      );
    });
    await vi.waitFor(() => {
      expect(dialog!.querySelector(".pw-rename-status")?.textContent).toMatch(/Updated 2 files/);
    });
  });
});
