/**
 * The Dashboard command opens the folder that contains the active note.
 */

import { describe, it, expect } from "vitest";
import { folderOfNote } from "../src/lib/note-folder";

describe("Dashboard command", () => {
  it("uses the active note's folder", () => {
    expect(folderOfNote("/vault/notes/today.md")).toBe("/vault/notes");
    expect(folderOfNote("C:\\vault\\notes\\today.md")).toBe("C:\\vault\\notes");
    expect(folderOfNote(null)).toBeNull();
    expect(folderOfNote("today.md")).toBeNull();
  });
});
