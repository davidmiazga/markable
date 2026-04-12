/**
 * List Engine — pure logic for advanced list marker detection and generation.
 *
 * No CM6 dependency. All functions are pure and testable with Vitest.
 *
 * Supports 4 list styles:
 * - standard:      1. 2. 3. at all depths (CommonMark)
 * - alphanumeric:  I. A. 1. a. i. (legal/academic, depth determines marker type)
 * - decimal:       1. 1.1. 1.1.1. (nested decimal outline)
 * - steps:         1. a. - (step-by-step mixed)
 */

// --- Types ---

export type ListStyle = "standard" | "alphanumeric" | "decimal" | "steps";

export type MarkerType =
  | "decimal"
  | "alpha-lower"
  | "alpha-upper"
  | "roman-lower"
  | "roman-upper"
  | "decimal-outline"
  | "bullet";

export interface ListLineInfo {
  /** Detected marker type */
  markerType: MarkerType;
  /** Nesting depth (0-based), derived from leading whitespace */
  depth: number;
  /** Ordinal value (1-based). For alpha: a=1, b=2. For roman: i=1, ii=2. */
  ordinal: number;
  /** The full marker text including trailing space, e.g. "A. " or "1.1. " */
  marker: string;
  /** Leading whitespace */
  indent: string;
  /** Content after the marker */
  content: string;
  /** For decimal-outline: the parent chain, e.g. [1, 2] for "1.2.3." */
  parentChain?: number[];
}

// --- Roman numeral helpers ---

const ROMAN_UPPER_VALUES: [string, number][] = [
  ["M", 1000], ["CM", 900], ["D", 500], ["CD", 400],
  ["C", 100], ["XC", 90], ["L", 50], ["XL", 40],
  ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1],
];

export function toRomanUpper(num: number): string {
  if (num <= 0 || num > 3999) return String(num);
  let result = "";
  for (const [letter, value] of ROMAN_UPPER_VALUES) {
    while (num >= value) {
      result += letter;
      num -= value;
    }
  }
  return result;
}

export function toRomanLower(num: number): string {
  return toRomanUpper(num).toLowerCase();
}

export function fromRoman(str: string): number {
  const upper = str.toUpperCase();
  let result = 0;
  let i = 0;
  for (const [letter, value] of ROMAN_UPPER_VALUES) {
    while (upper.startsWith(letter, i)) {
      result += value;
      i += letter.length;
    }
  }
  return result;
}

/** Check if a string is a valid Roman numeral. */
export function isRomanNumeral(str: string): boolean {
  const upper = str.toUpperCase();
  return /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(upper) && upper.length > 0;
}

// --- Alpha helpers ---

export function toAlphaLower(num: number): string {
  if (num < 1 || num > 26) return String(num);
  return String.fromCharCode(96 + num); // a=1, b=2, ...
}

export function toAlphaUpper(num: number): string {
  if (num < 1 || num > 26) return String(num);
  return String.fromCharCode(64 + num); // A=1, B=2, ...
}

export function fromAlpha(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 96; // a-z
  if (code >= 65 && code <= 90) return code - 64;   // A-Z
  return 0;
}

// --- Marker generation per type ---

export function generateMarker(type: MarkerType, ordinal: number, parentChain?: number[]): string {
  switch (type) {
    case "decimal":
      return `${ordinal}. `;
    case "alpha-lower":
      return `${toAlphaLower(ordinal)}. `;
    case "alpha-upper":
      return `${toAlphaUpper(ordinal)}. `;
    case "roman-lower":
      return `${toRomanLower(ordinal)}. `;
    case "roman-upper":
      return `${toRomanUpper(ordinal)}. `;
    case "decimal-outline": {
      const chain = parentChain ? [...parentChain, ordinal] : [ordinal];
      return `${chain.join(".")}. `;
    }
    case "bullet":
      return "- ";
  }
}

// --- Style definitions: depth → marker type ---

const STYLE_DEPTHS: Record<ListStyle, (depth: number) => MarkerType> = {
  standard: () => "decimal",
  alphanumeric: (depth) => {
    const cycle: MarkerType[] = [
      "roman-upper", "alpha-upper", "decimal", "alpha-lower", "roman-lower",
    ];
    return cycle[depth % cycle.length];
  },
  decimal: () => "decimal-outline",
  steps: (depth) => {
    if (depth === 0) return "decimal";
    if (depth === 1) return "alpha-lower";
    return "bullet";
  },
};

export function markerTypeForDepth(style: ListStyle, depth: number): MarkerType {
  return STYLE_DEPTHS[style](depth);
}

// --- Line detection ---

/** Regex patterns for each marker type. Capture groups: (indent)(marker)(content) */
const MARKER_PATTERNS: { type: MarkerType; regex: RegExp; getOrdinal: (match: RegExpMatchArray) => number; getParentChain?: (match: RegExpMatchArray) => number[] }[] = [
  {
    type: "decimal-outline",
    regex: /^(\s*)((\d+(?:\.\d+)+)\.\s)(.*)/,
    getOrdinal: (m) => {
      const parts = m[3].split(".");
      return parseInt(parts[parts.length - 1], 10);
    },
    getParentChain: (m) => {
      const parts = m[3].split(".");
      return parts.slice(0, -1).map((p) => parseInt(p, 10));
    },
  },
  {
    type: "decimal",
    regex: /^(\s*)(\d+\.\s)(.*)/,
    getOrdinal: (m) => parseInt(m[2], 10),
  },
  {
    type: "bullet",
    regex: /^(\s*)([-*+]\s)(.*)/,
    getOrdinal: () => 0,
  },
];

