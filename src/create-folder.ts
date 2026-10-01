import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { resolveUnderRoot, toRelativePath } from "./paths";
import { resolveRoot } from "./roots";
import { validateEntryName } from "./entry-name";

export type CreateFolderInput = {
  rootId: string;
  /** Folder to create in. Empty string is the tree root. */
  directoryRelativePath: string;
  name: string;
};

export type CreateFolderResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

/**
 * Create a folder with a user-chosen name in a folder already on the tree,
 * without overwriting anything that is already there.
 * Uses listDirectory(showSkipped) so dotfiles in the target folder are seen.
 */
export async function createFolder(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
  input: CreateFolderInput,
): Promise<CreateFolderResult> {
  const nameCheck = validateEntryName(input.name);
  if (!nameCheck.ok) {
    return { ok: false, message: nameCheck.message };
  }
  const name = nameCheck.name;

  const root = resolveRoot(input.rootId);
  if (root === undefined) {
    return {
      ok: false,
      message: "This file explorer panel is out of date — reopen it and try again.",
    };
  }

  let directoryAbsolute: string;
  try {
    directoryAbsolute = resolveUnderRoot(root.rootPath, input.directoryRelativePath);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "That folder is not in this tree.",
    };
  }

  try {
    const listing = await host.call("listDirectory", {
      rootPath: root.rootPath,
      relativePath: input.directoryRelativePath,
      showSkipped: true,
      ignoredFolders: [],
    }, { hostId: root.hostId });
    if (listing.entries.some((entry) => entry.name === name)) {
      return { ok: false, message: `An item named ${name} already exists here.` };
    }
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not list that folder.",
    };
  }

  const relativePath =
    input.directoryRelativePath === "" ? name : `${input.directoryRelativePath}/${name}`;

  let absolute: string;
  try {
    absolute = resolveUnderRoot(root.rootPath, relativePath);
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "That path is not in this tree.",
    };
  }

  try {
    await bb.sdk.files.mkdir({
      hostId: root.hostId,
      path: absolute,
      rootPath: root.rootPath,
      recursive: false,
    });
    return { ok: true, relativePath: toRelativePath(root.rootPath, absolute) };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not create the folder.",
    };
  }
}
