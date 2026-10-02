# Plugins panel sections

Panel grouping for the Plugins list. Packs remain first-run CX, not capability limits: every flavor can still enable every plugin.

Source of truth for membership: [`flavors/packs.json`](../flavors/packs.json). A pack may list a plugin and still leave it **default off** (`defaultOff`). The panel reads that catalog plus the active flavor’s `enabledPacks`.

## Sections

Same seven sections in every flavor. Pack ids are the section ids.

| Section | Pack id | Plugins | Default off |
|---|---|---|---|
| Base editing | `base` | markdown-toolbar, command-bar, typing-assist, auto-save, auto-title, insert-count, templates, word-count, diagrams, math, focus-mode, typewriter-mode | templates, word-count, diagrams, math, focus-mode, typewriter-mode |
| PKM | `pkm` | file-browser, backlinks, knowledge-graph, yaml-pane, media-preview, outline-panel | |
| Project | `project` | kanban | |
| Quick note | `quicknote` | sync | |
| Diary | `diary` | daily-note, calendar | |
| Book | `book` | auto-toc | |
| User Plugins | `user` | user IIFEs (unchanged; Reload stays here) | |

Host modules stay non-togglable and do not appear in this list.

A core IIFE that is not listed in any pack still renders: it is appended to Base so it cannot disappear from the panel.

First-run enablement is **not** “every plugin in an enabled pack.” A plugin starts on only when its pack is in the flavor’s `enabledPacks` **and** it is not in that pack’s `defaultOff`.

## Order per flavor

That flavor’s `enabledPacks` first, then the other packs in catalog order, then User.

| Flavor | Section order |
|---|---|
| Markable | Base → PKM → Project → Quick note → Diary → Book → User |
| Re-markable | Base → PKM → Project → Quick note → Diary → Book → User |
| Markable PKM | Base → PKM → Project → Quick note → Diary → Book → User |
| Markable-Project | Base → Project → PKM → Quick note → Diary → Book → User |
| Markable-QuickNote | Base → Quick note → PKM → Project → Diary → Book → User |
| Markable-Diary | Base → Diary → PKM → Project → Quick note → Book → User |
| Markable Book | Base → Book → PKM → Project → Quick note → Diary → User |

First-run pack sections start **open**. Every other pack section, and User, starts **collapsed**. Collapse is session-only.

## Section preset (Off / Default / All)

Each pack header uses a three-segment control (not User). Reload stays on User only.

| Preset | Meaning |
|---|---|
| Off | Every loaded plugin in the section off |
| Default | Each plugin returns to its first-run default (pack enabled + not `defaultOff`) |
| All | Every loaded plugin in the section on |

The active segment is the preset that matches the current rows. Priority if two presets coincide: Off, then All, then Default. A custom mix highlights none.

## Plugin moves

| Plugin | From | To | First-run |
|---|---|---|---|
| templates | Quick note | Base | off |
| auto-title | Quick note | Base | on |
| insert-count | Quick note | Base | on |
| word-count | Base (mid-list, default on) | Base, after templates | off |
| diagrams | Added | Base | off |
| math | Added | Base | off |
| focus-mode | Added | Base | off |
| typewriter-mode | Added | Base | off |
| auto-toc | Added | Book | on when the flavor includes `book` |

The `added` pack is gone. Markable Book (`flavors/book.json`) is `base` + `book`.

The vocabulary editor lives in File Properties as the Edit tags section. See [`PROPERTIES_WRANGLER.md`](PROPERTIES_WRANGLER.md).
