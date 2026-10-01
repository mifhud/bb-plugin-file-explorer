# File Explorer

A [BB](https://getbb.app) plugin that keeps a file explorer open across threads. Choose a project source or thread workspace as its pinned folder. Switching threads leaves the folder, expanded directories, and selection in place.

## Install

```
bb plugin install git:https://github.com/mifhud/bb-plugin-file-explorer.git@semver:^0.1.0
```

Or search **File Explorer** in BB Community.

## Use

- The rail carries two tabs — **Files** and **Search text**. Switch between name/path search and content search + replace with the tab buttons above the tree.
- Type in the search box to find a file by name, by part of its path, or by a path you paste. Arrow keys move, Enter selects the file in the tree and opens its preview on a thread or New Thread page; the tree re-roots if the file lives in another project. Enter with nothing in the list falls back to resolving the text as written, which also covers folders.
- Choose the pinned folder from the selector above search. Project sources and the current thread workspace are listed; the choice survives BB restarts. A search hit or chat path can temporarily show another folder. Click its root name to return to the pinned folder.
- Use the File Explorer button in the sidebar footer to show or hide the tree on any BB page. The thread header and New thread composer also provide a button.
- Drag the tree's left edge to resize it. Double-click the edge to reset the width.
- `File Explorer: find a file` in the command palette opens the panel with the search box focused.
- `File Explorer: show pinned folder` in the command palette opens the panel at the pinned root.
- Files show Seti-style type icons (markdown, JSON, git, `.env`, README, TypeScript, …), as in Cursor. Folders keep only the chevron.
- In a thread or on the New Thread page, click a file to open BB's default preview.
- Right-click to add the absolute path to an open chat draft, create a file or folder (type a name when prompted), rename or delete a file or folder, copy a relative or absolute path, or reveal it in Explorer. When several drafts are open, choose the target in the file menu. Right-click the root name at the top of the tree to create the file there. A newly created file opens in the external editor so you can paste into it. Rename and delete ask for confirmation; deleting a folder removes it recursively.
- Click the refresh button (↻) next to the folder selector to reload the root choices and current tree contents.
- Paths written in chat can jump the tree to that file, and so do bare file names like `AGENTS-base.md`. Search roots (default `~/Documents`) cover folders outside the current checkout.
- Git-ignored files appear dimmed in the tree with a tooltip noting they are ignored.

Open in Explorer reveals the file in the system file manager: `open -R` on macOS, `explorer /select` on Windows, `xdg-open` on Linux. This action is available for files on this computer.

## Settings

```
bb plugin config file-explorer
```

- **Show the pinned file explorer when BB opens** — tree is visible on BB startup (default: on)
- **Confirm before deleting files and folders** — safety dialog before destructive operations (default: on)
- **Show hidden files and folders** — reveal `.git`, `node_modules`, `.claude`, and other build/ignored folders
- **Root folder for personal threads** — set `~/Documents` to offer it as a pinned folder. Project sources and thread workspaces are also available in the folder selector. Project threads always show their project workspace.
- **Files or folders to hide by default** — extra folder names to hide in the tree and search (one per line); extends the built-in skip list (`.git`, `node_modules`, etc.)
- **Folders to search for paths mentioned in chat** — search roots for name-based resolution (default `~/Documents`)

## Develop

```bash
npm install
bb plugin build
bb plugin reload file-explorer
```

## Notes

This plugin is based on [bb-plugin-file-tree](https://github.com/fzrx-ego/bb-plugin-file-tree) by [fzrx-ego](https://github.com/fzrx-ego). It has been customized into a standalone **File Explorer** plugin under the `file-explorer` namespace, with added features such as chat path resolution, file content search and replace, git-ignore dimming, and persistent rail state across threads.
