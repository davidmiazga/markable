# Step 03: macOS DMG Build Workaround & Code Signing (R3 — CRITICAL)

**Requirement:** R3 — macOS DMG Build Workaround (CRITICAL)
**Acceptance Criteria:** CI=true npm run tauri build produces working DMG, app opens without Gatekeeper warnings, spctl verification passes, fallback script provided

---

## Overview

This is the **single most critical step in Phase 1** because it unblocks macOS distribution. The macOS Sequoia/Tahoe DMG compiler has a known incompatibility with Tauri v2's AppleScript-based icon positioning. This step:

1. **Primary workaround:** Set `CI=true` environment variable to bypass AppleScript-based icon positioning
2. **Fallback script:** Provide manual DMG creation using `create-dmg` command-line tool
3. **Code signing:** Configure signing identity in tauri.conf.json and document the setup process
4. **Verification:** Test both the primary and fallback builds, verify code signature

**Output:** A working DMG build pipeline with primary and fallback methods, documented build instructions, and an updated ADR in `docs/build-notes/macos-dmg-workaround.md`.

---

## Architecture Decision Record (ADR)

### Problem Statement

Tauri v2's bundler uses AppleScript to position app icons in the DMG window during the `hdiutil` phase. macOS Sequoia (15.x) and Tahoe (upcoming) enforce heightened security checks that either block or reject AppleScript execution during disk image creation, resulting in:

- "Damaged" file errors when users open the DMG
- Build failures with `hdiutil` errors during `npm run tauri build`
- App flagged as malicious by Gatekeeper even with valid code signature

### Root Cause

Tauri v2's bundler (`tauri-bundler`) invokes `hdiutil` with an AppleScript template to set icon position and appearance. This AppleScript execution is intercepted by Sequoia's heightened security model, which requires:

1. Explicit code signature on the bundler itself (not provided by npm)
2. Notarization of the DMG (not automatic)
3. Or, bypassing the AppleScript step entirely via headless mode

As of 2026-04-04, no official Tauri patch has been released. The Tauri team is working on a fix, but it is not yet available.

### Decision

**Implement a two-tier build strategy:**

1. **Tier 1 (Primary):** Use `CI=true` environment variable to force headless DMG creation
   - Skips AppleScript-based icon positioning
   - Produces a DMG without fancy icons/backgrounds
   - Works on Sequoia/Tahoe
   - Suitable for development and distribution

2. **Tier 2 (Fallback):** Provide a shell script that builds the `.app` bundle only, then uses `create-dmg` command-line tool
   - Used only if Tier 1 fails
   - Requires Node.js and `create-dmg` npm package
   - More control over DMG appearance
   - Still requires code signing

### Consequences

**Positive:**
- Phase 1 can complete without waiting for official Tauri patch
- Builds are reproducible (both tiers use environment variables or scripts)
- Code signing is now mandatory, improving app security

**Negative:**
- Tier 1 DMG has no custom icons/backgrounds (minimal visual polish)
- Developers must understand two build paths
- Apple Developer ID required for code signing (not just personal account for side-loading)

### Status

**Approved** — Proceed with implementation. Revisit if Tauri releases official fix.

---

## Implementation

### Task 3.1: Configure Code Signing in tauri.conf.json

macOS Sequoia requires all apps to be code-signed. Update the bundle configuration in `src-tauri/tauri.conf.json`:

**File: `src-tauri/tauri.conf.json` (update bundle section)**

