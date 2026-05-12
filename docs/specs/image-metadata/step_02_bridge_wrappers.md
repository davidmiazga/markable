---
title: "Step 02 — bridge.ts Typed Wrappers"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 02 — bridge.ts Typed Wrappers

## Goal

Add three typed wrapper functions to `src/lib/bridge.ts`. These follow the exact
`FileResult<T>` pattern used by all existing wrappers. They are NOT used by the plugin
(the plugin uses `__TAURI_INTERNALS__` directly) but they exist per FR-10 and project
convention for non-plugin consumers and documentation.

## Prerequisite

Step 01 complete: the three Rust commands are registered and visible in the invoke handler.

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/bridge.ts` | Append three functions after the last existing function |

---

## TDD Sequence

The existing `tests/bridge.test.ts` covers `readFile` and `writeFile`. Add a new test
file `tests/bridge-image-metadata.test.ts` that tests the three new wrappers.

### Test file: `tests/bridge-image-metadata.test.ts`

Pattern: mock `@tauri-apps/api/core`'s `invoke` via `vi.mock`, verify the wrapper calls
the correct command with the correct args, and maps success/failure to `FileResult`.

Tests:

- `BW-01` `getImageDimensions` calls `invoke("get_image_dimensions", { path })` and returns
  `{ ok: true, value: { width: 1920, height: 1080 } }` on success (Rust returns a tuple
  `[1920, 1080]`; note the Rust tuple serialises as a JSON array `[w, h]`).
- `BW-02` `getImageDimensions` returns `{ ok: false, error: { message, command, path } }` on failure.
- `BW-03` `getExifData` calls `invoke("get_exif_data", { path })` and returns
  `{ ok: true, value: { dateTaken: "2024-03-15", camera: "Canon EOS R5" } }`.
- `BW-04` `getExifData` maps `null` date and camera to `null` in the value (Rust `None` → JSON `null`).
- `BW-05` `getExifData` returns `{ ok: false, error: {...} }` on failure.
- `BW-06` `sidecarExists` calls `invoke("sidecar_exists", { path })` and returns
  `{ ok: true, value: true }`.
- `BW-07` `sidecarExists` returns `{ ok: true, value: false }` when invoke returns false.
- `BW-08` `sidecarExists` returns `{ ok: false, error: {...} }` on invoke rejection.

---

## Implementation

### Type note: Rust tuple serialisation

A Rust `Result<(u32, u32), String>` serialises the success value as a JSON array `[w, h]`.
The bridge wrapper must destructure this:

```typescript
const [width, height] = await invoke<[number, number]>("get_image_dimensions", { path });
return { ok: true, value: { width, height } };
```

### `getImageDimensions`

```typescript
/**
 * Read image dimensions (width × height in pixels) from the file header.
 *
 * Supports JPEG, PNG, GIF, WebP, and HEIC/HEIF. Header-only read — no full decode.
 * The plugin calls get_image_dimensions directly via __TAURI_INTERNALS__; this wrapper
 * exists for non-plugin consumers and type documentation (FR-10).
 *
 * @param path - Absolute path to the image file.
 * @returns FileResult<{ width: number; height: number }> — never throws.
 */
export async function getImageDimensions(
  path: string,
): Promise<FileResult<{ width: number; height: number }>> {
  try {
    const [width, height] = await invoke<[number, number]>("get_image_dimensions", { path });
    return { ok: true, value: { width, height } };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_image_dimensions",
        path,
      } satisfies TauriCommandError,
    };
  }
}
```

### `getExifData`

```typescript
/**
 * Read Exif metadata from a JPEG image file.
 *
 * Returns DateTimeOriginal as YYYY-MM-DD and camera as "Make Model" string.
 * Both fields are null when the Exif tag is absent.
 * JPEG only for v1 (HEIC/HEIF Exif is out of scope).
 * The plugin calls get_exif_data directly via __TAURI_INTERNALS__; this wrapper
 * exists for non-plugin consumers and type documentation (FR-10).
 *
 * @param path - Absolute path to the JPEG file.
 * @returns FileResult<{ dateTaken: string | null; camera: string | null }> — never throws.
 */
export async function getExifData(
  path: string,
): Promise<FileResult<{ dateTaken: string | null; camera: string | null }>> {
  try {
    const data = await invoke<{ date_taken: string | null; camera: string | null }>(
      "get_exif_data",
      { path },
    );
    return {
      ok: true,
      value: {
        dateTaken: data.date_taken,
        camera: data.camera,
      },
    };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_exif_data",
        path,
      } satisfies TauriCommandError,
    };
  }
}
```

Note: The Rust struct uses `snake_case` field names (`date_taken`, `camera`). Tauri's
default serde serialisation with `#[derive(serde::Serialize)]` and no `rename_all` attribute
preserves snake_case. The bridge wrapper explicitly maps `date_taken` → `dateTaken` for the
TypeScript-idiomatic return shape.

If the Rust struct uses `#[serde(rename_all = "camelCase")]`, then the invoke type should
use `dateTaken` directly. The step_01 spec does NOT add `rename_all`, so snake_case is used
in the invoke call and remapped in the bridge wrapper. The developer must verify this matches
the actual Rust serialisation and adjust if needed.

### `sidecarExists`

```typescript
/**
 * Check whether a sidecar file (path + ".md") exists on disk.
 *
 * Returns true if the sidecar file exists as a regular file.
 * The plugin calls sidecar_exists directly via __TAURI_INTERNALS__; this wrapper
 * exists per convention (FR-10). Note: executeBulkYaml does NOT call this — it writes
 * directly via write_file, which creates the file if absent (NFR-7).
 *
 * @param path - Absolute path to the source file (e.g. "/vault/photo.jpg").
 *               The sidecar path checked is path + ".md".
 * @returns FileResult<boolean> — never throws.
 */
export async function sidecarExists(
  path: string,
): Promise<FileResult<boolean>> {
  try {
    const exists = await invoke<boolean>("sidecar_exists", { path });
    return { ok: true, value: exists };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "sidecar_exists",
        path,
      } satisfies TauriCommandError,
    };
  }
}
```

---

## Placement in bridge.ts

Append the three functions at the end of `src/lib/bridge.ts`, after the `moveFile` function
(the current last function). Maintain the existing section comment style.

Add a section header comment before the three functions:

```typescript
// ── Image metadata commands ───────────────────────────────────────────────────
```

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/bridge-image-metadata.test.ts` passes (all 8 tests green)
- [ ] `getImageDimensions` is exported from `bridge.ts`
- [ ] `getExifData` is exported from `bridge.ts`
- [ ] `sidecarExists` is exported from `bridge.ts`
- [ ] All three return `FileResult<T>` (same pattern as `readFile`, `writeFile`)
- [ ] No imports added to bridge.ts other than the functions themselves
  (types `FileResult`, `TauriCommandError` are already imported)
