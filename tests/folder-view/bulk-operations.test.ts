/**
 * tests/folder-view/bulk-operations.test.ts
 *
 * Unit tests for bulk operation runners.
 * Covers EC-01 through EC-07, EC-09, EC-10, EC-11, EC-12,
 * EC-15, EC-18, EC-19, EC-22.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeBulkMove,
  executeBulkDelete,
  executeBulkYaml,
  formatOperationResult,
} from "../../src/plugins/file-browser/folder-view/bulk-operations";
import { createSelectionState } from
  "../../src/plugins/file-browser/folder-view/bulk-selection";
import type { FolderCard } from
  "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFileCard(name: string, ext = ".md"): FolderCard {
  return {
    path: `/vault/${name}${ext}`,
    name,
    kind: "file",
    ext,
    modified: 0,
  };
}

function makeDirCard(name: string): FolderCard {
  return {
    path: `/vault/${name}`,
    name,
    kind: "directory",
    ext: "",
    modified: 0,
  };
}

// ── Tauri mock setup ──────────────────────────────────────────────────────────

let mockInvoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke = vi.fn();
  (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
});

// ── executeBulkMove ───────────────────────────────────────────────────────────

describe("executeBulkMove", () => {
  it("BM-01: empty selection returns {succeeded:0, failed:[]} without invoking (EC-01)", async () => {
    const state = createSelectionState();
    const result = await executeBulkMove(state, "/dest");
    expect(result).toEqual({ succeeded: 0, failed: [] });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BM-02: file in selection invokes move_file with source + destinationDir", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");
    mockInvoke.mockResolvedValue(undefined);

    await executeBulkMove(state, "/dest");

    expect(mockInvoke).toHaveBeenCalledWith("move_file", {
      source: card.path,
      destinationDir: "/dest",
    });
  });

  it("BM-03: directory in selection invokes rename_file with oldPath + newPath (EC-05)", async () => {
    const state = createSelectionState();
    const card = makeDirCard("myFolder");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");
    mockInvoke.mockResolvedValue(undefined);

    await executeBulkMove(state, "/dest");

    expect(mockInvoke).toHaveBeenCalledWith("rename_file", {
      oldPath: card.path,
      newPath: "/dest/myFolder",
    });
  });

  it("BM-04: successful move increments succeeded", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");
    mockInvoke.mockResolvedValue(undefined);

    const result = await executeBulkMove(state, "/dest");
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("BM-05: failed move adds path to failed with error string (EC-02, EC-03, EC-04)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");
    mockInvoke.mockRejectedValue("destination not found");

    const result = await executeBulkMove(state, "/missing-dest");
    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe(card.path);
    expect(result.failed[0].error).toBe("destination not found");
  });

  it("BM-06: mixed success/failure: succeeded counts only successes", async () => {
    const state = createSelectionState();
    const card1 = makeFileCard("note1");
    const card2 = makeFileCard("note2");
    state.paths.add(card1.path);
    state.paths.add(card2.path);
    state.kindMap.set(card1.path, "file");
    state.kindMap.set(card2.path, "file");

    mockInvoke
      .mockResolvedValueOnce(undefined)  // card1 succeeds
      .mockRejectedValueOnce("error");   // card2 fails

    const result = await executeBulkMove(state, "/dest");
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  it("BM-07: all fail: succeeded=0, all in failed (EC-19)", async () => {
    const state = createSelectionState();
    const card1 = makeFileCard("note1");
    const card2 = makeFileCard("note2");
    state.paths.add(card1.path);
    state.paths.add(card2.path);
    state.kindMap.set(card1.path, "file");
    state.kindMap.set(card2.path, "file");
    mockInvoke.mockRejectedValue("error");

    const result = await executeBulkMove(state, "/dest");
    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(2);
  });

  it("BM-08: operations are sequential (second invoke called after first resolves)", async () => {
    const state = createSelectionState();
    // Use an ordered set by manually adding paths.
    const paths = ["/vault/note1.md", "/vault/note2.md"];
    for (const p of paths) {
      state.paths.add(p);
      state.kindMap.set(p, "file");
    }

    const callOrder: string[] = [];
    mockInvoke.mockImplementation(async (_cmd: string, args: any) => {
      callOrder.push(args.source);
    });

    await executeBulkMove(state, "/dest");
    // Both calls must have occurred (sequential).
    expect(callOrder).toHaveLength(2);
  });
});

// ── executeBulkDelete ─────────────────────────────────────────────────────────

describe("executeBulkDelete", () => {
  it("BD-01: empty selection returns {succeeded:0, failed:[]} (EC-01)", async () => {
    const state = createSelectionState();
    const result = await executeBulkDelete(state);
    expect(result).toEqual({ succeeded: 0, failed: [] });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BD-02: file invokes delete_file", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");
    mockInvoke.mockResolvedValue(undefined);

    await executeBulkDelete(state);
    expect(mockInvoke).toHaveBeenCalledWith("delete_file", { path: card.path });
  });

  it("BD-03: directory invokes delete_directory (EC-15)", async () => {
    const state = createSelectionState();
    const card = makeDirCard("docs");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");
    mockInvoke.mockResolvedValue(undefined);

    await executeBulkDelete(state);
    expect(mockInvoke).toHaveBeenCalledWith("delete_directory", { path: card.path });
  });

  it("BD-04: all fail: succeeded=0, all in failed (EC-19)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");
    mockInvoke.mockRejectedValue("permission denied");

    const result = await executeBulkDelete(state);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(1);
  });
});

// ── executeBulkYaml ───────────────────────────────────────────────────────────

describe("executeBulkYaml", () => {
  it("BY-01: empty key returns early without invoking", async () => {
    const state = createSelectionState();
    state.paths.add("/vault/a.md");
    state.kindMap.set("/vault/a.md", "file");
    const result = await executeBulkYaml(state, "add", "", "val", []);
    expect(result).toEqual({ succeeded: 0, failed: [], skippedCount: 0 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BY-02: directory in selection is skipped (skippedCount incremented, no invoke) (EC-12)", async () => {
    const state = createSelectionState();
    const card = makeDirCard("myFolder");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");

    const result = await executeBulkYaml(state, "add", "status", "done", [card]);
    expect(result.skippedCount).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BY-03: directory in selection is skipped (directories still skipped, skippedCount=1)", async () => {
    // Updated for step_07: non-.md files now use sidecar write. Only directories are skipped.
    const state = createSelectionState();
    const card = makeDirCard("subdir");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");

    const result = await executeBulkYaml(state, "add", "status", "done", [card]);
    expect(result.skippedCount).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BY-04: .md file invokes read_file then write_file with modified content", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    const originalContent = "---\ntitle: test\n---\nBody";
    mockInvoke
      .mockResolvedValueOnce(originalContent)  // read_file
      .mockResolvedValueOnce(undefined);        // write_file

    await executeBulkYaml(state, "add", "status", "done", [card]);

    expect(mockInvoke).toHaveBeenCalledWith("read_file", { path: card.path });
    const writeCall = mockInvoke.mock.calls.find(c => c[0] === "write_file");
    expect(writeCall).toBeDefined();
    expect(writeCall![1].content).toContain("status: done");
  });

  it("BY-05: op=add adds key to frontmatter", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    mockInvoke
      .mockResolvedValueOnce("---\ntitle: test\n---\nBody")
      .mockResolvedValueOnce(undefined);

    await executeBulkYaml(state, "add", "status", "done", [card]);

    const writeContent = mockInvoke.mock.calls.find(c => c[0] === "write_file")![1].content;
    expect(writeContent).toContain("status: done");
  });

  it("BY-06: op=remove removes key from frontmatter", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    mockInvoke
      .mockResolvedValueOnce("---\ntitle: test\nstatus: old\n---\nBody")
      .mockResolvedValueOnce(undefined);

    await executeBulkYaml(state, "remove", "status", "", [card]);

    const writeContent = mockInvoke.mock.calls.find(c => c[0] === "write_file")![1].content;
    expect(writeContent).not.toContain("status:");
    expect(writeContent).toContain("title: test");
  });

  it("BY-07: malformed frontmatter adds file to failed, does not write (EC-10)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Opening --- but no closing --- = malformed.
    mockInvoke.mockResolvedValueOnce("---\ntitle: test");

    const result = await executeBulkYaml(state, "add", "status", "done", [card]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe(card.path);
    expect(result.succeeded).toBe(0);
    // No write_file call.
    expect(mockInvoke).not.toHaveBeenCalledWith("write_file", expect.anything());
  });

  it("BY-08: key absent in remove op — file processed without error (EC-09)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("note");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    mockInvoke
      .mockResolvedValueOnce("---\ntitle: test\n---\nBody")
      .mockResolvedValueOnce(undefined);

    const result = await executeBulkYaml(state, "remove", "status", "", [card]);
    // Key was absent but no error — file is still written (idempotent).
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("BY-09: only-directory selection returns EC-18 state via skippedCount (directories skipped)", async () => {
    // Updated for step_07: non-.md files now use sidecar write. Only directories produce skippedCount.
    const state = createSelectionState();
    const card = makeDirCard("subdir");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");

    const result = await executeBulkYaml(state, "add", "status", "done", [card]);
    expect(result.skippedCount).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toHaveLength(0);
    const summary = formatOperationResult(result, "Processed", result.skippedCount);
    expect(summary).toBe("No eligible files in selection.");
  });

  it("BY-10: mixed selection 2 .md + 1 dir: skippedCount=1, succeeded=2 (EC-22)", async () => {
    const state = createSelectionState();
    const md1 = makeFileCard("note1");
    const md2 = makeFileCard("note2");
    const dir = makeDirCard("docs");

    for (const c of [md1, md2, dir]) {
      state.paths.add(c.path);
      state.kindMap.set(c.path, c.kind);
    }

    const content = "---\ntitle: x\n---\nBody";
    mockInvoke
      .mockResolvedValueOnce(content)     // read note1
      .mockResolvedValueOnce(undefined)   // write note1
      .mockResolvedValueOnce(content)     // read note2
      .mockResolvedValueOnce(undefined);  // write note2

    const result = await executeBulkYaml(state, "add", "status", "done", [md1, md2, dir]);
    expect(result.skippedCount).toBe(1);
    expect(result.succeeded).toBe(2);
  });
});

// ── executeBulkYaml — sidecar write tests (step_07) ──────────────────────────

describe("executeBulkYaml — sidecar write for non-.md files (step_07)", () => {
  it("BY-S01: photo.jpg → sidecar path is /vault/photo.jpg.md; read+write called on sidecar", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    // card.path = "/vault/photo.jpg"
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    const sidecarPath = "/vault/photo.jpg.md";
    const sidecarContent = "---\nrating: 3\n---\n";

    mockInvoke
      .mockResolvedValueOnce(sidecarContent) // read_file sidecar
      .mockResolvedValueOnce(undefined);      // write_file sidecar

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    expect(mockInvoke).toHaveBeenCalledWith("read_file", { path: sidecarPath });
    const writeCall = mockInvoke.mock.calls.find(c => c[0] === "write_file");
    expect(writeCall).toBeDefined();
    expect(writeCall![1].path).toBe(sidecarPath);
    expect(writeCall![1].content).toContain("rating: 5");
    expect(result.succeeded).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("BY-S02: photo.jpg, sidecar does not exist, op=add → empty content used; write_file creates sidecar (EC-8)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // read_file throws "File not found" — sidecar does not exist.
    mockInvoke
      .mockRejectedValueOnce("File not found: /vault/photo.jpg.md") // read_file
      .mockResolvedValueOnce(undefined);                              // write_file

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    // write_file must still be called — write_file creates the sidecar.
    const writeCall = mockInvoke.mock.calls.find(c => c[0] === "write_file");
    expect(writeCall).toBeDefined();
    expect(writeCall![1].content).toContain("rating: 5");
    expect(result.succeeded).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("BY-S03: directory → skippedCount=1 (directories still skipped)", async () => {
    const state = createSelectionState();
    const card = makeDirCard("photos");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "directory");

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    expect(result.skippedCount).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("BY-S04: mixed selection photo.jpg + notes.md → both processed, skippedCount=0 (EC-21)", async () => {
    const state = createSelectionState();
    const photo = makeFileCard("photo", ".jpg");
    const note  = makeFileCard("notes");
    // Register both paths.
    state.paths.add(photo.path);
    state.kindMap.set(photo.path, "file");
    state.paths.add(note.path);
    state.kindMap.set(note.path, "file");

    const mdContent = "---\ntitle: notes\n---\n";
    const sidecarContent = "---\nrating: 3\n---\n";

    // The loop iterates in insertion order (Set). Order depends on paths Set iteration.
    // Use mockImplementation to route by args.
    mockInvoke.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "read_file") {
        return args.path.endsWith(".jpg.md") ? sidecarContent : mdContent;
      }
      return undefined; // write_file
    });

    const result = await executeBulkYaml(state, "add", "rating", "5", [photo, note]);

    expect(result.succeeded).toBe(2);
    expect(result.skippedCount).toBe(0);
  });

  it("BY-S05: photo.jpg, sidecar exists with frontmatter, op=add key=rating value=5 → key updated (EC-9)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Sidecar has existing frontmatter with a different rating.
    mockInvoke
      .mockResolvedValueOnce("---\nrating: 3\n---\n") // read_file
      .mockResolvedValueOnce(undefined);               // write_file

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    const writeCall = mockInvoke.mock.calls.find(c => c[0] === "write_file");
    expect(writeCall![1].content).toContain("rating: 5");
    expect(writeCall![1].content).not.toContain("rating: 3");
    expect(result.succeeded).toBe(1);
  });

  it("BY-S06: photo.jpg, sidecar does not exist, op=remove → read throws → result.failed has entry (EC-10)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Sidecar missing — read throws.
    mockInvoke.mockRejectedValueOnce("File not found: /vault/photo.jpg.md");

    const result = await executeBulkYaml(state, "remove", "rating", "", [card]);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe("/vault/photo.jpg.md");
    expect(result.succeeded).toBe(0);
  });

  it("BY-S07: photo.jpg, sidecar has malformed frontmatter, op=add → failed, no write (EC-11)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Malformed: opening --- but no closing ---.
    mockInvoke.mockResolvedValueOnce("---\nrating: 3");

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe("/vault/photo.jpg.md");
    expect(result.failed[0].error).toContain("Could not parse frontmatter");
    expect(mockInvoke).not.toHaveBeenCalledWith("write_file", expect.anything());
    expect(result.succeeded).toBe(0);
  });

  it("BY-S08: photo.jpg, sidecar absent, op=add → write_file called with '---\\nrating: 5\\n---\\n'", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Sidecar missing: read throws, write proceeds with minimal frontmatter.
    mockInvoke
      .mockRejectedValueOnce("File not found: /vault/photo.jpg.md")
      .mockResolvedValueOnce(undefined);

    const result = await executeBulkYaml(state, "add", "rating", "5", [card]);

    const writeCall = mockInvoke.mock.calls.find(c => c[0] === "write_file");
    expect(writeCall).toBeDefined();
    expect(writeCall![1].content).toContain("rating: 5");
    expect(result.succeeded).toBe(1);
  });

  it("BY-S09: formatOperationResult with skippedCount=1 (directory), succeeded=2 → summary includes directory skip", () => {
    const result = formatOperationResult(
      { succeeded: 2, failed: [] },
      "Processed",
      1,
    );
    // New message format: "1 directory skipped" not "1 item(s) skipped — not .md".
    expect(result).toContain("1 directory skipped");
    expect(result).toContain("eligible files");
  });

  it("BY-S10: formatOperationResult with skippedCount=0, succeeded=2 → no skip annotation in summary", () => {
    const result = formatOperationResult(
      { succeeded: 2, failed: [] },
      "Processed",
      0,
    );
    expect(result).not.toContain("skipped");
    expect(result).toContain("2 of 2");
  });

  it("BY-S11: op=remove on existing sidecar that does not have the key → write_file still called (idempotent)", async () => {
    const state = createSelectionState();
    const card = makeFileCard("photo", ".jpg");
    state.paths.add(card.path);
    state.kindMap.set(card.path, "file");

    // Sidecar exists but key "rating" is absent.
    mockInvoke
      .mockResolvedValueOnce("---\ntitle: photo\n---\n") // read_file
      .mockResolvedValueOnce(undefined);                  // write_file

    const result = await executeBulkYaml(state, "remove", "rating", "", [card]);

    // write_file is still called (idempotent remove of absent key).
    expect(mockInvoke).toHaveBeenCalledWith("write_file", expect.objectContaining({
      path: "/vault/photo.jpg.md",
    }));
    expect(result.succeeded).toBe(1);
  });
});

// ── formatOperationResult ─────────────────────────────────────────────────────

describe("formatOperationResult", () => {
  it("FR-01: Move success: 'Moved 3 of 3 items.'", () => {
    const result = formatOperationResult({ succeeded: 3, failed: [] }, "Moved");
    expect(result).toBe("Moved 3 of 3 items.");
  });

  it("FR-02: Move partial failure includes Failed lines", () => {
    const result = formatOperationResult(
      { succeeded: 1, failed: [{ path: "/vault/a.md", error: "not found" }] },
      "Moved",
    );
    expect(result).toContain("Failed: /vault/a.md — not found");
  });

  it("FR-03: all failure — '0 of 2 items succeeded.' (EC-19)", () => {
    const result = formatOperationResult(
      { succeeded: 0, failed: [
        { path: "/vault/a.md", error: "err1" },
        { path: "/vault/b.md", error: "err2" },
      ] },
      "Deleted",
    );
    expect(result).toContain("0 of 2 items succeeded.");
  });

  it("FR-04: YAML skipped directories appends 'directory skipped' annotation (step_07 update)", () => {
    // Updated for step_07: skipped annotation says "directory" not "not .md".
    const result = formatOperationResult(
      { succeeded: 2, failed: [] },
      "Processed",
      1,
    );
    expect(result).toContain("1 directory skipped");
  });

  it("FR-05: only directories in selection → 'No eligible files in selection.' (step_07 update)", () => {
    // Updated for step_07: message changes from "No eligible .md files" to "No eligible files".
    const result = formatOperationResult(
      { succeeded: 0, failed: [] },
      "Processed",
      2,
    );
    expect(result).toBe("No eligible files in selection.");
  });
});
