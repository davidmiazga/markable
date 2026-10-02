# Wrangler: tag pages as a note aliased to a tag

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev

## Problem
Finish the items left in markable/planning/PROPERTIES_WRANGLER.md

Later: Tag pages (a note aliased to a tag)

A tag is only a label on notes. There is no note that stands for the tag itself.

## In scope
From a tag in Manage, open its tag page. That page is a normal markdown note whose front matter `aliases` includes the tag name. If no such note exists, create `Tags/{tag}.md` with that alias and open it. If one already exists, open that note and do not create a second one.

## Out of scope
Categories do not get pages. Search, rename, merge, and the inline `#tag` menu are unchanged. This does not add a new sidebar or a generated index of every tag.

## UX / behavior
Right-clicking a tag in Manage includes "Open tag page" beside the existing search actions. Choosing it opens the aliased note in a tab. The new note's body can be empty. Its front matter has `aliases` set to the tag name. A missing `Tags` folder is created with the note. If the tag name is not a safe file name, show an error and do not write a file.

## Tests
Run the usual cargo and vite checks. Assert that opening a tag page creates `Tags/{tag}.md` with the alias when none exists, and that a second open finds the existing note instead of creating another. Assert that an unsafe tag name does not write a file.
