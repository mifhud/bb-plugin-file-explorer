/**
 * Text search inside a pinned root, and the replace that acts on a result.
 *
 * The tree lists names; this walks the same folders and reads the files. It
 * goes through a small host gateway rather than local `node:fs`, so a project
 * that lives on another paired host searches exactly where the tree browses.
 *
 * Both jobs are bounded on purpose. Search is a dragnet across a working copy
 * — a repo with a `node_modules` in it is millions of lines — so the walk
 * counts files, the scan skips binaries and anything large, and the result
 * stops at the caller's limit. Replace only touches files the search already
 * named, and writes each one against the hash it was read at, so a file that
 * changed underneath is refused instead of silently overwritten.
 */
import { basename } from "node:path";
import type { FileReplaceOutcome, FileSearchMatch } from "../contract";
import { SKIP_FILE_NAMES } from "../contract";
import { resolveUnderRoot, toRelativePath } from "./paths";
import { mapLimit } from "./pool";
import {
  buildMatcher,
  findMatches,
  replaceMatches,
  type MatchOptions,
} from "./text-match";

/** One directory's immediate children, resolved by the host. */
export interface HostSearchEntry {
  name: string;
  kind: "file" | "directory";
  absolutePath: string;
}

export interface HostSearchReadResult {
  content: string;
  contentEncoding: "base64" | "utf8";
  sha256: string;
  sizeBytes: number;
}

/**
 * The slice of the host SDK this feature needs. Kept as an interface so the
 * walk can be tested against an in-memory tree.
 */
export interface HostSearchFs {
  list(absolutePath: string): Promise<HostSearchEntry[]>;
  read(absolutePath: string): Promise<HostSearchReadResult>;
  /** False when the host refused the write because the file changed. */
  write(input: {
    absolutePath: string;
    content: string;
    expectedSha256: string | null;
  }): Promise<boolean>;
}

export interface SearchInFilesInput extends MatchOptions {
  query: string;
  limit: number;
}

export interface SearchInFilesResult {
  matches: FileSearchMatch[];
  truncated: boolean;
  filesScanned: number;
  filesWithMatches: number;
}

export type ReplaceInFilesInput = MatchOptions & {
  query: string;
  replacement: string;
  relativePaths: string[];
};

export type ReplaceInFilesResult =
  | {
      ok: true;
      files: FileReplaceOutcome[];
      failures: { relativePath: string; message: string }[];
      totalReplaced: number;
    }
  | { ok: false; message: string };

/** Bounded so one search cannot walk a whole disk. */
const MAX_FILES = 4000;
const MAX_DEPTH = 24;
/** Bigger than any source file worth grepping; skips build artefacts and media. */
const MAX_FILE_BYTES = 1_000_000;
/** Long enough for context around a match, short enough for one row. */
const MAX_LINE_CHARS = 400;
const LIST_CONCURRENCY = 8;
const READ_CONCURRENCY = 8;
/** Files per read wave, so a full result list can end the walk early. */
const READ_CHUNK = 40;
const REPLACE_CONCURRENCY = 4;

/**
 * Extensions whose bytes are never a line of text. The size cap and the NUL
 * check catch the rest, but refusing these up front saves reading an archive
 * or a JPEG to learn the same thing.
 */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "tiff",
  "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "webm", "wav", "ogg", "flac", "m4a",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "war", "wasm",
  "sqlite", "sqlite3", "db", "lockb", "snap", "node",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function relativeOf(rootPath: string, absolutePath: string): string | null {
  try {
    return toRelativePath(rootPath, absolutePath);
  } catch {
    return null;
  }
}

interface Candidate {
  relativePath: string;
  absolutePath: string;
}

/** Breadth-first walk collecting the files to scan, bounded by file count. */
async function collectFiles(
  fs: HostSearchFs,
  rootPath: string,
  ignoredDirs: ReadonlySet<string>,
): Promise<{ files: Candidate[]; truncated: boolean }> {
  const files: Candidate[] = [];
  let truncated = false;
  let frontier: { absolutePath: string; depth: number }[] = [
    { absolutePath: rootPath, depth: 0 },
  ];

  while (frontier.length > 0) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    const wave = frontier;
    frontier = [];
    const listings = await mapLimit(wave, LIST_CONCURRENCY, async (node) => {
      try {
        return await fs.list(node.absolutePath);
      } catch {
        // A folder that vanished mid-walk (or is unreadable) is not fatal.
        return [] as HostSearchEntry[];
      }
    });
    for (let index = 0; index < listings.length; index += 1) {
      const node = wave[index];
      if (node === undefined) continue;
      for (const entry of listings[index] ?? []) {
        if (entry.kind === "directory") {
          if (ignoredDirs.has(entry.name)) continue;
          if (node.depth + 1 > MAX_DEPTH) continue;
          frontier.push({ absolutePath: entry.absolutePath, depth: node.depth + 1 });
          continue;
        }
        if (files.length >= MAX_FILES) {
          truncated = true;
          break;
        }
        if (SKIP_FILE_NAMES.has(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(extensionOf(entry.name))) continue;
        const relativePath = relativeOf(rootPath, entry.absolutePath);
        if (relativePath === null) continue;
        files.push({ relativePath, absolutePath: entry.absolutePath });
      }
      if (truncated) break;
    }
  }
  return { files, truncated };
}

