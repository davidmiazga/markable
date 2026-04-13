# Step 03 — Build, Deploy, and Verify

**Deliverables:** None (no new source files). This step deploys the compiled plugin to the app's plugin directory and performs visual verification of all functional requirements and edge cases.

**Prerequisite:** step_01 and step_02 both complete and passing.

**Verified complete when:** All items in the visual verification checklist below are checked off and signed off by the user.

---

## Build

```bash
# From the project root
npm run build:plugins
```

Expected output:
```
Building focus-mode.js ...
  -> focus-mode.js done
Building typewriter-mode.js ...
  -> typewriter-mode.js done
Building word-count.js ...
  -> word-count.js done
Building status-bar.js ...
  -> status-bar.js done
Building auto-toc.js ...
  -> auto-toc.js done

[build-plugins] All 5 core plugins built successfully.
```

If `auto-toc.js` is not listed or the script exits non-zero, fix compilation errors before proceeding.

---

## Deploy

Copy the compiled plugin to the app's plugin directory:

```bash
cp src-tauri/plugins/core/auto-toc.js \
  ~/Library/Application\ Support/com.markable.app/plugins/core/auto-toc.js
```

Verify it is present:

```bash
ls ~/Library/Application\ Support/com.markable.app/plugins/core/
```

Expected: `auto-toc.js` appears alongside `focus-mode.js`, `word-count.js`, etc.

Note: During Tauri `dev` mode the plugins are served from `src-tauri/plugins/core/` directly (via the Tauri resource bundle). For a production build (`cargo tauri build`), the `tauri.conf.json` `bundle.resources` glob `"plugins/core/*"` includes `auto-toc.js` automatically — no `tauri.conf.json` change is needed.

---

## Run the app

```bash
npm run tauri dev
```

---

## Visual Verification Checklist

Work through the following items in order. The app must be running.

### Plugin registration

- [ ] Open the Plugins panel (Cmd-Shift-P). "Auto TOC" appears in the list with the description "Table of contents sidebar".
- [ ] Click "Auto TOC" to open the detail view. The detail text reads: "Displays a real-time table of contents in a right-side sidebar, listing all headings in the document. The active heading is highlighted as you move the cursor through the document. Click any heading to jump to it instantly."

### FR-3 / FR-5 — Sidebar DOM and layout

- [ ] Toggle "Auto TOC" ON. A 220 px sidebar appears on the right side of the editor. The editor shrinks to fill remaining space. The sidebar has a left border and a slightly different background from the editor.
- [ ] Toggle "Auto TOC" OFF. The sidebar disappears. The editor returns to full width. No visible artifacts remain.
- [ ] Toggle ON and OFF two more times (three full cycles). No duplicate sidebars, no CSS duplication, no visible glitches.

### FR-9 / EC-1 / EC-2 — Empty state

- [ ] With the plugin ON and the editor empty, the sidebar shows "No headings" centered in muted text.
- [ ] Type plain text (no headings). The sidebar continues to show "No headings".

### FR-4 / FR-6 — Heading detection and rendering

- [ ] Type `# H1 heading`. After ~150 ms, the TOC updates to show "H1 heading" with no indent.
- [ ] Add `## H2 heading` on a new line. The TOC shows both items; "H2 heading" is indented 12 px more than "H1 heading".
- [ ] Add `### H3 heading`, `#### H4 heading`, `##### H5 heading`, `###### H6 heading`. All six levels appear with progressively increasing indent (12 px per level).
- [ ] Type `####### Not a heading`. This line does NOT appear in the TOC (7 hashes excluded).
- [ ] Type `#NoSpace`. This line does NOT appear in the TOC (no space after hash).

### EC-6 — Empty heading text

- [ ] Type `# ` (hash + space, nothing more). The TOC shows a blank-height item at the H1 position (not skipped). Clicking it jumps the cursor to that line.

### EC-7 — Inline Markdown in heading text

- [ ] Type `## **Bold** title`. The TOC shows `**Bold** title` verbatim (no rendering, no crash).

### FR-7 / EC-3 — Active heading highlight

