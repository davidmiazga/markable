# Wrangler: rename a tag and rewrite notes

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev

## Problem

Adopt next: Rename a tag (and slash-nested subtags), rewriting front-matter tags: and inline #tags. 

## In scope
Finish the rename feature where a category/tag is renamed when near-duplicates are found. After a script runs to do the rename, want to see all .md files with an edited name update across the vault. We want this script to be accurate and fast when running across an entire vault of files.


## Out of scope
Do not change the core behavior of drag and drop tag ordering and renaming within the interface. That is complete. Do not do the 'merge onto an existing name' feature yet.

## UX / behavior
User can see category/tags in the vault. Upon clicking edit, they can change the name of the category or tag. They then are provided a 'Cancel' or 'Apply' button. Then user sees a progress of some sort. Either an error or success is the end state. Upon success a user can then go into any .md file to see the change has occured. Upon error, there is some useful information provided so the user knows what the issue is.

## Tests
We must test with series of different situations that are likely for users to change. We should include common issues where special characters are used/requested and provide error states when that occurs. We should generate a list of likely issues, then run the script several times to resolve these likely issues.
