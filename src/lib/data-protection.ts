/**
 * Data Protection preference for Markdown deletes.
 *
 * Off removes the file. Ask shows an Are you sure dialog. Trash keeps a
 * local copy that Settings can restore. The Rust delete commands read the
 * same shape from settings.json.
 */

export type DataProtectionMode = "off" | "ask" | "trash";
export type TrashRetention = "duration" | "untilQuit" | "askOnQuit";
export type RetentionUnit = "hours" | "days";

export interface DataProtectionSettings {
  mode: DataProtectionMode;
  retention: TrashRetention;
  retentionAmount: number;
  retentionUnit: RetentionUnit;
  /** When true, the footer shows a trash can for the recovery queue. */
  showTrashIcon: boolean;
}

export interface RecoveredNote {
  id: string;
  originalPath: string;
  name: string;
  deletedAtMs: number;
  expiresAtMs: number | null;
  sessionOnly: boolean;
}

export const DEFAULT_DATA_PROTECTION: DataProtectionSettings = {
  mode: "off",
  retention: "duration",
  retentionAmount: 7,
  retentionUnit: "days",
  showTrashIcon: false,
};

const MODES: DataProtectionMode[] = ["off", "ask", "trash"];
const RETENTIONS: TrashRetention[] = ["duration", "untilQuit", "askOnQuit"];
const UNITS: RetentionUnit[] = ["hours", "days"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Fill missing or invalid Data Protection fields with the defaults. */
export function resolveDataProtection(
  value: Partial<DataProtectionSettings> | undefined,
): DataProtectionSettings {
  const amount = Number(value?.retentionAmount);
  const clamped = Number.isFinite(amount) ? Math.min(8760, Math.max(1, Math.round(amount))) : DEFAULT_DATA_PROTECTION.retentionAmount;
  return {
    mode: oneOf(value?.mode, MODES, DEFAULT_DATA_PROTECTION.mode),
    retention: oneOf(value?.retention, RETENTIONS, DEFAULT_DATA_PROTECTION.retention),
    retentionAmount: clamped,
    retentionUnit: oneOf(value?.retentionUnit, UNITS, DEFAULT_DATA_PROTECTION.retentionUnit),
    showTrashIcon: value?.showTrashIcon === true,
  };
}
