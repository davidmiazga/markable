# Features

We will have 3 categories of features:

1. **Base-Core features** (!important — always a priority, warn if anything impacts this)
   - a. Extended features (building upon Base-Core; can be bumped to a plugin as needed)

2. **Plugin features** (allows the app to be performant while adding optional features)

3. **PKM features** (Personal Knowledge Management)

---

## Phase 1: Base Features

### 1. Editing Experience

A "Typora-style" live preview where users edit inline Markdown in a **chromeless window**.

- **Chromeless window**: Tauri `decorations: false` with a custom drag region. Only the macOS traffic-light buttons and the document title are visible. The title's appearance (including opacity — potentially 0% until hover) must be fully controllable via theming so we can experiment with what looks best.
- **No floating toolbar in Phase 1.** The "palette of type tools" is deferred to Phase 2 (Markdown Toolbar plugin, Notion-style floating bar).

### 2. Multi-File Support

Phase 1 supports multiple open files via **horizontal tabs** along the top of the window (browser/VS Code-style).

- Tabs should not interfere with the chromeless aesthetic.
- **Optional compact mode:** A minimal dot-pattern indicator (`..●..`) showing open files, with the file name displayed small above it. Architect to evaluate feasibility and propose a toggle mechanism between tab mode and dot-pattern mode.
- Phase 3 adds a sidebar File Browser with stacked/vertical tabs inside it; the Phase 1 horizontal tabs remain the primary navigation until then.

### 3. Performance

Focus on a very fast opening and editing experience.

- App should open almost instantly.
- No flashes of white windows or flashing of other UI elements.
- Anything that cannot be loaded quickly must be loaded as a secondary/deferred load or shuttled to "Added-Plugin" state.

### 4. Persistence & Settings

Settings are always persistent. The app should open in the same state the user left it.

Core persistent settings:
1. Customizable content width
2. Customizable default overall font size
3. Customizable keyboard commands via `keybindings.json` (power-user editable). Phase 2 adds a keybinding editor UI.
4. Selected theme persists on load. If the theme CSS is corrupt or missing, revert to default theme automatically.
5. Window placement is persistent on load
6. Recent files list is persistent on load

### 5. Theming & Customization

Hot-swappable, instant-apply theming across the **full app chrome** (editor, window background, all UI elements) — reference VS Code's theming model.

- **Theme directory:** `~/Library/Application Support/Markable/themes/`
- Default themes are bundled with the app; user themes are loaded from the directory above.
- Users can create custom themes by adding a CSS file to the themes directory.
- Theme switching: Next Theme (Ctrl-Shift-Down), Previous Theme (Ctrl-Shift-Up), or from Theme menu.
- **Uninstall cleanup:** Phase 1 ships with documented uninstall steps in Help/README that remove `~/Library/Application Support/Markable/` and all app data. No "droppings" after deletion. A proper in-app uninstaller may follow in a later phase.

### 6. Save Behavior

- **Manual save only** in Phase 1: Save (Cmd-S), Save As (Cmd-Shift-S).
- When Cmd-S is pressed on a new untitled file, present a Save As dialog.
- **Auto-save is a Phase 2 plugin** with the option to disable it.

### 7. Export & Import (Phase 1 Scope)

Phase 1 supports easy/lightweight formats only:
- **Export:** HTML (Cmd-Opt-E)
- **Import:** `.md` and `.txt` (Cmd-I)

More complex formats (PDF, Word) are deferred to Phase 2 Extended Exports.

### 8. Front Matter

- Phase 1 inserts `---` delimiters (Cmd-Shift-Y) but **hides or renders YAML front matter as plain text** — no parsing or special rendering.
- Full YAML support (side panel, term restriction, Obsidian-style properties) is Phase 3.

### 9. Base Menu UI

All typical macOS app features should be present. Default keyboard shortcuts listed below.

#### 9.1 System Menu
1. About Markable
2. Check for updates... (opens URL)
3. Settings: Cmd-,
4. Hide Markable: Cmd-H
5. Show All
6. Quit: Cmd-Q

#### 9.2 File Menu
1. Open: Cmd-O
2. New File: Cmd-N
3. Save: Cmd-S
4. Save As: Cmd-Shift-S
5. Export (HTML): Cmd-Opt-E
6. Import (.md/.txt): Cmd-I *(Note: conflicts with Italic — see Shortcut Conflicts)*
7. Close: Cmd-W
8. Close All: Cmd-Shift-W

#### 9.3 Edit Menu
1. Undo: Cmd-Z
2. Redo: Cmd-Shift-Z
3. Cut: Cmd-X
4. Copy: Cmd-C
5. Paste: Cmd-V
6. Paste Link Over Text: Cmd-K
7. Copy As Markdown: Cmd-Shift-C
8. Copy As HTML: Cmd-Opt-C
9. Paste Without Formatting: Cmd-Shift-V
10. Select All: Cmd-A
11. Find: Cmd-F
12. Find And Replace: Cmd-Shift-F
13. Move Line Up: Opt-Up Arrow
14. Move Line Down: Opt-Down Arrow

