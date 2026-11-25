import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { searchHostInFiles } from "./host-search";
import type { SearchInFilesInput } from "./search-in-files";

const BASE = { matchCase: false, wholeWord: false, useRegex: false };
const IGNORED = new Set(["node_modules", ".git"]);

/** A real tree on disk, because this search reads the filesystem ripgrep reads. */
async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "file-explorer-search-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content);
  }
  return root;
}

async function search(
  root: string,
  input: Partial<SearchInFilesInput> & { query: string },
): Promise<{ rows: string[]; truncated: boolean }> {
  const result = await searchHostInFiles(
    root,
    { ...BASE, limit: 50, ...input },
    IGNORED,
  );
  return {
    rows: result.matches.map((match) => `${match.relativePath}:${match.line}:${match.column}:${match.lineMatches}`).sort(),
    truncated: result.truncated,
  };
}

test("finds matching lines with their file, line and column, skipping ignored folders and binaries", async () => {
  const root = await makeTree({
    "src/a.ts": "const foo = 1;\nfoo(); foo();\n",
    "src/b.ts": "export const bar = 2;\n",
    "README.md": "hello foo world\n",
    "node_modules/pkg/index.js": "foo\n",
    "assets/deep/logo.png": "foo",
  });
  try {
    const { rows } = await search(root, { query: "foo" });
    assert.deepEqual(rows, [
      "README.md:1:6:1",
      "src/a.ts:1:6:1",
      "src/a.ts:2:0:2",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("case, whole-word and regex options decide what matches", async () => {
  const root = await makeTree({
    "a.txt": "Foo foobar foo\nfool\n",
  });
  try {
    // Case-insensitive by default: every "foo" spelling on both lines, with
    // the count of matches on the line.
    assert.deepEqual((await search(root, { query: "Foo" })).rows, ["a.txt:1:0:3", "a.txt:2:0:1"]);
    assert.deepEqual((await search(root, { query: "Foo", matchCase: true })).rows, ["a.txt:1:0:1"]);
    // Whole words only: "foobar" and "fool" are not the word.
    assert.deepEqual((await search(root, { query: "foo", wholeWord: true })).rows, ["a.txt:1:0:2"]);
    assert.deepEqual((await search(root, { query: "fo+", useRegex: true, wholeWord: true })).rows, ["a.txt:1:0:2"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pattern the regex engine refuses falls back to the walk", async () => {
  const root = await makeTree({
    "a.txt": "value=42\nother=7\n",
  });
  try {
    // A lookbehind is valid JavaScript and unsupported by the regex engine
    // ripgrep uses, so this line only appears if the fallback ran.
    const { rows } = await search(root, { query: "(?<==)\\d+", useRegex: true });
    assert.deepEqual(rows, ["a.txt:1:6:1", "a.txt:2:6:1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops at the limit and says so", async () => {
  const root = await makeTree({ "a.txt": "foo\nfoo\nfoo\n" });
  try {
    const result = await search(root, { query: "foo", limit: 2 });
    assert.equal(result.rows.length, 2);
    assert.equal(result.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("files too big to grep are left alone", async () => {
  const root = await makeTree({
    "big.txt": `foo\n${"x".repeat(1_100_000)}`,
    "small.txt": "foo\n",
  });
  try {
    const { rows } = await search(root, { query: "foo" });
    assert.deepEqual(rows, ["small.txt:1:0:1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find-in-folder's include glob (folder/**) scopes ripgrep to that subfolder", async () => {
  const root = await makeTree({
    "src/a.ts": "foo\n",
    "src/b.ts": "bar\n",
    "src/nested/deep.ts": "foo\n",
    "tests/a.test.ts": "foo\n",
  });
  try {
    // This is exactly what "Find in Folder" writes into the include field.
    const { rows } = await search(root, { query: "foo", include: "src/**" });
    assert.deepEqual(rows.sort(), ["src/a.ts:1:0:1", "src/nested/deep.ts:1:0:1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("include and exclude globs are passed to ripgrep and respected", async () => {
  const root = await makeTree({
    "src/a.ts": "foo\n",
    "src/b.ts": "foo\n",
    "src/c.txt": "foo\n",
    "tests/a.test.ts": "foo\n",
  });
  try {
    // A bare name matches at any depth; a slash makes the glob root-relative.
    const onlyTs = await search(root, { query: "foo", include: "*.ts" });
    assert.deepEqual(onlyTs.rows.sort(), [
      "src/a.ts:1:0:1",
      "src/b.ts:1:0:1",
      "tests/a.test.ts:1:0:1",
    ]);
    const srcOnly = await search(root, { query: "foo", include: "src/*.ts" });
    assert.deepEqual(srcOnly.rows.sort(), ["src/a.ts:1:0:1", "src/b.ts:1:0:1"]);
    const noTests = await search(root, { query: "foo", exclude: "**/*.test.ts" });
    assert.deepEqual(noTests.rows.sort(), ["src/a.ts:1:0:1", "src/b.ts:1:0:1", "src/c.txt:1:0:1"]);
    const noTests2 = await search(root, { query: "foo", exclude: "tests" });
    assert.deepEqual(noTests2.rows.sort(), ["src/a.ts:1:0:1", "src/b.ts:1:0:1", "src/c.txt:1:0:1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
