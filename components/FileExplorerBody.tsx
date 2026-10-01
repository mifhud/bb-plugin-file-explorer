import { useEffect, useRef, useSyncExternalStore } from "react";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { openWorkspaceFile } from "@/lib/open-preview";
import { surfaceNavigation } from "@/lib/surface-navigation";
import {
  getChatTargets,
  requestAddToChat,
  subscribeChatTargets,
  type ChatTarget,
} from "@/lib/chat-draft-bus";
import type { rpcContract, TreeEntry, Workspace } from "../contract";
import type { useWorkspaceTree } from "@/hooks/useWorkspaceTree";

type TreeModel = ReturnType<typeof useWorkspaceTree>;

function absolutePathOf(workspace: Workspace, relativePath: string): string {
  const root = workspace.rootPath.replace(/\/+$/u, "");
  return relativePath === "" ? root : `${root}/${relativePath}`;
}

/** Folder a new file should land in: the row itself if it is a folder, else its parent. */
function directoryOf(entry: TreeEntry): string {
  if (entry.kind === "directory") return entry.relativePath;
  const slash = entry.relativePath.lastIndexOf("/");
  return slash === -1 ? "" : entry.relativePath.slice(0, slash);
}

function targetLabel(
  target: ChatTarget,
  activeThreadId: string | null,
): string {
  switch (target.scope.kind) {
    case "thread":
      return target.scope.threadId === activeThreadId
        ? "main thread"
        : `thread ${target.scope.threadId.slice(-6)}`;
    case "side-chat":
      return `side chat ${target.scope.tabId.slice(-6)}`;
    case "queued-message":
      return `queued message ${target.scope.queuedMessageId.slice(-6)}`;
    case "new-thread":
      return "new thread";
  }
}

async function createAndOpenFile(args: {
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  navigate: ReturnType<typeof useBbNavigate>;
  workspace: Workspace;
  directoryRelativePath: string;
  name: string;
  showCreated: (relativePath: string) => Promise<void>;
}): Promise<void> {
  try {
    const result = await args.rpc.call("createFile", {
      rootId: args.workspace.rootId,
      directoryRelativePath: args.directoryRelativePath,
      name: args.name,
    });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await args.showCreated(result.relativePath);
    const opened = openWorkspaceFile(
      args.navigate,
      args.workspace,
      result.relativePath,
      (message) => {
        void args.rpc.call("clientLog", { message }).catch(() => undefined);
      },
      "external",
    );
    if (!opened) {
      toast.error(
        "Created the file, but could not open it in an external editor.",
      );
    }
  } catch {
    toast.error("Could not create the file.");
  }
}

