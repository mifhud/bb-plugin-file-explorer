import assert from "node:assert/strict";
import { rename, mkdtemp, mkdir, rm, writeFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { renameEntry } from "./rename-entry";
import { registerRoot } from "./roots";

function mockBb(moveImpl?: (source: string, dest: string) => Promise<void>): BbPluginApi {
  const doMove = moveImpl ?? (async () => undefined);
  return {
    sdk: {
      files: {
        move: async (input: { hostId: string; sourcePath: string; destinationPath: string }) => {
          await doMove(input.sourcePath, input.destinationPath);
        },
      },
    },
  } as unknown as BbPluginApi;
}

function mockHost(rootPath: string): ExperimentalHostClient<typeof hostContract> {
  return {
    call: (async (method: string, input: unknown, _options: unknown) => {
      const relativePath = typeof input === "object" && input !== null && "relativePath" in input
        ? (input as { relativePath: string }).relativePath
        : undefined;
      const absolute = relativePath === undefined ? rootPath : path.join(rootPath, relativePath);
      if (method === "statPath") {
        try {
          const stats = await stat(absolute);
          return { isDirectory: stats.isDirectory() };
        } catch (e: NodeJS.ErrnoException) {
          if (e.code === "ENOENT") return null;
          throw e;
        }
      }
      if (method === "listDirectory") {
        const dirents = await readdir(absolute, { withFileTypes: true });
        return {
          entries: dirents
            .filter((dirent) => dirent.isFile() || dirent.isDirectory())
            .map((dirent) => ({
              name: dirent.name,
              relativePath: dirent.name,
              kind: dirent.isDirectory() ? "directory" as const : "file" as const,
            })),
        };
      }
      throw new Error(`Unexpected method: ${method}`);
      // Cast: mock matches the ExperimentalHostClient<typeof hostContract> interface at runtime.
    }) as unknown as ExperimentalHostClient<typeof hostContract>["call"],
  } satisfies ExperimentalHostClient<typeof hostContract>;
}

test("renameEntry moves a file to the new name in the same folder", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-test-"));
  try {
    await writeFile(path.join(rootPath, "old-name.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, {
      rootId,
      relativePath: "old-name.ts",
      newName: "new-name.ts",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.relativePath, "new-name.ts");
      assert.deepEqual(await readdir(rootPath), ["new-name.ts"]);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry renames a dotfile", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-dotfile-"));
  try {
    await writeFile(path.join(rootPath, ".env"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, {
      rootId,
      relativePath: ".env",
      newName: ".env.local",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.relativePath, ".env.local");
      assert.deepEqual(await readdir(rootPath), [".env.local"]);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry refuses a destination that already exists (including dotfiles)", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-collision-dotfile-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "old");
    await writeFile(path.join(rootPath, ".b"), "other");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb();
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "a.ts", newName: ".b" });
    assert.equal(result.ok, false);
    assert.deepEqual((await readdir(rootPath)).sort(), [".b", "a.ts"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry preserves the parent folder for nested files", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-nested-"));
  try {
    await mkdir(path.join(rootPath, "src"));
    await writeFile(path.join(rootPath, "src", "old.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, {
      rootId,
      relativePath: "src/old.ts",
      newName: "new.ts",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.relativePath, "src/new.ts");
      assert.deepEqual(await readdir(path.join(rootPath, "src")), ["new.ts"]);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry trims whitespace in the new name", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-trim-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "a.ts", newName: "  b.ts  " });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.relativePath, "b.ts");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry refuses the workspace root", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-root-"));
  try {
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb();
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "", newName: "something" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /workspace root cannot be renamed/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry refuses an empty new name", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-empty-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb();
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "a.ts", newName: "   " });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /name cannot be empty/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry refuses a new name with a path separator", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-sep-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb();
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "a.ts", newName: "sub/b.ts" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /single name, not a path/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry refuses a destination that already exists", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-collision-"));
  try {
    await writeFile(path.join(rootPath, "a.ts"), "old");
    await writeFile(path.join(rootPath, "b.ts"), "other");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb();
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "a.ts", newName: "b.ts" });
    assert.equal(result.ok, false);
    assert.deepEqual((await readdir(rootPath)).sort(), ["a.ts", "b.ts"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry renames a directory", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-dir-"));
  try {
    await mkdir(path.join(rootPath, "mydir"));
    await writeFile(path.join(rootPath, "mydir", "child.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: "mydir", newName: "otherdir" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.relativePath, "otherdir");
      assert.deepEqual(await readdir(path.join(rootPath, "otherdir")), ["child.ts"]);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("renameEntry renames a dotfile directory", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-rename-dotdir-"));
  try {
    await mkdir(path.join(rootPath, ".config"));
    await writeFile(path.join(rootPath, ".config", "child.ts"), "content");
    const rootId = registerRoot("test-host", rootPath);
    const bb = mockBb((source, dest) => rename(source, dest));
    const host = mockHost(rootPath);
    const result = await renameEntry(bb, host, { rootId, relativePath: ".config", newName: ".settings" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.relativePath, ".settings");
      assert.deepEqual(await readdir(path.join(rootPath, ".settings")), ["child.ts"]);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
