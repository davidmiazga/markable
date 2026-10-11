import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCardContent, defaultBoardContent } from "../../../src/plugins/kanban/board-model";

const files = vi.hoisted(() => new Map<string, string>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { path?: string; content?: string; oldPath?: string; newPath?: string }) => {
    const path = args?.path ?? "";
    if (cmd === "list_md_files") {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const names = [...files.keys()]
        .filter((item) => item.startsWith(prefix))
        .map((item) => item.slice(prefix.length))
        .filter((name) => name !== "" && !name.includes("/"));
      return Promise.resolve(names);
    }
    if (cmd === "read_file") {
      const content = files.get(path);
      return content === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(content);
    }
    if (cmd === "write_file") {
      files.set(path, args?.content ?? "");
      return Promise.resolve();
    }
    if (cmd === "rename_file") {
      const from = args?.oldPath ?? "";
      const to = args?.newPath ?? "";
      const content = files.get(from);
      if (content === undefined || files.has(to)) return Promise.reject(new Error("rename failed"));
      files.set(to, content);
      files.delete(from);
      return Promise.resolve();
    }
    if (cmd === "ensure_directory") return Promise.resolve();
    return Promise.resolve(null);
  },
}));

import plugin from "../../../src/plugins/kanban/kanban.plugin";

function host(): HTMLElement {
  const node = document.createElement("div");
  node.id = "custom-tab-host";
  document.body.appendChild(node);
  return node;
}

function api(settings: Record<string, unknown> | null) {
  const registerSidebarPanel = vi.fn();
  const focusSidebarPanel = vi.fn();
  return {
    registerSidebarPanel,
    focusSidebarPanel,
    loadSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async () => undefined),
    openCustomRenderTab: (_title: string, renderFn: (container: HTMLElement) => void) => {
      const node = document.getElementById("custom-tab-host");
      if (!node) return;
      node.innerHTML = "";
      renderFn(node);
    },
  };
}

