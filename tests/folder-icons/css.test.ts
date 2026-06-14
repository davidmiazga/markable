/**
 * tests/folder-icons/css.test.ts — step_02
 *
 * Asserts that every catalog id from step_01 has a matching CSS rule
 * `.folder-icon-<id> svg`, and that no hardcoded hex colors leak into any
 * folder-icon-* rule (NFR-7 — theme tokens only).
 *
 * Reads the candidate stylesheet files from disk and does string searches.
 * Brittle by design — the goal is to fail loudly if a new icon is added to
 * the catalog without a matching CSS rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FOLDER_ICONS } from "../../src/plugins/file-browser/folder-icons";

function readAllCandidateStylesheets(): string {
  // The CSS may live in any of these locations; concatenate all that exist so
  // the test doesn't care which file the developer chose.
  const candidates = [
    resolve(__dirname, "../../src/styles.css"),
    resolve(__dirname, "../../src/plugins/file-browser/file-browser.css"),
    resolve(__dirname, "../../src/plugins/file-browser/folder-icons.css"),
  ];
  let combined = "";
  for (const p of candidates) {
    try {
      combined += readFileSync(p, "utf8");
    } catch {
      /* file may not exist — fine */
    }
  }
  return combined;
}

describe("folder-icons CSS (step_02)", () => {
  it("every catalog id has a matching .folder-icon-<id> CSS selector (FR-3)", () => {
    const combined = readAllCandidateStylesheets();
    for (const def of FOLDER_ICONS) {
      const selector = `.folder-icon-${def.id} svg`;
      expect(
        combined.includes(selector),
        `Missing selector for icon "${def.id}" — expected "${selector}"`,
      ).toBe(true);
    }
  });

  it("a .folder-icon-custom svg rule exists for user-supplied SVGs (amendment 2026-06-05)", () => {
    const combined = readAllCandidateStylesheets();
    expect(combined.includes(".folder-icon-custom svg")).toBe(true);
  });

  it("no hardcoded hex colors appear inside any folder-icon-* CSS rule (NFR-7)", () => {
    // Walk every block whose selector contains `.folder-icon-` and assert it
    // does not contain any `#xxxxxx` hex literal — colors must come from theme
    // tokens via `currentColor` / CSS variables.
    const candidates = [
      resolve(__dirname, "../../src/plugins/file-browser/file-browser.css"),
      resolve(__dirname, "../../src/plugins/file-browser/folder-icons.css"),
      resolve(__dirname, "../../src/styles.css"),
    ];
    for (const p of candidates) {
      let css = "";
      try {
        css = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      // Crude block matcher: `.folder-icon-<rest>{ ... }` — sufficient because
      // the CSS we wrote is a single block of selectors + a couple of small
      // companion blocks.
      const blocks = css.match(/\.folder-icon-[^{]+\{[^}]*\}/g) ?? [];
      for (const block of blocks) {
        expect(
          block,
          `Hardcoded hex inside folder-icon rule: ${block.slice(0, 80)}...`,
        ).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    }
  });
});