- [ ] Place the cursor above the first heading. No TOC item is highlighted.
- [ ] Move the cursor into the H1 section (between H1 and H2). "H1 heading" is highlighted with a left accent border and subtle background.
- [ ] Move the cursor into the H2 section. "H2 heading" becomes active; H1 is no longer highlighted.
- [ ] Move the cursor to the last line of the document (below all headings). The last heading remains active (it is still the last heading before the cursor).

### FR-8 — Click-to-jump

- [ ] Scroll to the middle of a long document. Click the first heading in the TOC. The editor scrolls so that heading line is centered and the cursor moves to that line.
- [ ] Click a heading near the end of the document. Editor scrolls and cursor moves correctly.
- [ ] EC-22: Click the heading on line 1 (very top). Jump works; editor does not over-scroll.
- [ ] EC-23: Click a heading on the last line. Jump works; editor does not over-scroll.
- [ ] After clicking a TOC item, the editor is focused (you can immediately start typing without clicking the editor first).

### EC-8 — Duplicate heading text

- [ ] Create two headings with the same text (`# Same` on line 1, `# Same` on line 10). Both appear as separate entries in the TOC. Clicking the first jumps to line 1; clicking the second jumps to line 10.

### EC-9 — 200+ headings

- [ ] Paste a document with 201 `# Heading N` lines. The TOC renders all 201 items. The list scrolls. No visible lag or crash.

### EC-13 / EC-14 / EC-15 — Real-time updates

- [ ] Type a new `# New Top` heading above existing headings. Within ~150 ms it appears at the top of the TOC.
- [ ] Delete a heading line. Within ~150 ms that item disappears from the TOC.
- [ ] Rename a heading while the cursor is on it. Within ~150 ms the TOC item text updates.

### EC-16 — Window resize

- [ ] Resize the app window. The sidebar stays 220 px wide. The editor grows/shrinks to fill remaining space.

### EC-17 — Content width

- [ ] Open Settings and change Content Width to a narrow value (e.g. 400 px). The editor content respects its max-width within the narrower `#editor` flex cell. The sidebar is unaffected.

### EC-18 — Zoom

- [ ] Use Cmd+= to zoom in several steps. The sidebar font size does not change (it is independent of zoom). The editor zooms as expected.

### EC-19 / EC-20 — Theme compatibility

- [ ] Switch to dark mode. The sidebar background, text, border, and active-item accent all update correctly via CSS variables.
- [ ] Load a custom CSS theme. The sidebar adopts the theme's CSS variable values.

### EC-21 — Status bar coexistence

- [ ] Enable the Word Count plugin. The status bar is visible below the editor. With the Auto TOC sidebar also enabled, the status bar spans full width below both the editor and the sidebar (not clipped by the sidebar).

### EC-25 — Code fence exclusion

- [ ] In the editor, type:
  ```
  # Real heading
  ```
  # Fake heading inside fence
  ```
  # Another real heading
  ```
  The TOC shows "Real heading" and "Another real heading" only. "Fake heading inside fence" does not appear.

### EC-26 — View Mode

- [ ] Enable View Mode (Cmd-Shift-D). The editor enters preview mode. Click a heading in the TOC. The cursor moves to the correct line and the editor scrolls.

### EC-27 / EC-28 — File open and close

- [ ] With the plugin ON, open a different `.md` file (File > Open or drag-and-drop). The TOC rebuilds immediately to reflect the new document's headings.
- [ ] Close the document (File > Close). The TOC clears to "No headings".

### EC-11 / EC-12 — Toggle cycles

- [ ] Toggle the plugin OFF then ON three times rapidly. Open DevTools (right-click > Inspect). In the Elements panel, confirm there is exactly one `<style id="__markable_auto_toc_css__">` tag. Confirm there is exactly one `#toc-sidebar` element. Confirm there is exactly one `.toc-editor-row` wrapper.

### EC-24 — First run (no settings file)

- [ ] Delete `~/Library/Application Support/com.markable.app/plugins/auto-toc/settings.json` if it exists. Restart the app. Enable the plugin. It enables without error (check DevTools Console for warnings).

---

## Post-verification

Once all items above are checked:

1. Mark all three steps in `00_index.md` as complete (change `[ ]` to `[x]`).
2. Update `MEMORY.md` (or ask the Requirements Analyst to update it): set "Auto TOC" in the Feature Checkpoint 2 table from "—" to "DONE (Phase 1)".
3. Activate `@code-reviewer` for the final audit.
