# Make Settings and Plugins sidebars jump to sections, and move Manage Vaults onto the File Browser row.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/, tests/
Dev: cd . && npm run tauri dev


## Problem
For the settings and plugin settings: I DO want to be able to scroll on these. The sidebar is more like 'jump linking' to the right section in these menus (section is active, other are dimmed/disabled in the sidebar). Also, That big 'mange vaults' button is distracting. If we want that button, directly associate it with the file browser plugin [see attcd].

## In scope
THe settings and plugin settings are the focus.

## Out of scope
Do not work on any other plugins or functionality. We are focused on the settings/modals UX.

## UX / behavior
The core behavior is great. We are only enhancing navigation (UX) for finding and focusing on the settings/plugin-settings. User can scroll like before but also the sidebar menu helps get them to the right place.

## Tests
Usual tests (ts, cargo, etc).
