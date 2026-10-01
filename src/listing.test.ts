import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_IGNORED_DIRS } from "../contract";
import { listHostDirectory } from "./host-listing";
import { invalidateListings, listDir } from "./listing";
import { registerRoot } from "./roots";
test("host listing shows immediate hidden children, symlinks, and .git when enabled", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-list-test-"));
  try {
    await mkdir(path.join(rootPath, "Docs"));
    await mkdir(path.join(rootPath, ".claude", "handoffs"), { recursive: true });
    await mkdir(path.join(rootPath, ".git"));
    await symlink(".claude", path.join(rootPath, ".agents"));
    await writeFile(path.join(rootPath, ".claude", "handoffs", "target.md"), "test");

    const plain = await listHostDirectory(rootPath, "", false, [...DEFAULT_IGNORED_DIRS]);
    assert.deepEqual(plain.entries.map((entry) => entry.name), [".agents", "Docs"]);

    const shown = await listHostDirectory(rootPath, "", true, [...DEFAULT_IGNORED_DIRS]);
    assert.deepEqual(shown.entries.map((entry) => entry.name), [".agents", ".claude", ".git", "Docs"]);
    assert.equal(shown.entries.find((entry) => entry.name === ".agents")?.kind, "directory");
    assert.equal(shown.entries.some((entry) => entry.name === "handoffs"), false);

    const handoffs = await listHostDirectory(rootPath, ".claude/handoffs", true, [...DEFAULT_IGNORED_DIRS]);
    assert.deepEqual(handoffs.entries.map((entry) => entry.name), ["target.md"]);

    const rootId = registerRoot("test-host", rootPath);
    const seen: string[] = [];
    const callHost = async (input: { hostId: string; rootPath: string; relativePath: string; showSkipped: boolean; ignoredFolders: string[] }) => {
      seen.push(input.hostId);
      return listHostDirectory(input.rootPath, input.relativePath, input.showSkipped, input.ignoredFolders);
    };
    const throughServer = await listDir({ rootId, relativePath: "", showSkipped: true, ignoredFolders: [...DEFAULT_IGNORED_DIRS] }, callHost);
    assert.deepEqual(throughServer.entries, shown.entries);
    await listDir({ rootId, relativePath: "", showSkipped: true, ignoredFolders: [...DEFAULT_IGNORED_DIRS] }, callHost);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("host listing follows a symlink whose target leaves the workspace", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-symlink-test-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "bb-file-explorer-outside-"));
  try {
    await writeFile(path.join(outside, "out.md"), "x");
    await symlink(outside, path.join(rootPath, "outside"));

    // Expanding the escaping symlink lists its target's contents instead of
    // erroring "path escapes the workspace".
    const expanded = await listHostDirectory(rootPath, "outside", true, [...DEFAULT_IGNORED_DIRS]);
    assert.deepEqual(expanded.entries.map((entry) => entry.name), ["out.md"]);

    // ...and the link itself is still visible (typed as a folder) in its parent
    // listing, so it is not silently hidden.
    const parent = await listHostDirectory(rootPath, "", true, [...DEFAULT_IGNORED_DIRS]);
    const link = parent.entries.find((entry) => entry.name === "outside");
    assert.ok(link);
    assert.equal(link?.kind, "directory");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("an invalidated in-flight listing cannot refill the cache", async () => {
  const rootId = registerRoot("stale-host", "/stale/project");
  let release!: (value: { entries: { name: string; relativePath: string; kind: "file" }[] }) => void;
  const pending = new Promise<{ entries: { name: string; relativePath: string; kind: "file" }[] }>((resolve) => {
    release = resolve;
  });
  const input = { rootId, relativePath: "", showSkipped: true, ignoredFolders: [...DEFAULT_IGNORED_DIRS] };
  const old = listDir(input, async () => pending);
  invalidateListings(rootId);
  release({ entries: [{ name: "old.md", relativePath: "old.md", kind: "file" }] });
  await old;
  const fresh = await listDir(input, async () => ({ entries: [
    { name: "new.md", relativePath: "new.md", kind: "file" },
  ] }));
  assert.deepEqual(fresh.entries.map((entry) => entry.name), ["new.md"]);
});
