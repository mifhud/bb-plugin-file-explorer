import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPlainText } from "./clipboard.ts";

interface TextareaStub {
  value: string;
  readOnly: boolean;
  style: Record<string, unknown>;
  attributes: Record<string, string>;
  removed: boolean;
  focused: boolean;
  selection: [number, number] | null;
  setAttribute(name: string, value: string): void;
  focus(): void;
  select(): void;
  setSelectionRange(start: number, end: number): void;
  remove(): void;
}

interface StubOptions {
  writeText?: (text: string) => Promise<void>;
  /** What `document.execCommand("copy")` reports. */
  execCommandResult?: boolean;
  /** Whether the command runs the page's `copy` listeners at all. */
  fireCopyEvent?: boolean;
  /** Whether that event carries a clipboard to write into. */
  nullClipboardData?: boolean;
  execCommandThrows?: boolean;
  withDocument?: boolean;
}

function installStubs({
  writeText,
  execCommandResult = true,
  fireCopyEvent = true,
  nullClipboardData = false,
  execCommandThrows = false,
  withDocument = true,
}: StubOptions) {
  const descriptors = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  };
  const textareas: TextareaStub[] = [];
  const commands: string[] = [];
  const payloads: string[] = [];
  const copyListeners = new Set<(event: ClipboardEvent) => void>();

  Object.defineProperty(globalThis, "navigator", {
    value: writeText === undefined ? {} : { clipboard: { writeText } },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: (type: string, listener: (event: ClipboardEvent) => void) => {
        if (type === "copy") copyListeners.add(listener);
      },
      removeEventListener: (type: string, listener: (event: ClipboardEvent) => void) => {
        if (type === "copy") copyListeners.delete(listener);
      },
    },
  });

  if (withDocument) {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        body: {
          appendChild: () => {},
        },
        createElement: () => {
          const textarea: TextareaStub = {
            value: "",
            readOnly: false,
            style: {},
            attributes: {},
            removed: false,
            focused: false,
            selection: null,
            setAttribute(name, value) {
              textarea.attributes[name] = value;
            },
            focus() {
              textarea.focused = true;
            },
            select() {},
            setSelectionRange(start, end) {
              textarea.selection = [start, end];
            },
            remove() {
              textarea.removed = true;
            },
          };
          textareas.push(textarea);
          return textarea;
        },
        execCommand: (command: string) => {
          commands.push(command);
          if (execCommandThrows) throw new Error("copy command refused");
          if (fireCopyEvent) {
            const clipboardData = nullClipboardData
              ? null
              : {
                  setData: (type: string, value: string) => {
                    if (type === "text/plain") payloads.push(value);
                  },
                };
            const event = {
              clipboardData,
              preventDefault: () => {},
              stopImmediatePropagation: () => {},
            };
            for (const listener of [...copyListeners]) {
              listener(event as unknown as ClipboardEvent);
            }
          }
          return execCommandResult;
        },
      },
    });
  } else {
    Object.defineProperty(globalThis, "document", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }

  return {
    textareas,
    commands,
    payloads,
    copyListenerCount: () => copyListeners.size,
    restore: () => {
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
    },
  };
}

test("copyPlainText writes through the Clipboard API when it is available", async () => {
  const written: string[] = [];
  const stubs = installStubs({
    writeText: async (text) => {
      written.push(text);
    },
  });
  try {
    assert.equal(await copyPlainText("src/reveal.ts"), true);
    assert.deepEqual(written, ["src/reveal.ts"]);
    assert.deepEqual(stubs.commands, []);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText falls back to the editing command when the API rejects", async () => {
  const stubs = installStubs({
    writeText: async () => {
      throw new Error("NotAllowedError");
    },
  });
  try {
    assert.equal(await copyPlainText("/home/me/src/reveal.ts"), true);
    assert.deepEqual(stubs.commands, ["copy"]);
    // The listener's payload is what reaches the clipboard; the selection is not.
    assert.deepEqual(stubs.payloads, ["/home/me/src/reveal.ts"]);
    const [textarea] = stubs.textareas;
    assert.equal(textarea?.value, "/home/me/src/reveal.ts");
    assert.equal(textarea?.readOnly, true);
    assert.equal(textarea?.focused, true);
    assert.deepEqual(textarea?.selection, [0, "/home/me/src/reveal.ts".length]);
    assert.equal(textarea?.removed, true);
    assert.equal(stubs.copyListenerCount(), 0);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText uses the editing command when no Clipboard API exists", async () => {
  const stubs = installStubs({});
  try {
    assert.equal(await copyPlainText("relative/path.md"), true);
    assert.deepEqual(stubs.commands, ["copy"]);
    assert.deepEqual(stubs.payloads, ["relative/path.md"]);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText reports failure when the editing command refuses", async () => {
  const stubs = installStubs({ execCommandResult: false });
  try {
    assert.equal(await copyPlainText("x"), false);
    assert.equal(stubs.textareas[0]?.removed, true);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText reports failure when the command reports success without copying", async () => {
  const stubs = installStubs({ fireCopyEvent: false });
  try {
    assert.equal(await copyPlainText("x"), false);
    assert.equal(stubs.copyListenerCount(), 0);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText reports failure when the copy event carries no clipboard data", async () => {
  const stubs = installStubs({ nullClipboardData: true });
  try {
    assert.equal(await copyPlainText("x"), false);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText reports failure when the command throws", async () => {
  const stubs = installStubs({ execCommandThrows: true });
  try {
    assert.equal(await copyPlainText("x"), false);
  } finally {
    stubs.restore();
  }
});

test("copyPlainText reports failure without a document instead of throwing", async () => {
  const stubs = installStubs({ withDocument: false });
  try {
    assert.equal(await copyPlainText("x"), false);
  } finally {
    stubs.restore();
  }
});
