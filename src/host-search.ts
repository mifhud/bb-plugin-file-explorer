/**
 * The text search the panel actually runs: ripgrep, on the machine that owns
 * the files.
 *
 * ripgrep finds the candidate lines. It is compiled to WebAssembly and shipped
 * with the plugin, so a host needs no binary of its own and nothing crosses the
 * host bridge but the rows themselves — the old walk read every file through
 * the bridge to learn which lines matched. The lines ripgrep reports are then
 * read the way the panel reads any other line, through `matchLine`, so the row
 * the panel paints and the replacement it writes still agree on what matched:
 * ripgrep is the candidate filter, the JavaScript matcher stays the authority.
 *
 * The tree's own rules decide what is visible, which is why the run is not
 * gitignore-aware (`--no-ignore --hidden`) and why the ignored folders arrive
 * as globs: a file the tree shows must be a file the search reads. A pattern
 * the Rust engine refuses — a lookaround, say — or a ripgrep that fails
 * outright falls back to the walk in `search-in-files.ts`, so the panel never
 * loses a search it used to answer.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ripgrep } from "ripgrep";
import type { FileSearchMatch } from "../contract";
import { SKIP_FILE_NAMES } from "../contract";
import {
  BINARY_EXTENSIONS,
  matchLine,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  searchInFiles,
  type HostSearchEntry,
  type HostSearchReader,
  type SearchInFilesInput,
  type SearchInFilesResult,
} from "./search-in-files";
import { buildMatcher } from "./text-match";

/** The fields this walk reads out of ripgrep's JSON-lines output. */
interface RipgrepEvent {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
  };
}

/**
 * `-g` reads gitignore-style globs, so a folder name from the user's settings
 * is escaped rather than allowed to act as a pattern of its own.
 */
function escapeGlob(name: string): string {
  return name.replace(/[\\*?[\]{}!]/gu, (character) => `\\${character}`);
}

function ripgrepArgs(
  input: SearchInFilesInput,
  ignoredDirs: ReadonlySet<string>,
): string[] {
  const args = [
    "--json",
    // The tree decides what is hidden, not a repo's ignore files: a file the
    // tree shows must be a file the search reads.
    "--no-ignore",
    "--hidden",
    `--max-depth=${MAX_DEPTH}`,
    `--max-filesize=${MAX_FILE_BYTES}`,
  ];
  for (const name of ignoredDirs) args.push("--glob", `!${escapeGlob(name)}`);
  for (const name of SKIP_FILE_NAMES) args.push("--glob", `!${escapeGlob(name)}`);
  // ripgrep calls a file binary when its first bytes say so — a short file
  // whose bytes happen to be printable is still a picture, so the same
  // extensions the walk refuses are refused here.
  for (const extension of BINARY_EXTENSIONS) args.push("--glob", `!*.${extension}`);
  if (!input.matchCase) args.push("--ignore-case");
  // Whole-word matching stays out of ripgrep's hands: the JavaScript matcher
  // applies it to the line, and a superset of candidate lines is all this run
  // has to produce.
  if (input.useRegex) args.push("--regexp", input.query);
  else args.push("--fixed-strings", "--regexp", input.query);
  return args;
}

/**
 * The path ripgrep is handed to search, and the only path it can reach: the
 * pinned root, mounted in the guest at a name no real machine has. Searching
 * `"."` is not an option — a guest path is resolved against the worker's
 * working directory, which is `/`, and a run rooted there walks the whole disk.
 */
const GUEST_ROOT = "/file-explorer-root";

/**
 * The path ripgrep printed, as a path relative to the pinned root. The run is
 * rooted at `GUEST_ROOT`, so rows arrive as `/file-explorer-root/src/file.ts`.
 */
function relativeFromRipgrep(pathText: string): string | null {
  const prefix = `${GUEST_ROOT}/`;
  if (!pathText.startsWith(prefix)) return null;
  const relative = pathText.slice(prefix.length);
  if (relative.split("/").includes("..")) return null;
  return relative;
}

