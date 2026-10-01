import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeRailOpen, RAIL_EVENT, toggleRailOpen, writeStoredOpen } from "./rail-state";

const GIT_RAIL_EVENT = "bb-plugin-git:rail-open";
const GIT_RAIL_STORAGE_KEY = "bb-plugin-git:rail-open";
const SELF_RAIL_STORAGE_KEY = "bb-plugin-file-explorer:rail-open";

test("first toggle opens a rail whose default setting is closed", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const events: boolean[] = [];
  const target = new EventTarget();
  target.addEventListener(RAIL_EVENT, (event) => {
    events.push((event as CustomEvent<boolean>).detail);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  try {
    assert.equal(initializeRailOpen(false), false);
    toggleRailOpen();
    assert.deepEqual(events, [false, true]);
    assert.equal(values.get(SELF_RAIL_STORAGE_KEY), "1");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("opening the file-explorer rail closes the sibling git rail", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([
    [SELF_RAIL_STORAGE_KEY, "0"],
    [GIT_RAIL_STORAGE_KEY, "1"],
  ]);
  const gitEvents: boolean[] = [];
  const target = new EventTarget();
  target.addEventListener(GIT_RAIL_EVENT, (event) => {
    gitEvents.push((event as CustomEvent<boolean>).detail);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  try {
    writeStoredOpen(true);
    assert.equal(values.get(SELF_RAIL_STORAGE_KEY), "1");
    assert.equal(values.get(GIT_RAIL_STORAGE_KEY), "0");
    assert.deepEqual(gitEvents, [false]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("closing the file-explorer rail does not affect the sibling git rail", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([
    [SELF_RAIL_STORAGE_KEY, "1"],
    [GIT_RAIL_STORAGE_KEY, "1"],
  ]);
  const gitEvents: boolean[] = [];
  const target = new EventTarget();
  target.addEventListener(GIT_RAIL_EVENT, (event) => {
    gitEvents.push((event as CustomEvent<boolean>).detail);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  try {
    writeStoredOpen(false);
    assert.equal(values.get(SELF_RAIL_STORAGE_KEY), "0");
    assert.equal(values.get(GIT_RAIL_STORAGE_KEY), "1");
    assert.deepEqual(gitEvents, []);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("toggle after sibling closes the rail opens it (stale currentOpen)", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([
    [SELF_RAIL_STORAGE_KEY, "1"],
    [GIT_RAIL_STORAGE_KEY, "0"],
  ]);
  const gitEvents: boolean[] = [];
  const target = new EventTarget();
  target.addEventListener(GIT_RAIL_EVENT, (event) => {
    gitEvents.push((event as CustomEvent<boolean>).detail);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  try {
    // Open this rail (currentOpen = true, storage = "1").
    writeStoredOpen(true);
    assert.equal(values.get(SELF_RAIL_STORAGE_KEY), "1");
    // Simulate sibling closing this rail: writes "0" to our storage + dispatches
    // our event — but does NOT update currentOpen (stale = true).
    values.set(SELF_RAIL_STORAGE_KEY, "0");
    target.dispatchEvent(new CustomEvent(RAIL_EVENT, { detail: false }));
    // Toggle should read "0" from storage (not stale currentOpen) and OPEN.
    // Opening dispatches git event "false" a second time via closeSiblingRail.
    toggleRailOpen();
    assert.equal(values.get(SELF_RAIL_STORAGE_KEY), "1");
    assert.equal(values.get(GIT_RAIL_STORAGE_KEY), "0");
    assert.deepEqual(gitEvents, [false, false]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
