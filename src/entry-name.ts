export type EntryNameCheck =
  | { ok: true; name: string }
  | { ok: false; message: string };

/**
 * Validate a user-typed name for a new or renamed file or folder: a bare
 * name with no path separators, not `.` or `..`, and not empty after trim.
 */
export function validateEntryName(raw: string): EntryNameCheck {
  const name = raw.trim();
  if (name === "") {
    return { ok: false, message: "The name cannot be empty." };
  }
  if (/[\\/]/u.test(name) || name === "." || name === "..") {
    return { ok: false, message: "The name must be a single name, not a path." };
  }
  return { ok: true, name };
}