Locate the `build` section and add/update the `bundle` section:

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist",
    "devPath": "../src"
  },
  "tauri": {
    "bundle": {
      "active": true,
      "targets": ["dmg"],
      "identifier": "com.markable.app",
      "icon": [
        "src-tauri/icons/32x32.png",
        "src-tauri/icons/128x128.png",
        "src-tauri/icons/128x128@2x.png",
        "src-tauri/icons/icon.icns"
      ],
      "macOS": {
        "signingIdentity": null,
        "providerShortTeamID": null,
        "entitlements": null
      }
    }
  }
}
```

**Key fields:**

| Field | Value | Purpose |
|-------|-------|---------|
| `bundle.active` | `true` | Enable bundling (DMG, app, etc.) |
| `bundle.targets` | `["dmg"]` | Build only DMG for now (Phase 1) |
| `bundle.identifier` | `"com.markable.app"` | Unique app identifier (reverse DNS) |
| `macOS.signingIdentity` | `null` or string | **IMPORTANT:** See Task 3.2 |
| `macOS.providerShortTeamID` | `null` or string | Apple Team ID (if using team account) |
| `macOS.entitlements` | `null` | Entitlements file (not needed for Phase 1) |

### Task 3.2: Set Up Code Signing Identity

#### Option A: Personal Apple ID (Development Only)

If you're building for personal development:

```bash
# List available signing identities
security find-identity -v -p codesigning /Library/Keychains/System.keychain
```

Expected output (example):

```
  1) XXXXXXXXXXXXXXXXXXXXXXXX "Apple Development: your.email@example.com (ABC123XYZ)"
  2) YYYYYYYYYYYYYYYYYYYYYYYY "Developer ID Application: Your Name (TEAMID)"
```

Use the hash (40 hex chars) of your Apple Development identity:

**File: `src-tauri/tauri.conf.json` (update)**

```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "Apple Development: your.email@example.com (ABC123XYZ)"
      }
    }
  }
}
```

Replace `"your.email@example.com (ABC123XYZ)"` with your actual identity string.

#### Option B: Apple Developer ID (Distribution)

For production distribution, use a Developer ID Application certificate:

```bash
# List Developer ID certificates
security find-identity -v -p codesigning /Library/Keychains/System.keychain | grep "Developer ID"
```

Use the Developer ID identity:

**File: `src-tauri/tauri.conf.json` (update)**

```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "Developer ID Application: Your Name (TEAMID)",
        "providerShortTeamID": "TEAMID"
      }
    }
  }
}
```

#### Option C: Placeholder (For Version Control)

If you want to commit a placeholder that developers fill in locally:

**File: `src-tauri/tauri.conf.json` (update)**

```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "FIXME: Set to your Apple Developer ID",
        "providerShortTeamID": "FIXME: Set to your Team ID if applicable"
      }
    }
  }
}
```

**Then create a script to help developers set it:**

**File: `scripts/setup-signing.sh`**

```bash
#!/bin/bash

echo "Available signing identities:"
security find-identity -v -p codesigning /Library/Keychains/System.keychain

echo ""
echo "Enter the identity to use (copy the full string including parentheses):"
read IDENTITY

echo "Update src-tauri/tauri.conf.json with:"
echo "\"signingIdentity\": \"$IDENTITY\""
```

---

### Task 3.3: Create the Fallback DMG Build Script

Even if Tier 1 (CI=true) fails, provide a fallback using `create-dmg`:

**File: `scripts/build-dmg-fallback.sh`**

```bash
#!/bin/bash

# Markable 2.0 — Fallback DMG Build Script
# Usage: ./scripts/build-dmg-fallback.sh
# Builds the .app bundle, then creates a DMG using create-dmg CLI

set -e  # Exit on error

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
APP_NAME="Markable"
BUNDLE_PATH="$TAURI_DIR/target/release/bundle/macos/$APP_NAME.app"
DMG_OUTPUT="$PROJECT_ROOT/$APP_NAME.dmg"

echo "=== Markable 2.0 DMG Fallback Build ==="
echo ""

# Step 1: Build .app bundle only
echo "Step 1: Building .app bundle (Tier 1)..."
cd "$PROJECT_ROOT"

if cargo tauri build --bundles app; then
    echo "✓ .app bundle built successfully"
else
    echo "✗ .app bundle build failed"
    exit 1
fi

echo ""

# Step 2: Check if .app exists
if [ ! -d "$BUNDLE_PATH" ]; then
    echo "✗ Expected .app not found at: $BUNDLE_PATH"
    exit 1
fi

echo "Step 2: Creating DMG using create-dmg..."

# Step 3: Install create-dmg if not already installed
if ! command -v create-dmg &> /dev/null; then
    echo "Installing create-dmg..."
    npm install -g create-dmg
fi

