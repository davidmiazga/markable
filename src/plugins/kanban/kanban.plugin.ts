/**
 * Kanban — first-slice project pack plugin.
 *
 * Three-column board (To Do / In Progress / Done) in a sidebar panel.
 * Cards persist through the plugin settings API. No CM6 extensions.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

const PLUGIN_ID = "kanban";
const PANEL_ID = "kanban-board";
const CSS_ID = "markable-kanban-styles";

type ColumnId = "todo" | "doing" | "done";

interface Card {
  id: string;
  title: string;
  column: ColumnId;
}

interface BoardState {
  cards: Card[];
}

const COLUMNS: ReadonlyArray<{ id: ColumnId; title: string }> = [
  { id: "todo", title: "To Do" },
  { id: "doing", title: "In Progress" },
  { id: "done", title: "Done" },
];

const COLUMN_ORDER: readonly ColumnId[] = COLUMNS.map((column) => column.id);

const EMPTY_BOARD: BoardState = { cards: [] };

let _api: MarkablePluginAPI | null = null;
let _board: BoardState = { cards: [] };
let _container: HTMLElement | null = null;

function newCardId(): string {
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseBoard(raw: Record<string, unknown> | null): BoardState {
  if (raw === null || !Array.isArray(raw.cards)) {
    return { cards: [] };
  }
  const cards: Card[] = [];
  for (const item of raw.cards) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.trim() === "") continue;
    if (typeof record.title !== "string") continue;
    if (record.column !== "todo" && record.column !== "doing" && record.column !== "done") {
      continue;
    }
    cards.push({
      id: record.id,
      title: record.title,
      column: record.column,
    });
  }
  return { cards };
}

function persist(): void {
  void _api?.saveSettings({ cards: _board.cards }).catch(() => undefined);
}

function cardsIn(column: ColumnId): Card[] {
  return _board.cards.filter((card) => card.column === column);
}

function addCard(title: string): void {
  const trimmed = title.trim();
  if (trimmed === "") return;
  _board = {
    cards: [..._board.cards, { id: newCardId(), title: trimmed, column: "todo" }],
  };
  persist();
  renderBoard();
}

function moveCard(id: string, direction: -1 | 1): void {
  const card = _board.cards.find((item) => item.id === id);
  if (card === undefined) return;
  const index = COLUMN_ORDER.indexOf(card.column);
  const next = COLUMN_ORDER[index + direction];
  if (next === undefined) return;
  card.column = next;
  persist();
  renderBoard();
}

function deleteCard(id: string): void {
  _board = { cards: _board.cards.filter((card) => card.id !== id) };
  persist();
  renderBoard();
}

function injectCSS(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .kb-root {
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100%;
      min-height: 0;
      padding: 8px;
      box-sizing: border-box;
      font-family: var(--ui-font, system-ui, sans-serif);
      font-size: 12px;
      color: var(--text-color, inherit);
    }
    .kb-add {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .kb-add input {
      flex: 1;
      min-width: 0;
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: var(--bg-primary, #fff);
      color: inherit;
      font: inherit;
    }
    .kb-add button,
    .kb-card-actions button {
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: var(--bg-secondary, #f4f4f4);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .kb-add button:hover,
    .kb-card-actions button:hover {
      background: var(--bg-hover, #e8e8e8);
    }
    .kb-board {
      display: flex;
      gap: 8px;
      flex: 1;
      min-height: 0;
      overflow-x: auto;
    }
    .kb-column {
      flex: 1 1 0;
      min-width: 120px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 6px;
      background: var(--bg-secondary, #f7f7f7);
    }
    .kb-column-title {
      padding: 6px 8px;
      font-weight: 600;
      border-bottom: 1px solid var(--border-color, #ddd);
    }
    .kb-column-count {
      font-weight: 400;
      color: var(--text-secondary, #666);
    }
    .kb-cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      overflow-y: auto;
      min-height: 0;
    }
    .kb-card {
      padding: 6px 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: var(--bg-primary, #fff);
    }
    .kb-card-title {
      margin-bottom: 6px;
      word-break: break-word;
    }
    .kb-card-actions {
      display: flex;
      gap: 4px;
    }
    .kb-empty {
      padding: 8px;
      color: var(--text-secondary, #666);
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
}

function renderBoard(): void {
  if (_container === null) return;
  _container.innerHTML = "";

  const root = document.createElement("div");
  root.className = "kb-root";

  const addRow = document.createElement("form");
  addRow.className = "kb-add";
  addRow.addEventListener("submit", (event) => {
    event.preventDefault();
    addCard(input.value);
    input.value = "";
    input.focus();
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Add a card";
  input.setAttribute("aria-label", "New kanban card title");

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Add";

  addRow.append(input, submit);

  const board = document.createElement("div");
  board.className = "kb-board";

  for (const column of COLUMNS) {
    const cards = cardsIn(column.id);
    const col = document.createElement("section");
    col.className = "kb-column";
    col.setAttribute("aria-label", column.title);

    const heading = document.createElement("div");
    heading.className = "kb-column-title";
    heading.textContent = column.title;
    const count = document.createElement("span");
    count.className = "kb-column-count";
    count.textContent = ` ${cards.length}`;
    heading.appendChild(count);

    const list = document.createElement("div");
    list.className = "kb-cards";

    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "kb-empty";
      empty.textContent = "No cards";
      list.appendChild(empty);
    }

    for (const card of cards) {
      list.appendChild(renderCard(card));
    }

    col.append(heading, list);
    board.appendChild(col);
  }

  root.append(addRow, board);
  _container.appendChild(root);
}

function renderCard(card: Card): HTMLElement {
  const el = document.createElement("article");
  el.className = "kb-card";

  const title = document.createElement("div");
  title.className = "kb-card-title";
  title.textContent = card.title;

  const actions = document.createElement("div");
  actions.className = "kb-card-actions";

  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "←";
  back.title = "Move left";
  back.disabled = card.column === "todo";
  back.addEventListener("click", () => moveCard(card.id, -1));

  const forward = document.createElement("button");
  forward.type = "button";
  forward.textContent = "→";
  forward.title = "Move right";
  forward.disabled = card.column === "done";
  forward.addEventListener("click", () => moveCard(card.id, 1));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete card";
  remove.addEventListener("click", () => deleteCard(card.id));

  actions.append(back, forward, remove);
  el.append(title, actions);
  return el;
}

export default {
  id: PLUGIN_ID,
  name: "Kanban",
  version: "1.0.0",
  description: "Three-column project board in the sidebar",
  detail:
    "Shows a To Do / In Progress / Done board. Add cards, move them between columns, and persist the board in plugin settings. First plugin in the project pack.",
  sidebarPanelId: PANEL_ID,

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;
    injectCSS();
    const stored = await api.loadSettings().catch(() => null);
    _board = parseBoard(stored);

    api.registerSidebarPanel({
      id: PANEL_ID,
      title: "Kanban",
      side: "right",
      defaultWidth: 420,
      render(container: HTMLElement): void {
        _container = container;
        renderBoard();
      },
      destroy(container: HTMLElement): void {
        _container = null;
        container.innerHTML = "";
      },
    });
    api.focusSidebarPanel(PANEL_ID);
  },

  onDisable(api: MarkablePluginAPI): void {
    api.unregisterSidebarPanel(PANEL_ID);
    _api = null;
    _container = null;
    _board = { ...EMPTY_BOARD };
  },
};
