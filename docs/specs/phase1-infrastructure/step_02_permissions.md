# Step 02: Tauri v2 Capabilities & Permissions (R2)

**Requirement:** R2 — Tauri v2 Permission Scopes
**Acceptance Criteria:** No "permission denied" errors during file I/O, scopes are granular (not blanket), capabilities/default.json properly configured

---

## Overview

Tauri v2 uses a **capability-based security model** where each app action (file I/O, dialogs, window control, events) is explicitly granted through capability definitions in `src-tauri/capabilities/default.json`. This step defines granular permissions that allow file operations and dialogs while enforcing the principle of least privilege.

**Output:** A complete `capabilities/default.json` with rationale-documented permission scopes for file system access, dialog operations, and core window/event functionality.

---

## Tauri v2 Capability Model: Key Concepts

### Difference from Tauri v1

| Aspect | Tauri v1 | Tauri v2 |
|--------|----------|----------|
| **Permission Syntax** | Features in tauri.conf.json | Capabilities in separate default.json |
| **Inheritance** | All windows inherit all permissions | Each capability is explicit and can be overridden per window |
| **Granularity** | Feature-based (e.g., "fs") | Action-based (e.g., "fs:allow-read-file", "fs:allow-write-file") |
| **Denial** | Allow/deny lists | Explicit permission grants only |
| **Default Behavior** | Deny by default, explicitly allow | Deny by default, explicitly allow (same, but more verbose) |

### v2 Permission Syntax

Tauri v2 uses **domain:action format**:

- `core:window:allow-show` — Allow the window to call `show()`
- `fs:allow-read-file` — Allow reading individual files
- `fs:allow-write-file` — Allow writing individual files
- `dialog:allow-open` — Allow open file dialogs
- `dialog:allow-save` — Allow save file dialogs
- `core:event:allow-emit` — Allow emitting events from Rust to frontend
- `core:event:allow-listen` — Allow frontend to listen for events

### Security Principle

**Least Privilege:** Only grant permissions that the app absolutely needs. For Markable 2.0:

- **File operations:** Only allow read/write to user-selected files (scoped by dialog)
- **Dialogs:** Allow opening file dialogs for selection
- **Window control:** Allow showing the window (initially hidden by design)
- **Events:** Allow Rust ↔ TypeScript event communication

---

## Implementation

### Task 2.1: Create src-tauri/capabilities/default.json

Create the capabilities directory and configuration file with the exact structure below:

**File: `src-tauri/capabilities/default.json`**

```json
{
  "version": 1,
  "identifier": "main-capability",
  "description": "Minimal capability set for Markable 2.0 Phase 1",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:event:allow-emit",
    "core:event:allow-listen",
    "fs:default",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

### Explanation of Each Permission

| Permission | Purpose | Rationale |
|---|---|---|
| `core:default` | Core Tauri functionality | Required for command invocation and basic app lifecycle |
| `core:window:allow-show` | Allow window.show() command | Initial window is hidden on startup; this allows showing it |
| `core:event:allow-emit` | Rust → TypeScript event channel | For future event-based communication (Phase 2+) |
| `core:event:allow-listen` | TypeScript → Rust event listeners | For frontend to listen for Rust-initiated events |
| `fs:default` | Base filesystem permission | Enables filesystem operations; granular allow-* directives limit scope |
| `fs:allow-read-file` | Allow reading files | Enables `read_file` Rust command (step 04) |
| `fs:allow-write-file` | Allow writing files | Enables `write_file` Rust command (step 04) |
| `dialog:default` | Base dialog permission | Enables dialog operations |
| `dialog:allow-open` | Allow file open dialogs | Enables `open_file_dialog` Rust command (step 06) |
| `dialog:allow-save` | Allow file save dialogs | Enables `save_file_dialog` Rust command (step 06) |

### What We Explicitly DO NOT Grant

| Permission | Why Denied | Impact |
|---|---|---|
| `fs:allow-read-dir` | Not needed for Phase 1 | Prevents directory listing (file dialogs return explicit paths) |
| `fs:allow-read-text-file`, `fs:allow-read-binary-file` | Too generic | Use granular `allow-read-file` instead |
| `fs:allow-write-text-file` | Too generic | Use granular `allow-write-file` instead |
| `fs:allow-delete` | Not implemented | No delete operations in Phase 1 |
| `fs:allow-rename` | Not implemented | No rename operations in Phase 1 |
| `fs:allow-mkdir` | Not implemented | No directory creation in Phase 1 |
| `app:allow-exit` | Not needed | App exit is implicit on window close |
| `dialog:allow-ask`, `dialog:allow-confirm`, `dialog:allow-message` | Not implemented | Only file dialogs in Phase 1 |

---

### Task 2.2: Update src-tauri/tauri.conf.json to Reference Capabilities

The scaffolding creates a `src-tauri/tauri.conf.json`. Update it to reference the capabilities directory:

**File: `src-tauri/tauri.conf.json` (add this section if not present)**

Locate the `tauri` section and add (or verify) the `security` block:

```json
{
  "tauri": {
    "security": {
      "csp": null,
      "capabilities": ["src-tauri/capabilities/default.json"]
    }
  }
}
```

If `security` already exists, just update `capabilities` to reference the new file.

**Key settings:**
- `"csp": null` — Content Security Policy is not enforced in dev; can be tightened later
- `"capabilities": ["src-tauri/capabilities/default.json"]` — Load our custom capabilities from this file

---

### Task 2.3: Create src-tauri/capabilities/ Directory (if not already created by scaffolding)

```bash
mkdir -p /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/src-tauri/capabilities
```

**Verify directory exists:**

```bash
ls -la src-tauri/capabilities/
```

---

### Task 2.4: Add Documentation Comment to capabilities/default.json

Include a comment block explaining the capability design (not in JSON directly, but in a sidecar .md file):

**File: `src-tauri/capabilities/README.md` (documentation)**

```markdown
# Tauri v2 Capabilities for Markable 2.0

