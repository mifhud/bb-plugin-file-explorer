import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { resolveUnderRoot, toRelativePath } from "./paths";
import { resolveRoot } from "./roots";
import { validateEntryName } from "./entry-name";

export type RenameEntryInput = {
  rootId: string;
  relativePath: string;
  newName: string;
};

export type RenameEntryResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

/**
 * Rename one file or folder in the tree. The workspace root is refused so a
 * context-menu click cannot rename it. The new name must be a bare name — no
 * path separators — and must not collide with an existing entry in the same
 * folder. Uses statPath + listDirectory(showSkipped) so dotfiles work.
 */
export async function renameEntry(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
  input: RenameEntryInput,
): Promise<RenameEntryResult> {
  if (input.relativePath === "") {
    return { ok: false, message: "The workspace root cannot be renamed." };
  }

  const nameCheck = validateEntryName(input.newName);
  if (!nameCheck.ok) {
    return { ok: false, message: nameCheck.message };
  }
  const trimmed = nameCheck.name;

  const root = resolveRoot(input.rootId);
  if (root === undefined) {
    return {
      ok: false,
      message: "This file explorer panel is out of date — reopen it and try again.",
    };
  }

  let absolute: string;
  try {
    absolute = resolveUnderRoot(root.rootPath, input.relativePath);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "That path is not in this tree.",
    };
  }

  const slash = input.relativePath.lastIndexOf("/");
  const parentRelative = slash === -1 ? "" : input.relativePath.slice(0, slash);

  let statResult;
  try {
    statResult = await host.call("statPath", {
      rootPath: root.rootPath,
      relativePath: input.relativePath,
    }, { hostId: root.hostId });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not check that path.",
    };
  }

  if (statResult === null) {
    return { ok: false, message: "That item is not on disk." };
  }

  let listing;
  try {
    listing = await host.call("listDirectory", {
      rootPath: root.rootPath,
      relativePath: parentRelative,
      showSkipped: true,
      ignoredFolders: [],
    }, { hostId: root.hostId });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not list that folder.",
    };
  }

  if (listing.entries.some((candidate) => candidate.name === trimmed)) {
    return {
      ok: false,
      message: `An item named ${trimmed} already exists in this folder.`,
    };
  }

  const destinationAbsolute = resolveUnderRoot(
    root.rootPath,
    parentRelative === "" ? trimmed : `${parentRelative}/${trimmed}`,
  );

  try {
    await bb.sdk.files.move({
      hostId: root.hostId,
      sourcePath: absolute,
      destinationPath: destinationAbsolute,
      rootPath: root.rootPath,
    });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not rename the item.",
    };
  }

  return { ok: true, relativePath: toRelativePath(root.rootPath, destinationAbsolute) };
}