function TreeRow({
  entry,
  depth,
  workspace,
  tree,
  chatTargets,
  activeThreadId,
}: {
  entry: TreeEntry;
  depth: number;
  workspace: Workspace;
  tree: TreeModel;
  chatTargets: readonly ChatTarget[];
  activeThreadId: string | null;
}) {
  const overlayNavigate = useBbNavigate();
  const { threadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const isDir = entry.kind === "directory";
  const isOpen = isDir && tree.expanded.has(entry.relativePath);
  const isSelected = tree.selected === entry.relativePath;
  const childState = isOpen ? tree.dirs[entry.relativePath] : undefined;
  // A row git would not track is dimmed the way an editor draws an ignored
  // path, and says so in the tooltip. A label on every ignored row would cost
  // the name the narrow rail needs.
  const isIgnored = entry.gitIgnored === true;
  const rowRef = useRef<HTMLButtonElement>(null);

  // A reveal can land far below the fold, so bring the row into view once it
  // becomes the selected one.
  useEffect(() => {
    if (!isSelected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const onActivate = () => {
    tree.setSelected(entry.relativePath);
    if (isDir) {
      tree.toggleDir(entry.relativePath);
      return;
    }
    const navigation = surfaceNavigation(threadId);
    const opened = openWorkspaceFile(
      navigation,
      workspace,
      entry.relativePath,
      (message) => {
        void rpc.call("clientLog", { message }).catch(() => undefined);
      },
    );
    if (!opened)
      toast.error(
        navigation === null
          ? "Open a thread or New Thread page to preview files."
          : "Could not open the file preview.",
      );
  };

  const addToChat = (targetKey: string) => {
    if (
      !requestAddToChat(
        targetKey,
        absolutePathOf(workspace, entry.relativePath),
      )
    ) {
      toast.error("That chat draft is no longer open.");
    }
  };

  const osPath = {
    rootId: workspace.rootId,
    relativePath: entry.relativePath,
  };

  const openInFinder = () => {
    void rpc
      .call("revealInExplorer", osPath)
      .then((result) => {
        if (!result.ok) toast.error(result.message);
      })
      .catch(() => {
        toast.error("Could not open in Explorer.");
      });
  };

  const copyPathToClipboard = (text: string, successMessage: string) => {
    void rpc
      .call("copyTextToClipboard", {
        rootId: workspace.rootId,
        text,
      })
      .then((result) => {
        if (result.ok) toast.success(successMessage);
        else toast.error(result.message);
      })
      .catch(() => {
        toast.error("Could not copy to the clipboard.");
      });
  };

  const createFile = () => {
    const name = window.prompt("File name:");
    if (name === null) return;
    void createAndOpenFile({
      rpc,
      navigate: overlayNavigate,
      workspace,
      directoryRelativePath: directoryOf(entry),
      name,
      showCreated: tree.showCreated,
    });
  };

  const createFolder = () => {
    const name = window.prompt("Folder name:");
    if (name === null) return;
    void rpc
      .call("createFolder", {
        rootId: workspace.rootId,
        directoryRelativePath: directoryOf(entry),
        name,
      })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        await tree.showCreated(result.relativePath);
      })
      .catch(() => {
        toast.error("Could not create the folder.");
      });
  };

  const deleteThisEntry = () => {
    if (tree.confirmDelete && !window.confirm(`Delete ${entry.name}?`)) return;
    void rpc
      .call("deleteEntry", {
        rootId: workspace.rootId,
        relativePath: entry.relativePath,
      })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        await tree.forgetPath(result.relativePath);
      })
      .catch(() => {
        toast.error("Could not delete the item.");
      });
  };

  const renameThisEntry = () => {
    const oldName = entry.name;
    const newName = window.prompt("Rename to:", oldName);
    if (newName === null) return;
    void rpc
      .call("renameEntry", {
        rootId: workspace.rootId,
        relativePath: entry.relativePath,
        newName,
      })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        await tree.forgetPath(result.relativePath);
      })
      .catch(() => {
        toast.error("Could not rename the item.");
      });
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={rowRef}
            type="button"
            onClick={onActivate}
            title={
              isIgnored
                ? `${entry.relativePath} — ignored by git`
                : entry.relativePath
            }
            className={cn(
              "flex w-full min-w-0 items-center gap-0.5 rounded-[3px] py-px pr-1 text-left text-[11px] leading-5",
              "hover:bg-state-hover",
              isSelected && "bg-state-active font-medium",
            )}
            style={{ paddingLeft: 4 + depth * 10 }}
          >
            <span
              className={cn(
                "flex size-3 shrink-0 items-center justify-center text-muted-foreground",
                isIgnored && "opacity-50",
              )}
            >
              {isDir ? (
                <Icon
                  name={isOpen ? "ChevronDown" : "ChevronRight"}
                  className="size-2.5"
                />
              ) : null}
            </span>
            {isDir ? null : (
              <FileTypeIcon
                name={entry.name}
                className={cn("size-3", isIgnored && "opacity-45")}
              />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                isIgnored && "text-muted-foreground/50",
              )}
            >
              {entry.name}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {chatTargets.map((target) => (
            <ContextMenuItem
              key={target.key}
              onSelect={() => addToChat(target.key)}
            >
              <Icon name="MessageSquarePlus" className="size-4" />
              {chatTargets.length === 1
                ? "Add to chat"
                : `Add to ${targetLabel(target, activeThreadId)}`}
            </ContextMenuItem>
          ))}
          <ContextMenuItem onSelect={openInFinder}>
            <Icon name="FolderOpen" className="size-4" />
            Open in Explorer
          </ContextMenuItem>
          <ContextMenuItem onSelect={createFile}>
            <Icon name="FileText" className="size-4" />
            Create File
          </ContextMenuItem>
          <ContextMenuItem onSelect={createFolder}>
            <Icon name="FolderPlus" className="size-4" />
            Create Folder
          </ContextMenuItem>
          <ContextMenuItem onSelect={renameThisEntry}>
            <Icon name="EditFile" className="size-4" />
            {isDir ? "Rename Folder" : "Rename File"}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={deleteThisEntry}
          >
            <Icon name="Trash2" className="size-4" />
            {isDir ? "Delete folder" : "Delete file"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              copyPathToClipboard(entry.relativePath, "Relative path copied");
            }}
          >
            <Icon name="Copy" className="size-4" />
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              copyPathToClipboard(
                absolutePathOf(workspace, entry.relativePath),
                "Path copied",
              );
            }}
          >
            <Icon name="Copy" className="size-4" />
            Copy Path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isOpen && childState?.status === "loading" ? (
        <p
          className="py-0.5 pr-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft: 20 + (depth + 1) * 10 }}
        >
          …
        </p>
      ) : null}
      {isOpen && childState?.status === "error" ? (
        <p
          className="py-0.5 pr-1 text-[11px] text-destructive"
          style={{ paddingLeft: 20 + (depth + 1) * 10 }}
        >
          {childState.message}
        </p>
      ) : null}
      {isOpen && childState?.status === "ready"
        ? childState.entries.map((child) => (
            <TreeRow
              key={child.relativePath}
              entry={child}
              depth={depth + 1}
              workspace={workspace}
              tree={tree}
              chatTargets={chatTargets}
              activeThreadId={activeThreadId}
            />
          ))
        : null}
    </div>
  );
}

