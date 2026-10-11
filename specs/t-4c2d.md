# Make the diary month calendar open that day’s note and drop the duplicate calendar.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev


## Problem
Make the diary month calendar open that day’s note. Drop the duplicate calendar that does not open notes. Stop for a check-in when this phase is done.

**Diary.** [calendar.plugin.ts](markable/src/plugins/calendar/calendar.plugin.ts) is a month grid that does not open notes. Daily Note already does. The diary calendar should open that day’s note. Do not keep two calendars.

Daily notes, including a month calendar that opens the note, already live in the diary pack. We also want to be able to toggle to a view of the calendar that look more like a git commit heatmap.

## In scope
We want a full diary or daily note experience. We want it to be able to have sections/categories/tags but mainly viewable as a calendar/timeline so the user can make and track habits. Each entry is a .md file - typical sorting, filtering and searchable. Again mimic other habit tracking UI patterns but mostly be influenced by the Obsidian plugins. 

## Out of scope
Do not touch the core functionality of the app or other plugins.

## UX / behavior
The user wants to be able to not only put in a diary or daily note but track their progress on daily rituals and habits. We can track any type of timed habit and provide a dashboard of result centered around a calendar, git heatmap, or timeline view in the sidebar. 

## Tests
All the usual tests after each code progression - make sure the app compiles.
