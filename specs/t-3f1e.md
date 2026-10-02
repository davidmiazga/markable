# Wrangler: search include and exclude the current tag

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev


## Problem
We want a shortcut from a tag into search. It is not part of Manage, rename, or merge.

In Obsidian Tag Wrangler, right-clicking a tag (or category) should offer two search actions. One opens search already filled with tag:#recipe, meaning notes that have that tag. The other adds -tag:#recipe, meaning notes that do not. This ticket describes that idea, pointed at Markable’s command bar or find.

Markable does not have that query language today. The command bar’s tag mode lists tag names and filters them as you type. Find in the file browser filters the file tree by text. Smart folders can already say a tag “is” or “is not” a value, which is a saved rule, not a one-click search from the Manage list.


## In scope
From a tag in Manage, start a search for notes that include that tag, and a second action for notes that exclude it. That means teaching search to understand tag: and -tag: and adding those two actions on the tag row.

## Out of scope
We are not changing any other plugins.

## UX / behavior
Right-clicking a tag should offer two search actions.

## Tests
Run all normal cargo and vite tests. Also make sure the feature works as intended by running the trigger of the right click on the tag/cat and test the query itself. Also test that the results actually are what was intended.