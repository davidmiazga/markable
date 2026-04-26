/**
 * Custom Lezer MarkdownExtension for footnote syntax.
 *
 * Supports:
 * - Footnote references: [^1], [^note]
 * - Footnote definitions: [^1]: definition text (block-level)
 *
 * Defines "FootnoteRef", "FootnoteRefMark", "FootnoteDef", "FootnoteDefMark" node types.
 */

import type { MarkdownConfig } from "@lezer/markdown";

export const FootnoteExtension: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteRef", style: {} },
    { name: "FootnoteRefMark", style: {} },
  ],
  parseInline: [
    {
      name: "FootnoteRef",
      parse(cx, next, pos) {
        // Match [^identifier]
        if (next != 91 /* '[' */ || cx.char(pos + 1) != 94 /* '^' */) return -1;

        // Find closing ]
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch == 93 /* ']' */) break;
          // Only allow word characters, hyphens, dots in identifier
          if (ch == 32 /* space */ || ch == 10 /* newline */) return -1;
          end++;
        }
        if (end >= cx.end || cx.char(end) != 93) return -1;
        if (end == pos + 2) return -1; // empty [^]

        // Don't match [^1]: at start of line (that's a definition, handled by marked)
        if (end + 1 < cx.end && cx.char(end + 1) == 58 /* ':' */) return -1;

        cx.addElement(
          cx.elt("FootnoteRef", pos, end + 1, [
            cx.elt("FootnoteRefMark", pos, pos + 2),
            cx.elt("FootnoteRefMark", end, end + 1),
          ])
        );
        return end + 1;
      },
      after: "Emphasis",
    },
  ],
};
