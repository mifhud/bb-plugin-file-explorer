import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FileExplorerHeaderAction } from "@/components/FileExplorerHeaderAction";
import { GlobalFileExplorerRail } from "@/components/GlobalFileExplorerRail";
import { NewThreadFileExplorerAction } from "@/components/NewThreadFileExplorerAction";
import { ChatDraftBridge } from "@/components/ChatDraftBridge";
import { requestSearchFocus } from "@/lib/search-focus-bus";
import { toggleRailOpen, writeStoredOpen } from "@/lib/rail-state";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "global-file-explorer", component: GlobalFileExplorerRail });

  app.slots.experimental_threadHeaderAction({
    id: "file-explorer-toggle",
    title: "File Explorer",
    component: ({ threadId }) => <FileExplorerHeaderAction threadId={threadId} />,
  });

  app.slots.sidebarFooterAction({
    id: "file-explorer-toggle",
    title: "File Explorer",
    icon: "FileText",
    run: toggleRailOpen,
  });

  app.composer.customize({
    id: "new-thread-file-explorer",
    scopes: ["new-thread"],
    actions: [{ id: "open-file-explorer", component: NewThreadFileExplorerAction }],
  });

  app.composer.customize({
    id: "file-explorer-chat-draft",
    scopes: ["thread", "queued-message", "side-chat", "new-thread"],
    banners: [{ id: "bridge", chrome: "bare", component: ChatDraftBridge }],
  });

  app.slots.commandPaletteAction({
    id: "find-file-in-tree",
    title: "File Explorer: find a file",
    run: () => {
      writeStoredOpen(true);
      requestSearchFocus();
    },
  });

  app.slots.commandPaletteAction({
    id: "open-file-explorer",
    title: "File Explorer: show pinned folder",
    run: () => {
      writeStoredOpen(true);
    },
  });
});