// Alpha and Roman are trickier — we detect them but disambiguation happens later
const ALPHA_UPPER_RE = /^(\s*)([A-Z]\.\s)(.*)/;
const ALPHA_LOWER_RE = /^(\s*)([a-z]\.\s)(.*)/;
const ROMAN_UPPER_RE = /^(\s*)((?:M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))\.\s)(.*)/;
const ROMAN_LOWER_RE = /^(\s*)((?:m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))\.\s)(.*)/;

/**
 * Detect a list marker on a line of text.
 * Returns null if the line doesn't match any list pattern.
 */
export function detectListLine(lineText: string): ListLineInfo | null {
  // Check decimal-outline first (e.g. "1.1. " must match before "1. ")
  for (const pat of MARKER_PATTERNS) {
    const m = lineText.match(pat.regex);
    if (m) {
      return {
        markerType: pat.type,
        depth: Math.floor(m[1].length / 2),
        ordinal: pat.getOrdinal(m),
        marker: m[2],
        indent: m[1],
        content: m[m.length - 1],
        parentChain: pat.getParentChain?.(m),
      };
    }
  }

  // For single-letter markers, we need to distinguish Roman from Alpha.
  // Multi-character markers (II, IV, XIV, etc.) are unambiguously Roman.
  // Single-character: only I/V/X/L/D/M are treated as Roman (I is the most
  // common outline start). Single chars like A/B/C/E/F... are alpha.
  // Lowercase: only i/v/x/l/d/m are Roman. Others (a/b/c/e/f...) are alpha.
  const ROMAN_SINGLE_UPPER = new Set(["I", "V", "X", "L", "D", "M"]);
  const ROMAN_SINGLE_LOWER = new Set(["i", "v", "x", "l", "d", "m"]);

  // Try Roman upper first (multi-char is unambiguous)
  const ru = lineText.match(ROMAN_UPPER_RE);
  if (ru) {
    const markerText = ru[2].trim().replace(/\.\s?$/, "");
    if (isRomanNumeral(markerText)) {
      const isMultiChar = markerText.length > 1;
      if (isMultiChar || ROMAN_SINGLE_UPPER.has(markerText)) {
        return {
          markerType: "roman-upper",
          depth: Math.floor(ru[1].length / 2),
          ordinal: fromRoman(markerText),
          marker: ru[2],
          indent: ru[1],
          content: ru[3],
        };
      }
    }
  }

  // Try Roman lower (multi-char is unambiguous)
  const rl = lineText.match(ROMAN_LOWER_RE);
  if (rl) {
    const markerText = rl[2].trim().replace(/\.\s?$/, "");
    if (isRomanNumeral(markerText)) {
      const isMultiChar = markerText.length > 1;
      if (isMultiChar || ROMAN_SINGLE_LOWER.has(markerText)) {
        return {
          markerType: "roman-lower",
          depth: Math.floor(rl[1].length / 2),
          ordinal: fromRoman(markerText),
          marker: rl[2],
          indent: rl[1],
          content: rl[3],
        };
      }
    }
  }

  // Alpha upper (single letters not claimed by Roman)
  const au = lineText.match(ALPHA_UPPER_RE);
  if (au) {
    return {
      markerType: "alpha-upper",
      depth: Math.floor(au[1].length / 2),
      ordinal: fromAlpha(au[2][0]),
      marker: au[2],
      indent: au[1],
      content: au[3],
    };
  }

  // Alpha lower (single letters not claimed by Roman)
  const al = lineText.match(ALPHA_LOWER_RE);
  if (al) {
    return {
      markerType: "alpha-lower",
      depth: Math.floor(al[1].length / 2),
      ordinal: fromAlpha(al[2][0]),
      marker: al[2],
      indent: al[1],
      content: al[3],
    };
  }

  return null;
}

// --- Style inference ---

/**
 * Infer the list style from a set of lines (the current list block).
 * Checks for metadata comment override first, then infers from markers.
 * Falls back to the provided default style.
 */
