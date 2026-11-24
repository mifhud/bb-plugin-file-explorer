/**
 * The rail is an application surface, not a document: Chrome's right-click
 * list (Back, Reload, Inspect…) has nothing to do with a file tree, and a
 * right-click that lands a pixel outside a row — the tab strip, the folder
 * selector, the gap between rows, the space below the tree — used to hand that
 * pixel back to the browser and raise that list.
 *
 * This guard covers the rail's own chrome. Elements that render a menu of
 * their own are marked with `OWN_CONTEXT_MENU_ATTR` and left alone: Radix both
 * opens the menu and suppresses the native one, and Radix skips its handler
 * when a handler that ran earlier already called `preventDefault`. Suppressing
 * first here would therefore swallow the menu instead of the browser's.
 *
 * Two more exemptions stay, the only native items worth the interruption:
 * editable fields (paste/copy of typed text) and a non-empty selection (Copy).
 */

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * Marks an element whose right-click renders a menu of its own (a Radix
 * context-menu trigger). Spread it onto that element's JSX props.
 */
export const OWN_CONTEXT_MENU_ATTR = "data-file-explorer-own-context-menu";

const OWN_CONTEXT_MENU_SELECTOR = `[${OWN_CONTEXT_MENU_ATTR}]`;

/** The part of an event target the guard asks about. */
interface ContextMenuTargetLike {
  closest?(selector: string): Element | null;
}

/** The part of the rail root the guard asks about. */
export interface NativeContextMenuRoot {
  contains(other: Node | null): boolean;
}

/** The part of the window the guard asks about — absent outside a browser. */
type SelectionView = Pick<Window, "getSelection">;

function matches(target: EventTarget | null, selector: string): boolean {
  const closest = (target as ContextMenuTargetLike | null)?.closest;
  return typeof closest === "function" && closest.call(target, selector) !== null;
}

function selectionInside(
  root: NativeContextMenuRoot,
  view: SelectionView | undefined,
): boolean {
  const selection = view?.getSelection() ?? null;
  if (selection === null || selection.isCollapsed) return false;
  return root.contains(selection.anchorNode);
}

/**
 * True when the browser's own menu is the right answer for this right-click:
 * a menu-owning element, an editable field, or text the user already selected.
 */
export function shouldKeepNativeContextMenu(
  root: NativeContextMenuRoot,
  target: EventTarget | null,
  view: SelectionView | undefined = globalThis.window,
): boolean {
  if (matches(target, OWN_CONTEXT_MENU_SELECTOR)) return true;
  if (matches(target, EDITABLE_SELECTOR)) return true;
  return selectionInside(root, view);
}

/**
 * Suppresses the browser context menu anywhere inside `root`, except where
 * `shouldKeepNativeContextMenu` says the native menu is what the user wants.
 * Returns the uninstaller.
 */
export function installNativeContextMenuGuard(
  root: HTMLElement | null,
): () => void {
  if (root === null) return () => {};
  const onContextMenu = (event: MouseEvent): void => {
    if (shouldKeepNativeContextMenu(root, event.target)) return;
    event.preventDefault();
  };
  root.addEventListener("contextmenu", onContextMenu);
  return () => root.removeEventListener("contextmenu", onContextMenu);
}
