---
title: "Let a card optionally show Cursor's working pattern"
status: Done
priority: P2
assignee: dave
writes: "src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/"
claimed-by: dave
claim-lease: "2026-11-26T03:57:41+00:00"
order: 1
unread: no
---

# Let a card optionally show Cursor's working pattern
Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/
Dev: cd . && npm run tauri dev
## Problem
I really like that animating dot pattern you have in the cursor chat interface to indicate something is happening. Hopefully something like that can be added to our kanban so I know an agent is working? It is a grid of small dots and it’s kinda random. If needed we can have it change somehow to indicate a status - have a % for progress if that makes sense.
## In scope
- A card note can optionally set `working: yes`. The card then shows a grid of small dots that light up in a random-looking pattern, the same kind of motion Cursor uses while an agent is working.
- The lane does not matter. Any card with `working: yes` shows the pattern.
- `working: no`, or no `working` line, leaves the card plain.
## Out of scope
- Deciding that an agent is working. Markable-Project does not start agents and does not infer this from the lane.
- dm-software-machine setting `working` when an AI is on a ticket. That uses this feature afterward.
- Other card details, lanes, and colors.
- The link color and click ticket.
## UX / behavior
The pattern sits on the card. Something working on that card, including an agent in a user's own workflow, turns it on by writing `working: yes`. The kanban only draws it.
## Tests
- A card with `working: yes` shows the grid, in any lane.
- A card with `working: no`, or without the line, does not show the pattern.
- Two cards in the same lane can differ: one shows the pattern and the other does not.
Priority: P2
Milestone: -
Owner: dave
Kind: task
Parent: -

## History
Moved from Ready to Claimed.

Moved from Review to Done.