/** The walk's view of this machine's files, so a fallback reads the same tree. */
function localReader(): HostSearchReader {
  return {
    async list(absolutePath): Promise<HostSearchEntry[]> {
      const dirents = await readdir(absolutePath, { withFileTypes: true });
      const entries: HostSearchEntry[] = [];
      for (const dirent of dirents) {
        const child = path.join(absolutePath, dirent.name);
        let kind: HostSearchEntry["kind"] | null = dirent.isDirectory()
          ? "directory"
          : dirent.isFile() ? "file" : null;
        if (kind === null && dirent.isSymbolicLink()) {
          // A broken link has no file or directory target; the tree skips it too.
          try {
            kind = (await stat(child)).isDirectory() ? "directory" : "file";
          } catch {
            continue;
          }
        }
        if (kind === null) continue;
        entries.push({ name: dirent.name, kind, absolutePath: child });
      }
      return entries;
    },
    async read(absolutePath) {
      const bytes = await readFile(absolutePath);
      // A NUL byte is the same "these bytes are not text" verdict the host
      // reaches when it hands a file back base64-encoded.
      if (bytes.includes(0)) {
        return { content: bytes.toString("base64"), contentEncoding: "base64", sizeBytes: bytes.length };
      }
      return { content: bytes.toString("utf8"), contentEncoding: "utf8", sizeBytes: bytes.length };
    },
  };
}

/**
 * Ripgrep's rows for this root, or null when ripgrep could not answer and the
 * walk should.
 */
async function scanWithRipgrep(
  rootPath: string,
  input: SearchInFilesInput,
  matcher: RegExp,
  ignoredDirs: ReadonlySet<string>,
): Promise<SearchInFilesResult | null> {
  const matches: FileSearchMatch[] = [];
  const decoder = new TextDecoder();
  let pending = "";
  let truncated = false;

  const consume = (line: string): void => {
    let event: RipgrepEvent;
    try {
      event = JSON.parse(line) as RipgrepEvent;
    } catch {
      return;
    }
    if (event.type !== "match") return;
    const pathText = event.data?.path?.text;
    const lineText = event.data?.lines?.text;
    const lineNumber = event.data?.line_number;
    if (pathText === undefined || lineText === undefined || lineNumber === undefined) return;
    const relativePath = relativeFromRipgrep(pathText);
    if (relativePath === null) return;
    // Every event carries one line; the trailing newline is not part of it.
    const match = matchLine(relativePath, lineNumber, lineText.replace(/\r?\n$/u, ""), matcher);
    if (match === null) return;
    if (matches.length >= input.limit) {
      truncated = true;
      return;
    }
    matches.push(match);
  };

  try {
    const result = await ripgrep([...ripgrepArgs(input, ignoredDirs), "--", GUEST_ROOT], {
      // The pinned root is the guest's whole world: nothing else on this
      // machine is reachable from the run.
      preopens: { [GUEST_ROOT]: rootPath },
      stdout: {
        write: (chunk) => {
          if (truncated) return;
          pending += decoder.decode(chunk, { stream: true });
          let end = pending.indexOf("\n");
          while (end !== -1) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            if (line !== "") consume(line);
            end = pending.indexOf("\n");
          }
        },
      },
      // A file ripgrep could not read is not this panel's business; the rows
      // that did scan are the answer.
      stderr: { write: () => {} },
    });
    // 1 is "no matches" — a real answer. 2 is ripgrep refusing the run.
    if (result.code === 2) return null;
  } catch {
    return null;
  }

  return {
    matches,
    truncated,
    filesWithMatches: new Set(matches.map((match) => match.relativePath)).size,
  };
}

/**
 * Search a pinned root on this host. Throws on a malformed pattern — the RPC
 * layer has to show that to the user rather than quietly match nothing.
 */
export async function searchHostInFiles(
  rootPath: string,
  input: SearchInFilesInput,
  ignoredDirs: ReadonlySet<string>,
): Promise<SearchInFilesResult> {
  const matcher = buildMatcher(input.query, input);
  const found = await scanWithRipgrep(rootPath, input, matcher, ignoredDirs);
  if (found !== null) return found;
  return searchInFiles(localReader(), rootPath, input, ignoredDirs);
}
