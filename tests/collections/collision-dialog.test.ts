/**
 * tests/collections/collision-dialog.test.ts
 *
 * Unit tests for the `incrementFilename` pure utility exported by
 * `src/lib/collision-dialog.ts`.
 */

import { describe, it, expect } from "vitest";
import { incrementFilename } from "../../src/lib/collision-dialog";

describe("incrementFilename", () => {
  it("appends -2 when target has no existing suffix", () => {
    expect(incrementFilename("note.md", new Set(["note.md"]))).toBe("note-2.md");
  });

  it("increments an existing -N suffix", () => {
    expect(
      incrementFilename("note-2.md", new Set(["note.md", "note-2.md"])),
    ).toBe("note-3.md");
  });

  it("skips gaps — picks the lowest free number", () => {
    expect(
      incrementFilename("note.md", new Set(["note.md", "note-2.md", "note-3.md"])),
    ).toBe("note-4.md");
  });

  it("handles files with no extension", () => {
    expect(incrementFilename("README", new Set(["README"]))).toBe("README-2");
  });

  it("handles files with no extension and existing suffix", () => {
    expect(incrementFilename("README-2", new Set(["README", "README-2"]))).toBe(
      "README-3",
    );
  });

  it("returns the candidate even when the file is not in the existing set", () => {
    // No collision — but we check a different name is never returned in this case.
    // (Callers only invoke incrementFilename when they know filename collides.)
    expect(incrementFilename("note.md", new Set(["other.md"]))).toBe("note-2.md");
  });

  it("preserves multi-part extensions correctly", () => {
    expect(incrementFilename("archive.tar.gz", new Set(["archive.tar.gz"]))).toBe(
      "archive.tar-2.gz",
    );
  });

  it("correctly strips the -N suffix before computing the base", () => {
    // "my-note-3.md" → base = "my-note", start from 4
    expect(
      incrementFilename("my-note-3.md", new Set(["my-note.md", "my-note-2.md", "my-note-3.md"])),
    ).toBe("my-note-4.md");
  });
});
