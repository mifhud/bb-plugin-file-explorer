import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { FileExplorerPanel } from "@/components/FileExplorerPanel";
import { FileContentSearchPanel } from "@/components/FileContentSearchPanel";
import { RailResizeHandle } from "@/components/RailResizeHandle";
import { cn } from "@/lib/utils";
import { acquireRailInset, syncRailInset } from "@/lib/rail-inset";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { RAIL_EVENT, initializeRailOpen, writeStoredOpen } from "@/lib/rail-state";
import { useRailWidthPx } from "@/lib/rail-width";
import type { RootChoice, rpcContract } from "../contract";

const ROOT_STORAGE_KEY = "bb-plugin-file-explorer:pinned-root";

/** The two views the rail carries: names, or the text inside them. */
type ExplorerTab = "files" | "search";
const TAB_STORAGE_KEY = "bb-plugin-file-explorer:tab";

function readStoredTab(): ExplorerTab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "search" ? "search" : "files";
  } catch {
    return "files";
  }
}

function writeStoredTab(tab: ExplorerTab): void {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // The choice still lasts for this window when storage is unavailable.
  }
}

function readPinnedRoot(): string | null {
  try {
    const value = localStorage.getItem(ROOT_STORAGE_KEY);
    return value !== null && /^(?:thread|source|personal):[\w-]{1,128}$/u.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function writePinnedRoot(id: string): void {
  try {
    localStorage.setItem(ROOT_STORAGE_KEY, id);
  } catch {
    // The choice still lasts for this window when storage is unavailable.
  }
}

/** Mounted once per BB window. Navigation never owns or unmounts the tree. */
export function GlobalFileExplorerRail() {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId, projectId } = useBbContext();
  const { values, isLoading: settingsLoading } = useSettings();
  const compact = useIsCompactViewport();
  const railWidthPx = useRailWidthPx();
  const portalScopeProps = usePortalScopeProps();
  const insetHolderId = useRef(`file-explorer:window:${Math.random().toString(36).slice(2)}`).current;
  const initialized = useRef(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(readPinnedRoot);
  const [choices, setChoices] = useState<RootChoice[]>([]);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [tab, setTab] = useState<ExplorerTab>(readStoredTab);

  useEffect(() => {
    if (settingsLoading || initialized.current) return;
    initialized.current = true;
    if (compact) writeStoredOpen(false);
    setOpen(compact ? false : initializeRailOpen(values?.openByDefault !== false));
    setReady(true);
  }, [compact, settingsLoading, values?.openByDefault]);

  useEffect(() => {
    const onRailEvent = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean") setOpen(next);
    };
    window.addEventListener(RAIL_EVENT, onRailEvent);
    return () => window.removeEventListener(RAIL_EVENT, onRailEvent);
  }, []);

  const pinnedThreadId = selectedId?.startsWith("thread:") ? selectedId.slice(7) : null;
  /** The thread the selector last followed, so a manual choice survives re-renders. */
  const lastFollowedThread = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setLoadingRoots(true);
    void rpc.call("listRootChoices", { currentThreadId: threadId, pinnedThreadId })
      .then(({ choices: next }) => {
        if (cancelled) return;
        setChoices(next);
        // Opening a thread shows that thread's own project: the selector
        // follows the route. The pinned choice is what New Thread keeps —
        // there is no thread there to follow.
        if (threadId !== null && lastFollowedThread.current !== threadId) {
          lastFollowedThread.current = threadId;
          const follow = next.find((choice) =>
              choice.id.startsWith("source:") && choice.projectId === projectId)
            ?? next.find((choice) => choice.id === `personal:${projectId}`)
            ?? next.find((choice) => choice.id === `thread:${threadId}`)
            ?? next.find((choice) => choice.projectId !== null && choice.projectId === projectId);
          if (follow !== undefined) {
            if (follow.id !== selectedId) {
              setSelectedId(follow.id);
              writePinnedRoot(follow.id);
            }
            return;
          }
        }
        if (selectedId === null) {
          const preferred = next.find((choice) => choice.id === `personal:${projectId}`)
            ?? next.find((choice) => choice.id === `thread:${threadId}`)
            ?? next.find((choice) => choice.projectId !== null && choice.projectId === projectId)
            ?? next[0];
          if (preferred !== undefined) {
            setSelectedId(preferred.id);
            writePinnedRoot(preferred.id);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) setRootError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingRoots(false);
      });
    return () => { cancelled = true; };
  }, [rpc, threadId, projectId, pinnedThreadId, selectedId, refreshCount, values?.treeRoot]);

  const chosen = choices.find((choice) => choice.id === selectedId);
  const railOpen = ready && open;
  useLayoutEffect(() => {
    if (!railOpen || compact) {
      syncRailInset();
      return;
    }
    return acquireRailInset(insetHolderId);
  }, [compact, insetHolderId, railOpen]);

  if (!ready) return null;
  return createPortal(
    <aside
      {...portalScopeProps}
      className="fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{ display: railOpen ? "flex" : "none", width: compact ? "100vw" : `${railWidthPx}px` }}
      aria-label="File Explorer"
    >
      {compact ? null : <RailResizeHandle />}
      <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-sidebar-border pl-3 pr-1">
        <span className="truncate text-sm font-medium text-muted-foreground">File Explorer</span>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 p-0"
          aria-label="Hide file explorer" onClick={() => writeStoredOpen(false)}>
          <Icon name="FileText" className="size-4" />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <select
          aria-label="File Explorer folder"
          title="Pinned folder — changing threads does not change this tree"
          value={selectedId ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            setSelectedId(id);
            writePinnedRoot(id);
          }}
          className="min-w-0 flex-1 truncate bg-sidebar text-[11px] text-sidebar-foreground outline-none"
        >
          {selectedId === null || chosen === undefined ? <option value={selectedId ?? ""}>Choose a folder</option> : null}
          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
        <button type="button" aria-label="Refresh folder list" title="Refresh folder list"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover"
          onClick={() => setRefreshCount((count) => count + 1)}>
          <Icon name="RotateCcw" className="size-3" />
        </button>
      </div>
      <div
        role="tablist"
        aria-label="File explorer view"
        className="flex shrink-0 items-center gap-0.5 border-b border-sidebar-border px-1.5 py-1"
      >
        {(
          [
            { id: "files", icon: "FileText", label: "Files" },
            { id: "search", icon: "Search", label: "Search text" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            title={item.label}
            onClick={() => {
              setTab(item.id);
              writeStoredTab(item.id);
            }}
            className={cn(
              "flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-[4px] text-[11px] leading-4",
              "hover:bg-state-hover",
              tab === item.id && "bg-state-active font-medium text-foreground hover:bg-state-active",
            )}
          >
            <Icon name={item.icon} className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
      {rootError !== null ? <p className="px-2 py-2 text-[11px] text-destructive">{rootError}</p> : null}
      {loadingRoots && choices.length === 0 ? <p className="px-2 py-2 text-[11px] text-muted-foreground">Loading folders…</p> : null}
      {tab === "files" ? (
        <FileExplorerPanel root={chosen?.workspace ?? null} />
      ) : (
        <FileContentSearchPanel root={chosen?.workspace ?? null} />
      )}
    </aside>,
    document.body,
  );
}
