/** Parent folder of an open note. Null when no note is open. */
export function folderOfNote(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return null;
  return filePath.slice(0, slash);
}