# Step 4: Create DMG
if create-dmg \
    --overwrite \
    --dmg-title "$APP_NAME" \
    --window-pos 200 120 \
    --window-size 600 300 \
    --icon-size 100 \
    --text-size 16 \
    --volname "$APP_NAME" \
    "$DMG_OUTPUT" \
    "$BUNDLE_PATH"
then
    echo "✓ DMG created successfully: $DMG_OUTPUT"
else
    echo "✗ DMG creation failed"
    exit 1
fi

echo ""
echo "Step 3: Verifying code signature..."

# Step 5: Verify code signature
if spctl --assess --verbose "$BUNDLE_PATH" 2>&1 | grep -q "accepted"; then
    echo "✓ Code signature verified (accepted)"
else
    echo "⚠ Code signature verification failed or returned 'rejected'"
    echo "  This may prevent the app from running on Sequoia/Tahoe"
    echo "  See docs/build-notes/macos-dmg-workaround.md for signing instructions"
fi

echo ""
echo "=== Build Complete ==="
echo "DMG location: $DMG_OUTPUT"
echo "To install: open $DMG_OUTPUT and drag to /Applications"
```

**Make the script executable:**

```bash
chmod +x /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/scripts/build-dmg-fallback.sh
```

---

### Task 3.4: Update docs/build-notes/macos-dmg-workaround.md

This file was stubbed in the repo. Flesh it out with the complete ADR and build instructions:

**File: `docs/build-notes/macos-dmg-workaround.md` (replace/update)**

```markdown
# macOS Sequoia/Tahoe DMG Compiler Workaround

**Status:** No official Tauri patch as of 2026-04-04.

## Architecture Decision Record (ADR)

### Problem

Tauri v2's DMG bundler uses AppleScript-based icon positioning during the `hdiutil` phase. macOS Sequoia (15.x) and Tahoe (upcoming) enforce heightened security checks that block or reject AppleScript execution, resulting in:

- "Damaged" file errors when opening the DMG
- Build failures with `hdiutil` errors
- App flagged as malicious by Gatekeeper

### Root Cause

The Tauri bundler invokes `hdiutil` with an AppleScript template to position icons. This execution is blocked by Sequoia's security model.

### Decision

**Implement a two-tier build strategy:**

1. **Tier 1 (Primary):** Set `CI=true` to bypass AppleScript entirely
   - Produces a minimal DMG without custom icons
   - Works on Sequoia/Tahoe
   - Suitable for development and distribution

2. **Tier 2 (Fallback):** Build `.app` bundle only, then use `create-dmg` CLI
   - Used only if Tier 1 fails
   - More control over DMG appearance
   - Still requires code signing

### Consequences

**Positive:**
- Phase 1 unblocked without waiting for Tauri patch
- Builds are reproducible

**Negative:**
- Tier 1 DMG has no custom icons
- Code signing is mandatory

### Status

**Approved** — Implemented in Phase 1 (Step 03).

---

## Build Instructions

### Prerequisites

Verify you have:
- Xcode Command Line Tools: `xcode-select --print-path`
- Apple Developer ID or personal certificate: `security find-identity -v -p codesigning /Library/Keychains/System.keychain`
- Signing identity configured in `src-tauri/tauri.conf.json`

### Tier 1: CI=true Headless DMG Build (Primary)

This is the recommended approach for all builds (development and distribution).

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Set environment variable and build
CI=true npm run tauri build

# Output: src-tauri/target/release/bundle/macos/Markable.dmg
```

**Expected output:**
- No AppleScript errors
- DMG file created at `src-tauri/target/release/bundle/macos/Markable.dmg`
- App can be dragged to `/Applications` without "Damaged" errors

**Verification:**
```bash
# Open the DMG
open src-tauri/target/release/bundle/macos/Markable.dmg

# Verify code signature
spctl --assess --verbose /Volumes/Markable/Markable.app

# Expected: "accepted"
```

### Tier 2: Fallback Manual DMG Build

Use this **only if Tier 1 fails**:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Run the fallback script
./scripts/build-dmg-fallback.sh

# Output: ./Markable.dmg
```

**What the script does:**
1. Builds `.app` bundle only (no bundling phase)
2. Installs `create-dmg` CLI if needed
3. Creates DMG using command-line options
4. Verifies code signature

