import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ignoredChildNames } from "./git-ignore";

const execFileAsync = promisify(execFile);

test("a directory outside a work tree reports nothing ignored", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-ignore-nonrepo-"));
  try {
    const ignored = await ignoredChildNames(dir, ["notes.md", "build"]);
    assert.equal(ignored.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a repo's gitignore rules mark exactly the ignored children", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-ignore-repo-"));
  try {
    try {
      await execFileAsync("git", ["init", "-q"], { cwd: dir });
    } catch {
      t.skip("git is not available");
      return;
    }
    await writeFile(path.join(dir, ".gitignore"), "build/\n*.log\n!keep.log\n");
    await mkdir(path.join(dir, "build"));
    await writeFile(path.join(dir, "notes.md"), "");
    await writeFile(path.join(dir, "debug.log"), "");
    await writeFile(path.join(dir, "keep.log"), "");

    const ignored = await ignoredChildNames(dir, [
      "notes.md",
      "debug.log",
      "keep.log",
      "build",
    ]);
    assert.equal(ignored.has("notes.md"), false);
    assert.equal(ignored.has("debug.log"), true);
    // The negation in .gitignore is honoured, not just the wildcard.
    assert.equal(ignored.has("keep.log"), false);
    assert.equal(ignored.has("build"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
