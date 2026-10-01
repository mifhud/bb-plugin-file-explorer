import { lstat, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { TreeEntry } from "../contract";
import { shouldSkip, sortEntries } from "./ignore";
import { resolveUnderRoot } from "./paths";
import { ignoredChildNames } from "./git-ignore";

/**
 * Local probe used to decide whether a relative path resolves to a directory
 * or file on this host. Follows symlinks (including targets that leave the
 * workspace root), so a chat link to an in-tree symlink is revealable; only
 * lexical escapes (`..` / absolute) are rejected, which surfaces as "not found".
 */
export async function statHostPath(
  rootPath: string,
  relativePath: string,
): Promise<{ isDirectory: boolean } | null> {
  try {
    const absolute = resolveUnderRoot(rootPath, relativePath);
    return { isDirectory: (await stat(absolute)).isDirectory() };
  } catch (cause) {
    if (cause instanceof Error && (cause.message === "path escapes the workspace" ||
      "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR"))) return null;
    throw cause;
  }
}

/** List only immediate children on the target host, skipping configured hidden/ignored folders unless requested. */
export async function listHostDirectory(
  rootPath: string,
  relativePath: string,
  showSkipped: boolean,
  ignoredFolders: string[],
): Promise<{ entries: TreeEntry[] }> {
  // Lexical (string) confinement only: a relative path that tries to leave the
  // root via `..` is rejected. Symlinks, however, are followed — readdir/stat
  // open them up to their target, even when that target lives outside the root.
  // This is the chosen posture for browsing ("open the link"): the link entry
  // itself stays inside the workspace and the FS follows it from there.
  const absolute = resolveUnderRoot(rootPath, relativePath);
  const dirents = await readdir(absolute, { withFileTypes: true });
  const visible: TreeEntry[] = [];
  const ignoredDirs = new Set(ignoredFolders);
  for (const dirent of dirents) {
    let kind: TreeEntry["kind"];
    if (dirent.isDirectory()) kind = "directory";
    else if (dirent.isFile()) kind = "file";
    else if (dirent.isSymbolicLink()) {
      try {
        kind = (await stat(path.join(absolute, dirent.name))).isDirectory() ? "directory" : "file";
      } catch {
        continue; // A broken link has no file or directory target.
      }
    } else continue;
    const childPath = relativePath === "" ? dirent.name : `${relativePath}/${dirent.name}`;
    const entry = { name: dirent.name, relativePath: childPath, kind };
    if (!shouldSkip(entry, showSkipped, ignoredDirs)) visible.push(entry);
  }
  // Ask git about the rows that will actually be shown, once per directory.
  const ignored = await ignoredChildNames(absolute, visible.map((entry) => entry.name));
  const entries = visible.map((entry) => ({
    ...entry,
    gitIgnored: ignored.has(entry.name),
  }));
  return { entries: sortEntries(entries) };
}

/**
 * Remove a file, directory (recursively), or symlink on the target host.
 * Uses lstat (not stat) so symlinks are detected and unlinked — never their
 * target is recursively deleted. Returns ok=false when the path does not exist.
 */
export async function removeHostPath(
  rootPath: string,
  relativePath: string,
): Promise<{ ok: boolean }> {
  const absolute = resolveUnderRoot(rootPath, relativePath);
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { ok: false };
    }
    throw cause;
  }
  if (stats.isSymbolicLink()) {
    // Unlink just the symlink, never its target.
    await rm(absolute, { force: false });
  } else if (stats.isDirectory()) {
    await rm(absolute, { recursive: true });
  } else {
    await rm(absolute);
  }
  return { ok: true };
}

