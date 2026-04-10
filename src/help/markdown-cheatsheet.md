# Markdown Cheatsheet

---

## Headings

```
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

---

## Emphasis

| Syntax | Result |
|---|---|
| `**bold**` or `__bold__` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `__underline__` | underline |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `==highlight==` | ==highlight== |
| `^superscript^` | ^superscript^ |
| `~subscript~` | ~subscript~ |

---

## Links & Images

```markdown
[link text](https://example.com)
![alt text](image.png)
```

Use **Cmd-K** to paste a copied URL as a link over selected text.

---

## Lists

**Bullet list:**
```
- Item one
- Item two
  - Nested item
```

**Ordered list:**
```
1. First
2. Second
3. Third
```

**Task list:**
```
- [ ] Unchecked
- [x] Checked
```

---

## Blockquotes

```
> This is a blockquote.
> It can span multiple lines.
```

---

## Code

**Inline code:** wrap with backticks `` `code` ``

**Code fence:**
~~~
```javascript
const greeting = "Hello, Markable!";
console.log(greeting);
```
~~~

Specify a language after the opening fence for syntax context.

---

## Tables

```
| Column A | Column B | Column C |
|---|---|---|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

| Column A | Column B | Column C |
|---|---|---|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

---

## Horizontal Rule

Three dashes on their own line:

```
---
```

---

## Math

**Inline math:** `$E = mc^2$`

**Block math:**
```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

> Math is inserted as syntax only in Phase 1 — rendering requires a future plugin.

---

## YAML Front Matter

```
---
title: My Document
date: 2026-04-10
tags: [notes, draft]
---

Document body starts here.
```

The front matter block collapses when your cursor moves outside it. Press **Cmd-Shift-Y** to insert or jump into it.

---

## Escaping

Prefix any Markdown character with `\` to display it literally:

```
\*not italic\*
\# not a heading
```
