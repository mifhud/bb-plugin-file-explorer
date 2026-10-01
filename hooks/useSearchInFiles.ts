import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { FileSearchMatch, rpcContract, Workspace } from "../contract";

/** Two letters match half a codebase; the query only pays off from three. */
const MIN_QUERY_LENGTH = 2;
/** Long enough to skip the middle of a typed word, short enough to feel live. */
const DEBOUNCE_MS = 320;
const LIMIT = 500;

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const DEFAULT_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  useRegex: false,
};

export interface FileGroup {
  relativePath: string;
  name: string;
  matches: FileSearchMatch[];
}

export function useSearchInFiles(root: Workspace | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_OPTIONS);
  const [matches, setMatches] = useState<FileSearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);

  const rootId = root?.rootId ?? null;
  const trimmed = query.trim();

  useEffect(() => {
    if (rootId === null || trimmed.length < MIN_QUERY_LENGTH) {
      requestId.current += 1;
      setMatches([]);
      setIsSearching(false);
      setError(null);
      setTruncated(false);
      return;
    }
    const id = (requestId.current += 1);
    setIsSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      void rpc
        .call("searchInFiles", {
          rootId,
          query: trimmed,
          ...options,
          limit: LIMIT,
        })
        .then((result) => {
          if (requestId.current !== id) return;
          setMatches(result.matches);
          setTruncated(result.truncated);
          setIsSearching(false);
        })
        .catch((cause: unknown) => {
          if (requestId.current !== id) return;
          setMatches([]);
          setTruncated(false);
          setIsSearching(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rpc, rootId, trimmed, options, refreshKey]);

  /** A workspace switch must not show the previous one's hits. */
  useEffect(() => {
    requestId.current += 1;
    setMatches([]);
    setError(null);
    setTruncated(false);
  }, [rootId]);

  const groups = useMemo<FileGroup[]>(() => {
    const byPath = new Map<string, FileGroup>();
    for (const match of matches) {
      const existing = byPath.get(match.relativePath);
      if (existing === undefined) {
        byPath.set(match.relativePath, {
          relativePath: match.relativePath,
          name: match.name,
          matches: [match],
        });
      } else {
        existing.matches.push(match);
      }
    }
    return [...byPath.values()];
  }, [matches]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const toggleOption = useCallback((key: keyof SearchOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const clear = useCallback(() => {
    requestId.current += 1;
    setQuery("");
    setMatches([]);
    setError(null);
    setTruncated(false);
    setIsSearching(false);
  }, []);

  const runReplace = useCallback(
    async (relativePaths: readonly string[]) => {
      if (rootId === null || trimmed.length < MIN_QUERY_LENGTH) return;
      if (relativePaths.length === 0) return;
      setIsReplacing(true);
      try {
        const result = await rpc.call("replaceInFiles", {
          rootId,
          query: trimmed,
          replacement,
          ...options,
          relativePaths: [...relativePaths],
        });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        const changed = result.files.filter((file) => file.replaced > 0);
        if (result.totalReplaced === 0) {
          toast.info("Nothing to replace.");
        } else {
          toast.success(
            `Replaced ${result.totalReplaced} ${
              result.totalReplaced === 1 ? "match" : "matches"
            } in ${changed.length} ${changed.length === 1 ? "file" : "files"}.`,
          );
        }
        for (const failure of result.failures) {
          toast.error(`${failure.relativePath}: ${failure.message}`);
        }
        refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not replace.");
      } finally {
        setIsReplacing(false);
      }
    },
    [rpc, rootId, trimmed, replacement, options, refresh],
  );

  return {
    query,
    setQuery,
    replacement,
    setReplacement,
    options,
    toggleOption,
    matches,
    groups,
    isSearching,
    isReplacing,
    truncated,
    error,
    clear,
    refresh,
    runReplace,
    replaceAll: () => runReplace(groups.map((group) => group.relativePath)),
    /** The query is long enough and something was actually searched. */
    hasQuery: trimmed.length >= MIN_QUERY_LENGTH,
    tooShort: trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH,
  };
}
