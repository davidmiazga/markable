# Plugin review against pack claims

Check-in for t-f988. This is the list of what is wrong. Fixes wait until David says to continue.

Compared each built plugin’s export (`name`, `description`, `detail`, `onEnable`) with [`flavors/packs.json`](../flavors/packs.json) and the app claims in [`SeparateApp-CXrequirements-v1.0.md`](SeparateApp-CXrequirements-v1.0.md). Not a click-through of every panel.

## Wrong

1. **PKM’s library claim is wider than Media Preview.** The PKM app is described as library and resource management for text, PDF, books, video, and files. `media-preview.plugin.ts` renders `![alt](url)` images in live preview. PDF, book, and video preview are not in that plugin.

2. **Quick note claims to-dos. The pack does not.** The QuickNote app line says fast notes and to-dos. The quicknote pack’s only plugin is `sync`. That plugin’s detail matches its own claim: it stores a service name and does not transfer files. Nothing in the pack is a to-do list.

3. **Book and PKM both ship a heading sidebar.** Book’s claim is TOC-first via `auto-toc`: a heading list, the active heading highlighted, click to jump. PKM’s `outline-panel` is also a live heading tree with click to jump, plus section folding. Two panels do the same job.

4. **`just diary` does not refresh plugins. `just remarkable` does.** `justfile` runs `npm run dev:plugins` only for `remarkable`. Diary, Project, PKM, QuickNote, and Book launch the app with whatever is already in Application Support.

## Matches the claim

Base editing plugins match their own descriptions: Markdown Toolbar, File Browser, Command Bar, Typing Assist, Auto-Save, Auto Title, Insert Count, Templates, Word Count, Mermaid Diagrams, Math, Focus Mode, Typewriter Mode. First-run on/off for that pack matches `packs.json` (`templates`, `word-count`, `diagrams`, `math`, `focus-mode`, `typewriter-mode` start off).

Backlinks tracks wiki-links, lists backlinks and outgoing links, and shows a hover preview on a wiki-link. Knowledge Graph, File Properties, and Outline Panel match their descriptions. Daily Note opens a date-stamped note and owns the month calendar, heatmap, and dashboard. Sync matches the placeholder claim. Auto TOC matches the Book TOC-first claim. The status bar is a host module, as the CX doc says, and is not an IIFE.

The Project app line says Kanban opens a folder of notes as lanes in the editor. Calendar stays in the diary pack (`defaultOff`) and does not draw its own grid: turning it on enables Daily Note and reveals Daily Note’s calendar panel; turning Daily Note off turns Calendar off. Tag wrangling lives inside File Properties. There is no Properties Wrangler toggle. The dependency map is `calendar` → `daily-note`. Outline and auto-toc are not linked.
