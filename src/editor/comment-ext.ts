/**
 * Custom Lezer MarkdownExtension for %%comment%% syntax (Obsidian-style).
 *
 * Follows the same delimiter pattern as highlight-ext.ts.
 * Defines "Comment" and "CommentMark" node types.
 */

import type { MarkdownConfig } from "@lezer/markdown";

const CommentDelim = { resolve: "Comment", mark: "CommentMark" };

const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1\u2010-\u2027]/;

export const CommentExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Comment", style: {} },
    { name: "CommentMark", style: {} },
  ],
  parseInline: [
    {
      name: "Comment",
      parse(cx, next, pos) {
        if (next != 37 /* '%' */ || cx.char(pos + 1) != 37 || cx.char(pos + 2) == 37)
          return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          CommentDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter)
        );
      },
      after: "Emphasis",
    },
  ],
};
