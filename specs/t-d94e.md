# Add bookmarks for files, searches, and headings.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev

## Problem
Obsidian core plugin Bookmarks is on in this vault. Settings line: "Save shortcuts to files, searches, headings, and graphs." Markable has no bookmarks. Do not start until diary ticket t-4c2d is accepted.

## In scope
Make sure we have ways to mark and pin items in the 'File Browser'. Bookmarks should open files and pins can take you to a specific point (like an anchor link). Report back if a preview on Ctrl/Cmd hover can be added here too (see t-d731). Also see if color-coding and some other UX features can be added easily.

## Out of scope
Do not change other core features of the app. We are focused on bookmarks and pin sections which I believe already exist.

## UX / behavior
Use can easily bookmark, pin, and preview frequently used files. Visually marking these links for easy reference is the enhancement requested as well. Organization and other features can be added for even better UX. Please suggest them before starting.

## Tests
Do all the usual tests (typescript, cargo, etc.). Visually confirm the added features work as intended and do not cause other issues in the app. Do not assume the code works, get evidence.