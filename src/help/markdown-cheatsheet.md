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

> This is a blockquote.
> It can span multiple lines.

---

## Callouts

Callouts are styled blockquotes with a type tag on the first line:

```
> [!NOTE]
> This is a note callout.

> [!WARNING] Watch out!
> You can add a custom title after the tag.
```

> [!NOTE]
> This is a note callout.

> [!WARNING] Watch out!
> You can add a custom title after the tag.

**Supported types:**

| Type | Colour |
|---|---|
| `note`, `info`, `todo` | Blue |
| `tip`, `hint`, `important` | Green |
| `warning`, `caution`, `attention` | Yellow |
| `danger`, `error`, `failure`, `bug` | Red |
| `success`, `check`, `done` | Green |
| `question`, `help`, `faq` | Purple |
| `example` | Purple |
| `quote`, `cite` | Grey |
| `abstract`, `summary`, `tldr` | Light blue |

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

```javascript
// Keywords, strings, numbers, functions, comments
function greet(name) {
  const count = 42;
  if (count > 0) {
    return `Hello, ${name}! Count: ${count}`;
  }
  return null;
}
```

```python
# Python: types, built-ins, decorators
def greet(name: str) -> str:
    count = 42
    if count > 0:
        return f"Hello, {name}! Count: {count}"
    return None
```

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

## Table Formulas

Cells starting with `=` are evaluated as formulas in live preview. The raw formula is shown when your cursor is on that row.

**Cell references** use column letters (A, B, C…) and row numbers starting at 1 (header row excluded):

| Item   | Qty | Price | Total     |
|--------|-----|-------|-----------|
| Apple  | 3   | 1.50  | =B1*C1    |
| Banana | 5   | 0.75  | =B2*C2    |
| **Total** |  |       | =SUM(D1:D2) |

**Supported functions:** `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `ROUND`, `ABS`, `IF`

```
=SUM(A1:A4)          sum of A1 through A4
=AVG(B1:B3)          average
=ROUND(A1/B1, 2)     divide and round to 2 decimal places
=IF(A1>10, 1, 0)     conditional (numeric comparisons only)
```

**Input tip:** commas in numbers are accepted — `1,000` is treated as `1000`.

**Output modifiers** are appended with `-` after the formula:

| Modifier | Example | Result |
|---|---|---|
| `-CommaFormat` | `=SUM(A1:A3)-CommaFormat` | `1,234,567` |
| `-MoneyFormat` | `=A1*B1-MoneyFormat` | `$1,234.56` |
| `-AccountFormat` | `=A1-AccountFormat` | `$1,234.56` or `$(1,234.56)` for negatives |
| `-PercentFormat` | `=A1/B1-PercentFormat` | `75%` |
| `-IntFormat` | `=A1/B1-IntFormat` | `3` (truncates decimals) |

Modifiers can be chained: `=A1/B1-IntFormat-PercentFormat` → `33%`.

**Error tokens:** `#ERR` (parse error), `#REF` (invalid cell), `#DIV/0` (division by zero), `#CIRC` (circular reference), `#VALUE` (non-numeric cell in arithmetic), `#NAME` (unknown modifier).

---

## Horizontal Rule

Three dashes on their own line:

```
---
```

---

## Math

**Inline math:** `$E = mc^2$`

$E = mc^2$

**Block math:**
```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

> Enable the **Math** plugin to render equations using KaTeX.

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
