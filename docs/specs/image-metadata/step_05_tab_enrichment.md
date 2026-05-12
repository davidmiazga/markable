---
title: "Step 05 — tab.ts: Enrichment Phase Extension"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 05 — tab.ts: Enrichment Phase Extension

## Goal

Extend the enrichment phase in `renderFolderViewTabAsync` to:
1. Run when image built-in columns are requested (even when `config.extraFields` is empty)
2. For image file cards: call `get_image_dimensions`, `get_exif_data`, and read sidecars
3. For non-image, non-`.md` file cards: set `card.meta = {}`
4. For directory cards: `card.meta = {}` (already done; verify it is still covered)

All reads are concurrent (same `Promise.all` pattern as the existing `.md` enrichment).

## Prerequisites

- Step 01: Rust commands registered and callable via `__TAURI_INTERNALS__`
- Step 03: `BUILTIN_FIELDS` includes image keys (so `config.extraFields` does NOT contain them)
- Step 04: `IMAGE_EXTENSIONS` constant defined at module scope in `tab.ts`

---

## Files Modified

| File | Change |
|------|--------|
| `src/plugins/file-browser/folder-view/tab.ts` | Replace enrichment block (lines 232-264) with extended version |

---

## TDD Sequence

Create `tests/folder-view/tab-image-enrichment.test.ts`.

### Test setup

All tests mock `window.__TAURI_INTERNALS__.invoke`. Each test specifies exactly which
commands are invoked with which arguments. Use `vi.fn()` with `mockResolvedValueOnce` or
`mockImplementation` to return different values per command.

```typescript
let mockInvoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke = vi.fn();
  (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
  // ... other window globals
});
```

### Tests

```
IE-01  Image card with width+height requested, JPEG file → invoke("get_image_dimensions") called;
       card.meta["width"] = "1920", card.meta["height"] = "1080"

IE-02  Image card with date-taken+camera requested, JPEG file → invoke("get_exif_data") called;
       card.meta["date-taken"] = "2024-03-15", card.meta["camera"] = "Canon EOS R5"

IE-03  Image card, JPEG, width+height+date-taken+camera all requested →
       both get_image_dimensions and get_exif_data are invoked for the same card

IE-04  PNG file with date-taken requested → get_exif_data NOT invoked for PNG;
       card.meta["date-taken"] = "" (EXIF not supported for PNG, per FR-3)

IE-05  Image card with sidecar field "rating" requested →
       invoke("read_file", { path: card.path + ".md" }) called;
       extractFrontmatterKeys called; card.meta["rating"] = "5"

IE-06  Image card with sidecar field requested, sidecar does not exist →
       invoke("read_file") throws "File not found: ..."; card.meta["rating"] = "" (EC-1 guard)

IE-07  Non-image, non-.md file (.pdf) with width column declared →
       get_image_dimensions NOT called for .pdf; card.meta = {} (EC-6)

IE-08  Directory card with width column declared → card.meta = {} (EC-6 / FR-7)

IE-09  .md file card in the same folder → extractFrontmatterKeys called as before (no regression)

IE-10  get_image_dimensions throws for a truncated image → card.meta["width"] = "",
       card.meta["height"] = ""; other cards continue normally (FR-8 per-card error isolation)

IE-11  imageColumnsRequested=false, config.extraFields=[] → enrichment does NOT run;
       no invoke calls at all (NFR-5 performance guard)

IE-12  imageColumnsRequested=true, config.extraFields=[] → enrichment DOES run;
       get_image_dimensions invoked for image cards

IE-13  Folder with 5 image cards → all 5 get_image_dimensions calls made concurrently
       via Promise.all (verify all 5 invoke calls are made)

IE-14  EC-19: width column declared, folder has no image files (only .md files) →
       no image commands invoked; enrichment completes normally

IE-15  .heic file with date-taken requested → get_exif_data IS invoked (HEIC is in the
       EXIF-eligible extension list: jpg, jpeg, heic, heif)

IE-16  .webp file with date-taken requested → get_exif_data NOT invoked (WebP not in
       EXIF-eligible list); card.meta["date-taken"] = ""
```

