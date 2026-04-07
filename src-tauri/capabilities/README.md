# Tauri v2 Capabilities

This directory contains Tauri v2 capability files that define granular permission scopes for Markable 2.0.

## default.json

The primary capability set for Markable. Grants:

| Permission | Purpose | Used By |
|---|---|---|
| `core:window:allow-show` | Show the main window | Window management |
| `core:event:allow-emit` | Emit events from Rust to TypeScript | Internal communication |
| `core:event:allow-listen` | Listen to events from Rust | Internal communication |
| `dialog:default` | Native file open/save dialogs | File operations (Step 06) |

## Security Model

- **Principle of Least Privilege:** Only the minimum permissions needed are granted.
- **No Filesystem Access:** Individual commands (`read_file`, `write_file`) are added in Step 04, not granted as blanket filesystem access.
- **No Network Access:** Markable does not require network permissions.
- **No Plugin Permissions:** Only core Tauri and dialog capabilities are used.

## Adding New Permissions

When new features are added (e.g., file system access in Step 04), new capabilities are added here or to feature-specific capability files. Each capability must be:
1. Listed in the `permissions` array
2. Referenced in `tauri.conf.json`'s `capabilities` array
3. Documented with rationale

## References

- [Tauri v2 Capabilities Documentation](https://tauri.app/develop/capabilities/)
- [Tauri Permissions List](https://tauri.app/develop/acl/reference/)