### Code Signing Setup

#### Find Your Signing Identity

```bash
security find-identity -v -p codesigning /Library/Keychains/System.keychain
```

**For development (personal certificate):**
```
 1) ABC123... "Apple Development: you@example.com (ABC123)"
```

**For distribution (Developer ID):**
```
 2) DEF456... "Developer ID Application: Your Name (TEAMID)"
```

#### Configure tauri.conf.json

**File: `src-tauri/tauri.conf.json`**

```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "Apple Development: you@example.com (ABC123)"
      }
    }
  }
}
```

Replace the identity string with your actual identity from the list above.

#### For Team Accounts

If using a team account:

```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "Developer ID Application: Team Name (TEAMID)",
        "providerShortTeamID": "TEAMID"
      }
    }
  }
}
```

### Verification

#### Test the DMG

1. Build the DMG:
   ```bash
   CI=true npm run tauri build
   ```

2. Open the DMG:
   ```bash
   open src-tauri/target/release/bundle/macos/Markable.dmg
   ```

3. Drag the app to `/Applications` in the Finder window

4. Launch the app from `/Applications`:
   ```bash
   open /Applications/Markable.app
   ```

5. Verify code signature:
   ```bash
   spctl --assess --verbose /Applications/Markable.app
   ```

**Expected output:**
```
/Applications/Markable.app: accepted
source=Apple System
origin=Developer ID
```

If output is `rejected`, the signing identity is invalid or missing.

---

## Troubleshooting

### Issue: "hdiutil" error during Tier 1 build

```
Error: hdiutil error: -60024
```

**Solution:**
1. Verify `CI=true` is set: `echo $CI`
2. Check that `signingIdentity` is correct in tauri.conf.json
3. Try Tier 2 fallback: `./scripts/build-dmg-fallback.sh`

### Issue: DMG shows "Damaged" when user opens it

**Root cause:** Signing identity missing or invalid.

**Solution:**
1. Verify signature: `spctl --assess --verbose /path/to/Markable.app`
2. If output is `rejected`, re-check signing identity in tauri.conf.json
3. Re-build with corrected identity

### Issue: "permission denied" when running fallback script

**Solution:**
```bash
chmod +x scripts/build-dmg-fallback.sh
./scripts/build-dmg-fallback.sh
```

### Issue: create-dmg not found (Tier 2)

**Solution:**
```bash
npm install -g create-dmg
```

---

## Research Links

