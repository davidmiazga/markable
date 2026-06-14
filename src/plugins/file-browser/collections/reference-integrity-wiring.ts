/**
 * reference-integrity-wiring.ts — Glue between vault-manager file-change
 * events and the reference-index handlers.
 *
 * The vault-manager already exposes `onIndexUpdated(cb)`, which fires for
 * every watcher event with a `{ eventType, path, newPath? }` payload. Step
 * 13's job is to translate those into the reference-index API:
 *
 *   eventType: "renamed"  → idx.onCanonicalRenamed(oldVaultRel, newVaultRel)
 *   eventType: "deleted"  → idx.onCanonicalDeleted(vaultRel)
 *   eventType: "created"  → no-op (no references can yet point at a new file)
 *   eventType: "modified" → no-op (content change doesn't affect reference targets)
 *
 * The wiring is exported as a factory so the file-browser plugin can call
 * it from its initialisation path (step 14 / 15 / 18). Tests bypass
 * vault-manager and call `dispatch` directly.
 *
 * @module collections/reference-integrity-wiring
 */

import * as vaultManager from "../../../lib/vault-manager";
import type { VaultFileChangedEvent } from "../../../lib/vault-types";
import type { ReferenceIndexHandle } from "./reference-index";

export interface ReferenceIntegrityWiringOpts {
  /**
   * Absolute path of the vault root. Used to compute vault-relative paths
   * from the watcher's absolute `path` and `newPath` fields.
   */
  readonly vaultRoot: string;
}

export interface ReferenceIntegrityWiring {
  /** Manually dispatch a watcher event. Public for tests. */
  dispatch(event: VaultFileChangedEvent): Promise<void>;
  /** Detach from the vault-manager. */
  detach(): void;
}

/**
 * Subscribe the reference-index to vault-manager's `onIndexUpdated` and
 * dispatch its events through the appropriate handler.
 */
export function wireReferenceIntegrity(
  idx: ReferenceIndexHandle,
  opts: ReferenceIntegrityWiringOpts,
): ReferenceIntegrityWiring {
  const vaultRoot = opts.vaultRoot.replace(/\/+$/, "");

  /**
   * Convert an absolute path into a vault-relative path. If the path is
   * not under the vault root, return it unchanged (defensive — the watcher
   * should not emit events for files outside the vault).
   */
  function toVaultRel(absPath: string): string {
    if (absPath.startsWith(vaultRoot + "/")) {
      return absPath.slice(vaultRoot.length + 1);
    }
    return absPath;
  }

  async function dispatch(event: VaultFileChangedEvent): Promise<void> {
    switch (event.eventType) {
      case "renamed": {
        if (!event.newPath) return;
        const oldRel = toVaultRel(event.path);
        const newRel = toVaultRel(event.newPath);
        await idx.onCanonicalRenamed(oldRel, newRel);
        return;
      }
      case "deleted": {
        await idx.onCanonicalDeleted(toVaultRel(event.path));
        return;
      }
      case "created":
      case "modified":
      default:
        // No effect on the reference graph.
        return;
    }
  }

  // Subscribe to the live event stream. Wrapped so we can pass a stable
  // function reference to `offIndexUpdated` in `detach`.
  const listener = (event: VaultFileChangedEvent): void => {
    void dispatch(event);
  };
  vaultManager.onIndexUpdated(listener);

  return {
    dispatch,
    detach() {
      vaultManager.offIndexUpdated(listener);
    },
  };
}
