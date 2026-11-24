/**
 * Clipboard writes must happen where the user is looking, not on the machine
 * running bb: a browser or phone talks to a server whose own clipboard is
 * another device's. The Clipboard API covers secure origins (https, localhost,
 * the desktop webview); plain-http origins, where `navigator.clipboard` is
 * undefined, fall back to the editing command.
 */
export async function copyPlainText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyWithEditingCommand(text);
    }
  }

  return copyWithEditingCommand(text);
}

/**
 * The editing command's own clipboard payload comes from the document
 * selection, which a menu's focus handling empties before the command runs:
 * `execCommand("copy")` then reports success and copies nothing. The listener
 * supplies the payload instead, so the selection only has to exist — mobile
 * engines refuse the command without a focused field — never to be correct.
 */
function copyWithEditingCommand(text: string): boolean {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    document.body === null ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  let written = false;
  const writeCopiedContent = (event: ClipboardEvent): void => {
    if (event.clipboardData === null) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  window.addEventListener("copy", writeCopiedContent, true);

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    width: "1px",
  });
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    // A command that reports success without running the copy listener did not
    // reach the clipboard.
    return document.execCommand("copy") && written;
  } catch {
    return written;
  } finally {
    window.removeEventListener("copy", writeCopiedContent, true);
    textarea.remove();
  }
}
