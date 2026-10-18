# Export the open note to a PDF file.

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/
Dev: cd . && npm run tauri dev

## Problem
File → Export already offers PDF, but that choice calls the system print dialog. Save a .pdf file the same way HTML export saves a .html file.

## In scope
- File → Export, PDF, writes a `.pdf` file through a save dialog.
- The file is the same rendered note HTML export already builds (title, body, the existing minimal stylesheet).
- Suggested name comes from the open note title (filtered for special characters), with a `.pdf` extension. Untitled notes suggest `Untitled.pdf`.
- Cancel on the format sheet or the save dialog writes nothing and shows no error.
- A failed write tells the user. Success is quiet, and the open note stays the open note.
- Print (Cmd-P) stays the system print dialog. Export PDF does not call it.

## Out of scope
- Word, Office import, and any other format.
- Page-edge layout, headers, footers, and page numbers.
- Changing how HTML export looks or how Print works.
- Exporting a closed file, a folder, or more than the open note.

## UX / behavior
- Cmd-Alt-E still opens the format sheet. HTML stays the default. PDF is the other choice.
- Choosing PDF opens a save dialog filtered to PDF files, the same shape as the HTML save dialog.
- No editor open: Export does nothing.
- The sheet already open: a second Export does nothing until the first one closes.

## Tests
- Choosing PDF asks for a save path and does not call `window.print`.
- Cancelling the save dialog writes no file.
- The suggested filename ends in `.pdf`, including for an untitled note.
- A failed write surfaces an error and leaves the open note path unchanged.
- HTML export and Print still do what they do now.
