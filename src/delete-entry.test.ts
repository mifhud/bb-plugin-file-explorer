import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readdir, symlink, stat, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { deleteEntry } from "./delete-entry";
import { registerRoot } from "./roots";

function mockHost(rootPath: string): ExperimentalHostClient<typeof hostContract> {
  async function call(method: string, input: unknown): Promise<unknown> {
    let relativePath = "";
    if (typeof input === "object" && input !== null && "relativePath" in input) {
      const candidate = input.relativePath;
      if (typeof candidate === "string") relativePath = candidate;
    }
    const absolute = relativePath === "" ? rootPath : path.join(rootPath, relativePath);
    if (method === "removePath") {
      try {
        const stats = await lstat(absolute);
        if (stats.isSymbolicLink()) {
          await rm(absolute);
        } else if (stats.isDirectory()) {
          await rm(absolute, { recursive: true });
        } else {
          await rm(absolute);
        }
        return { ok: true };
      } catch (e: NodeJS.ErrnoException) {
        if (e.code === "ENOENT") return { ok: false };
        throw e;
      }
    }
    throw new Error(`Unexpected method: ${method}`);
  }
  return { call } as unknown as ExperimentalHostClient<typeof hostContract>;
}

function noopBb(): never {
  // deleteEntry no longer touches bb — satisfies the parameter without any.
  return undefined as never;
}

test("deleteEntry removes a regular file", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-file-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: "a.ts",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await readdir(rootPath), []);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry removes a dotfile", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-dotfile-"));
  try {
    await writeFile(path.join(rootPath, ".env"), "SECRET=1");
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: ".env",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await readdir(rootPath), []);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry removes a symlink without touching its target", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-symlink-"));
  try {
    const target = path.join(rootPath, "real-file.txt");
    await writeFile(target, "important");
    const link = path.join(rootPath, ".shortcut");
    await symlink(target, link);
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: ".shortcut",
    });
    assert.equal(result.ok, true);
    // Symlink is gone, but target file remains intact.
    assert.deepEqual((await readdir(rootPath)).sort(), ["real-file.txt"]);
    const targetStats = await stat(target);
    assert.equal(targetStats.isFile(), true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry removes a dotfile directory recursively", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-dotdir-"));
  try {
    await mkdir(path.join(rootPath, ".config"));
    await writeFile(path.join(rootPath, ".config", "child.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: ".config",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await readdir(rootPath), []);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry removes a symlink to a directory without touching its target", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-symlink-dir-"));
  try {
    const targetDir = path.join(rootPath, "real-dir");
    await mkdir(targetDir);
    await writeFile(path.join(targetDir, "child.ts"), "content");
    const link = path.join(rootPath, ".link-to-dir");
    await symlink(targetDir, link);
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: ".link-to-dir",
    });
    assert.equal(result.ok, true);
    // Symlink is gone, but target directory and its contents remain intact.
    assert.deepEqual((await readdir(rootPath)).sort(), ["real-dir"]);
    assert.deepEqual(await readdir(targetDir), ["child.ts"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry refuses the workspace root", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-root-"));
  try {
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: "",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /workspace root cannot be deleted/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("deleteEntry reports not-on-disk for a missing entry", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-delete-missing-"));
  try {
    const rootId = registerRoot("test-host", rootPath);
    const host = mockHost(rootPath);
    const result = await deleteEntry(noopBb(), host, {
      rootId,
      relativePath: "nope.ts",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /not on disk/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
