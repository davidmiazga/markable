import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import {
  addCheckItem,
  applyCardDraft,
  buildCardContent,
  cardVisible,
  cleanProject,
  defaultBoardContent,
  groupByParent,
  isBoardContent,
  newCardContent,
  parseBoard,
  parseCard,
  progressOf,
  projectFolderName,
  salvageFrontmatter,
  toggleCheck,
  withDescription,
  withLanes,
  withScalar,
} from "../../../src/plugins/kanban/board-model";

const BOARD = defaultBoardContent("Launch");

describe("project board notes", () => {
  it("recognises a board note and its lanes", () => {
    expect(isBoardContent(BOARD)).toBe(true);
    const board = parseBoard(BOARD, "/vault/Project Board.md");
    expect(board?.title).toBe("Launch");
    expect(board?.lanes.map((lane) => lane.title)).toEqual(["To Do", "In Progress", "Done"]);
    expect(board?.lanes[0].color).toBe("#4c78e8");
    expect(board?.showTitle).toBe(true);
    const fm = BOARD.split("---")[1] ?? "";
    expect(load(fm)).toMatchObject({ kanban: "board", title: "Launch" });
  });

  it("reads the old repeated lane lines and writes them back as one list", () => {
    const legacy = [
      "---",
      "kanban: board",
      "title: testingMarkdown",
      "lane: To Do|#4c78e8",
      "lane: In Progress|#e6a23c",
      "lane: Done|#3d9a6a",
      "---",
      "",
    ].join("\n");
    const board = parseBoard(legacy, "board.md");
    expect(board?.lanes.map((lane) => lane.title)).toEqual(["To Do", "In Progress", "Done"]);
    const next = withLanes(legacy, board?.lanes ?? []);
    expect(next).toContain("lane:\n");
    expect(next).toContain('  - "To Do|#4c78e8"');
    expect(next).not.toContain("lane: To Do");
    expect(load((next.split("---")[1] ?? ""))).toMatchObject({
      lane: ["To Do|#4c78e8", "In Progress|#e6a23c", "Done|#3d9a6a"],
    });
  });

  it("ignores a note that is not a board", () => {
    expect(isBoardContent("---\ntitle: nope\n---\n")).toBe(false);
    expect(parseBoard("---\ntitle: nope\n---\n", "/vault/nope.md")).toBeNull();
  });

  it("reads a card note, including checkboxes and sections", () => {
    const content = [
      "---",
      "title: Ship it",
      "status: To Do",
      "priority: high",
      "due: 2026-10-01",
      "assignee: Ada",
      "tags: launch, board",
      "blocked-by: Review",
      "color: #fff8e8",
      "border: #4c78e8",
      "unread: yes",
      "estimate: 2",
      "---",
      "",
      "Write the note.",
      "- [ ] draft",
      "- [x] outline",
      "",
      "## Comments",
      "Looks close.",
      "## History",
      "Created today.",
    ].join("\n");
    const card = parseCard(content, "/vault/ship-it.md");
    expect(card.title).toBe("Ship it");
    expect(card.fileName).toBe("ship-it.md");
    expect(card.status).toBe("To Do");
    expect(card.tags).toEqual(["launch", "board"]);
    expect(card.checks.map((item) => [item.done, item.text])).toEqual([
      [false, "draft"],
      [true, "outline"],
    ]);
    expect(card.description).toBe("Write the note.");
    expect(card.comments).toBe("Looks close.");
    expect(card.history).toBe("Created today.");
    expect(card.custom).toEqual([{ key: "estimate", value: "2" }]);
    expect(card.unread).toBe(true);
  });

  it("moves a card by rewriting status", () => {
    const moved = withScalar(newCardContent("Ship it", "To Do"), "status", "Done");
    expect(parseCard(moved, "/vault/ship-it.md").status).toBe("Done");
  });

  it("toggles and adds a checkbox without dropping the rest of the note", () => {
    const start = `${newCardContent("Ship it", "To Do")}- [ ] draft\n\n## Comments\nKeep me.\n`;
    const toggled = toggleCheck(start, parseCard(start, "/v/a.md").checks[0].bodyLineIndex);
    expect(parseCard(toggled, "/v/a.md").checks[0].done).toBe(true);
    expect(parseCard(toggled, "/v/a.md").comments).toBe("Keep me.");
    const added = addCheckItem(toggled, "second");
    expect(parseCard(added, "/v/a.md").checks.map((item) => item.text)).toEqual(["draft", "second"]);
    expect(parseCard(added, "/v/a.md").comments).toBe("Keep me.");
  });

  it("hides a lane on the board note", () => {
    const board = parseBoard(BOARD, "/vault/board.md");
    expect(board).not.toBeNull();
    const next = withLanes(BOARD, board!.lanes.map((lane) => (
      lane.title === "Done" ? { ...lane, hidden: true } : lane
    )));
    expect(parseBoard(next, "/vault/board.md")?.lanes.find((lane) => lane.title === "Done")?.hidden).toBe(true);
  });

  it("filters overdue, due soon, blocked, and unread cards", () => {
    const overdue = parseCard(withScalar(withScalar(newCardContent("Late", "To Do"), "due", "2026-10-01"), "blocked-by", "X"), "/v/late.md");
    const soon = parseCard(withScalar(newCardContent("Soon", "To Do"), "due", "2026-10-12"), "/v/soon.md");
    const unread = parseCard(newCardContent("New", "To Do"), "/v/new.md");
    const today = "2026-10-10";
    expect(cardVisible(overdue, [], "", new Set(["overdue"]), today)).toBe(true);
    expect(cardVisible(soon, [], "", new Set(["overdue"]), today)).toBe(false);
    expect(cardVisible(soon, [], "", new Set(["due-soon"]), today)).toBe(true);
    expect(cardVisible(overdue, [], "", new Set(["blocked"]), today)).toBe(true);
    expect(cardVisible(unread, [], "", new Set(["unread"]), today)).toBe(true);
    expect(cardVisible(soon, [], "soon", new Set(), today)).toBe(true);
    expect(cardVisible(soon, [], "missing", new Set(), today)).toBe(false);
  });

  it("builds a task note from a form and edits it in place", () => {
    const content = buildCardContent({
      title: "Ship it",
      status: "To Do",
      priority: "high",
      due: "2026-10-20",
      assignee: "Ada",
      tags: ["launch", "board"],
      description: "Write the note.",
    });
    const card = parseCard(content, "/vault/Projects/launch/ship-it.md");
    expect(card.title).toBe("Ship it");
    expect(card.priority).toBe("high");
    expect(card.due).toBe("2026-10-20");
    expect(card.assignee).toBe("Ada");
    expect(card.tags).toEqual(["launch", "board"]);
    expect(card.description).toBe("Write the note.");
    expect(card.unread).toBe(true);

    const edited = applyCardDraft(content, {
      title: "Ship it",
      status: "In Progress",
      priority: "",
      due: "2026-10-21",
      assignee: "",
      tags: [],
      description: "Revised.",
    });
    const next = parseCard(edited, "/vault/Projects/launch/ship-it.md");
    expect(next.status).toBe("In Progress");
    expect(next.priority).toBe("");
    expect(next.assignee).toBe("");
    expect(next.tags).toEqual([]);
    expect(next.description).toBe("Revised.");
    expect(next.unread).toBe(true);
  });

  it("keeps checkboxes when the description changes", () => {
    const start = `${newCardContent("Ship it", "To Do")}- [x] outline\n`;
    const next = withDescription(start, "A new description.");
    const card = parseCard(next, "/v/a.md");
    expect(card.description).toBe("A new description.");
    expect(card.checks.map((item) => [item.done, item.text])).toEqual([[true, "outline"]]);
  });

  it("keeps the project name the user typed", () => {
    expect(projectFolderName("Project")).toBe("Project");
    expect(projectFolderName("John's Projects")).toBe("John's Projects");
    expect(projectFolderName("John's Projects", new Set(["John's Projects"]))).toBe("John's Projects 2");
  });

  it("closes broken properties and keeps the rest of the note", () => {
    const salvaged = salvageFrontmatter("---\ntitle: Ship\nstatus: To Do\noops\nStill here\n");
    const card = parseCard(salvaged, "/v/ship.md");
    expect(card.title).toBe("Ship");
    expect(card.status).toBe("To Do");
    expect(salvaged).toContain("oops");
    expect(salvaged).toContain("Still here");
  });

  it("cleans a messy project folder without dropping note text", () => {
    const messy = cleanProject([
      { name: "board.md", content: "Someone replaced the board." },
      { name: "loose.md", content: "A task with no properties.\n" },
      { name: "orphan.md", content: "---\ntitle: Orphan\nstatus: To Do\nparent: missing.md\n---\n\nKeep me.\n" },
      { name: "later.md", content: "---\ntitle: Later\nstatus: Waiting\n---\n\n" },
    ], "John's Projects");
    const board = messy.files.find((file) => file.name === "board.md");
    expect(board?.content).toContain("kanban: board");
    expect(board?.content).toContain("Someone replaced the board.");
    expect(board?.content).toContain('  - "Waiting|#888888"');
    const loose = parseCard(messy.files.find((file) => file.name === "loose.md")?.content ?? "", "loose.md");
    expect(loose.status).toBe("To Do");
    expect(loose.description).toContain("A task with no properties.");
    const orphan = parseCard(messy.files.find((file) => file.name === "orphan.md")?.content ?? "", "orphan.md");
    expect(orphan.parent).toBe("");
    expect(orphan.description).toBe("Keep me.");
    const again = cleanProject(messy.files, "John's Projects");
    expect(again.notes).toEqual([]);
    expect(again.files).toEqual(messy.files);
  });

  it("reads TAGS as the card tags, not a second custom field", () => {
    const card = parseCard("---\nTAGS: PM\nstatus: To Do\n---\n", "/v/note.md");
    expect(card.tags).toEqual(["PM"]);
    expect(card.custom.map((field) => field.key)).not.toContain("TAGS");
  });

  it("keeps a new checkbox under Subtasks when the description is rewritten", () => {
    const withTodo = addCheckItem(newCardContent("Parent", "To Do"), "Call the client");
    expect(withTodo).toContain("## Subtasks\n- [ ] Call the client");
    const card = parseCard(withTodo, "/v/parent.md");
    expect(card.checks.map((item) => item.text)).toEqual(["Call the client"]);
    expect(card.description).toBe("");
    const rewritten = withDescription(withTodo, "Write the note.");
    expect(rewritten).toContain("Write the note.");
    expect(rewritten).toContain("## Subtasks");
    expect(rewritten).toContain("- [ ] Call the client");
    const again = parseCard(rewritten, "/v/parent.md");
    expect(again.description).toBe("Write the note.");
    expect(again.checks.map((item) => item.text)).toEqual(["Call the client"]);
    const toggled = toggleCheck(rewritten, again.checks[0].bodyLineIndex);
    expect(toggled).toContain("- [x] Call the client");
  });

  it("counts checkboxes and finished subtasks", () => {
    const parent = parseCard(`${newCardContent("Parent", "To Do")}- [x] one\n- [ ] two\n`, "/v/parent.md");
    const child = parseCard(withScalar(newCardContent("Child", "Done"), "parent", "parent.md"), "/v/child.md");
    expect(progressOf(parent, [child])).toEqual({ done: 2, total: 3 });
    const grouped = groupByParent([parent, child]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].children).toHaveLength(1);
  });
});
