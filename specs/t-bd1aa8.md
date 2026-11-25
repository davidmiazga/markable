---
title: Give links a readable color in every theme and open them on click
status: Ready
priority: P1
assignee: dave
writes: "src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/"
order: 1
reason: "t-bd1aa8 refused: main checkout has dirty files inside writes. Commit, stash, or finish that work before claiming a worktree. scripts/tauri-flavor.mjs, src-tauri/src/lib.rs, src/main.ts, src/plugins/kanban/kanban.plugin.ts, src/tabs/tab-manager.ts"
unread: no
---

# Give links a readable color in every theme and open them on click

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/
Dev: cd . && npm run tauri dev

Fill every heading below. Replace the HTML comments. Do not leave TODO/TBD.
One-off questions can stay in chat. This file is for a software implementation.

## Problem
Links need a default color that is viewable in all of our themes. A click should cleanly open the link. The click should not edit the line or switch a view.

Today `--link-color` is the link color. The built-in dark theme uses a mid blue, and the shipped themes each set their own. A click on a wiki link can open the note, but a click on a markdown link or a bare URL still lands in the editor: the line becomes editable and view mode drops away.

## In scope
- A default link color that stays readable on the built-in light theme, the built-in dark theme, and the shipped themes (Dracula, Monokai, Nord, Solarized light, Solarized dark).
- A click on a markdown link, a bare URL, or a wiki link in the note opens that link.
- That click does not put the line into edit and does not switch the view.

## Out of scope
- The five feature cards (page edge, sync, Excalidraw, slides, Office files).
- New link kinds, a new browser, or a change to the HTML tab bridge.
- Recoloring a theme beyond the link color.

## UX / behavior
The link color is visible against the note background in every theme above. If a theme sets its own link color, that color is used when it stays readable. Otherwise the default is used.

Clicking a link opens it and leaves the note as it was. An http or https link opens in the system browser. A link to a note opens that note. `javascript:` and `file:` links do nothing. The click does not place the cursor in the source line and does not leave view mode or flip between preview and edit.

A link whose target cannot be opened stays on the same line, in the same view, with no edit.

## Tests
- The built-in light and dark link colors are distinguishable from that theme's note background and from its body text.
- Each shipped theme's link color is distinguishable from that theme's note background.
- A click on a rendered markdown link, a bare URL, and a wiki link opens the target.
- That click does not select the source line for editing and does not change the editor view.

Priority: P1
Milestone: -
Owner: dave
Kind: task
Parent: -

## History
Moved from Ready to Claimed.