---

## Implementation

### New constants (add near IMAGE_EXTENSIONS in tab.ts)

```typescript
/**
 * The four built-in image column identifiers. Must stay in sync with BUILTIN_FIELDS
 * in parser.ts. Used to detect when image enrichment is needed and to dispatch
 * dimension / EXIF reads vs sidecar reads within the enrichment loop.
 */
const IMAGE_BUILTIN_KEYS = new Set(["width", "height", "date-taken", "camera"]);

/**
 * Extensions eligible for EXIF data extraction (JPEG only for v1; HEIC/HEIF
 * returns Err from get_exif_data for now but is included for future readiness).
 */
const EXIF_ELIGIBLE_EXTS = new Set(["jpg", "jpeg", "heic", "heif"]);
```

### `imageColumnsRequested` helper (module scope, private)

```typescript
/**
 * Return true when the config requests at least one image built-in column.
 * Checks both config.fields (fields: mode) and config.extraFields (legacy mode).
 */
function imageColumnsRequested(config: FolderViewConfig): boolean {
  if (config.fields !== null) {
    return config.fields.some(f => IMAGE_BUILTIN_KEYS.has(f));
  }
  // Legacy mode: check extraFields (though image keys are unlikely here since they
  // are now in BUILTIN_FIELDS and would not appear in extraFields — defensive check).
  return config.extraFields.some(f => IMAGE_BUILTIN_KEYS.has(f.key));
}
```

### Updated enrichment guard and loop in `renderFolderViewTabAsync`

Replace the current enrichment block (the `if (layoutKey === "folder-table" && ...)` section):