export function FileExplorerBody({ tree }: { tree: TreeModel }) {
  const overlayNavigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const chatTargets = useSyncExternalStore(
    subscribeChatTargets,
    getChatTargets,
    getChatTargets,
  );

  if (tree.settingsLoading) {
    return (
      <p className="px-2 py-3 text-[11px] text-muted-foreground">Loading…</p>
    );
  }
  const workspace = tree.active;
  if (workspace === null) {
    return (
      <p className="px-2 py-3 text-[11px] text-muted-foreground">
        Choose a folder above.
      </p>
    );
  }

  const createFileInRoot = () => {
    const name = window.prompt("File name:");
    if (name === null) return;
    void createAndOpenFile({
      rpc,
      navigate: overlayNavigate,
      workspace,
      directoryRelativePath: "",
      name,
      showCreated: tree.showCreated,
    });
  };

  const createFolderInRoot = () => {
    const name = window.prompt("Folder name:");
    if (name === null) return;
    void rpc
      .call("createFolder", {
        rootId: workspace.rootId,
        directoryRelativePath: "",
        name,
      })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        await tree.showCreated(result.relativePath);
      })
      .catch(() => {
        toast.error("Could not create the folder.");
      });
  };

  const root = tree.dirs[""];
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <div className="flex w-full items-center justify-between px-1.5 py-0.5">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-left text-[11px] font-medium text-muted-foreground"
              onClick={() => void tree.reload()}
              title={
                tree.isRerooted
                  ? `${workspace.rootPath} — click to return to the pinned folder`
                  : workspace.rootPath
              }
            >
              <Icon
                name={tree.isRerooted ? "ArrowTurnBackward" : "FolderGit"}
                className="size-3 shrink-0"
              />
              <span className="min-w-0 truncate">{workspace.rootName}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuItem onSelect={createFileInRoot}>
              <Icon name="FileText" className="size-4" />
              Create File
            </ContextMenuItem>
            <ContextMenuItem onSelect={createFolderInRoot}>
              <Icon name="FolderPlus" className="size-4" />
              Create Folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <button
          type="button"
          aria-label="Reload folder"
          title="Reload folder"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover"
          onClick={() => void tree.reload()}
        >
          <Icon name="RotateCcw" className="size-3" />
        </button>
      </div>
      {root?.status === "error" ? (
        <p className="px-2 text-[11px] text-destructive">{root.message}</p>
      ) : null}
      {root?.status === "ready"
        ? root.entries.map((entry) => (
            <TreeRow
              key={entry.relativePath}
              entry={entry}
              depth={0}
              workspace={workspace}
              tree={tree}
              chatTargets={chatTargets}
              activeThreadId={threadId}
            />
          ))
        : null}
    </div>
  );
}
