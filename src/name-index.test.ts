import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_IGNORED_DIRS, type RevealRoot } from "../contract";
import { statHostPath } from "./host-listing";
import { findByName } from "./name-index";
import { registerRoot } from "./roots";
import { resolveInRoot } from "./reveal";

test("findByName resolves a bare filename to its owning root", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "bb-file-explorer-name-index-"));
  const docs = path.join(base, "Documents");
  try {
    await mkdir(docs, { recursive: true });
    await writeFile(path.join(docs, "lonely.md"), "x");
    const roots: RevealRoot[] = [
      { hostId: "host-1", rootPath: docs, rootName: "Documents", rootId: registerRoot("host-1", docs) },
    ];
    const hit = await findByName(roots, "lonely.md", new Set(DEFAULT_IGNORED_DIRS));
    assert.ok(hit);
    assert.equal(hit?.relativePath, "lonely.md");
    assert.equal(hit?.isDirectory, false);
    assert.equal(hit?.root.rootPath, docs);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("findByName resolves a multi-segment name to the right file inside its root", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "bb-file-explorer-name-index-"));
  const docs = path.join(base, "Documents");
  try {
    await mkdir(docs, { recursive: true });
    await mkdir(path.join(docs, "proj"));
    await writeFile(path.join(docs, "proj", "notes.md"), "x");
    const roots: RevealRoot[] = [
      { hostId: "host-1", rootPath: docs, rootName: "Documents", rootId: registerRoot("host-1", docs) },
    ];
    const hit = await findByName(roots, "proj/notes.md", new Set(DEFAULT_IGNORED_DIRS));
    assert.ok(hit);
    assert.equal(hit?.relativePath, "proj/notes.md");
    assert.equal(hit?.root.rootPath, docs);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a bare filename mentioned in chat reveals via the name index across roots", async () => {
  // Regression: `findByName` used an undeclared `name`, so a chat link to a
  // bare filename (not present in the thread workspace) threw "name is not
  // defined" instead of re-rooting the tree to the file.
  const base = await mkdtemp(path.join(tmpdir(), "bb-file-explorer-reveal-name-"));
  const workspace = path.join(base, "thread-ws");
  const docs = path.join(base, "Documents");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(docs, { recursive: true });
    await writeFile(path.join(workspace, "exists.md"), "here");
    await writeFile(path.join(docs, "lonely.md"), "there");

    const rootId = registerRoot("host-1", workspace);
    const bb = {
      sdk: {
        system: { config: async () => ({ primaryHostId: "host-1" }) },
        projects: { list: async () => [] },
        threads: { get: async () => ({ environmentId: "env-1", projectId: "proj-1" }) },
        environments: { get: async () => ({ id: "env-1", hostId: "host-1", path: workspace }) },
        hosts: { pathsExist: async () => ({ existence: {} }) },
      },
      log: { warn: () => undefined, info: () => undefined },
    } as unknown as BbPluginApi;
    const probe = async (hostId: string, rootPath: string, relativePath: string) =>
      statHostPath(rootPath, relativePath);

    const result = await resolveInRoot(bb, { rootId, path: "lonely.md" }, async () => [docs], probe, new Set(DEFAULT_IGNORED_DIRS));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.isDirectory, false);
      assert.equal(result.relativePath, "lonely.md");
      // Re-roots to the Documents search root, not the thread workspace.
      assert.equal(result.root?.rootPath, docs);
    }
    // And the thread-workspace file still resolves in place.
    const here = await resolveInRoot(bb, { rootId, path: "exists.md" }, async () => [docs], probe, new Set(DEFAULT_IGNORED_DIRS));
    assert.equal(here.ok, true);
    if (here.ok) assert.equal(here.root, null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