- [Tauri GitHub Issues](https://github.com/tauri-apps/tauri/issues) — Search for `hdiutil` or `AppleScript DMG`
- [Tauri DMG Bundler Code](https://github.com/tauri-apps/tauri/tree/develop/crates/tauri-bundler)
- [create-dmg NPM Package](https://www.npmjs.com/package/create-dmg)
- [Apple Code Signing Documentation](https://developer.apple.com/support/code-signing/)

---

## Expected Timeline

- **Tier 1 (CI=true):** Works reliably once identity is configured. Build time: ~2-3 minutes
- **Tier 2 (Fallback):** Used only if Tier 1 fails. Build time: ~3-5 minutes (includes create-dmg install)

## Status Update

Check the Tauri GitHub repository regularly for a fix. Once an official patch is released, this workaround can be retired in favor of the upstream solution.
```

---

### Task 3.5: Create a Local Build Script (Convenience)

Create a convenience script for developers to build with CI=true by default:

**File: `scripts/build-macos.sh`**

```bash
#!/bin/bash

# Markable 2.0 — macOS Build Script
# Usage: ./scripts/build-macos.sh
# Builds with CI=true (workaround for Sequoia DMG compiler)

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Markable 2.0 — macOS Build ==="
echo ""
echo "Building with CI=true (Sequoia workaround)..."
echo ""

export CI=true
npm run tauri build

echo ""
echo "=== Build Complete ==="
echo "DMG location: src-tauri/target/release/bundle/macos/Markable.dmg"
echo ""
echo "To verify signature:"
echo "  spctl --assess --verbose ./src-tauri/target/release/bundle/macos/Markable.app"
echo ""
echo "To test:"
echo "  open ./src-tauri/target/release/bundle/macos/Markable.dmg"
```

**Make it executable:**

```bash
chmod +x /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/scripts/build-macos.sh
```

---

### Task 3.6: Test the Build (Tier 1)

Now test that the primary build works:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Option A: Using the convenience script
./scripts/build-macos.sh

# OR Option B: Direct command
CI=true npm run tauri build
```

**Expected output:**
```
Compiling tauri v2.10
...
Bundling Markable (DMG)...
✓ Built successfully
```

**Expected artifacts:**
```
src-tauri/target/release/bundle/macos/
├── Markable.app/        (Signed macOS app bundle)
└── Markable.dmg          (Distribution disk image)
```

---

### Task 3.7: Verify Code Signature

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Check the .app bundle signature
spctl --assess --verbose ./src-tauri/target/release/bundle/macos/Markable.app
```

**Expected output:**
```
./src-tauri/target/release/bundle/macos/Markable.app: accepted
source=Apple System
origin=Developer ID
```

**If output is "rejected":**
- The signing identity is invalid or doesn't exist
- Check `src-tauri/tauri.conf.json` for the correct identity
- Re-run `security find-identity` to verify it's available

---

### Task 3.8: Test the DMG Installation Flow

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Open the DMG
open ./src-tauri/target/release/bundle/macos/Markable.dmg

# Expected: Finder window opens showing Markable.app and Applications folder
# User can drag Markable.app to Applications to "install"

# Verify the app can launch
open /Volumes/Markable/Markable.app

# Expected: App window opens without "Damaged" or Gatekeeper warnings
```

---

### Task 3.9: Test the Fallback Build (Tier 2) — Optional

If Tier 1 succeeded, you can skip this for now. But if you want to verify the fallback:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Run the fallback script
./scripts/build-dmg-fallback.sh

# Expected output: ./Markable.dmg created
```

---

## Acceptance Checklist (Step 03 Complete When All Pass)

- [ ] `src-tauri/tauri.conf.json` has `bundle` section with signing identity
- [ ] `scripts/build-dmg-fallback.sh` exists and is executable
- [ ] `scripts/build-macos.sh` exists and is executable
- [ ] `docs/build-notes/macos-dmg-workaround.md` is complete with ADR
- [ ] `CI=true npm run tauri build` produces `Markable.dmg` (Tier 1)
- [ ] `spctl --assess` returns "accepted" for the .app bundle
- [ ] DMG can be opened and app can be dragged to `/Applications`
- [ ] App launches without Gatekeeper warnings
- [ ] Fallback script runs without errors (Tier 2 optional, but good to test)

---

## Files Modified/Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/tauri.conf.json` | UPDATED | Add bundle config with signingIdentity |
| `scripts/build-dmg-fallback.sh` | NEW | Fallback DMG creation using create-dmg |
| `scripts/build-macos.sh` | NEW | Convenience script for CI=true builds |
| `docs/build-notes/macos-dmg-workaround.md` | UPDATED | Complete ADR with build instructions, verification, troubleshooting |
| `scripts/setup-signing.sh` | NEW (optional) | Helper to list available signing identities |

---

## Edge Case Coverage (Step 03)

| EC # | Edge Case | Coverage |
|------|-----------|----------|
| EC-1 | CI=true on non-macOS | CI=true is harmless on Linux/Windows; documented |
| EC-2 | Missing signingIdentity → build fails | Build fails with clear error pointing to tauri.conf.json |
| EC-3 | DMG build fails even with CI=true | Fallback script provided; build docs outline scenario |
| EC-4 | App unsigned → spctl rejected | Documentation explains signing setup and verification |

---

## Summary

Step 03 solves the **critical macOS Sequoia/Tahoe DMG build incompatibility** by:

1. Configuring code signing in tauri.conf.json with your Apple Developer ID
2. Providing a primary build path using `CI=true` (headless DMG)
3. Providing a fallback build path using `create-dmg` script
4. Documenting the entire process as an ADR with troubleshooting
5. Verifying the build with `spctl` code signature checks

**Next step:** Move to `step_04_rust_command_bridge.md` to implement file I/O Rust commands.
