# Restore a Markdown note from a recent local snapshot.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html, flavors/, scripts/, src-tauri/tauri.conf.json, planning/
Dev: cd . && npm run tauri dev

## Problem
Obsidian core plugin File recovery is on in this vault. Settings line: "Restore recent snapshots to recover from accidental data loss. Snapshots are only saved for Markdown files." Markable has no local history. Do not start until diary ticket t-4c2d is accepted.

## In scope
We are working on the core File Recovery method. Protect .md files from accidental deletion. 
Incorporate a user-preference to include "Are you sure?" message when deleting and/or have a trash that only deletes files after XX days.

## Out of scope
Do not change the plugins - this feature is core functionality. Do not change how actual files are saved, only how we protect items from accidental loss. We are not including the sync feature here yet (which in that case we would recommend to turn this 'off' because files are on another location).

## UX / behavior
A user has (optional) safeguards when deleting files. When a user accidentally deletes a file - they should know they can optionally get the file back. USer preferences include a section for `Data Protection`. It includes: 
- off (no file protection)
    - ask before deleting files
    - Use local trash bin
        - Keep backup file copies for XX days (or maybe hours?)
        - Keep backup file copies until app quits (or ask when app quits)

## Tests
Include the usual tests (typescript, cargo, etc). Do a series of test, mimicking different states/options of our preferences (make a test file, use the delete function and verify the 'ask before deleting'. Do this for the local trash bin as well).