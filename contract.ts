import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_IGNORED_DIRS = [
  ".git",
  ".claude",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
] as const;

/** Directories to skip by default; extended by the user's ignoredFolders setting. */
export const SKIP_DIR_NAMES = new Set(DEFAULT_IGNORED_DIRS);

export const SKIP_FILE_NAMES = new Set([".DS_Store"]);

export const treeEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory"]),
  /**
   * Matched by a `.gitignore` rule — the repo's own or the user's global
   * excludes file. Absent for rows the client synthesised (a revealed child
   * the host never listed), which are shown undimmed.
   */
  gitIgnored: z.boolean().optional(),
});
export type TreeEntry = z.infer<typeof treeEntrySchema>;

export const workspaceSchema = z.object({
  /**
   * Null when the root on screen is not this thread's environment — a reveal
   * that landed in another registered project re-roots the tree there.
   */
  environmentId: z.string().nullable(),
  hostId: z.string(),
  rootPath: z.string(),
  rootName: z.string(),
  /**
   * Opaque id the server minted for {hostId, rootPath}. `listDir` and
   * `revealInExplorer` take this instead of the raw
   * pair, so the server — not whatever called the RPC — decides which host
   * and path an operation actually touches.
   */
  rootId: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const rootChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  projectId: z.string().nullable(),
  workspace: workspaceSchema,
});
export type RootChoice = z.infer<typeof rootChoiceSchema>;

export const workspaceResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    workspace: workspaceSchema,
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["no_thread", "no_environment", "no_checkout"]),
  }),
]);
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>;

/** Where a reveal landed, when that is not the thread's own workspace. */
export const revealRootSchema = z.object({
  hostId: z.string(),
  rootPath: z.string(),
  rootName: z.string(),
  rootId: z.string(),
});
export type RevealRoot = z.infer<typeof revealRootSchema>;

export const revealResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    relativePath: z.string(),
    isDirectory: z.boolean(),
    /**
     * Set when the path lives in another registered project. Agents cite
     * paths from anywhere, so the tree re-roots there rather than reporting
     * a path the user can plainly see is real.
     */
    root: revealRootSchema.nullable(),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type RevealResult = z.infer<typeof revealResultSchema>;

/**
 * One row in the find-a-file list: enough to draw it, and the absolute path a
 * click hands back to the same reveal that chat paths use.
 */
