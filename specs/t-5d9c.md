# Grey out side mini-bar icons when their panel is hidden

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev


## Problem
I want to add a small feature - in the mini bar on the sides of the app that have the icons. Clicking an icon works to show/hide the panel - the icon should match the show/hide with an 'enabled/disabled' state. Just grey it out on disabled.

## In scope
A simple state addition to the button so the user has more immediate feedback on what panels are showing.

## Out of scope
Do not touch any other plugins or app functionalities.

## UX / behavior
Same exact behavior except for the state change on the buttons that show/hide panels.

## Tests
Do all the usual tests (cargo, typescript, etc). Add a visual test to be sure the show/hide panels states are working. I will also test it myself once it's done, just say 'done'.