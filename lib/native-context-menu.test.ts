import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installNativeContextMenuGuard,
  OWN_CONTEXT_MENU_ATTR,
  shouldKeepNativeContextMenu,
} from "./native-context-menu";

const insideRail = { contains: () => true };
const outsideRail = { contains: () => false };
const nothingSelected = { getSelection: () => null };
const selecting = (anchorNode: unknown) => ({
  getSelection: () => ({ isCollapsed: false, anchorNode }),
});

function target(closest: (selector: string) => Element | null): EventTarget {
  return { closest } as unknown as EventTarget;
}

const plainTarget = target(() => null);
const menuOwnerTarget = target((selector) =>
  selector.includes(OWN_CONTEXT_MENU_ATTR) ? ({} as Element) : null,
);

const editableTarget = target((selector) =>
  selector.includes("textarea") ? ({} as Element) : null,
);

test("rail chrome keeps no browser menu", () => {
  assert.equal(
    shouldKeepNativeContextMenu(outsideRail, plainTarget, nothingSelected),
    false,
  );
});

test("an element that renders its own menu owns its right-clicks", () => {
  assert.equal(
    shouldKeepNativeContextMenu(outsideRail, menuOwnerTarget, nothingSelected),
    true,
  );
});

test("an editable field keeps the browser menu", () => {
  assert.equal(
    shouldKeepNativeContextMenu(outsideRail, editableTarget, nothingSelected),
    true,
  );
});

test("only a selection inside the rail keeps the browser menu", () => {
  assert.equal(
    shouldKeepNativeContextMenu(insideRail, plainTarget, selecting({})),
    true,
  );
  assert.equal(
    shouldKeepNativeContextMenu(outsideRail, plainTarget, selecting({})),
    false,
  );
});

function fakeRail() {
  const listeners = new Map<string, (event: MouseEvent) => void>();
  return {
    element: {
      contains: () => false,
      addEventListener: (type: string, handler: (event: MouseEvent) => void) => {
        listeners.set(type, handler);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    },
    rightClick(target: EventTarget): number {
      let prevented = 0;
      listeners.get("contextmenu")?.({
        target,
        preventDefault: () => {
          prevented += 1;
        },
      } as unknown as MouseEvent);
      return prevented;
    },
  };
}

test("the guard suppresses rail right-clicks and releases on uninstall", () => {
  const rail = fakeRail();
  const uninstall = installNativeContextMenuGuard(
    rail.element as unknown as HTMLElement,
  );
  assert.equal(rail.rightClick(plainTarget), 1);
  assert.equal(rail.rightClick(editableTarget), 0);
  uninstall();
  assert.equal(rail.rightClick(plainTarget), 0);
});

test("a missing rail root installs nothing", () => {
  const uninstall = installNativeContextMenuGuard(null);
  uninstall();
});
