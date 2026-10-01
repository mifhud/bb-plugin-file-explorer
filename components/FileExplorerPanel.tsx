import { FileExplorerBody } from "@/components/FileExplorerBody";
import {
  FileExplorerSearchBox,
  FileExplorerSearchResults,
} from "@/components/FileExplorerSearch";
import { useFileSearch } from "@/hooks/useFileSearch";
import { useWorkspaceTree } from "@/hooks/useWorkspaceTree";
import type { Workspace } from "../contract";

export function FileExplorerPanel({
  root,
}: {
  root: Workspace | null;
}) {
  const tree = useWorkspaceTree(root);
  const search = useFileSearch(tree);
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <FileExplorerSearchBox search={search} />
      {/* The results take the tree's place rather than covering it: the rail
          is narrow, and a dropdown there hides the thing being searched. */}
      {search.isActive ? (
        <FileExplorerSearchResults search={search} />
      ) : (
        <FileExplorerBody tree={tree} />
      )}
    </div>
  );
}
