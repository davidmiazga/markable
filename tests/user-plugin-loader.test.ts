/**
 * Tests for UserPluginLoader (src/plugins/user-plugin-loader.ts).
 *
 * evaluatePlugin() is a pure synchronous function (new Function eval).
 * All cases are testable without a real DOM or Tauri runtime.
 */

import { describe, it, expect } from "vitest";
import { evaluatePlugin } from "../src/plugins/user-plugin-loader";

const MINIMAL_PLUGIN = `
return {
  id: "test-plugin",
  name: "Test Plugin",
  description: "A test plugin.",
  onEnable(api) {},
  onDisable(api) {},
};
`;

describe("evaluatePlugin()", () => {
  it("returns ok:true for a valid minimal plugin", () => {
    const result = evaluatePlugin(MINIMAL_PLUGIN, "test.js");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.id).toBe("test-plugin");
      expect(result.plugin.name).toBe("Test Plugin");
    }
  });

  it("EC-2: rejects empty source", () => {
    const result = evaluatePlugin("", "empty.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("EC-2: rejects whitespace-only source", () => {
    const result = evaluatePlugin("   \n\t  ", "ws.js");
    expect(result.ok).toBe(false);
  });

  it("EC-3: rejects source with a syntax error", () => {
    const result = evaluatePlugin("return { id: 'x', ;;; }", "bad-syntax.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("evaluation error");
  });

  it("EC-4: rejects source that returns null", () => {
    const result = evaluatePlugin("return null;", "null.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not an object");
  });

  it("EC-4: rejects source that returns a string", () => {
    const result = evaluatePlugin('return "hello";', "string.js");
    expect(result.ok).toBe(false);
  });

  it("EC-5: rejects plugin missing 'id' field", () => {
    const src = `return { name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "no-id.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("id");
  });

  it("EC-5: reports all missing fields in the error message", () => {
    const src = `return { id: "x" };`;
    const result = evaluatePlugin(src, "partial.js");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("name");
      expect(result.reason).toContain("description");
      expect(result.reason).toContain("onEnable");
      expect(result.reason).toContain("onDisable");
    }
  });

  it("EC-20: rejects plugin with empty id", () => {
    const src = `return { id: "", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "empty-id.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("id");
  });

  it("EC-20: rejects plugin id containing '.'", () => {
    const src = `return { id: "foo.bar", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "dotted-id.js");
    expect(result.ok).toBe(false);
  });

  it("EC-20: rejects plugin id containing '/'", () => {
    const src = `return { id: "foo/bar", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "slash-id.js");
    expect(result.ok).toBe(false);
  });

  it("filename is included in error result", () => {
    const result = evaluatePlugin("return null;", "specific-file.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.filename).toBe("specific-file.js");
  });

  it("accepts plugin with optional detail field", () => {
    const src = `
      return {
        id: "plugin-with-detail",
        name: "X",
        description: "Y",
        detail: "Long description.",
        onEnable(api) {},
        onDisable(api) {},
      };
    `;
    const result = evaluatePlugin(src, "detail.js");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plugin.detail).toBe("Long description.");
  });
});