## Overview

This directory contains Tauri capability definitions for Markable 2.0 Phase 1.

## default.json

Defines the minimal permission set required for:
- File I/O (read/write via user-selected paths)
- File dialogs (open/save)
- Window control (show/hide)
- Event communication (Rust ↔ TypeScript)

## Permission Scoping

All filesystem operations are scoped to files explicitly selected by the user via dialogs.
The Rust side validates all file paths and implements proper error handling.

## Future Enhancements

Phase 2+ may add:
- `fs:allow-read-dir` (for workspace scanning)
- `fs:allow-delete` (for trash/delete operations)
- `app:allow-exit` (for custom exit handling)
- Additional dialog types (message, confirm)
```

---

### Task 2.5: Verify tauri.conf.json Structure

Ensure the complete structure of `src-tauri/tauri.conf.json` matches this pattern (existing fields from scaffolding preserved, new/updated fields noted):

**File: `src-tauri/tauri.conf.json` (verify/update)**

```json
{
  "productName": "Markable",
  "version": "0.1.0",
  "identifier": "com.markable.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist",
    "devPath": "../src"
  },
  "app": {
    "windows": [
      {
        "title": "Markable",
        "width": 1024,
        "height": 768,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null,
      "capabilities": ["src-tauri/capabilities/default.json"]
    }
  },
  "tauri": {
    "windows": [
      {
        "title": "Markable",
        "width": 1024,
        "height": 768,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}
```

**Note:** The exact field names and nesting may differ slightly from scaffolding. The key requirement is that `"capabilities": ["src-tauri/capabilities/default.json"]` is present under `app.security` or `tauri.security`.

---

### Task 2.6: Test Capabilities are Recognized

Build the Rust backend to verify the capabilities file is loaded correctly:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/src-tauri
cargo check
```

**Expected output:**
```
Checking app v0.1.0
    Finished check [unoptimized + debuginfo] target(s) in X.XXs
```

**If error appears:** Check tauri.conf.json for syntax errors (invalid JSON, missing quotes, etc.)

---

### Task 2.7: Manual Verification (Optional but Recommended)

Start the dev environment and verify there are no permission errors:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0
npm run tauri dev
```

Expected:
- [ ] Window opens without errors
- [ ] No "permission denied" messages in console
- [ ] Console is clean (or shows only Tauri startup messages)

You cannot test actual file operations yet (those come in steps 04 and 06), but absence of permission warnings is a good sign.

---

## Acceptance Checklist (Step 02 Complete When All Pass)

- [ ] `src-tauri/capabilities/` directory exists
- [ ] `src-tauri/capabilities/default.json` exists with all 11 permissions
- [ ] JSON is valid (can be parsed by `cargo check`)
- [ ] `src-tauri/tauri.conf.json` references `src-tauri/capabilities/default.json` in `security.capabilities`
- [ ] `cargo check` succeeds (no Rust errors)
- [ ] `npm run tauri dev` starts without permission errors
- [ ] `src-tauri/capabilities/README.md` documents the rationale for each permission

---

## Files Modified/Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/capabilities/default.json` | NEW | Tauri v2 capabilities with granular permissions |
| `src-tauri/capabilities/README.md` | NEW | Documentation of capability design |
| `src-tauri/tauri.conf.json` | UPDATED | Add `security.capabilities` reference |

---

## Edge Case Coverage (Step 02)

| EC # | Edge Case | Coverage |
|------|-----------|----------|
| EC-2 | Missing signingIdentity → build fails | Not covered in step 02 (deferred to step 03) |
| EC-20 | Tauri permissions misconfigured → operation fails | Covered by this step; granular `allow-*` directives; errors will be "permission denied" |

**Note:** Actual permission enforcement is tested in steps 04 and 06 when commands are invoked. This step establishes the capability definitions only.

---

## Troubleshooting

### Issue: cargo check fails with "capabilities file not found"

**Solution:**
1. Verify the path in tauri.conf.json: `src-tauri/capabilities/default.json`
2. Verify the file exists: `ls -la src-tauri/capabilities/default.json`
3. Verify JSON syntax: `cat src-tauri/capabilities/default.json | jq .` (jq must be installed)

### Issue: npm run tauri dev shows "permission denied" errors immediately

**Solution:**
1. Verify capabilities are loaded: check tauri.conf.json for `security.capabilities`
2. Verify JSON is valid: run `cargo check` for detailed Rust compilation errors
3. Check for typos in permission names (e.g., `fs:allow-read-file` not `fs:allow-read`)

### Issue: Commands in step 04 fail with "permission denied" even though permissions are granted

**Solution:**
1. Verify the command is registered with `#[tauri::command]` macro
2. Verify the command is invoked in main.rs: `invoke_handler(.invoke_handler(tauri::generate_handler![...]))`
3. Verify the TypeScript wrapper calls the correct command name via `invoke("command_name")`

---

## Summary

Step 02 establishes the **capability-based security model** for Markable 2.0 by:

1. Defining a granular `default.json` with only the permissions we need
2. Documenting the rationale for each permission (least privilege)
3. Listing what we explicitly do NOT grant and why
4. Updating tauri.conf.json to load the capabilities
5. Verifying the configuration with `cargo check`

**Next step:** Move to `step_03_dmg_workaround.md` to configure the macOS DMG build process and code signing.
