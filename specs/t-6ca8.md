# List every tag and how many notes use it.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev


## Problem
Obsidian core plugin Tags view is on in this vault. Settings line: "Show a list of all tags and their number of occurrences." Markable can rename and merge tags inside File Properties. It does not have this occurrence list. I think our 'Tag Wrangler' might cover this functionality. LMk if we need to consolidate this functionality for better UX.

## In scope
Any functions that work with our metadata, categories and tags especially.

## Out of scope
Do not work with any functions that do not edit metadata.

## UX / behavior
We want seamless UX across categories and tags. 

## Tests
Run all the usual tests (ts, cargo, etc.)