describe("project board in the editor", () => {
  beforeEach(() => {
    files.clear();
    document.body.innerHTML = "";
    plugin.onDisable();
  });

  it("asks for a folder in the editor when none is open", async () => {
    host();
    const surface = api(null);
    await plugin.onEnable(surface as never);
    const node = document.getElementById("custom-tab-host");
    expect(node?.textContent).toContain("Choose a folder");
    expect(node?.textContent).not.toContain("Repair");
    expect(node?.textContent).not.toContain("Create project");
    expect(surface.registerSidebarPanel).not.toHaveBeenCalled();
    expect(surface.focusSidebarPanel).not.toHaveBeenCalled();
  });

  it("opens lanes in the editor for a saved folder", async () => {
    files.set("/proj/board.md", defaultBoardContent("Launch"));
    files.set("/proj/test01.md", `${buildCardContent({
      title: "Test01",
      status: "To Do",
      assignee: "GM",
      tags: ["PM"],
    })}- [x] one\n- [ ] two\n`);
    host();
    const surface = api({ folder: "/proj", folders: ["/proj"], parent: "" });
    await plugin.onEnable(surface as never);

    const node = document.getElementById("custom-tab-host");
    expect(node?.querySelector("input[type=search]")?.getAttribute("placeholder")).toContain("Search cards");
    for (const label of ["Overdue", "Due soon", "Blocked", "Unread"]) {
      expect(node?.textContent).toContain(label);
    }
    for (const lane of ["To Do", "In Progress", "Done"]) {
      expect(node?.textContent).toContain(lane);
    }
    expect(node?.textContent).toContain("Test01");
    expect(node?.textContent).toContain("PM");
    expect(node?.textContent).toContain("GM");
    expect(node?.textContent).toContain("1/2");
    expect(node?.querySelectorAll("input[placeholder='+ Add a card']").length).toBe(3);
    expect(node?.textContent).toContain("+ Add column");
    expect(node?.textContent).not.toContain("Repair");
    expect(node?.textContent).not.toContain("No cards");
    expect(node?.querySelector(".kb-board")).not.toBeNull();
    expect(node?.querySelector(".kb-panel")).toBeNull();
    node?.querySelector(".kb-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const panel = node?.querySelector(".kb-panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("File name");
    expect(panel?.querySelector<HTMLInputElement>("input[aria-label='File name']")?.value).toBe("test01.md");
    expect(panel?.textContent).toContain("Task List");
    expect(panel?.querySelector("input[placeholder='Add a task...']")).not.toBeNull();
    expect(panel?.textContent).not.toContain("Todo");
    expect(panel?.querySelector("input[placeholder='Add a subcard...']")).not.toBeNull();
    expect(node?.querySelector(".kb-card .kb-panel")).toBeNull();
    expect(node?.querySelector("button[title='Column options']")).not.toBeNull();
    expect(surface.registerSidebarPanel).not.toHaveBeenCalled();
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 80; i += 1) await Promise.resolve();
}

function lane(name: string): HTMLElement {
  const node = document.querySelector(`section[aria-label="${name}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing lane ${name}`);
  return node;
}

function click(node: Element | null | undefined): void {
  node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function submit(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function cardNamed(title: string): HTMLElement {
  const node = [...document.querySelectorAll(".kb-card")].find((card) => (
    card.querySelector(".kb-card-title")?.textContent === title
  ));
  if (!(node instanceof HTMLElement)) throw new Error(`missing card ${title}`);
  return node;
}

function box(top: number, height = 80, left = 10, width = 200): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
    toJSON() { return {}; },
  } as DOMRect;
}

function stackRects(nodes: HTMLElement[]): void {
  nodes.forEach((node, index) => {
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue(box(100 + index * 90));
  });
}

function pointerDrag(source: HTMLElement, hit: Element, clientY: number): { before: string; drop: string; top: string } {
  const previous = document.elementFromPoint.bind(document);
  document.elementFromPoint = (() => hit) as typeof document.elementFromPoint;
  try {
    source.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 30, clientY: 10,
    }));
    source.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, pointerId: 1, clientX: 30, clientY,
    }));
    const line = document.querySelector<HTMLElement>(".kb-insert");
    const placed = { before: line?.dataset.before ?? "", drop: line?.dataset.drop ?? "", top: line?.style.top ?? "" };
    source.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 1, clientX: 30, clientY,
    }));
    return placed;
  } finally {
    document.elementFromPoint = previous;
  }
}

function field(label: string): HTMLInputElement {
  const node = document.querySelector<HTMLInputElement>(`.kb-panel input[aria-label="${label}"]`);
  if (!node) throw new Error(`missing ${label} field`);
  return node;
}

function menu(column: HTMLElement, label: string): void {
  click(column.querySelector("button[title='Column options']"));
  const pop = document.querySelector(".kb-menu-pop");
  if (!(pop instanceof HTMLElement)) throw new Error("missing column menu");
  if (column.contains(pop)) throw new Error("column menu is inside the scrolling lane");
  const item = [...pop.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!item) throw new Error(`missing menu ${label}`);
  click(item);
}

function filter(label: string): void {
  const node = [...document.querySelectorAll(".kb-toolbar button")].find((item) => item.textContent === label);
  if (!node) throw new Error(`missing filter ${label}`);
  click(node);
}

function laneNames(): string[] {
  return [...document.querySelectorAll(".kb-column")].map((node) => node.getAttribute("aria-label") ?? "");
}