#### 9.4 Format Menu
1. Headings: H1–H6 via Cmd-1 through Cmd-6
2. Text formatting:
   - Bold: Cmd-B
   - Italic: Cmd-I *(Note: conflicts with Import — see Shortcut Conflicts)*
   - Underline: Cmd-U
   - Superscript: Cmd-Shift-+
   - Subscript: Cmd-Shift--
   - Highlight: Cmd-Shift-H
   - Math (inline): Cmd-Shift-M
   - Strikethrough: Cmd-Shift-< *(Note: may not register on all keyboards — see Shortcut Conflicts)*
3. Insert Image: Cmd-E *(Note: macOS system shortcut in some contexts — see Shortcut Conflicts)*
4. Insert Link Format: Cmd-Shift-[
5. Insert Table: Cmd-Shift-T
6. Code Fences: Opt-C
7. Quote: Opt-Q
8. Math (block): Opt-M
9. Ordered List (Simple Numerals): Opt-O
10. Indent: Cmd-]
11. Outdent: Cmd-[
12. Bullet List: Opt-.
13. Task List: Opt-X
14. Horizontal Rule: Opt-/
15. Front Matter Fence: Cmd-Shift-Y *(inserts delimiters only — no YAML rendering)*
16. Clear All Formatting: Cmd-.

#### 9.5 Theme Menu
1. Next Theme: Ctrl-Shift-Down Arrow
2. Previous Theme: Ctrl-Shift-Up Arrow
3. \<Theme List\> (dynamically populated from themes directory)

#### 9.6 Window Menu
1. Zoom In: Cmd-+
2. Zoom Out: Cmd--
3. Fullscreen: Ctrl-F
4. Maximize
5. Minimize

#### 9.7 Help Menu
1. Search
2. Quickstart
3. Help
4. Markdown Cheatsheet

### Keyboard Shortcut Conflicts (To Resolve During Architecture)

These conflicts are flagged for the Architect to propose alternatives:

| Conflict | Issue |
|---|---|
| **Cmd-I** | Assigned to both File > Import and Format > Italic |
| **Cmd-E** | Insert Image, but is a macOS system shortcut in some contexts |
| **Cmd-Shift-<** | Strikethrough — may not register on all keyboard layouts |

---

## Phase 2: Plugin Features

> Optionally installed by user. These features are only considered after base features are verified as working. Phase 1 architecture must be **modular enough** to support a plugin loader, but the plugin registry/loader itself ships in Phase 2.

1. **Markdown Toolbar** — Floating (Notion-style), with editable position: float offset, custom position, or docked at top (MS Word-style). This replaces the Phase 1 "palette of type tools."
2. **Word Count**
3. **Auto-generate TOC** (Table of Contents)
4. **Basic Templates** (Markdown with fields for reuse)
5. **Advanced Lists:** Roman Numerals (Opt-R), Number Letter Simple (Opt-N), Number Letter Extended (Opt-L), Custom Formats
6. **Advanced Markdown** — tables with editing UI
7. **Advanced Media Preview** — inserting/previewing images, video, embedded `.md`
8. **Math LaTeX Support**
9. **Diagrams Support** — Mermaid and/or Excalidraw (possibly separate plugins)
10. **Focus Modes:** General (current line highlighted), Typewriter (current line centered)
11. **Command Bar** (Cmd-Shift-P)
12. **Multi-Cursor** (Cmd-Opt-Up/Down Arrows)
13. **Backlinks** (+Visualization?)
14. **Footnotes**
15. **Insert Count Command** (Insert a number and increment by 1, or start at N and count by X)
16. **Extended Exports:** PDF, HTML, Word formats
17. **Auto-Save Plugin** — with option to disable. Trigger options: debounce timer, focus loss, or both.
18. **Keybinding Editor UI** — visual editor for `keybindings.json` (Phase 1 is JSON-only)

---

## Phase 3: Advanced PKM Features

> These take more time to implement but put Markable in competition with Obsidian. This list will grow over time.

1. **Daily Note / Calendar**
2. **YAML Pane** — auto-tagging, categories, displayed in a right-side panel (Obsidian-style properties). Must support term restriction to eliminate similar/duplicate terms (Notion-style).
3. **Extended Keyboard Command Interface** — top-notch visual keybinding management
4. **Custom Icons**
5. **Advanced CSS Class Support** — for inserting user HTML or simple features like columns
6. **Columns** — prebuilt column support (mixing Markdown and HTML/CSS; needs careful architecture)
7. **Dockable Interface** — top/bottom/left/right pane areas
8. **Page Preview** — MS Word-style page edges visible on all sides
9. **File Browser** — sidebar pane showing files (VS Code-style with custom icons); includes stacked/vertical tabs inside the sidebar
10. **Layout Views/Templates**
11. **File Browser Advanced** — "Vaults" (Obsidian-style)
    1. Content type hierarchy: Vault, Areas-Divisions, Domains, Fields, Subfields, Disciplines, Subjects, Topics, Subtopics, Snippets
    2. Folder View: customized view of items inside a hierarchy item
11a. **Knowledge Graph Visualization** — interactive node-edge graph view of vault backlinks and connections (deferred from FC2 Backlinks)
12. **Backup & Sync**
13. **Networking Solutions** — file paths on local networks or cross-OS
14. **Projects**
15. **Dataview** — sortable tables with filters
    1. Excel and basic spreadsheet support?
16. **Advanced Import** — read and write MS Office formats
17. **Full Excalidraw Support**
18. **Slides/Presentation Support** — would require extensive custom CSS capability
