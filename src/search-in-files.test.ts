import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";
import {
  replaceInFiles,
  searchInFiles,
  type HostSearchEntry,
  type HostSearchFs,
} from "./search-in-files";

const ROOT = "/root";

/** An in-memory host: a flat file map with directories derived from the paths. */
function makeFs(initial: Record<string, string>): HostSearchFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>([ROOT]);
  for (const [relative, content] of Object.entries(initial)) {
    files.set(`${ROOT}/${relative}`, content);
    const parts = relative.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      dirs.add(`${ROOT}/${parts.slice(0, end).join("/")}`);
    }
  }
  return {
    files,
    async list(absolutePath): Promise<HostSearchEntry[]> {
      if (!dirs.has(absolutePath)) throw new Error("ENOENT");
      const prefix = `${absolutePath}/`;
      const entries: HostSearchEntry[] = [];
      for (const dir of dirs) {
        if (dir === absolutePath || !dir.startsWith(prefix)) continue;
        if (dir.slice(prefix.length).includes("/")) continue;
        entries.push({ name: basename(dir), kind: "directory", absolutePath: dir });
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        if (file.slice(prefix.length).includes("/")) continue;
        entries.push({ name: basename(file), kind: "file", absolutePath: file });
      }
      return entries;
    },
    async read(absolutePath) {
      const content = files.get(absolutePath);
      if (content === undefined) throw new Error("ENOENT");
      return {
        content,
        contentEncoding: "utf8",
        sha256: `${absolutePath}:${content.length}`,
        sizeBytes: Buffer.byteLength(content, "utf8"),
      };
    },
    async write({ absolutePath, content }) {
      files.set(absolutePath, content);
      return true;
    },
  };
}

const TREE = {
  "src/a.ts": "const foo = 1;\nfoo();\n",
  "src/b.ts": "export const bar = 2;\n",
  "README.md": "hello foo world\n",
  "node_modules/pkg/index.js": "foo foo foo\n",
  "logo.png": "foo",
};

const IGNORED = new Set(["node_modules", ".git"]);
const BASE = { matchCase: false, wholeWord: false, useRegex: false };

test("search finds matching lines and skips ignored folders and binaries", async () => {
  const fs = makeFs(TREE);
  const result = await searchInFiles(fs, ROOT, { query: "foo", ...BASE, limit: 50 }, IGNORED);
  assert.deepEqual(
    result.matches.map((match) => `${match.relativePath}:${match.line}`).sort(),
    ["README.md:1", "src/a.ts:1", "src/a.ts:2"],
  );
  assert.equal(result.filesWithMatches, 2);
  assert.equal(result.truncated, false);
  // node_modules and the png never contribute rows.
  assert.equal(result.matches.some((match) => match.relativePath.includes("node_modules")), false);
});

test("search reports the column and length of the first match on a line", async () => {
  const fs = makeFs({ "a.txt": "say foo now\n" });
  const result = await searchInFiles(fs, ROOT, { query: "foo", ...BASE, limit: 10 }, IGNORED);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.column, 4);
  assert.equal(result.matches[0]?.length, 3);
  assert.equal(result.matches[0]?.lineMatches, 1);
});

test("search stops at the limit and marks the result truncated", async () => {
  const fs = makeFs(TREE);
  const result = await searchInFiles(fs, ROOT, { query: "foo", ...BASE, limit: 1 }, IGNORED);
  assert.equal(result.matches.length, 1);
  assert.equal(result.truncated, true);
});

test("whole word narrows the search", async () => {
  const fs = makeFs({ "a.txt": "foobar foo\n" });
  const result = await searchInFiles(
    fs,
    ROOT,
    { query: "foo", ...BASE, wholeWord: true, limit: 10 },
    IGNORED,
  );
  assert.deepEqual(result.matches.map((match) => match.column), [7]);
});

test("replace rewrites only the named files and counts matches", async () => {
  const fs = makeFs(TREE);
  const result = await replaceInFiles(fs, ROOT, {
    query: "foo",
    replacement: "baz",
    ...BASE,
    relativePaths: ["src/a.ts"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.totalReplaced, 2);
  assert.deepEqual(result.files, [{ relativePath: "src/a.ts", replaced: 2 }]);
  assert.equal(fs.files.get(`${ROOT}/src/a.ts`), "const baz = 1;\nbaz();\n");
  // A file the caller did not list is untouched.
  assert.equal(fs.files.get(`${ROOT}/README.md`), "hello foo world\n");
});

test("replace reports an invalid regex instead of throwing", async () => {
  const fs = makeFs(TREE);
  const result = await replaceInFiles(fs, ROOT, {
    query: "(",
    replacement: "x",
    matchCase: false,
    wholeWord: false,
    useRegex: true,
    relativePaths: ["src/a.ts"],
  });
  assert.equal(result.ok, false);
});
