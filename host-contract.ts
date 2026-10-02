import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { fileSearchMatchSchema, treeEntrySchema } from "./contract";

export const hostContract = defineRpcContract({
  statPath: {
    input: z.object({ rootPath: z.string().min(1), relativePath: z.string() }).strict(),
    output: z.object({ isDirectory: z.boolean() }).strict().nullable(),
  },
  listDirectory: {
    input: z.object({
      rootPath: z.string().min(1),
      relativePath: z.string(),
      showSkipped: z.boolean(),
      ignoredFolders: z.array(z.string()),
    }).strict(),
    output: z.object({ entries: z.array(treeEntrySchema) }).strict(),
  },
  /**
   * Text search inside a root, run on the machine that owns it: the files never
   * cross the host bridge, and a root on another paired host searches there.
   */
  searchInFiles: {
    input: z.object({
      rootPath: z.string().min(1),
      query: z.string().min(1).max(1024),
      matchCase: z.boolean(),
      wholeWord: z.boolean(),
      useRegex: z.boolean(),
      limit: z.number().int().min(1).max(1000),
      ignoredFolders: z.array(z.string()).max(200),
    }).strict(),
    output: z.object({
      matches: z.array(fileSearchMatchSchema),
      /** True when the match budget stopped the run before the tree was exhausted. */
      truncated: z.boolean(),
      filesWithMatches: z.number().int().nonnegative(),
    }).strict(),
  },
  removePath: {
    input: z.object({
      rootPath: z.string().min(1),
      relativePath: z.string(),
    }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
});