export function inferListStyle(
  lines: string[],
  precedingLine: string | null,
  fallbackStyle: ListStyle,
): ListStyle {
  // Layer 1: metadata comment override
  if (precedingLine) {
    const commentMatch = precedingLine.match(/<!--\s*list:\s*(standard|alphanumeric|decimal|steps)\s*-->/);
    if (commentMatch) {
      return commentMatch[1] as ListStyle;
    }
  }

  // Layer 2: auto-inference from markers
  for (const line of lines) {
    const info = detectListLine(line);
    if (!info) continue;

    // Decimal-outline markers are unambiguous
    if (info.markerType === "decimal-outline") return "decimal";

    // Roman upper at depth 0 → alphanumeric
    if (info.markerType === "roman-upper" && info.depth === 0) return "alphanumeric";

    // Alpha upper at any depth → alphanumeric
    if (info.markerType === "alpha-upper") return "alphanumeric";

    // Alpha lower at depth 0 → could be steps (a. at top level)
    // Alpha lower at depth 1 with decimal at depth 0 → steps
    if (info.markerType === "alpha-lower" && info.depth === 0) return "steps";

    // Roman lower → likely alphanumeric at depth 4+
    if (info.markerType === "roman-lower") return "alphanumeric";
  }

  // Layer 3: fallback
  return fallbackStyle;
}

// --- Next marker generation ---

/**
 * Generate the next marker for a given style, depth, and ordinal.
 * For decimal outline, parentChain carries the parent numbering.
 */
export function nextMarker(
  style: ListStyle,
  depth: number,
  ordinal: number,
  parentChain?: number[],
): string {
  if (style === "decimal") {
    const chain = parentChain ? [...parentChain, ordinal] : [ordinal];
    return `${chain.join(".")}. `;
  }
  const type = markerTypeForDepth(style, depth);
  return generateMarker(type, ordinal, parentChain);
}

/**
 * Generate the initial (first item) marker for a given style and depth.
 */
export function firstMarkerForDepth(
  style: ListStyle,
  depth: number,
  parentChain?: number[],
): string {
  return nextMarker(style, depth, 1, parentChain);
}

/**
 * Increment a detected marker to produce the next one.
 * E.g. "A. " → "B. ", "III. " → "IV. ", "1.2. " → "1.3. "
 */
export function incrementMarker(info: ListLineInfo): string {
  switch (info.markerType) {
    case "decimal":
      return `${info.ordinal + 1}. `;
    case "alpha-lower":
      return `${toAlphaLower(info.ordinal + 1)}. `;
    case "alpha-upper":
      return `${toAlphaUpper(info.ordinal + 1)}. `;
    case "roman-lower":
      return `${toRomanLower(info.ordinal + 1)}. `;
    case "roman-upper":
      return `${toRomanUpper(info.ordinal + 1)}. `;
    case "decimal-outline": {
      const chain = info.parentChain ? [...info.parentChain, info.ordinal + 1] : [info.ordinal + 1];
      return `${chain.join(".")}. `;
    }
    case "bullet":
      return "- ";
  }
}

// --- Disambiguation ---

/**
 * Disambiguate a marker that could be multiple types (e.g. "i." = alpha or roman).
 * Checks sibling lines at the same depth to determine the correct type.
 * Falls back to the style definition's expected type for that depth.
 */
export function disambiguate(
  info: ListLineInfo,
  siblingLines: string[],
  style: ListStyle,
): MarkerType {
  const expectedType = markerTypeForDepth(style, info.depth);

  // If the detected type matches the expected type, no conflict
  if (info.markerType === expectedType) return expectedType;

  // Check siblings at the same depth for clues
  for (const line of siblingLines) {
    const sibling = detectListLine(line);
    if (!sibling || sibling.depth !== info.depth) continue;

    // If a sibling is clearly alpha (e.g. "h." before "i."), this is alpha too
    if (sibling.markerType === "alpha-lower" && !isRomanNumeral(sibling.marker.trim().replace(/\.$/, ""))) {
      return "alpha-lower";
    }
    if (sibling.markerType === "alpha-upper" && !isRomanNumeral(sibling.marker.trim().replace(/\.$/, ""))) {
      return "alpha-upper";
    }
  }

  // Fall back to style definition
  return expectedType;
}

// --- Metadata comment detection ---

/** Check if a line is a list metadata comment. */
export function isListMetaComment(lineText: string): boolean {
  return /<!--\s*list:\s*(standard|alphanumeric|decimal|steps)\s*-->/.test(lineText);
}

/** Extract the style from a list metadata comment. */
export function parseListMetaComment(lineText: string): ListStyle | null {
  const match = lineText.match(/<!--\s*list:\s*(standard|alphanumeric|decimal|steps)\s*-->/);
  return match ? (match[1] as ListStyle) : null;
}

// --- List block boundary detection ---

/**
 * Given a document (array of line texts, 0-indexed) and a line index,
 * find the start and end indices of the list block containing that line.
 * A list block is contiguous lines that all match list marker patterns
 * (including blank lines that are "inside" the list for indented continuation).
 * Returns null if the line is not in a list.
 */
export function findListBlockRange(
  lines: string[],
  lineIndex: number,
): { start: number; end: number } | null {
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  // Check if current line is a list line
  if (!detectListLine(lines[lineIndex])) return null;

  // Walk backward
  let start = lineIndex;
  while (start > 0) {
    const prev = lines[start - 1];
    if (detectListLine(prev) || isListMetaComment(prev)) {
      start--;
    } else {
      break;
    }
  }

  // Walk forward
  let end = lineIndex;
  while (end < lines.length - 1) {
    const next = lines[end + 1];
    if (detectListLine(next)) {
      end++;
    } else {
      break;
    }
  }

  return { start, end };
}
