import { describe, it, expect } from "vitest";
import {
  classifyScanTag,
  foldVocabKey,
  nearDupClusters,
  relatedNested,
} from "../../src/lib/near-dup-clusters";

describe("foldVocabKey", () => {
  it("folds case and separators", () => {
    expect(foldVocabKey("Daily-Note")).toBe("dailynote");
    expect(foldVocabKey("daily_note")).toBe("dailynote");
    expect(foldVocabKey("daily note")).toBe("dailynote");
  });
});

describe("nearDupClusters", () => {
  it("clusters case variants", () => {
    const clusters = nearDupClusters(["Recipe", "recipe"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("case");
    expect(clusters[0].canonical).toBe("recipe");
    expect(clusters[0].members).toEqual(["recipe", "Recipe"]);
  });

  it("clusters hyphen / underscore / space", () => {
    const clusters = nearDupClusters(["daily-note", "daily_note", "daily note"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("separator");
    expect(clusters[0].canonical).toBe("daily-note");
  });

  it("clusters short edit-distance pairs", () => {
    const clusters = nearDupClusters(["colour", "color"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("edit-distance");
    expect(clusters[0].members).toEqual(["color", "colour"]);
  });

  it("does not cluster nested parent/child as near-dups", () => {
    expect(nearDupClusters(["work", "work/project"])).toHaveLength(0);
  });

  it("omits unique values", () => {
    expect(nearDupClusters(["home", "family", "finance"])).toHaveLength(0);
  });
});

describe("relatedNested", () => {
  it("lists children under an existing parent", () => {
    const rel = relatedNested(["work", "work/project", "home"]);
    expect(rel).toEqual([{ parent: "work", children: ["work/project"] }]);
  });
});

describe("classifyScanTag", () => {
  it("splits field:value pairs", () => {
    expect(classifyScanTag("status:draft")).toEqual({
      kind: "field",
      field: "status",
      value: "draft",
    });
  });

  it("keeps plain tags", () => {
    expect(classifyScanTag("recipe")).toEqual({ kind: "tag", value: "recipe" });
  });

  it("treats a Tags field as tags", () => {
    expect(classifyScanTag("Tags:Great")).toEqual({ kind: "tag", value: "Great" });
  });
});
