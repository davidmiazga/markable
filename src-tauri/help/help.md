# Markable Help

---

## Keyboard Shortcuts

### File

| Action | Shortcut |
|---|---|
| New | Cmd-N |
| Open | Cmd-O |
| Import (.md / .txt) | Cmd-Opt-I |
| Save | Cmd-S |
| Save As | Cmd-Shift-S |
| Export as HTML | Cmd-Opt-E |
| Close | Cmd-W |
| Close All | Cmd-Shift-W |

### Edit

| Action | Shortcut |
|---|---|
| Undo | Cmd-Z |
| Redo | Cmd-Shift-Z |
| Cut | Cmd-X |
| Copy | Cmd-C |
| Paste | Cmd-V |
| Paste without formatting | Cmd-Opt-V |
| Paste link over selection | Cmd-K |
| Copy as plain text | Cmd-Opt-T |
| Copy as HTML | Cmd-Opt-C |
| Select All | Cmd-A |
| Find | Cmd-F |
| Find and Replace | Cmd-Opt-F |
| Move line up | Opt-↑ |
| Move line down | Opt-↓ |

### Format

| Action | Shortcut |
|---|---|
| Heading 1 – 6 | Cmd-1 through Cmd-6 |
| Bold | Cmd-B |
| Italic | Cmd-I |
| Underline | Cmd-U |
| Strikethrough | Cmd-Shift-X |
| Highlight | Cmd-Shift-H |
| Superscript | Cmd-Shift-6 |
| Subscript | Cmd-Shift-9 |
| Inline math ($…$) | Cmd-Shift-M |
| Bullet list | Opt-. |
| Ordered list | Opt-O |
| Task list | Opt-X |
| Blockquote | Opt-Q |
| Code fence | Opt-C |
| Horizontal rule | Opt-/ |
| Insert image | Cmd-Shift-I |
| Insert table | Cmd-Shift-T |
| Front matter | Cmd-Shift-Y |
| Indent | Cmd-] |
| Outdent | Cmd-[ |
| Clear formatting | Cmd-. |

### View

| Action | Shortcut |
|---|---|
| Zoom in | Cmd-= |
| Zoom out | Cmd-- |
| Next theme | Ctrl-Shift-↓ |
| Previous theme | Ctrl-Shift-↑ |
| Settings | Cmd-, |

---

## Custom Themes

Markable supports hot-swappable CSS themes. Themes live in:

```
~/Library/Application Support/com.markable.app/themes/
```

Any `.css` file you place there appears automatically in the **Theme** menu. Two sample themes are included: `nord.css` and `solarized-dark.css` — copy one as a starting point.

### CSS Variables

Your theme file overrides these CSS custom properties:

| Variable | Controls |
|---|---|
| `--bg-primary` | Editor and window background |
| `--text-primary` | Body text |
| `--text-secondary` | Dimmed text (front matter, blockquotes) |
| `--cursor-color` | Blinking cursor |
| `--heading-color` | All heading levels |
| `--link-color` | Inline links |
| `--blockquote-color` | Blockquote text |
| `--blockquote-border` | Blockquote left-border accent |
| `--code-bg` | Inline code and code fence background |
| `--code-text` | Code text color |
| `--hr-color` | Horizontal rule color |

### Walkthrough: Creating a Rose Theme

1. Open Finder → Go → Go to Folder → paste `~/Library/Application Support/com.markable.app/themes/`
2. Create a new file named `rose.css`
3. Paste the following:

```css
/* Rose — a warm light theme */
:root {
  --bg-primary:        hsl(10, 30%, 97%);
  --text-primary:      hsl(10, 20%, 18%);
  --text-secondary:    hsl(10, 10%, 45%);
  --cursor-color:      hsl(350, 60%, 45%);
  --heading-color:     hsl(350, 50%, 35%);
  --link-color:        hsl(350, 70%, 45%);
  --blockquote-color:  hsl(10, 15%, 45%);
  --blockquote-border: hsl(350, 40%, 75%);
  --code-bg:           hsla(350, 30%, 70%, 0.15);
  --code-text:         hsl(10, 20%, 18%);
  --hr-color:          hsl(350, 30%, 85%);
}
```

4. Switch to the **Theme** menu — `rose` appears at the bottom of the list. Click it to apply instantly.
5. Tweak the hue values and save to see changes live (Markable reloads on focus).

> **Tip:** Custom themes build on the dark base layer. For a light theme, override `--bg-primary` with a light color and adjust `--text-primary` to a dark value as shown above.

---

## Settings File

Settings are stored at:

```
~/Library/Application Support/com.markable.app/settings.json
```

You can hand-edit this file, but Markable will overwrite unknown keys on next save. Stick to settings you see in the **Settings** panel (Cmd-,).

---

## Uninstalling

To remove all Markable data after deleting the app:

```
rm -rf ~/Library/Application\ Support/com.markable.app/
```

---

*See Help → Markdown Cheatsheet for a syntax reference.*