/** Clip a long line around its first match, retargeting the column. */
function clipLine(
  line: string,
  column: number,
  length: number,
): { text: string; column: number; length: number } {
  if (line.length <= MAX_LINE_CHARS) return { text: line, column, length };
  const start = Math.max(0, column - 80);
  const end = Math.min(line.length, start + MAX_LINE_CHARS);
  return {
    text: line.slice(start, end),
    column: column - start,
    length: Math.min(length, end - column),
  };
}

/** Reads one file and returns a row per matching line, or null when skipped. */
async function scanFile(
  fs: HostSearchFs,
  candidate: Candidate,
  matcher: RegExp,
): Promise<FileSearchMatch[] | null> {
  let read: HostSearchReadResult;
  try {
    read = await fs.read(candidate.absolutePath);
  } catch {
    return null;
  }
  // base64 means the host already decided these bytes are not text.
  if (read.contentEncoding !== "utf8") return null;
  if (read.sizeBytes > MAX_FILE_BYTES) return null;
  if (read.content.includes("\u0000")) return null;

  const lines = read.content.split(/\r\n|\r|\n/u);
  const matches: FileSearchMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const found = findMatches(line, matcher);
    if (found.length === 0) continue;
    const first = found[0];
    if (first === undefined) continue;
    const clipped = clipLine(line, first.column, first.length);
    matches.push({
      relativePath: candidate.relativePath,
      name: basename(candidate.relativePath),
      line: index + 1,
      text: clipped.text,
      column: clipped.column,
      length: clipped.length,
      lineMatches: found.length,
    });
  }
  return matches;
}

export async function searchInFiles(
  fs: HostSearchFs,
  rootPath: string,
  input: SearchInFilesInput,
  ignoredDirs: ReadonlySet<string>,
): Promise<SearchInFilesResult> {
  // Throws on a bad pattern; the RPC layer turns it into a visible error.
  const matcher = buildMatcher(input.query, input);

  const { files, truncated: walkTruncated } = await collectFiles(fs, rootPath, ignoredDirs);
  const matches: FileSearchMatch[] = [];
  let filesScanned = 0;
  let truncated = walkTruncated;

  for (
    let start = 0;
    start < files.length && matches.length < input.limit;
    start += READ_CHUNK
  ) {
    const chunk = files.slice(start, start + READ_CHUNK);
    const scanned = await mapLimit(chunk, READ_CONCURRENCY, (candidate) =>
      scanFile(fs, candidate, matcher),
    );
    for (const fileMatches of scanned) {
      if (fileMatches === null) continue;
      filesScanned += 1;
      if (fileMatches.length === 0) continue;
      for (const match of fileMatches) {
        if (matches.length >= input.limit) {
          truncated = true;
          break;
        }
        matches.push(match);
      }
    }
  }

  return {
    matches,
    truncated,
    filesScanned,
    filesWithMatches: new Set(matches.map((match) => match.relativePath)).size,
  };
}

export async function replaceInFiles(
  fs: HostSearchFs,
  rootPath: string,
  input: ReplaceInFilesInput,
): Promise<ReplaceInFilesResult> {
  let matcher: RegExp;
  try {
    matcher = buildMatcher(input.query, input);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "That is not a valid pattern.",
    };
  }

  const files: FileReplaceOutcome[] = [];
  const failures: { relativePath: string; message: string }[] = [];
  let totalReplaced = 0;

  const found = await mapLimit(
    [...new Set(input.relativePaths)],
    REPLACE_CONCURRENCY,
    async (relativePath): Promise<
      | { relativePath: string; replaced: number }
      | { relativePath: string; message: string }
    > => {
      let absolute: string;
      try {
        absolute = resolveUnderRoot(rootPath, relativePath);
      } catch {
        return { relativePath, message: "That path is not inside this folder." };
      }
      let read: HostSearchReadResult;
      try {
        read = await fs.read(absolute);
      } catch {
        return { relativePath, message: "Could not read the file." };
      }
      if (read.contentEncoding !== "utf8" || read.content.includes("\u0000")) {
        return { relativePath, message: "Not a text file." };
      }
      const { text, count } = replaceMatches(read.content, matcher, input.replacement, input.useRegex);
      if (count === 0) return { relativePath, replaced: 0 };
      try {
        const written = await fs.write({
          absolutePath: absolute,
          content: text,
          expectedSha256: read.sha256,
        });
        if (!written) return { relativePath, message: "The file changed on disk. Search again." };
      } catch {
        return { relativePath, message: "Could not write the file." };
      }
      return { relativePath, replaced: count };
    },
  );

  for (const result of found) {
    if ("replaced" in result) {
      files.push({ relativePath: result.relativePath, replaced: result.replaced });
      totalReplaced += result.replaced;
    } else {
      failures.push(result);
    }
  }

  return { ok: true, files, failures, totalReplaced };
}
