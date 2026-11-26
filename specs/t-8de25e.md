---
title: Put the trash icon at the lower right of a card
status: Done
priority: P3
assignee: dave
writes: "src/plugins/kanban/, tests/plugins/kanban/board-view.test.ts"
claimed-by: dave
claim-lease: "2026-11-26T05:45:51+00:00"
order: 2
unread: no
---

# Put the trash icon at the lower right of a card

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/plugins/kanban/
Dev: cd . && npm run tauri dev

Fill every heading below. Replace the HTML comments. Do not leave TODO/TBD.
One-off questions can stay in chat. This file is for a software implementation.

## Problem
The trash icon on a card should sit at the lower right of the card.

## In scope
- The trash icon on a card sits at the lower right of that card.
- The trash icon in the sidebar stays in the sidebar head.

## Out of scope
- The icon drawing. It stays the Material Symbols trash can.
- Delete behavior.

## UX / behavior
On the card, the trash icon is at the lower right. In the open sidebar it stays beside the title.

## Tests
- The card head no longer holds the trash icon.
- The lower right of the card holds the trash icon.
- The kanban board tests still pass.

Priority: P3
Milestone: -
Owner: dave
Kind: task
Parent: -

## History
Moved from Review to Done.
