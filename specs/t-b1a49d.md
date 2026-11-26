---
title: Show an animating dot on a kanban card while an agent is working
status: Ready
priority: P2
assignee: dave
writes: "src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/"
order: 6
---

# Show an animating dot on a kanban card while an agent is working

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: src/, src-tauri/src/, index.html/, flavors/, scripts/, src-tauri/tauri.conf.json/, planning/, tests/
Dev: cd . && npm run tauri dev

## Problem
I really like that animating dot pattern you have in the cursor chat interface to indicate something is happening. Hopefully something like that can be added to our kanban so I know an agent is working? Darn, that means our port to /dm-software-machine will need updating. But updates are to be expected.

## In scope
- A kanban card shows an animating dot while an agent is working on that ticket, so the board shows that something is happening.
- The project tracker that dm-software-machine opens shows the same dot, and the machine records that an agent is working so the card can show it.

## Out of scope
- Other card details, lanes, and colors.
- The link color and click ticket.

## UX / behavior
The dot uses the same kind of motion as the Cursor chat indicator that something is happening. It sits on the card on the board. It shows while an agent is working on that ticket. It is absent when no agent is working on that ticket.

## Tests
- A card with an agent working shows the animating dot.
- A card with no agent working does not show the dot.
- The project tracker opened by dm-software-machine shows that same dot.

Priority: P2
Milestone: -
Owner: dave
Kind: task
Parent: -
