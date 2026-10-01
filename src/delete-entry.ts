import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { resolveUnderRoot, toRelativePath } from "./paths";
import { resolveRoot } from "./roots";

export type DeleteEntryInput = {
  rootId: string;
  relativePath: string;
};

export type DeleteEntryResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

/**
 * Delete one file or folder in the tree. The workspace root is refused so a
 * context-menu click cannot wipe the root. Folders are removed recursively.
 * Uses host.removePath (not bb.sdk.files.remove) so dotfiles and symlinks are
 * handled correctly — symlinks are unlinked, never their targets.
 */
export async function deleteEntry(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
  input: DeleteEntryInput,
): Promise<DeleteEntryResult> {
  if (input.relativePath === "") {
    return { ok: false, message: "The workspace root cannot be deleted." };
  }

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

  let result;
  try {
    result = await host.call("removePath", {
      rootPath: root.rootPath,
      relativePath: input.relativePath,
    }, { hostId: root.hostId });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Could not delete the item.",
    };
  }

  if (!result.ok) {
    return { ok: false, message: "That item is not on disk." };
  }

  return { ok: true, relativePath: toRelativePath(root.rootPath, absolute) };
}
