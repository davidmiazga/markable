import { describe, it, expect } from "vitest";
import {
  extractH1,
  h1ToFilename,
  resolveConflictPath,
} from "../../../src/plugins/auto-title/auto-title-helpers";

// ── extractH1 ────────────────────────────────────────────────────────────────

describe("extractH1", () => {
  it("returns heading text from a simple H1", () => {
    expect(extractH1("# My Notes\n")).toBe("My Notes");
  });

  it("trims trailing whitespace from heading", () => {
    expect(extractH1("# My Notes   ")).toBe("My Notes");
  });

  it("returns null for empty string", () => {
    expect(extractH1("")).toBeNull();
  });

  it("returns null for H2 heading", () => {
    expect(extractH1("## Sub Heading")).toBeNull();
  });

  it("returns null when # has no space after it", () => {
    expect(extractH1("#NoSpace")).toBeNull();
  });

  it("returns null when H1 is not on the first content line", () => {
    expect(extractH1("Some prose\n# Heading")).toBeNull();
  });

  it("skips YAML front matter and reads H1 from first body line", () => {
    expect(extractH1("---\ntitle: x\n---\n\n# Notes")).toBe("Notes");
  });

  it("returns null when YAML is present but body has no H1", () => {
    expect(extractH1("---\ntitle: x\n---\n\nSome prose")).toBeNull();
  });

  it("returns null for malformed YAML (no closing fence)", () => {
    expect(extractH1("---\ntitle: x\n# Not a heading yet")).toBeNull();
  });

  it("returns full multi-word heading", () => {
    expect(extractH1("# My Long Heading Here")).toBe("My Long Heading Here");
  });

  it("does not sanitize special chars — that is h1ToFilename's job", () => {
    expect(extractH1("# Q&A: Tips")).toBe("Q&A: Tips");
  });

  it("returns null for H1 with only whitespace after #", () => {
    expect(extractH1("#   ")).toBeNull();
  });
});

// ── h1ToFilename ─────────────────────────────────────────────────────────────

describe("h1ToFilename (spaces — default)", () => {
  it("preserves plain text with capitalisation", () => {
    expect(h1ToFilename("My Meeting Notes")).toBe("My Meeting Notes");
  });

  it("replaces forward slash with space", () => {
    expect(h1ToFilename("Projects/Work")).toBe("Projects Work");
  });

  it("replaces colon with space", () => {
    expect(h1ToFilename("Notes: Day 1")).toBe("Notes Day 1");
  });

  it("collapses multiple consecutive illegal chars to one space", () => {
    expect(h1ToFilename("A//B")).toBe("A B");
  });

  it("returns Untitled when all chars are illegal", () => {
    expect(h1ToFilename("///")).toBe("Untitled");
  });

  it("trims leading and trailing whitespace", () => {
    expect(h1ToFilename("  Hello  ")).toBe("Hello");
  });

  it("preserves capitalisation", () => {
    expect(h1ToFilename("My Weekly Review")).toBe("My Weekly Review");
  });

  it("replaces null character", () => {
    expect(h1ToFilename("A\x00B")).toBe("A B");
  });
});

describe("h1ToFilename (camel)", () => {
  it("uppercases first letter of each word and joins", () => {
    expect(h1ToFilename("My Meeting Notes", "camel")).toBe("MyMeetingNotes");
  });

  it("single word stays capitalised", () => {
    expect(h1ToFilename("hello", "camel")).toBe("Hello");
  });

  it("illegal chars replaced before camel-casing", () => {
    expect(h1ToFilename("Notes: Day 1", "camel")).toBe("NotesDay1");
  });

  it("returns Untitled when all chars are illegal", () => {
    expect(h1ToFilename("///", "camel")).toBe("Untitled");
  });

  it("already-capitalised words stay capitalised", () => {
    expect(h1ToFilename("My Weekly Review", "camel")).toBe("MyWeeklyReview");
  });
});

describe("h1ToFilename (kebab)", () => {
  it("lowercases and hyphenates words", () => {
    expect(h1ToFilename("My Meeting Notes", "kebab")).toBe("my-meeting-notes");
  });

  it("single word is lowercased", () => {
    expect(h1ToFilename("Hello", "kebab")).toBe("hello");
  });

  it("illegal chars replaced before kebab-casing", () => {
    expect(h1ToFilename("Notes: Day 1", "kebab")).toBe("notes-day-1");
  });

  it("returns Untitled when all chars are illegal", () => {
    expect(h1ToFilename("///", "kebab")).toBe("Untitled");
  });

  it("uppercase input is lowercased", () => {
    expect(h1ToFilename("My Weekly Review", "kebab")).toBe("my-weekly-review");
  });
});

// ── resolveConflictPath ───────────────────────────────────────────────────────

describe("resolveConflictPath", () => {
  it("returns primary path when no conflict", () => {
    expect(resolveConflictPath("/vault", "My Notes", {})).toBe("/vault/My Notes.md");
  });

  it("returns ' 2' variant when primary is taken", () => {
    const map = { "/vault/My Notes.md": true };
    expect(resolveConflictPath("/vault", "My Notes", map)).toBe("/vault/My Notes 2.md");
  });

  it("returns ' 3' variant when primary and ' 2' are taken", () => {
    const map = { "/vault/My Notes.md": true, "/vault/My Notes 2.md": true };
    expect(resolveConflictPath("/vault", "My Notes", map)).toBe("/vault/My Notes 3.md");
  });

  it("returns primary path with empty exists map", () => {
    expect(resolveConflictPath("/vault", "Notes", {})).toBe("/vault/Notes.md");
  });

  it("treats absent keys (undefined) as non-existent", () => {
    const map: Record<string, boolean> = {};
    expect(resolveConflictPath("/vault", "Notes", map)).toBe("/vault/Notes.md");
  });
});
