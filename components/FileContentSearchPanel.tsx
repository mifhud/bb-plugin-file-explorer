import { useBbContext } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { openWorkspaceFile } from "@/lib/open-preview";
import { surfaceNavigation } from "@/lib/surface-navigation";
import { useSearchInFiles, type FileGroup } from "@/hooks/useSearchInFiles";
import type { FileSearchMatch, Workspace } from "../contract";

function OptionToggle({
  name,
  label,
  active,
  disabled,
  onClick,
}: {
  name: IconName;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground",
        "hover:bg-state-hover disabled:opacity-40 disabled:hover:bg-transparent",
        active && "bg-state-active text-foreground",
      )}
    >
      <Icon name={name} className="size-3" />
    </button>
  );
}

/** Draw the line with its first match picked out, without `dangerouslySetInnerHTML`. */
function Highlighted({ match }: { match: FileSearchMatch }) {
  const before = match.text.slice(0, match.column);
  const hit = match.text.slice(match.column, match.column + match.length);
  const after = match.text.slice(match.column + match.length);
  return (
    <span className="whitespace-pre">
      {before}
      <span className="rounded-[2px] bg-state-active text-foreground">{hit}</span>
      {after}
    </span>
  );
}

function ResultGroup({
  group,
  disabled,
  onOpen,
  onReplaceFile,
}: {
  group: FileGroup;
  disabled: boolean;
  onOpen: (match: FileSearchMatch) => void;
  onReplaceFile: (relativePath: string) => void;
}) {
  return (
    <div className="mb-2">
      <div className="group/header flex items-center gap-1 rounded-[3px] px-1.5 py-0.5">
        <FileTypeIcon name={group.name} className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={group.relativePath}>
          {group.name}
        </span>
        <span className="shrink-0 rounded-full bg-state-hover px-1.5 text-[9px] leading-4 text-muted-foreground">
          {group.matches.length}
        </span>
        <button
          type="button"
          title={`Replace in ${group.name}`}
          aria-label={`Replace in ${group.name}`}
          disabled={disabled}
          onClick={() => onReplaceFile(group.relativePath)}
          className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 hover:bg-state-hover group-hover/header:opacity-100 disabled:opacity-30"
        >
          <Icon name="Replace" className="size-3" />
        </button>
      </div>
      {group.matches.map((match) => (
        <button
          key={`${match.relativePath}:${match.line}`}
          type="button"
          title={`${match.relativePath}:${match.line}`}
          onClick={() => onOpen(match)}
          className="flex w-full min-w-0 items-start gap-1 rounded-[3px] px-1.5 py-0.5 text-left hover:bg-state-hover"
        >
          <span className="w-7 shrink-0 pt-px text-right text-[10px] leading-4 text-muted-foreground">
            {match.line}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
            <Highlighted match={match} />
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Search the text inside the pinned folder and replace it in place. The name
 * search in the Files tab answers "where is this file"; this answers "where is
 * this word", which is the question a rename or an API change actually asks.
 */
export function FileContentSearchPanel({ root }: { root: Workspace | null }) {
  const { threadId } = useBbContext();
  const search = useSearchInFiles(root);

  const openMatch = (match: FileSearchMatch) => {
    if (root === null) return;
    // The window overlay this panel lives in has no preview panel of its own,
    // so the open has to go through the route surface's navigator — the same
    // one a tree row uses.
    const navigation = surfaceNavigation(threadId);
    const opened = openWorkspaceFile(navigation, root, match.relativePath);
    if (!opened) toast.error(navigation === null
      ? "Open a thread or New Thread page to preview files."
      : "Could not open the file preview.");
  };

  if (root === null) {
    return (
      <p className="px-2 py-3 text-[11px] text-muted-foreground">Choose a folder above.</p>
    );
  }

  const summary = search.groups.length === 0
    ? null
    : `${search.matches.length}${search.truncated ? "+" : ""} in ${search.groups.length} ${
        search.groups.length === 1 ? "file" : "files"
      }`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 flex-col gap-1 border-b border-sidebar-border px-1.5 py-1">
        <div className="flex items-center gap-1">
          <Icon name="Search" className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder="Search in files"
            aria-label="Search text inside files"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[11px] leading-5 text-sidebar-foreground outline-none placeholder:text-muted-foreground"
          />
          {search.query !== "" ? (
            <button
              type="button"
              onClick={search.clear}
              aria-label="Clear search"
              className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-state-hover"
            >
              <Icon name="X" className="size-2.5" />
            </button>
          ) : null}
          <OptionToggle
            name="CaseSensitive"
            label="Match case"
            active={search.options.matchCase}
            onClick={() => search.toggleOption("matchCase")}
          />
          <OptionToggle
            name="WholeWord"
            label="Match whole word"
            active={search.options.wholeWord}
            onClick={() => search.toggleOption("wholeWord")}
          />
          <OptionToggle
            name="Regex"
            label="Use regular expression"
            active={search.options.useRegex}
            onClick={() => search.toggleOption("useRegex")}
          />
        </div>
        <div className="flex items-center gap-1">
          <Icon name="Replace" className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={search.replacement}
            onChange={(event) => search.setReplacement(event.target.value)}
            placeholder="Replace with"
            aria-label="Replacement text"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[11px] leading-5 text-sidebar-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            title="Replace all"
            aria-label="Replace all"
            disabled={search.isReplacing || search.groups.length === 0}
            onClick={search.replaceAll}
            className="flex size-5 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-state-hover disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon name="ReplaceAll" className="size-3" />
          </button>
        </div>
      </div>

      {summary !== null ? (
        <p className="shrink-0 border-b border-sidebar-border px-2 py-1 text-[10px] text-muted-foreground">
          {summary}
          {search.truncated ? " — refine the query to see the rest" : ""}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {search.error !== null ? (
          <p className="px-2 py-2 text-[11px] text-destructive">{search.error}</p>
        ) : search.tooShort ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            Type at least 2 characters to search.
          </p>
        ) : search.isSearching && search.matches.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">Searching…</p>
        ) : search.matches.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            {search.hasQuery ? "No matches." : "Search inside every file under this folder."}
          </p>
        ) : (
          <>
            {search.isSearching ? (
              <p className="px-2 py-1 text-[10px] text-muted-foreground">Searching…</p>
            ) : null}
            {search.groups.map((group) => (
              <ResultGroup
                key={group.relativePath}
                group={group}
                disabled={search.isReplacing}
                onOpen={openMatch}
                onReplaceFile={(relativePath) => void search.runReplace([relativePath])}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
