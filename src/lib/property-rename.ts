/** Client-side checks that match src-tauri/src/commands/property_rename.rs */

function inRenameSet(value: string, from: string): boolean {
  return value === from || value.startsWith(`${from}/`);
}

function mappedValue(value: string, from: string, to: string): string {
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return to + value.slice(from.length);
  return value;
}

function validSegment(segment: string): boolean {
  if (!segment || !/^[A-Za-z]/.test(segment)) return false;
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

export function validatePropertyRename(
  fromRaw: string,
  toRaw: string,
  existing: string[],
): string | null {
  const from = fromRaw.trim();
  const to = toRaw.trim();
  if (!from) return "Current name is empty.";
  if (!to) return "New name cannot be empty.";
  if (from === to) return "New name is the same as the current name.";
  if (to.startsWith("/") || to.endsWith("/") || to.includes("//")) {
    return "Name cannot start, end, or contain empty slash segments.";
  }
  if (from.startsWith(`${to}/`) || to.startsWith(`${from}/`)) {
    return "New name cannot nest under or wrap the current name.";
  }
  if (!to.split("/").every(validSegment)) {
    return `Invalid name "${to}". Use letters, numbers, hyphen, or underscore in each slash segment. No spaces, #, or :.`;
  }
  const renamed = existing.filter((v) => inRenameSet(v, from)).map((v) => mappedValue(v, from, to));
  for (const name of renamed) {
    if (existing.some((v) => !inRenameSet(v, from) && v === name)) {
      return `"${name}" already exists. Merge onto an existing name is a separate action.`;
    }
  }
  return null;
}
