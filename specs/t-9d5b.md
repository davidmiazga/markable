# Let bottom Settings and Plugins sections jump to the top, and add space between sections.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/, tests/
Dev: cd . && npm run tauri dev

Fill every heading below. Replace the HTML comments. Do not leave TODO/TBD.
One-off questions can stay in chat. This file is for a software implementation.

## Problem
These settings/plugin-setting panels work ok... except when you get to the bottom items. It doesn't jump to the top where a user would expect it to be. I think it is because the panel doesn't have the ability to put space at the bottom to push items up? IDK. Please address it. Also since we are doing these jump links, please put a bit of space between items so they don't get crammed so much.

## In scope
Settings/plugin-settings

## Out of scope
Do not work on anything besides settings/plugin-settings.

## UX / behavior
More space between items/sections, less crammed. Make bottom items jump to the top when sidebar button is clicked.

## Tests
Usual tests (ts, cargo, etc.)