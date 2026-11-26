---
title: Set the working pattern when an AI is working a ticket
status: Ready
priority: P2
assignee: dave
writes: dm-software-machine/
order: 1
unread: no
---

# Set the working pattern when an AI is working a ticket

Done means: the fast gate is green and the feature is visible in the profile dev command
Writes: dm-software-machine/
Dev: cd . && npm run tauri dev

Fill every heading below. Replace the HTML comments. Do not leave TODO/TBD.
One-off questions can stay in chat. This file is for a software implementation.

## Problem
Use the kanban working pattern directly in dm-software-machine to indicate that a ticket is being worked on by AI. Any lane can have an AI working on that status. Moving a card to Claimed starts the agents, a script verifies the work is happening and moves the card to Running, and the next script runs Review and the lanes after that.

## In scope
- When an AI is confirmed working a ticket, dm-software-machine writes `working: yes` on that note. The lane does not matter.
- The pattern stays on only while that agent is still working. A `working: yes` with no live agent is cleared.
- When the agent stops or finishes, the machine turns the pattern off and the card shows what happened: the lane it belongs in, or a reason if it stopped.
- Moving a card to Claimed starts the agents for that ticket in its work folder. A card that splits across separate files gets one agent per piece. A card that does not split gets one agent.
- A script checks that an agent is actually working, then moves the card to Running.
- When the work is finished, the next script runs Review, and the lanes after that follow.
## Out of scope
- Drawing the grid. Markable-Project already does that when `working: yes` is on the note.
- Starting an agent from Markable-Project.
## UX / behavior
The dot pattern is the live agent. It shows on a card only while that agent process is still running, in any lane. When the process stops, the pattern turns off and the card says the agent stopped. A pattern with no live process is not left on.
## Tests
- A ticket with an AI working has `working: yes` on its note, in any lane.
- A ticket with no AI working does not have the pattern turned on.
- A `working: yes` left on after the agent stops is cleared, and the card shows the lane or a reason.
- A card moved to Claimed starts an agent, and the card moves to Running only after that agent is confirmed working.
- When the work finishes, Review runs.

Priority: P2
Milestone: -
Owner: dave
Kind: task
Parent: -

## History
Moved from Ready to Claimed.
