---
title: Hide or delete a card
status: Done
priority: P2
assignee: dave
writes: "src/plugins/kanban/, tests/plugins/kanban/, dm-software-machine/"
claimed-by: dave
claim-lease: "2026-11-26T05:36:29+00:00"
order: 5
unread: no
---

# Hide or delete a card
Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/plugins/kanban/, tests/plugins/kanban/, dm-software-machine/
Dev: cd . && npm run tauri dev
Fill every heading below. Replace the HTML comments. Do not leave TODO/TBD.
One-off questions can stay in chat. This file is for a software implementation.
## Problem
A card can be hidden from its lane, or deleted forever.

## In scope
- Each card has a trash icon. The open sidebar has the same trash icon. Either one deletes that note forever.
- The sidebar has a Hidden checkbox. Checking it closes the sidebar, and that card is no longer drawn in its lane.
- The lane menu has Show/hide cards. Show brings every hidden card in that lane back. Hide hides every card in that lane.
- The lane menu has Delete all. It asks once. Yes deletes every card in that lane forever. Cancel deletes none.
- A deleted machine ticket is removed from the machine, and a later board update does not write the note back.
- A hidden card stays hidden when its note is rewritten.

## Out of scope
- A trash column, or bringing a deleted card back.
- Hiding a card from the card face. Hide is the sidebar checkbox, and Show/hide cards on the lane menu.
- Deleting or hiding the column itself. A column can already be hidden or deleted, and deleting a column still keeps its cards.
- Deleting the board file.

## UX / behavior
The trash icon deletes that one card forever. Hidden is a checkbox in the sidebar. Checking it closes the sidebar and the card leaves the lane. The lane menu's Show/hide cards control is how those cards come back: Show draws them again, and Hide hides every card in the lane. Delete all asks once before it removes every card in the lane. Cancel leaves them in place.

## Tests
- Checking Hidden closes the sidebar and removes that card from the lane. Show on that lane draws it again.
- Hide on that lane hides every card in the lane. Show restores them.
- The trash icon on the card, and the trash icon in the sidebar, each remove that card's note.
- Delete all asks for confirmation. Yes removes every card in the lane. Cancel removes none.
- Deleting a machine ticket removes the note and the ticket, and a later board update does not recreate the note.
- A hidden card stays hidden when its note is rewritten.
Priority: P2
Milestone: -
Owner: dave
Kind: task
Parent: -

## History
Moved from Ready to Claimed.
The question was answered: hide means out of view, delete means gone forever. Hide all and Show all, and Delete all with a confirm, live on the lane menu.
Moved from Blocked to Ready.

Moved from Ready to Claimed.
Moved from Running to Blocked.
The question was answered: ship the trash icon on the card and in the sidebar, the Hidden checkbox in the sidebar, Show/hide cards on the lane menu, and Delete all with a confirm.
Moved from Blocked to Ready.

Moved from Ready to Claimed.