describe("project board flows", () => {
  beforeEach(() => {
    files.clear();
    document.body.innerHTML = "";
    plugin.onDisable();
  });

  it("edits a card, a column, and the filters without leaving the editor", async () => {
    files.set("/proj/board.md", defaultBoardContent("Launch"));
    files.set("/proj/test01.md", `${buildCardContent({
      title: "Test01",
      status: "To Do",
      assignee: "GM",
      tags: ["PM"],
    })}- [x] one\n- [ ] two\n`);
    host();
    await plugin.onEnable(api({ folder: "/proj", folders: ["/proj"], parent: "" }) as never);
    await flush();

    const add = lane("To Do").querySelector<HTMLInputElement>("input[placeholder='+ Add a card']");
    if (!add) throw new Error("missing add-card field");
    submit(add, "Ship the board");
    await flush();
    const side = lane("In Progress").querySelector<HTMLInputElement>("input[placeholder='+ Add a card']");
    if (!side) throw new Error("missing in-progress add field");
    submit(side, "Side quest");
    await flush();
    expect(files.has("/proj/ship-the-board.md")).toBe(true);
    expect(files.has("/proj/side-quest.md")).toBe(true);
    expect([...lane("To Do").querySelectorAll(".kb-card-title")].map((node) => node.textContent)).toEqual([
      "Test01",
      "Ship the board",
    ]);

    click(cardNamed("Test01"));
    const title = field("Title");
    title.value = "Test01 renamed";
    title.dispatchEvent(new Event("blur"));
    await flush();
    expect(document.querySelector(".kb-panel h2")?.textContent).toBe("Test01 renamed");
    expect(cardNamed("Test01 renamed").style.outlineColor).toBe("#4c78e8");
    const opened = files.get("/proj/test01.md") ?? "";
    expect(opened).toContain("title: Test01 renamed");
    expect(opened).toContain("unread: no");
    expect(opened).toContain("assignee: GM");

    field("Due").value = "2020-01-01";
    field("Due").dispatchEvent(new Event("blur"));
    field("Priority").value = "A";
    field("Priority").dispatchEvent(new Event("blur"));
    await flush();
    expect(files.get("/proj/test01.md")).toContain("due: 2020-01-01");
    expect(files.get("/proj/test01.md")).toContain("priority: A");
    expect(files.get("/proj/test01.md")).toContain("title: Test01 renamed");

    const fill = document.querySelector<HTMLInputElement>(".kb-panel input[aria-label='Fill']");
    if (!fill) throw new Error("missing fill field");
    fill.value = "#abcdef";
    fill.dispatchEvent(new Event("change"));
    await flush();
    expect(files.get("/proj/test01.md")).toContain("color: #abcdef");
    expect(cardNamed("Test01 renamed").style.backgroundColor).toBe("#abcdef");
    click([...document.querySelectorAll<HTMLButtonElement>(".kb-panel button")].find((node) => node.textContent === "Clear" && node.title === "Clear fill"));
    await flush();
    expect(files.get("/proj/test01.md")).not.toContain("color:");

    const todo = document.querySelector<HTMLInputElement>(".kb-panel input[placeholder='Add a task...']");
    if (!todo) throw new Error("missing task field");
    submit(todo, "Call the client");
    await flush();
    expect(files.get("/proj/test01.md")).toContain("## Subtasks");
    expect(files.get("/proj/test01.md")).toContain("- [ ] Call the client");
    expect(lane("To Do").textContent).not.toContain("Call the client");
    expect(cardNamed("Test01 renamed").querySelector(".kb-frac")?.textContent).toBe("1/3");

    const boxes = [...document.querySelectorAll<HTMLInputElement>(".kb-panel .kb-check input")];
    const two = boxes[1];
    if (!two) throw new Error("missing todo checkbox");
    two.checked = true;
    two.dispatchEvent(new Event("change"));
    await flush();
    expect(files.get("/proj/test01.md")).toContain("- [x] two");
    expect(cardNamed("Test01 renamed").querySelector(".kb-frac")?.textContent).toBe("2/3");

    const description = document.querySelector<HTMLTextAreaElement>(".kb-panel textarea[aria-label='Description']");
    if (!description) throw new Error("missing description");
    description.value = "Write the note.";
    description.dispatchEvent(new Event("blur"));
    await flush();
    const described = files.get("/proj/test01.md") ?? "";
    expect(described).toContain("Write the note.");
    expect(described).toContain("## Subtasks");
    expect(described).toContain("- [ ] Call the client");
    expect(described).toContain("- [x] two");

    const sub = document.querySelector<HTMLInputElement>(".kb-panel input[placeholder='Add a subcard...']");
    if (!sub) throw new Error("missing subcard field");
    submit(sub, "Draft the note");
    await flush();
    expect(document.querySelector(".kb-panel")?.textContent).toContain("Draft the note");
    expect(document.querySelectorAll(".kb-card").length).toBe(3);
    expect([...cardNamed("Test01 renamed").querySelectorAll(".kb-tag")].map((node) => node.textContent)).toContain("PM");
    const nested = cardNamed("Test01 renamed").querySelector(".kb-nested");
    expect(nested?.textContent).toBe("Draft the note");
    expect(cardNamed("Test01 renamed").contains(nested)).toBe(true);
    click(cardNamed("Test01 renamed").querySelector(".kb-sub-toggle"));
    expect(document.querySelector(".kb-nested")).toBeNull();
    click(cardNamed("Test01 renamed").querySelector(".kb-sub-toggle"));
    expect(document.querySelector(".kb-nested")?.textContent).toBe("Draft the note");
    expect(files.get("/proj/draft-the-note.md")).toContain("parent: test01.md");
    const more = document.querySelector<HTMLInputElement>(".kb-panel input[placeholder='Add a subcard...']");
    if (!more) throw new Error("missing subcard field");
    submit(more, "Alpha note");
    await flush();
    expect([...cardNamed("Test01 renamed").querySelectorAll(".kb-nested")].map((node) => node.textContent)).toEqual([
      "Alpha note",
      "Draft the note",
    ]);
    expect(cardNamed("Test01 renamed").querySelector(".kb-frac")?.textContent).toBe("2/5");
    const head = cardNamed("Test01 renamed").querySelector(".kb-card-head");
    expect([...(head?.children ?? [])].map((node) => node.className)).toEqual(["kb-card-title", "kb-grip"]);
    const draft = [...cardNamed("Test01 renamed").querySelectorAll<HTMLElement>(".kb-nested")].find((node) => node.textContent === "Draft the note");
    const alpha = [...cardNamed("Test01 renamed").querySelectorAll<HTMLElement>(".kb-nested")].find((node) => node.textContent === "Alpha note");
    if (!draft || !alpha) throw new Error("missing nested cards");
    expect(draft.querySelector(".kb-nested-title")?.nextElementSibling?.classList.contains("kb-grip")).toBe(true);
    expect(head?.querySelector(".kb-grip")?.querySelectorAll("span").length).toBe(6);
    const nestedList = cardNamed("Test01 renamed").querySelector(".kb-nested-list");
    if (!(nestedList instanceof HTMLElement)) throw new Error("missing nested list");
    stackRects([alpha, draft]);
    vi.spyOn(nestedList, "getBoundingClientRect").mockReturnValue(box(90, 200));
    const nestedMove = pointerDrag(draft, alpha, 120);
    expect(nestedMove.drop).toBe("yes");
    expect(nestedMove.before).toBe(alpha.dataset.path);
    expect(nestedMove.top).toBe("98px");
    await flush();
    expect([...cardNamed("Test01 renamed").querySelectorAll(".kb-nested")].map((node) => node.textContent)).toEqual([
      "Draft the note",
      "Alpha note",
    ]);
    const paneList = document.querySelector<HTMLElement>(".kb-pane-subs");
    if (!paneList) throw new Error("missing pane subcards");
    const paneRows = [...paneList.querySelectorAll<HTMLElement>(":scope > .kb-sort-item")];
    expect(paneRows.map((row) => row.querySelector(".kb-subcard-open")?.textContent)).toEqual([
      "Draft the note",
      "Alpha note",
    ]);
    expect(paneRows[0]?.lastElementChild?.classList.contains("kb-grip")).toBe(true);
    stackRects(paneRows);
    vi.spyOn(paneList, "getBoundingClientRect").mockReturnValue(box(90, 200));
    const paneMove = pointerDrag(paneRows[1], paneRows[0], 120);
    expect(paneMove.drop).toBe("yes");
    expect(paneMove.before).toBe(paneRows[0]?.dataset.path);
    await flush();
    expect([...document.querySelectorAll(".kb-pane-subs .kb-subcard-open")].map((node) => node.textContent)).toEqual([
      "Alpha note",
      "Draft the note",
    ]);
    expect([...cardNamed("Test01 renamed").querySelectorAll(".kb-nested")].map((node) => node.textContent)).toEqual([
      "Alpha note",
      "Draft the note",
    ]);

    const comment = document.querySelector<HTMLInputElement>(".kb-panel input[placeholder='Write a comment...']");
    if (!comment) throw new Error("missing comment field");
    submit(comment, "Looks close");
    await flush();
    expect(files.get("/proj/test01.md")).toContain("## Comments");
    expect(files.get("/proj/test01.md")).toMatch(/_\d{4}-\d{2}-\d{2} \d{2}:\d{2}:_ Looks close/);

    const blocked = document.querySelector<HTMLSelectElement>(".kb-panel select[aria-label='Blocked by']");
    if (!blocked) throw new Error("missing blocked-by field");
    blocked.value = "ship-the-board.md";
    blocked.dispatchEvent(new Event("change"));
    await flush();
    expect(files.get("/proj/test01.md")).toContain("blocked-by: ship-the-board.md");

    filter("Overdue");
    expect(lane("To Do").textContent).toContain("Test01 renamed");
    expect(lane("To Do").textContent).not.toContain("Ship the board");
    expect(lane("In Progress").textContent).not.toContain("Side quest");
    filter("Overdue");
    filter("Blocked");
    expect(lane("To Do").textContent).toContain("Test01 renamed");
    expect(lane("To Do").textContent).not.toContain("Ship the board");
    filter("Blocked");

    const status = document.querySelector<HTMLSelectElement>(".kb-panel select[aria-label='Status']");
    if (!status) throw new Error("missing status field");
    status.value = "Done";
    status.dispatchEvent(new Event("change"));
    await flush();
    expect(lane("Done").textContent).toContain("Test01 renamed");
    expect(lane("To Do").textContent).not.toContain("Test01 renamed");
    expect(files.get("/proj/test01.md")).toContain("Moved from To Do to Done.");
    filter("Overdue");
    expect(document.body.textContent).not.toContain("Test01 renamed");
    filter("Overdue");

    const ship = cardNamed("Ship the board");
    const progress = lane("In Progress");
    const sideWrap = cardNamed("Side quest").parentElement;
    if (!(sideWrap instanceof HTMLElement)) throw new Error("missing side quest");
    stackRects([sideWrap]);
    const progressList = progress.querySelector(".kb-cards");
    if (progressList instanceof HTMLElement) vi.spyOn(progressList, "getBoundingClientRect").mockReturnValue(box(90, 200));
    const across = pointerDrag(ship, progress, 400);
    expect(across.drop).toBe("yes");
    expect(across.before).toBe("");
    await flush();
    expect([...lane("In Progress").querySelectorAll(".kb-card-title")].map((node) => node.textContent)).toEqual([
      "Side quest",
      "Ship the board",
    ]);
    expect(lane("To Do").textContent).not.toContain("Ship the board");
    expect(files.get("/proj/ship-the-board.md")).toContain("Moved from To Do to In Progress.");
    const wraps = [...lane("In Progress").querySelectorAll<HTMLElement>(":scope .kb-cards > .kb-card-wrap")];
    stackRects(wraps);
    const laneList = lane("In Progress").querySelector(".kb-cards");
    if (laneList instanceof HTMLElement) vi.spyOn(laneList, "getBoundingClientRect").mockReturnValue(box(90, 300));
    const shipAgain = cardNamed("Ship the board");
    const sideCard = cardNamed("Side quest");
    const again = pointerDrag(shipAgain, sideCard, 110);
    expect(again.drop).toBe("yes");
    expect(again.before).toBe(sideCard.dataset.path);
    await flush();
    expect([...lane("In Progress").querySelectorAll(".kb-card-title")].map((node) => node.textContent)).toEqual([
      "Ship the board",
      "Side quest",
    ]);

    menu(lane("In Progress"), "Delete");
    await flush();
    expect(document.querySelector("section[aria-label='In Progress']")).toBeNull();
    expect(files.get("/proj/board.md")).not.toContain("lane: In Progress");
    expect(lane("To Do").textContent).toContain("Ship the board");
    expect(lane("To Do").textContent).toContain("Side quest");
    expect(files.get("/proj/ship-the-board.md")).toContain("status: To Do");

    menu(lane("To Do"), "Rename");
    const rename = document.querySelector<HTMLInputElement>("input[aria-label='Rename To Do']");
    if (!rename) throw new Error("missing rename field");
    rename.value = "Ready";
    rename.dispatchEvent(new Event("blur"));
    await flush();
    expect(document.querySelector("section[aria-label='To Do']")).toBeNull();
    expect(lane("Ready").textContent).toContain("Ship the board");
    expect(lane("Ready").textContent).toContain("Side quest");
    expect(files.get("/proj/board.md")).not.toContain("lane: To Do");
    expect(files.get("/proj/ship-the-board.md")).toContain("status: Ready");
    expect(files.get("/proj/side-quest.md")).toContain("status: Ready");

    menu(lane("Ready"), "Hide");
    await flush();
    expect(document.querySelector("section[aria-label='Ready']")).toBeNull();
    click([...document.querySelectorAll("button")].find((node) => node.textContent === "Show Ready"));
    await flush();
    expect(lane("Ready")).not.toBeNull();

    click(lane("Ready").querySelector("button[title='Collapse column']"));
    await flush();
    expect(lane("Ready").textContent).not.toContain("Ship the board");
    click(lane("Ready").querySelector("button[title='Expand column']"));
    await flush();
    expect(lane("Ready").textContent).toContain("Ship the board");

    menu(lane("Ready"), "Move right");
    await flush();
    expect(laneNames()).toEqual(["Done", "Ready"]);

    click(document.querySelector("button[title='Add a column']"));
    const column = document.querySelector<HTMLInputElement>("input[aria-label='New column name']");
    if (!column) throw new Error("missing new column field");
    submit(column, "Later");
    await flush();
    expect(laneNames()).toEqual(["Done", "Ready", "Later"]);

    click(lane("Ready").querySelector("button[title='Column options']"));
    const color = document.querySelector<HTMLInputElement>("input[aria-label='Color for Ready']");
    if (!color) throw new Error("missing color field");
    color.value = "#112233";
    color.dispatchEvent(new Event("change"));
    await flush();
    expect(files.get("/proj/board.md")).toContain("lane: Ready|#112233");

    const search = document.querySelector<HTMLInputElement>("input[type=search]");
    if (!search) throw new Error("missing search");
    search.value = "quest";
    search.dispatchEvent(new Event("input"));
    expect(lane("Ready").textContent).toContain("Side quest");
    expect(lane("Ready").textContent).not.toContain("Ship the board");
    expect(lane("Done").textContent).not.toContain("Test01 renamed");
    expect(document.querySelector(".kb-panel")).toBeNull();
    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector(".kb-panel h2")?.textContent).toBe("Test01 renamed");

    const fileName = document.querySelector<HTMLInputElement>(".kb-panel input[aria-label='File name']");
    if (!fileName) throw new Error("missing file name field");
    fileName.value = "launch-note";
    fileName.dispatchEvent(new Event("blur"));
    await flush();
    expect(files.has("/proj/test01.md")).toBe(false);
    expect(files.get("/proj/launch-note.md")).toContain("title: Test01 renamed");
    expect(files.get("/proj/draft-the-note.md")).toContain("parent: launch-note.md");
    expect(document.querySelector(".kb-panel h2")?.textContent).toBe("Test01 renamed");
    expect(document.querySelector<HTMLInputElement>(".kb-panel input[aria-label='File name']")?.value).toBe("launch-note.md");
  });
});
