import { spawn } from "node:child_process";

/** One directory's worth of ignored names is a few hundred bytes at most. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Which of `names` — the immediate children of `directoryAbsolute` — git
 * ignores.
 *
 * The question is answered with git itself rather than a hand-rolled parser,
 * so every rule the user already relies on applies: `.gitignore` files at any
 * depth, `.git/info/exclude`, the global excludes file configured as
 * `core.excludesFile`, negations, and directory-only patterns. A directory
 * outside a work tree, or a machine without git, simply reports nothing
 * ignored.
 *
 * Paths are fed through stdin with `-z` so a name containing a newline cannot
 * be mistaken for two.
 */
export async function ignoredChildNames(
  directoryAbsolute: string,
  names: readonly string[],
): Promise<ReadonlySet<string>> {
  if (names.length === 0) return new Set();
  const output = await runGitCheckIgnore(directoryAbsolute, names);
  if (output === null) return new Set();
  const ignored = new Set<string>();
  for (const line of output.split("\0")) {
    if (line === "") continue;
    // git echoes the path as given, but a directory pattern may come back
    // with a trailing slash; the listing knows its children without one.
    ignored.add(line.endsWith("/") ? line.slice(0, -1) : line);
  }
  return ignored;
}

/**
 * `git check-ignore -z --stdin` exits 0 when something matched and 1 when
 * nothing did, both of which are answers. Only a failure to run at all — no
 * git, no repository — resolves to `null`.
 */
function runGitCheckIgnore(
  cwd: string,
  names: readonly string[],
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let child;
    try {
      child = spawn("git", ["-C", cwd, "check-ignore", "-z", "--stdin"], {
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (size >= MAX_OUTPUT_BYTES) return;
      size += chunk.length;
      chunks.push(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    // A closed stdin is how git learns the list ended; an EPIPE here is
    // indistinguishable from an empty answer.
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${names.join("\0")}\0`);
  });
}