export const searchHitSchema = z.object({
  name: z.string(),
  /** Relative to the root named below, so a row can show where the file lives. */
  relativePath: z.string(),
  absolutePath: z.string(),
  rootName: z.string(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

/**
 * One line inside a file that matched a text query: enough to draw the row
 * (file, line number, and the slice of the line to highlight) without sending
 * the whole file back.
 */
export const fileSearchMatchSchema = z.object({
  relativePath: z.string(),
  name: z.string(),
  /** 1-based, as an editor shows it. */
  line: z.number().int().positive(),
  /** The line, trimmed of its newline; long lines are clipped for transport. */
  text: z.string(),
  /** 0-based offset of the first match within `text`. */
  column: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  /** Every match on this line, so a row can say "3" without re-scanning. */
  lineMatches: z.number().int().positive(),
});
export type FileSearchMatch = z.infer<typeof fileSearchMatchSchema>;

/** One file's outcome from a replace run. */
export const fileReplaceOutcomeSchema = z.object({
  relativePath: z.string(),
  replaced: z.number().int().nonnegative(),
});
export type FileReplaceOutcome = z.infer<typeof fileReplaceOutcomeSchema>;

/**
 * A chat link bb aimed at a file that is not there, and the file the same text
 * really names. `text` and `href` identify the anchor the fix belongs to.
 */
export const anchorFixSchema = z.object({
  text: z.string(),
  href: z.string(),
  absolutePath: z.string(),
  hostId: z.string(),
  isDirectory: z.boolean(),
});
export type AnchorFix = z.infer<typeof anchorFixSchema>;

export const rpcContract = defineRpcContract({
  listRootChoices: {
    input: z.object({
      currentThreadId: z.string().min(1).nullable(),
      pinnedThreadId: z.string().min(1).nullable(),
    }).strict(),
    output: z.object({ choices: z.array(rootChoiceSchema) }),
  },
  resolveInRoot: {
    input: z.object({ rootId: z.string().min(1), path: z.string().trim().min(1).max(4096) }).strict(),
    output: revealResultSchema,
  },
  searchFilesInRoot: {
    input: z.object({ rootId: z.string().min(1), query: z.string().trim().min(1).max(1024), limit: z.number().int().min(1).max(50) }).strict(),
    output: z.object({ hits: z.array(searchHitSchema) }),
  },
  workspaceForThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: workspaceResultSchema,
  },
  workspaceForProject: {
    input: z.object({ projectId: z.string().min(1) }).strict(),
    output: workspaceResultSchema,
  },
  /** Turn a path as written in a chat message into a workspace-relative one. */
  resolveInWorkspace: {
    input: z
      .object({
        threadId: z.string().min(1),
        path: z.string().trim().min(1).max(4096),
      })
      .strict(),
    output: revealResultSchema,
  },
  /**
   * Which of these candidates are real paths in the thread's workspace.
   * `packs/gws` and `and/or` are the same shape, so the filesystem decides
   * which strings in a message get a reveal affordance.
   */
  /** Diagnostics from the browser, so DOM behaviour is observable in bb.log. */
  clientLog: {
    input: z.object({ message: z.string().max(2000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  resolvePaths: {
    input: z
      .object({
        threadId: z.string().min(1),
        paths: z.array(z.string().trim().min(1).max(4096)).max(200),
      })
      .strict(),
    output: z.object({ known: z.array(z.string()) }),
  },
  /**
   * Find a file by name or partial path across the thread workspace and the
   * search roots, favoring the active project. `resolveInWorkspace` is the
   * same question asked about a single written string.
   */
  searchFiles: {
    input: z
      .object({
        threadId: z.string().min(1),
        query: z.string().trim().min(1).max(1024),
        limit: z.number().int().min(1).max(50),
      })
      .strict(),
    output: z.object({ hits: z.array(searchHitSchema) }),
  },
  /**
   * Which of these chat links point at a file that does not exist, and where
   * the linked text actually lives. bb resolves a path written in a message
   * against the thread's own workspace root, so a message that names a file in
   * another project links to a path that was never there.
   */
  resolveFileAnchors: {
    input: z
      .object({
        threadId: z.string().min(1),
        anchors: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(512),
              href: z.string().trim().min(1).max(4096),
            }),
          )
          .max(100),
      })
      .strict(),
    output: z.object({ fixes: z.array(anchorFixSchema) }),
  },
  listDir: {
    input: z
      .object({
        rootId: z.string().min(1),
        relativePath: z.string(),
        showSkipped: z.boolean(),
        ignoredFolders: z.array(z.string()),
      })
      .strict(),
    output: z.object({ entries: z.array(treeEntrySchema) }),
  },
  revealInExplorer: {
    input: z
      .object({
        rootId: z.string().min(1),
        relativePath: z.string(),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true) }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  copyTextToClipboard: {
    input: z
      .object({
        rootId: z.string().min(1),
        text: z.string().max(10000),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true) }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  /**
   * Create an empty file with a user-chosen name in the given folder and
   * return its workspace-relative path so the tree can select and open it.
   */
  createFile: {
    input: z
      .object({
        rootId: z.string().min(1),
        directoryRelativePath: z.string(),
        name: z.string().trim().min(1).max(4096),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), relativePath: z.string() }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  /** Create a folder with a user-chosen name in the given folder. */
  createFolder: {
    input: z
      .object({
        rootId: z.string().min(1),
        directoryRelativePath: z.string(),
        name: z.string().trim().min(1).max(4096),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), relativePath: z.string() }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  /** Delete one file or folder. The tree root is refused. */
  deleteEntry: {
    input: z
      .object({
        rootId: z.string().min(1),
        relativePath: z.string(),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), relativePath: z.string() }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  /** Rename one file or folder. The tree root is refused. */
  renameEntry: {
    input: z
      .object({
        rootId: z.string().min(1),
        relativePath: z.string(),
        newName: z.string().trim().min(1).max(4096),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), relativePath: z.string() }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  /**
   * Search the text inside the files under a pinned root, not their names.
   * The walk respects the same hidden/ignored folders as the tree, and the
   * result carries one row per matching line.
   */
  searchInFiles: {
    input: z
      .object({
        rootId: z.string().min(1),
        query: z.string().min(1).max(1024),
        matchCase: z.boolean(),
        wholeWord: z.boolean(),
        useRegex: z.boolean(),
        limit: z.number().int().min(1).max(1000),
      })
      .strict(),
    output: z.object({
      matches: z.array(fileSearchMatchSchema),
      /** True when the walk or the match budget stopped the run early. */
      truncated: z.boolean(),
      filesScanned: z.number().int().nonnegative(),
      filesWithMatches: z.number().int().nonnegative(),
    }),
  },
  /**
   * Replace a text query inside specific files under a pinned root. Each file
   * is written with the hash it was read at, so a file that changed under the
   * run is reported as a failure rather than clobbered.
   */
  replaceInFiles: {
    input: z
      .object({
        rootId: z.string().min(1),
        query: z.string().min(1).max(1024),
        replacement: z.string().max(10000),
        matchCase: z.boolean(),
        wholeWord: z.boolean(),
        useRegex: z.boolean(),
        relativePaths: z.array(z.string()).min(1).max(500),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({
        ok: z.literal(true),
        files: z.array(fileReplaceOutcomeSchema),
        failures: z.array(z.object({ relativePath: z.string(), message: z.string() })),
        totalReplaced: z.number().int().nonnegative(),
      }),
      z.object({ ok: z.literal(false), message: z.string() }),
    ]),
  },
});
