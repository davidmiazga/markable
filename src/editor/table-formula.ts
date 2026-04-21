/**
 * table-formula.ts
 *
 * Pure evaluator module for spreadsheet-style formula cells inside GFM Markdown
 * tables. Any body cell whose trimmed content begins with "=" is parsed,
 * evaluated, and its result returned as a display string. Header cells are
 * always returned as literal text.
 *
 * This file has ZERO dependencies on DOM, CM6, or Tauri. All exported
 * functions are pure (same inputs produce same outputs) and are directly
 * testable with Vitest in a Node environment.
 *
 * Architecture: docs/specs/table-formula/step_01_formula_parser.md
 * Requirements: docs/requirements/active_task.md
 */

// ── Token Types ────────────────────────────────────────────────────────────────

/**
 * Discriminated union of all token types the tokenizer can produce.
 * - NUMBER: numeric literal (3, 3.14, .5)
 * - CELLREF: single-letter column + digits (A1, b3) — normalised to uppercase
 * - IDENT: bare letter sequence (function names) — always uppercased
 * - RANGE_SEP: the colon in A1:B3
 * - COMMA: argument separator
 * - LPAREN / RPAREN: parentheses for grouping and function calls
 * - OP: arithmetic operator (+, -, *, /, %, ^)
 * - CMP: comparison operator (>, <, >=, <=, =, <>)
 * - EOF: sentinel at the end of the token stream
 */
export type TokenType =
  | "NUMBER"
  | "CELLREF"
  | "IDENT"
  | "RANGE_SEP"
  | "COMMA"
  | "LPAREN"
  | "RPAREN"
  | "OP"
  | "CMP"
  | "EOF";

/** A single token produced by the tokenizer. */
export interface Token {
  type: TokenType;
  /** Original text as it appears in the expression (IDENT and CELLREF are uppercased). */
  raw: string;
  /** Populated for NUMBER tokens only. */
  value?: number;
}

// ── Error and Cell Value Types ─────────────────────────────────────────────────

/**
 * All recognised formula error tokens. These are plain ASCII strings so they
 * render correctly without HTML encoding and can be detected with startsWith("#").
 */
export type FormulaError = "#ERR" | "#REF" | "#DIV/0" | "#CIRC" | "#VALUE" | "#NAME";

/**
 * The value of an evaluated cell: either a number or a formula error token.
 * Used internally by the evaluator and as the return type of resolveRef/evalNode.
 */
export type CellValue = number | FormulaError;

// ── AST Node Types ─────────────────────────────────────────────────────────────

/**
 * Discriminated union of all AST node types produced by the recursive descent
 * parser. All cell reference indices are 0-based (col 0 = column A, row 0 =
 * first body row).
 */
export type ASTNode =
  | { type: "number"; value: number }
  | { type: "cellRef"; col: number; row: number }
  | { type: "range"; c1: number; r1: number; c2: number; r2: number }
  | { type: "unary"; op: "-"; operand: ASTNode }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "%" | "^"; left: ASTNode; right: ASTNode }
  | { type: "compare"; op: ">" | "<" | ">=" | "<=" | "=" | "<>"; left: ASTNode; right: ASTNode }
  | { type: "call"; name: string; args: ASTNode[] };

// ── Table Data Structures ──────────────────────────────────────────────────────

/**
 * The raw parsed table: header cells and body cells as plain trimmed strings.
 * Formula syntax is preserved here — the evaluator processes it separately.
 */
export interface RawTable {
  /** Raw cell strings from the GFM header row (first non-delimiter line). */
  header: string[];
  /** Raw cell strings from each body row, row-major order (body[row][col]). */
  body: string[][];
}

/**
 * The result of evaluateTableFormulas(): header cells as-is, body cells
 * replaced with display strings (computed results or error tokens for formulas,
 * raw text for non-formula cells).
 */
export interface EvaluatedTable {
  /** Header cells — always literal text, never formula-evaluated. */
  header: string[];
  /** Body cells — formula cells replaced with display strings. */
  body: string[][];
}

/**
 * Evaluation context threaded through all recursive eval calls.
 * - rawTable: the source data for cell lookups
 * - cache: memoises resolved cell values to prevent redundant re-evaluation
 * - visiting: tracks cells currently on the call stack for cycle detection
 */
export interface EvalContext {
  rawTable: RawTable;
  /** Key format: "col:row" (0-based). Maps to the resolved CellValue. */
  cache: Map<string, CellValue>;
  /** Addresses of cells currently being evaluated (for circular reference detection). */
  visiting: Set<string>;
}

// ── Tokenizer ──────────────────────────────────────────────────────────────────

/**
 * Converts a formula expression string into a flat array of Token objects.
 * The caller must strip the leading "=" and any modifier suffixes before
 * calling this function.
 *
 * Token priority (evaluated in order):
 *  1. Two-character comparison operators (>=, <=, <>)
 *  2. Single-character comparison (>, <, =)
 *  3. Single-character arithmetic (+, -, *, /, %, ^)
 *  4. Punctuation ((, ), :, ,)
 *  5. Numeric literals (integers, decimals, leading-dot decimals)
 *  6. Alphanumeric identifiers (CELLREF if letter+digits, otherwise IDENT)
 *
 * @param expr - The expression string (no leading "=", no modifier suffixes).
 * @returns Array of Token objects terminated by an EOF token.
 * @throws SyntaxError for unrecognised characters.
 */
