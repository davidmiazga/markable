---
title: "Folder View — Enhancement Backlog"
last-updated: "2026-05-10"
review-cadence-days: 14
status: active
---

# Folder View — Enhancement Backlog

Items are removed from this list as they are implemented. Effort: S = small (hours), M = medium (day).

Follow the developer procedure in `reference.md` for each item.

---

| ID | Enhancement | YAML / mechanism | Description | Effort |
|---|---|---|---|---|
| FVB-02 | Extra YAML field on card | `show-field: status` | Pull a named front-matter value from the vault index and display it as a small badge on each file card. | S |
| FVB-03 | Cover / hero banner | `cover: image.png` | Full-width image banner at the top of the folder view (above the description body). `cover:` points to a path relative to the folder; if absent, auto-selects the first image found in the folder. | M |
| FVB-10 | Per-note cover image | _(reads `cover:` from individual note front matter)_ | If a `.md` file in the grid has `cover: image.png` in its own front matter, use that image as the card preview instead of the text excerpt. | M |
| FVB-11 | List layout | `layout: folder-list` | A second registered layout: compact single-row cards (name + date, no preview rectangle). Registered in `LAYOUT_RENDERERS` in `tab.ts`. | M |

---

## Completed (removed from active tracking)

FVB-01, FVB-04, FVB-05, FVB-06, FVB-07, FVB-08, FVB-09 — implemented in session 14.
