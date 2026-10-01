import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { resolveRoot } from "./roots";
import { resolveUnderRoot } from "./paths";

const execFileAsync = promisify(execFile);

export type OsActionResult = { ok: true } | { ok: false; message: string };

export interface WorkspacePathInput {
  rootId: string;
  relativePath: string;
}

/**
 * This action always runs on this process's own machine (there is no
 * `hostId` to route by), so a root registered against a real workspace can be
 * resolved there. The relative path is lexically confined (no `..`/absolute
 * escapes); symlinks are followed, so "Open in Explorer" on an in-tree link
 * opens the link's target — the link entry itself stays inside the workspace.
 */
function resolveExisting(input: WorkspacePathInput): string {
  const root = resolveRoot(input.rootId);
  if (root === undefined) {
    throw new Error("This file explorer panel is out of date — reopen it and try again.");
  }
  return resolveUnderRoot(root.rootPath, input.relativePath);
}

function fail(cause: unknown, fallback: string): OsActionResult {
  const message = cause instanceof Error ? cause.message : fallback;
  return { ok: false, message };
}

let cachedWsl: boolean | undefined;
function isWsl(): boolean {
  if (cachedWsl !== undefined) return cachedWsl;
  if (process.platform !== "linux") {
    cachedWsl = false;
    return false;
  }
  try {
    cachedWsl = readFileSync("/proc/sys/kernel/osrelease", "utf8").includes("microsoft");
  } catch {
    cachedWsl = false;
  }
  return cachedWsl;
}

/** Launch a GUI app without waiting on its (unreliable) exit code. */
function spawnDetached(command: string, args: string[]): void {
  const proc = spawn(command, args, { detached: true, stdio: "ignore" });
  proc.unref();
}

/**
 * Reveal the item in the desktop file manager (Finder / Explorer / Files).
 * `open -R` selects the file in its parent folder rather than opening it.
 */
export async function revealInExplorer(
  input: WorkspacePathInput,
): Promise<OsActionResult> {
  let absolute: string;
  try {
    absolute = await resolveExisting(input);
  } catch (cause) {
    return fail(cause, "That path is not on disk.");
  }

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-R", absolute]);
      return { ok: true };
    }
    if (process.platform === "win32") {
      spawnDetached("explorer", [`/select,${absolute}`]);
      return { ok: true };
    }
    if (await isWsl()) {
      const { stdout } = await execFileAsync("wslpath", ["-w", absolute]);
      const winPath = stdout.trim();
      spawnDetached("/mnt/c/Windows/explorer.exe", [`/select,${winPath}`]);
      return { ok: true };
    }
    await execFileAsync("xdg-open", [absolute]);
    return { ok: true };
  } catch (cause) {
    return fail(cause, "Could not open in Explorer.");
  }
}

/**
 * Try one clipboard command via stdin.
 */
function trySpawnClipboard(command: string, args: string[], text: string): Promise<OsActionResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    proc.on("error", (err) => resolve(fail(err, "Could not copy to the clipboard.")));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve(fail(new Error(`Process exited with code ${code}`), "Could not copy to the clipboard."));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/** Put a plain-text string on the system clipboard. */
export async function copyTextToClipboard(
  text: string,
): Promise<OsActionResult> {
  if (process.platform === "darwin") {
    return trySpawnClipboard("pbcopy", [], text);
  }
  if (process.platform === "win32") {
    return trySpawnClipboard("clip", [], text);
  }
  const linuxCommands: Array<[string, string[]]> = [
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
    ["clip.exe", []],
    ["/mnt/c/Windows/System32/clip.exe", []],
  ];
  for (const [command, args] of linuxCommands) {
    const result = await trySpawnClipboard(command, args, text);
    if (result.ok) return result;
  }
  return {
    ok: false,
    message: "Could not copy to the clipboard. Install xclip or run in a graphical environment.",
  };
}
