# macOS Sequoia/Tahoe DMG Compiler Workaround

**Status**: No official Tauri patch as of 2026-04-04.

## Problem

Tauri v2's DMG bundler uses AppleScript-based icon positioning during the `hdiutil` phase. macOS Sequoia's heightened security checks flag or reject this process, resulting in:
- "Damaged" file errors on the built DMG
- `hdiutil` failures during the Tauri build

## Workarounds (in priority order)

### 1. Headless DMG via `CI=true`

Set `CI=true` in your build environment. This forces Tauri's bundler to skip AppleScript-based icon positioning.

```bash
CI=true npm run tauri build
```

### 2. Build `.app` only + manual DMG

If the above still fails, build the `.app` bundle only and use `create-dmg`:

```bash
cargo tauri build --bundles app

create-dmg \
  --volname "Markable" \
  --window-pos 200 120 \
  --window-size 600 300 \
  "Markable.dmg" \
  "src-tauri/target/release/bundle/macos/Markable.app"
```

### 3. Tauri CLI fix branch

Check for pending PRs on the Tauri repo. If a fix branch exists:

```bash
cargo install tauri-cli --git https://github.com/tauri-apps/tauri --branch fix/macos-dmg-compiler
```

## Code Signing & Notarization

macOS Sequoia removes the "Right-click > Open" bypass for unsigned apps. You **must** configure:
- `signingIdentity` in `tauri.conf.json`
- Apple Developer ID + Team ID

Verify with: `spctl --assess --verbose /path/to/Markable.app`

## Research Links

- [Tauri GitHub Issues](https://github.com/tauri-apps/tauri/issues) — search for `hdiutil failure` or `AppleScript DMG error`
- Community reports of successful builds using older Provisioner versions