```typescript
// Step 3a: Enrichment phase — read child metadata for folder-table columns.
// Runs when:
//   (a) extra-fields are declared (custom frontmatter columns), OR
//   (b) image built-in columns are requested (width, height, date-taken, camera).
// NFR-5: no enrichment runs for layouts other than folder-table or when neither
// condition is met.
const needsEnrichment =
  layoutKey === "folder-table" &&
  (config.extraFields.length > 0 || imageColumnsRequested(config));

if (needsEnrichment) {
  // Determine which field keys are needed per card type.
  // imageKeys: which of the four image built-ins are in config.fields / extraFields.
  // sidecarKeys: non-builtin keys from extraFields (used for .md cards AND sidecar reads).
  const allRequestedFields: string[] = config.fields !== null
    ? config.fields
    : config.extraFields.map(f => f.key);

  const requestedImageKeys = allRequestedFields.filter(f => IMAGE_BUILTIN_KEYS.has(f));
  const needsDimensions = requestedImageKeys.includes("width") || requestedImageKeys.includes("height");
  const needsExif = requestedImageKeys.includes("date-taken") || requestedImageKeys.includes("camera");
  // sidecarKeys = everything that is NOT a built-in (image or standard).
  // config.extraFields already excludes BUILTIN_FIELDS entries (parser.ts resolved them).
  const sidecarKeys = config.extraFields.map(f => f.key);

  // Initialise meta for non-.md file cards and directory cards so the renderer
  // can safely access card.meta without undefined checks.
  for (const card of cards) {
    if (card.kind !== "file" || card.ext !== ".md") {
      card.meta = {};
    }
  }

  // Enrich all cards concurrently (NFR-5: uncapped Promise.all, same as before).
  // Each per-card async callback handles its own error path (FR-8: one failure
  // must not abort the render for other cards).
  await Promise.all(
    cards.map(async (card) => {
      // ── Directory cards: no enrichment ────────────────────────────────────
      if (card.kind === "directory") return; // card.meta already = {}

      // ── .md file cards: unchanged path ────────────────────────────────────
      if (card.ext === ".md") {
        if (sidecarKeys.length === 0) return; // no custom fields requested
        try {
          const fileContent = await (window as any).__TAURI_INTERNALS__?.invoke?.(
            "read_file",
            { path: card.path },
          );
          const raw = typeof fileContent === "string"
            ? fileContent
            : (fileContent?.content ?? "");
          card.meta = extractFrontmatterKeys(raw, sidecarKeys);
        } catch {
          card.meta = {};
        }
        return;
      }

      // ── Non-.md file cards ─────────────────────────────────────────────────
      // Determine if this card is an image by checking its extension.
      const extRaw = card.ext.startsWith(".") ? card.ext.slice(1).toLowerCase() : card.ext.toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(extRaw);

      if (!isImage) {
        // Non-image, non-.md file (e.g. .pdf, .zip): meta stays {} (EC-6, FR-7).
        return;
      }

      // ── Image card enrichment ──────────────────────────────────────────────

      // 1. Image dimensions (FR-2)
      if (needsDimensions) {
        try {
          const dims = await (window as any).__TAURI_INTERNALS__?.invoke?.(
            "get_image_dimensions",
            { path: card.path },
          ) as [number, number];
          card.meta!["width"]  = String(dims[0]);
          card.meta!["height"] = String(dims[1]);
        } catch {
          // EC-1: truncated/unreadable → em-dash fallback in renderer.
          card.meta!["width"]  = "";
          card.meta!["height"] = "";
        }
      }

      // 2. EXIF data (FR-3) — only for EXIF-eligible extensions.
      if (needsExif) {
        if (EXIF_ELIGIBLE_EXTS.has(extRaw)) {
          try {
            const exif = await (window as any).__TAURI_INTERNALS__?.invoke?.(
              "get_exif_data",
              { path: card.path },
            ) as { date_taken: string | null; camera: string | null };
            card.meta!["date-taken"] = exif.date_taken ?? "";
            card.meta!["camera"]     = exif.camera ?? "";
          } catch {
            // EC-2: no Exif segment → em-dash fallback.
            card.meta!["date-taken"] = "";
            card.meta!["camera"]     = "";
          }
        } else {
          // PNG, GIF, WebP: EXIF not supported. Store "" so renderer shows em-dash.
          card.meta!["date-taken"] = "";
          card.meta!["camera"]     = "";
        }
      }

      // 3. Sidecar keys (FR-4) — read <image>.md if any non-builtin fields requested.
      if (sidecarKeys.length > 0) {
        const sidecarPath = card.path + ".md";
        try {
          const sidecarContent = await (window as any).__TAURI_INTERNALS__?.invoke?.(
            "read_file",
            { path: sidecarPath },
          );
          const raw = typeof sidecarContent === "string"
            ? sidecarContent
            : (sidecarContent?.content ?? "");
          const sidecarMeta = extractFrontmatterKeys(raw, sidecarKeys);
          // Merge sidecar meta into card.meta (image keys already set above).
          for (const k of sidecarKeys) {
            card.meta![k] = sidecarMeta[k] ?? "";
          }
        } catch {
          // EC-1 (sidecar variant): sidecar missing or unreadable → "" for each key.
          for (const k of sidecarKeys) {
            card.meta![k] = "";
          }
        }
      }
    }),
  );
}
```

### Note on card.meta initialization

`card.meta` is typed as `Record<string, string> | undefined` on `FolderCard`. The `card.meta = {}`
line in the non-`.md` pre-loop and the `card.meta!` assertions in the enrichment loop are
consistent: the pre-loop sets `{}` for all non-`.md` cards before any concurrent work begins,
so the `!` assertion is safe (it was just set in the synchronous pre-loop).

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/folder-view/tab-image-enrichment.test.ts` passes (IE-01 through IE-16)
- [ ] Existing `tests/folder-view/tab.test.ts` passes with no regressions
- [ ] `get_image_dimensions` is called only for image cards when `width` or `height` is requested
- [ ] `get_exif_data` is called only for jpg/jpeg/heic/heif cards when `date-taken` or `camera` is requested
- [ ] PNG/GIF/WebP cards get `card.meta["date-taken"] = ""` when `date-taken` is in fields (no EXIF invoke)
- [ ] Non-image, non-.md files get `card.meta = {}` (em-dash in all columns)
- [ ] `config.extraFields.length === 0` AND no image columns → enrichment skips entirely (NFR-5)
- [ ] `config.extraFields.length === 0` AND image columns requested → enrichment runs