export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < expr.length) {
    // Skip whitespace (space and tab only — formulas are single-cell, no newlines)
    if (expr[pos] === " " || expr[pos] === "\t") { pos++; continue; }

    // Two-character comparison operators (must check before single-char versions)
    const two = expr.slice(pos, pos + 2);
    if (two === ">=" || two === "<=" || two === "<>") {
      tokens.push({ type: "CMP", raw: two });
      pos += 2;
      continue;
    }

    const ch = expr[pos];

    // Single-character comparison
    if (ch === ">" || ch === "<") { tokens.push({ type: "CMP", raw: ch }); pos++; continue; }
    // Equality comparison (not used as arithmetic here)
    if (ch === "=") { tokens.push({ type: "CMP", raw: ch }); pos++; continue; }

    // Arithmetic operators
    if ("+-*/%^".includes(ch)) { tokens.push({ type: "OP", raw: ch }); pos++; continue; }

    // Punctuation
    if (ch === "(") { tokens.push({ type: "LPAREN", raw: ch }); pos++; continue; }
    if (ch === ")") { tokens.push({ type: "RPAREN", raw: ch }); pos++; continue; }
    if (ch === ":") { tokens.push({ type: "RANGE_SEP", raw: ch }); pos++; continue; }
    if (ch === ",") { tokens.push({ type: "COMMA", raw: ch }); pos++; continue; }

    // Numeric literals: handles ".5", "3", "3.14"
    const numMatch = expr.slice(pos).match(/^(\d*\.\d+|\d+)/);
    if (numMatch) {
      const raw = numMatch[1];
      tokens.push({ type: "NUMBER", raw, value: parseFloat(raw) });
      pos += raw.length;
      continue;
    }

    // Alphanumeric identifiers: CELLREF (letter + digits) or IDENT (function name)
    const identMatch = expr.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (identMatch) {
      const raw = identMatch[0];
      pos += raw.length;
      // A single letter followed by one or more digits is a cell reference (A1, B23)
      if (/^[A-Za-z]\d+$/.test(raw)) {
        // Uppercase the column letter while preserving digit portion
        tokens.push({ type: "CELLREF", raw: raw.toUpperCase() });
      } else {
        // Function name or other identifier — uppercase the whole thing
        tokens.push({ type: "IDENT", raw: raw.toUpperCase() });
      }
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${pos}`);
  }

  tokens.push({ type: "EOF", raw: "" });
  return tokens;
}

// ── Modifier Splitter ──────────────────────────────────────────────────────────

/**
 * Separates the arithmetic expression body from any trailing "-ModifierName"
 * suffixes before tokenisation. The modifiers are returned in the order they
 * appear in the original string (left to right).
 *
 * Disambiguation rule (AD-06, EC-60):
 * A trailing "-<word>" segment is a modifier only when <word> matches
 * /^[A-Z][a-zA-Z]+$/ exactly — first char uppercase, remaining chars letters
 * only (no digits), minimum length 2. This correctly rejects:
 *   -B1  (has digit)
 *   -b   (lowercase start)
 *
 * Algorithm scans right-to-left, peeling one modifier at a time.
 *
 * @param formulaBody - Everything after the leading "=" in the cell.
 * @returns Object with { expr: the arithmetic expression, modifiers: string[] }
 */
export function splitModifiers(formulaBody: string): { expr: string; modifiers: string[] } {
  const modifiers: string[] = [];
  let remaining = formulaBody;

  for (;;) {
    const lastDash = remaining.lastIndexOf("-");
    if (lastDash === -1) break;

    const candidate = remaining.slice(lastDash + 1);
    // Modifier must be PascalCase: starts with uppercase, remaining alpha only, length >= 2
    if (/^[A-Z][a-zA-Z]+$/.test(candidate)) {
      modifiers.unshift(candidate);          // prepend to maintain left-to-right order
      remaining = remaining.slice(0, lastDash);
    } else {
      break;
    }
  }

  return { expr: remaining, modifiers };
}

// ── Recursive Descent Parser ───────────────────────────────────────────────────

/**
 * Parses a token array into an ASTNode tree using recursive descent.
 * Grammar (in ascending precedence):
 *   expression   ::= comparison
 *   comparison   ::= addition ( cmpOp addition )*
 *   addition     ::= multiplication ( ("+"|"-") multiplication )*
 *   multiplication ::= power ( ("*"|"/"|"%") power )*
 *   power        ::= unary ("^" unary)*
 *   unary        ::= "-" unary | primary
 *   primary      ::= NUMBER | CELLREF | CELLREF ":" CELLREF
 *                  | IDENT "(" argList ")" | "(" expression ")"
 *
 * @param tokens - Token array from tokenize(), must end with EOF.
 * @returns Root ASTNode.
 * @throws SyntaxError on any grammar violation.
 */
export function parse(tokens: Token[]): ASTNode {
  let pos = 0;

  /** Returns the current token without advancing. */
  const peek = (): Token => tokens[pos] ?? { type: "EOF", raw: "" };

  /** Advances and returns the current token; throws if expected type doesn't match. */
  const consume = (expectedType?: TokenType): Token => {
    const tok = tokens[pos++];
    if (expectedType !== undefined && tok.type !== expectedType) {
      throw new SyntaxError(`Expected ${expectedType} but got ${tok.type} ("${tok.raw}")`);
    }
    return tok;
  };

  // Forward declarations for mutual recursion
  let parseExpression: () => ASTNode;
  let parseAddition: () => ASTNode;

  const parsePrimary = (): ASTNode => {
    const tok = peek();

    // Numeric literal
    if (tok.type === "NUMBER") {
      consume();
      return { type: "number", value: tok.value! };
    }

    // Cell reference, possibly followed by ":" for a range
    if (tok.type === "CELLREF") {
      consume();
      const colLetter = tok.raw[0];
      const rowNum = parseInt(tok.raw.slice(1), 10);
      const col = colLetter.charCodeAt(0) - 65; // A=0, B=1, …
      const row = rowNum - 1;                    // 1-based → 0-based

      // Check for range separator (A1:B3)
      if (peek().type === "RANGE_SEP") {
        consume("RANGE_SEP");
        const tok2 = consume("CELLREF");
        const col2 = tok2.raw[0].charCodeAt(0) - 65;
        const row2 = parseInt(tok2.raw.slice(1), 10) - 1;

        // Normalise range to ascending order (EC-22, FR-03.3)
        return {
          type: "range",
          c1: Math.min(col, col2),
          r1: Math.min(row, row2),
          c2: Math.max(col, col2),
          r2: Math.max(row, row2),
        };
      }

      return { type: "cellRef", col, row };
    }

    // Function call: IDENT "(" argList ")"
    if (tok.type === "IDENT") {
      const name = tok.raw; // already uppercased by tokenizer
      consume();
      consume("LPAREN");

      const args: ASTNode[] = [];
      // Empty argument list
      if (peek().type !== "RPAREN") {
        args.push(parseExpression());
        while (peek().type === "COMMA") {
          consume("COMMA");
          args.push(parseExpression());
        }
      }
      consume("RPAREN");
      return { type: "call", name, args };
    }

    // Grouped expression: "(" expression ")"
    if (tok.type === "LPAREN") {
      consume("LPAREN");
      const node = parseExpression();
      consume("RPAREN");
      return node;
    }

    throw new SyntaxError(`Unexpected token ${tok.type} ("${tok.raw}")`);
  };

  const parseUnary = (): ASTNode => {
    if (peek().type === "OP" && peek().raw === "-") {
      consume();
      return { type: "unary", op: "-", operand: parseUnary() };
    }
    return parsePrimary();
  };

  const parsePower = (): ASTNode => {
    let node = parseUnary();
    // Left-associative: while loop produces (2^3)^4 for chained ^
    while (peek().type === "OP" && peek().raw === "^") {
      consume();
      const right = parseUnary();
      node = { type: "binary", op: "^", left: node, right };
    }
    return node;
  };

  const parseMultiplication = (): ASTNode => {
    let node = parsePower();
    while (peek().type === "OP" && "*/%".includes(peek().raw)) {
      const op = consume().raw as "*" | "/" | "%";
      node = { type: "binary", op, left: node, right: parsePower() };
    }
    return node;
  };

  parseAddition = (): ASTNode => {
    let node = parseMultiplication();
    while (peek().type === "OP" && "+-".includes(peek().raw)) {
      const op = consume().raw as "+" | "-";
      node = { type: "binary", op, left: node, right: parseMultiplication() };
    }
    return node;
  };

  const parseComparison = (): ASTNode => {
    let node = parseAddition();
    while (peek().type === "CMP") {
      const op = consume().raw as ">" | "<" | ">=" | "<=" | "=" | "<>";
      node = { type: "compare", op, left: node, right: parseAddition() };
    }
    return node;
  };

  parseExpression = parseComparison;

  const result = parseExpression();

  // Ensure the entire token stream was consumed (no trailing garbage)
  if (peek().type !== "EOF") {
    throw new SyntaxError(`Unexpected token after expression: "${peek().raw}"`);
  }

  return result;
}

// ── Table Markdown Parser ──────────────────────────────────────────────────────

/**
 * Parses a raw GFM Markdown table string into a RawTable structure.
 * Uses the same pipe-splitting and delimiter-detection logic as TableWidget.toDOM()
 * to guarantee cell values align with what the renderer sees.
 *
 * @param rawMarkdown - The raw Markdown text of a single GFM table block.
 * @returns RawTable with trimmed cell strings.
 */
export function parseTableMarkdown(rawMarkdown: string): RawTable {
  /**
   * Returns true if a line is a GFM table separator. A valid separator must
   * contain at least one dash in addition to pipes, colons, and whitespace.
   * This prevents empty rows like "|  |" (pipes + spaces, no dashes) from
   * being misidentified as delimiter rows.
   */
  const isDelim = (line: string): boolean => {
    const trimmed = line.trim();
    return /^[\|\s:\-]+$/.test(trimmed) && trimmed.includes("-");
  };

  /**
   * Splits a Markdown table row on "|" and strips the leading/trailing
   * empty parts that appear when the row begins and ends with "|".
   * Each cell is trimmed.
   */
  const parseCells = (line: string): string[] => {
    const parts = line.split("|");
    if (parts[0].trim() === "") parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    return parts.map((c) => c.trim());
  };

  const lines = rawMarkdown.split("\n").filter((l) => l.trim().length > 0);

  let header: string[] = [];
  const body: string[][] = [];
  let inHeader = true;

  for (const line of lines) {
    if (isDelim(line)) {
      // The separator row marks the end of the header section
      inHeader = false;
      continue;
    }
    if (inHeader) {
      header = parseCells(line);
    } else {
      body.push(parseCells(line));
    }
  }

  return { header, body };
}

// ── Cell Value Helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the trimmed string represents a valid number that can be
 * used in arithmetic. Accepts "3", "3.14", ".5", "-3". Rejects "", "hello",
 * "#ERR", and whitespace-only strings.
 *
 * This is intentionally strict: only strings that Number() converts cleanly
 * to a finite number are accepted.
 */
function isNumericString(s: string): boolean {
  const trimmed = s.trim().replace(/,/g, "");
  if (!trimmed) return false;
  return !isNaN(Number(trimmed));
}

// ── Range Collection Helper ────────────────────────────────────────────────────

/**
 * Collects the CellValue of every cell in a range node.
 * Validates that the range is either single-column or single-row (FR-03.2).
 * Returns ["#ERR"] for rectangle ranges and ["#REF"] for out-of-bounds ranges.
 *
 * @param node  - A range AST node with 0-based, already-normalised indices.
 * @param ctx   - Evaluation context (provides rawTable and memoisation).
 * @param depth - Current recursion depth for the depth-cap guard.
 * @returns     Array of CellValue results (may include error tokens).
 */
function collectRangeValues(
  node: { type: "range"; c1: number; r1: number; c2: number; r2: number },
  ctx: EvalContext,
  depth: number,
): CellValue[] {
  // Reject multi-row, multi-column rectangle ranges (FR-03.2, EC-21)
  if (node.c1 !== node.c2 && node.r1 !== node.r2) return ["#ERR"];

  // Bounds check — verify all range endpoints are inside the table
  const rowCount = ctx.rawTable.body.length;
  const colCount = ctx.rawTable.body[0]?.length ?? 0;
  if (
    node.r1 < 0 || node.r2 >= rowCount ||
    node.c1 < 0 || node.c2 >= colCount
  ) {
    return ["#REF"];
  }

  // Collect values for each cell in the range (single-column or single-row)
  const values: CellValue[] = [];
  for (let r = node.r1; r <= node.r2; r++) {
    for (let c = node.c1; c <= node.c2; c++) {
      values.push(resolveRef(c, r, ctx, depth));
    }
  }
  return values;
}

// ── Cell Reference Resolver ────────────────────────────────────────────────────

/**
 * Resolves the CellValue of a single cell by its 0-based (col, row) address.
 *
 * Resolution order:
 *  1. Bounds check → #REF
 *  2. Depth cap (> 50 hops) → #REF
 *  3. Cache hit → cached value
 *  4. Cycle detection (currently visiting) → #CIRC
 *  5. Empty cell → 0 (FR-02.6)
 *  6. Formula cell (starts with "=") → recursive evaluation
 *  7. Numeric string → parsed number
 *  8. Non-numeric string → #VALUE (FR-02.7)
 *
 * @param col   - 0-based column index.
 * @param row   - 0-based row index (counts body rows only, not header).
 * @param ctx   - Evaluation context with rawTable, cache, and visiting set.
 * @param depth - Current recursion depth; guarded against pathological chains.
 * @returns     CellValue (number or FormulaError string).
 */
export function resolveRef(col: number, row: number, ctx: EvalContext, depth: number): CellValue {
  // 1. Bounds check
  const rowCount = ctx.rawTable.body.length;
  const colCount = ctx.rawTable.body[row]?.length ?? 0;
  if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return "#REF";

  // 2. Depth cap — prevents pathological non-circular deep chains (FR-06.4)
  if (depth > 50) return "#REF";

  const key = `${col}:${row}`;

  // 3. Cache hit — avoid re-evaluating the same cell
  if (ctx.cache.has(key)) return ctx.cache.get(key)!;

  // 4. Cycle detection — if this cell is already on the evaluation stack
  if (ctx.visiting.has(key)) return "#CIRC";

  const raw = ctx.rawTable.body[row][col].trim();

  // 5. Empty cell → contributes 0 in numeric contexts (FR-02.6)
  if (!raw) {
    ctx.cache.set(key, 0);
    return 0;
  }

  // 6. Formula cell — evaluate recursively
  if (raw.startsWith("=")) {
    ctx.visiting.add(key);
    const result = evaluateCellFormula(raw.slice(1), ctx, depth + 1);
    ctx.visiting.delete(key);
    ctx.cache.set(key, result);
    return result;
  }

  // 7. Numeric string → return the parsed number (strip commas for input like "1,000")
  if (isNumericString(raw)) {
    const num = Number(raw.replace(/,/g, ""));
    ctx.cache.set(key, num);
    return num;
  }

  // 8. Non-numeric string → #VALUE (will cause #VALUE in arithmetic callers)
  ctx.cache.set(key, "#VALUE");
  return "#VALUE";
}

// ── AST Evaluator ─────────────────────────────────────────────────────────────

/**
 * Evaluates an ASTNode to a CellValue. All numeric operations propagate
 * the first FormulaError encountered (left before right for binary nodes).
 *
 * For aggregate functions (SUM, AVG, MIN, MAX, COUNT), non-numeric values
 * in ranges are silently skipped per FR-04.6. For arithmetic, any FormulaError
 * from a cell reference propagates immediately.
 *
 * @param node  - AST node to evaluate.
 * @param ctx   - Evaluation context (rawTable, cache, visiting).
 * @param depth - Current recursion depth (passed through to resolveRef).
 * @returns     CellValue — a number or a FormulaError string.
 */
export function evalNode(node: ASTNode, ctx: EvalContext, depth: number): CellValue {
  switch (node.type) {
    case "number":
      return node.value;

    case "cellRef":
      return resolveRef(node.col, node.row, ctx, depth);

    case "range":
      // Ranges are only valid as function arguments. If evalNode is called
      // directly on a range node (e.g., used bare in arithmetic), return #ERR.
      return "#ERR";

    case "unary": {
      const val = evalNode(node.operand, ctx, depth);
      if (typeof val !== "number") return val; // propagate error
      return -val;
    }

    case "binary": {
      const left = evalNode(node.left, ctx, depth);
      if (typeof left !== "number") return left; // left error takes precedence
      const right = evalNode(node.right, ctx, depth);
      if (typeof right !== "number") return right;

      switch (node.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? "#DIV/0" : left / right;
        case "%": return right === 0 ? "#DIV/0" : left % right;
        case "^": return Math.pow(left, right);
      }
      break;
    }

    case "compare": {
      const left = evalNode(node.left, ctx, depth);
      if (typeof left !== "number") return left;
      const right = evalNode(node.right, ctx, depth);
      if (typeof right !== "number") return right;

      // Comparison operators return 1 (true) or 0 (false) for use in IF conditions
      switch (node.op) {
        case ">":  return left > right  ? 1 : 0;
        case "<":  return left < right  ? 1 : 0;
        case ">=": return left >= right ? 1 : 0;
        case "<=": return left <= right ? 1 : 0;
        case "=":  return left === right ? 1 : 0;
        case "<>": return left !== right ? 1 : 0;
      }
      break;
    }

    case "call":
      return evalCall(node.name, node.args, ctx, depth);
  }

  return "#ERR";
}

// ── Function Call Dispatcher ───────────────────────────────────────────────────

/**
 * Dispatches a parsed function call to the appropriate implementation.
 * All function names have been uppercased by the tokenizer.
 *
 * Aggregate functions (SUM, AVG, MIN, MAX, COUNT) accept:
 *   - A single range argument (A1:A5)
 *   - A comma-separated list of cell references or literals
 *
 * @param name  - Uppercase function name.
 * @param args  - Parsed argument AST nodes.
 * @param ctx   - Evaluation context.
 * @param depth - Current recursion depth.
 * @returns     CellValue.
 */
function evalCall(name: string, args: ASTNode[], ctx: EvalContext, depth: number): CellValue {
  switch (name) {
    case "SUM": {
      const vals = collectAggregateValues(args, ctx, depth);
      if (vals === "#ERR" || vals === "#REF") return vals;
      // Propagate real formula errors (anything that is not #VALUE); skip #VALUE (non-numeric
      // cell text is silently skipped per FR-04.6, AD-05, EC-11). #CIRC, #REF, etc. propagate.
      const firstRealError = (vals as CellValue[]).find(
        (v): v is FormulaError => typeof v === "string" && v !== "#VALUE"
      );
      if (firstRealError) return firstRealError;
      const nums = (vals as CellValue[]).filter((v): v is number => typeof v === "number");
      return nums.reduce((a, b) => a + b, 0);
    }

    case "AVG": {
      const vals = collectAggregateValues(args, ctx, depth);
      if (vals === "#ERR" || vals === "#REF") return vals;
      const firstRealError = (vals as CellValue[]).find(
        (v): v is FormulaError => typeof v === "string" && v !== "#VALUE"
      );
      if (firstRealError) return firstRealError;
      const nums = (vals as CellValue[]).filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return "#ERR"; // no numeric values → #ERR (FR-04.6)
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }

    case "MIN": {
      const vals = collectAggregateValues(args, ctx, depth);
      if (vals === "#ERR" || vals === "#REF") return vals;
      const firstRealError = (vals as CellValue[]).find(
        (v): v is FormulaError => typeof v === "string" && v !== "#VALUE"
      );
      if (firstRealError) return firstRealError;
      const nums = (vals as CellValue[]).filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return "#ERR";
      return Math.min(...nums);
    }

    case "MAX": {
      const vals = collectAggregateValues(args, ctx, depth);
      if (vals === "#ERR" || vals === "#REF") return vals;
      const firstRealError = (vals as CellValue[]).find(
        (v): v is FormulaError => typeof v === "string" && v !== "#VALUE"
      );
      if (firstRealError) return firstRealError;
      const nums = (vals as CellValue[]).filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return "#ERR";
      return Math.max(...nums);
    }

    case "COUNT": {
      // COUNT checks raw cell strings directly to distinguish empty cells (should
      // not be counted) from cells containing the number 0. FR-04.6, EC-35.
      if (args.length === 1 && args[0].type === "range") {
        const node = args[0];
        // Validate the range structurally first
        const rangeVals = collectRangeValues(node, ctx, depth);
        if (rangeVals.length === 1 && (rangeVals[0] === "#ERR" || rangeVals[0] === "#REF")) {
          return rangeVals[0];
        }
        // Count raw body cell strings that are non-empty numeric strings
        let count = 0;
        for (let r = node.r1; r <= node.r2; r++) {
          for (let c = node.c1; c <= node.c2; c++) {
            const raw = ctx.rawTable.body[r]?.[c]?.trim() ?? "";
            if (raw && isNumericString(raw)) count++;
          }
        }
        return count;
      }
      // For non-range arguments, fall back to resolved values
      const vals = collectAggregateValues(args, ctx, depth);
      if (vals === "#ERR" || vals === "#REF") return vals;
      return (vals as CellValue[]).filter((v) => typeof v === "number").length;
    }

    case "ROUND": {
      if (args.length !== 2) return "#ERR"; // FR-04.3 — exactly 2 args required
      const value = evalNode(args[0], ctx, depth);
      if (typeof value !== "number") return value;
      const digits = evalNode(args[1], ctx, depth);
      if (typeof digits !== "number") return digits;
      const d = Math.trunc(digits);
      // Uses Math.round(v * 10^d) / 10^d which handles negative d (FR-04.3, AD-10)
      return Math.round(value * Math.pow(10, d)) / Math.pow(10, d);
    }

    case "ABS": {
      if (args.length !== 1) return "#ERR"; // FR-04.4 — exactly 1 arg required
      const value = evalNode(args[0], ctx, depth);
      if (typeof value !== "number") return value;
      return Math.abs(value);
    }

    case "IF": {
      if (args.length !== 3) return "#ERR"; // FR-04.5 — exactly 3 args required
      const cond = evalNode(args[0], ctx, depth);
      if (typeof cond !== "number") return cond;
      // Non-zero condition is truthy (consistent with IF semantics)
      return cond !== 0 ? evalNode(args[1], ctx, depth) : evalNode(args[2], ctx, depth);
    }

    default:
      return "#NAME"; // FR-04.2 — unknown function
  }
}

/**
 * Collects values for aggregate functions from either a single range argument
 * or a list of cell reference / literal arguments.
 *
 * Returns "#ERR" or "#REF" as a string (not an array) only when the range
 * itself is structurally invalid (rectangle shape) or out-of-bounds. These
 * are the only two values that collectRangeValues produces as the sole element
 * to signal a range-level problem. "#VALUE" inside a range is a per-cell
 * result that individual aggregate functions handle (SUM/AVG/MIN/MAX skip it,
 * COUNT doesn't count it).
 *
 * @param args  - Argument AST nodes (one range OR multiple cell/literal nodes).
 * @param ctx   - Evaluation context.
 * @param depth - Current recursion depth.
 * @returns     Array of CellValue, or a FormulaError string for range-level errors.
 */
function collectAggregateValues(
  args: ASTNode[],
  ctx: EvalContext,
  depth: number,
): CellValue[] | "#ERR" | "#REF" {
  if (args.length === 1 && args[0].type === "range") {
    const rangeVals = collectRangeValues(args[0], ctx, depth);
    // collectRangeValues returns ["#ERR"] for rectangle ranges and ["#REF"] for
    // out-of-bounds ranges. These single-element error arrays signal range-level
    // errors, not individual cell errors. Distinguish them from a valid single-cell
    // range whose only cell happens to contain a non-numeric value like "#VALUE".
    if (rangeVals.length === 1 && (rangeVals[0] === "#ERR" || rangeVals[0] === "#REF")) {
      return rangeVals[0];
    }
    return rangeVals;
  }

  // Multiple arguments — each may be a cell ref, literal, or nested expression
  const results: CellValue[] = [];
  for (const arg of args) {
    results.push(evalNode(arg, ctx, depth));
  }
  return results;
}

// ── Result Formatter ───────────────────────────────────────────────────────────

/**
 * Converts a numeric evaluation result to its display string.
 *
 * Standard path (isRoundCall=false):
 *   - Applies toPrecision(10) + parseFloat() to suppress floating-point noise
 *     (e.g. 0.1 + 0.2 → 0.3, not 0.30000000000000004). (NFR-04, FR-08.2)
 *   - Integer results have no decimal point (6.0 → "6"). (FR-08.3)
 *
 * ROUND path (isRoundCall=true, roundDigits >= 0):
 *   - Uses toFixed(roundDigits) to guarantee exactly that many decimal places.
 *     (FR-08.4)
 *
 * ROUND path with negative digits (isRoundCall=true, roundDigits < 0):
 *   - Result is an integer-scale value; use standard path.
 *
 * @param value       - The numeric result to format.
 * @param isRoundCall - True when the top-level expression was a ROUND() call.
 * @param roundDigits - The digits argument from ROUND(); used only when isRoundCall=true.
 * @returns           Display string.
 */
export function formatNumericResult(value: number, isRoundCall: boolean, roundDigits: number): string {
  // ROUND with non-negative digits: guarantee exact decimal places (FR-08.4)
  if (isRoundCall && roundDigits >= 0) {
    return value.toFixed(roundDigits);
  }

  // Standard path: suppress floating-point noise and strip trailing zeros
  const normalised = parseFloat(value.toPrecision(10));
  return String(normalised);
}

// ── Modifier Application ───────────────────────────────────────────────────────

/**
 * Applies canonical output modifiers to a display string.
 *
 * Processing rules:
 *  1. Error tokens (start with "#") pass through unchanged. (FR-11.7)
 *  2. Unknown modifier names → "#NAME" immediately. (FR-11.6)
 *  3. Modifiers are applied in canonical order regardless of input order,
 *     ensuring order-independence (FR-11.5):
 *     Step A: IntFormat     (truncate to integer)
 *     Step B: CommaFormat / MoneyFormat / AccountFormat (thousands separators)
 *     Step C: AccountFormat (negative → parentheses; others restore sign)
 *     Step D: MoneyFormat / AccountFormat (prepend $)
 *     Step E: PercentFormat (append %)
 *
 * @param displayStr - The formatted number string (or error token) to transform.
 * @param modifiers  - Array of modifier names extracted by splitModifiers().
 * @returns          Transformed display string, or "#NAME" for unknown modifiers.
 */
export function applyModifiers(displayStr: string, modifiers: string[]): string {
  // 1. Error tokens bypass all modifier processing
  if (displayStr.startsWith("#")) return displayStr;

  // No modifiers → return unchanged
  if (modifiers.length === 0) return displayStr;

  // 2. Validate all modifier names before applying any
  const supported = new Set(["CommaFormat", "MoneyFormat", "AccountFormat", "PercentFormat", "IntFormat"]);
  for (const mod of modifiers) {
    if (!supported.has(mod)) return "#NAME";
  }

  const num = parseFloat(displayStr);
  // Defensive: if the string can't be parsed, return unchanged (should not occur
  // for a non-error display string from the evaluator)
  if (isNaN(num)) return displayStr;

  const isNegative = num < 0;
  // Work with the absolute value string to avoid sign issues during formatting
  let absStr = displayStr.startsWith("-") ? displayStr.slice(1) : displayStr;

  // Step A: IntFormat — truncate to integer (display only; referenced value is unchanged)
  if (modifiers.some((m) => m === "IntFormat")) {
    absStr = String(Math.trunc(parseFloat(absStr)));
  }

  // Step B: CommaFormat, MoneyFormat, or AccountFormat — add thousands separators
  if (modifiers.some((m) => m === "CommaFormat" || m === "MoneyFormat" || m === "AccountFormat")) {
    absStr = applyCommaFormat(absStr);
  }

  // Step C: AccountFormat wraps negatives in parens; others restore sign
  let result: string;
  if (modifiers.some((m) => m === "AccountFormat")) {
    result = isNegative ? `(${absStr})` : absStr;
  } else {
    result = isNegative ? `-${absStr}` : absStr;
  }

  // Step D: MoneyFormat or AccountFormat — prepend $ symbol
  if (modifiers.some((m) => m === "MoneyFormat" || m === "AccountFormat")) {
    result = `$${result}`;
  }

  // Step E: PercentFormat — append % symbol
  if (modifiers.some((m) => m === "PercentFormat")) {
    result = `${result}%`;
  }

  return result;
}

/**
 * Applies thousands comma separators to a numeric string.
 * Uses a regex approach (not toLocaleString) so results are deterministic
 * and locale-independent in all test environments.
 *
 * Handles both integer parts and decimal parts correctly:
 *   "1234567"   → "1,234,567"
 *   "1234.56"   → "1,234.56"
 *
 * @param absStr - Absolute-value display string (no leading minus sign).
 * @returns      Comma-separated string.
 */
function applyCommaFormat(absStr: string): string {
  const [intPart, decPart] = absStr.split(".");
  // Insert commas every 3 digits from the right in the integer portion
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

// ── Internal Cell Formula Evaluator ───────────────────────────────────────────

/**
 * Internal function called by resolveRef() when a cell contains a formula.
 * Returns the raw CellValue (number or error) without modifier application —
 * modifiers only affect the display layer, not cross-cell references.
 *
 * Note: modifier parsing happens here only to strip the expr from the body;
 * the modifiers array itself is discarded. The display path in
 * evaluateTableFormulas() re-runs splitModifiers for the display cell.
 *
 * @param rawFormulaBody - Everything after "=" in the cell (not yet stripped).
 * @param ctx            - Evaluation context.
 * @param depth          - Current recursion depth.
 * @returns              CellValue (number or FormulaError).
 */
function evaluateCellFormula(rawFormulaBody: string, ctx: EvalContext, depth: number): CellValue {
  const { expr } = splitModifiers(rawFormulaBody);

  if (expr.trim() === "") return "#ERR"; // EC-02 — empty formula body

  try {
    const tokens = tokenize(expr.trim());
    const ast = parse(tokens);
    return evalNode(ast, ctx, depth);
  } catch {
    return "#ERR";
  }
}

// ── Entry Point ────────────────────────────────────────────────────────────────

/**
 * Primary public entry point consumed by TableWidget.toDOM() in live-preview.ts.
 *
 * Parses the raw Markdown table, builds an evaluation context, then evaluates
 * every body cell that starts with "=". Header cells are always returned as-is.
 *
 * ROUND display formatting: the entry point detects when the top-level AST
 * node is a ROUND call and passes the digit count to formatNumericResult()
 * so the display string has the correct number of decimal places. The cached
 * numeric value in resolveRef() is the unformatted result (AD-06 note).
 *
 * @param rawMarkdown - The raw Markdown string of one GFM table block.
 * @returns           EvaluatedTable with header and body display strings.
 */
export function evaluateTableFormulas(rawMarkdown: string): EvaluatedTable {
  const rawTable = parseTableMarkdown(rawMarkdown);
  const ctx: EvalContext = { rawTable, cache: new Map(), visiting: new Set() };

  const body: string[][] = rawTable.body.map((row) =>
    row.map((raw) => {
      const trimmed = raw.trim();

      // Non-formula cell: return the raw trimmed string.
      // TableWidget.toDOM() will apply marked.parseInline() to it.
      if (!trimmed.startsWith("=")) return trimmed;

      // Formula cell: evaluate and format for display
      const formulaBody = trimmed.slice(1); // strip leading "="
      const { expr, modifiers } = splitModifiers(formulaBody);

      if (expr.trim() === "") return applyModifiers("#ERR", modifiers);

      try {
        const tokens = tokenize(expr.trim());
        const ast = parse(tokens);

        // Detect ROUND at the top level to enable toFixed display formatting (FR-08.4)
        let isRound = false;
        let roundDigits = 0;
        if (ast.type === "call" && ast.name === "ROUND" && ast.args.length === 2) {
          isRound = true;
          const digitsVal = evalNode(ast.args[1], ctx, 0);
          if (typeof digitsVal === "number") roundDigits = Math.trunc(digitsVal);
        }

        const value = evalNode(ast, ctx, 0);

        let displayStr: string;
        if (typeof value !== "number") {
          // Value is a FormulaError — display it directly
          displayStr = value;
        } else {
          displayStr = formatNumericResult(value, isRound, roundDigits);
        }

        return applyModifiers(displayStr, modifiers);
      } catch {
        return applyModifiers("#ERR", modifiers);
      }
    })
  );

  return { header: rawTable.header, body };
}

// ── Table Sort Helpers ─────────────────────────────────────────────────────────

/**
 * Parse a display string (possibly formatted with $, commas, %, accounting
 * parens) back to a number for sort comparison purposes.
 *
 * Returns the numeric value if parseable, or the original string for
 * locale-aware string comparison fallback.
 *
 * Handles: "$1,234.56" → 1234.56, "$(1,234)" → -1234, "75%" → 75,
 *          "-3.5" → -3.5, "(42)" → -42, "hello" → "hello"
 *
 * @param s - Display string from EvaluatedTable body cell.
 * @returns   Parsed number, or original string if non-numeric.
 */
export function parseDisplayValue(s: string): number | string {
  // Strip currency symbol, thousands commas, percent sign
  let cleaned = s.replace(/[$,]/g, "").replace(/%$/, "").trim();
  // Accounting-style negative: (123) → -123
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? s : n;
}

/**
 * Sort EvaluatedTable body rows by a given column, returning a new array.
 * Numeric columns sort numerically (using parseDisplayValue); others sort
 * lexicographically via localeCompare.
 *
 * Formula error tokens ("#ERR" etc.) always sort last regardless of direction.
 *
 * @param body - EvaluatedTable body (array of string arrays).
 * @param col  - Zero-based column index to sort by.
 * @param dir  - "asc" (smallest first) or "desc" (largest first).
 * @returns      New sorted array; original is not mutated.
 */
export function sortBodyRows(
  body: string[][],
  col: number,
  dir: "asc" | "desc",
): string[][] {
  return [...body].sort((a, b) => {
    const aRaw = a[col] ?? "";
    const bRaw = b[col] ?? "";

    // Error tokens sort last in both directions
    const aIsErr = aRaw.startsWith("#");
    const bIsErr = bRaw.startsWith("#");
    if (aIsErr && !bIsErr) return 1;
    if (!aIsErr && bIsErr) return -1;
    if (aIsErr && bIsErr) return aRaw.localeCompare(bRaw);

    const aVal = parseDisplayValue(aRaw);
    const bVal = parseDisplayValue(bRaw);

    let cmp: number;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return dir === "asc" ? cmp : -cmp;
  });
}
