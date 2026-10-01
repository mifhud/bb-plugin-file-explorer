/**
 * The matching rules behind the Search panel's query box.
 *
 * A query is read the way the user wrote it: literally unless they ask for a
 * regular expression, case-insensitively unless they ask for case, and whole
 * words only when asked. One builder produces a single global `RegExp` and
 * every caller — the per-line highlight, the count, and the replace — uses
 * that same expression, so a row the panel paints and a replacement it writes
 * can never disagree about what matched.
 */

export interface MatchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

/** `foo.bar` typed literally should not match `fooXbar`. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * One global expression for `query`. Throws on a malformed regular expression
 * so the caller can tell the user instead of silently matching nothing.
 *
 * Whole-word matching uses lookarounds rather than `\b`, because `\b` puts a
 * boundary between a word character and the start of the string even when the
 * query itself opens with `.` or `-`; the lookarounds test the characters
 * actually adjacent to the match, which is what "whole word" means.
 */
export function buildMatcher(query: string, options: MatchOptions): RegExp {
  const core = options.useRegex ? query : escapeRegExp(query);
  const source = options.wholeWord ? `(?<!\\w)(?:${core})(?!\\w)` : core;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}

export interface LineMatch {
  /** 0-based offset into the line. */
  column: number;
  length: number;
}

/** Advances a global matcher past one match, tolerating a zero-length one. */
function advance(matcher: RegExp, match: RegExpExecArray): void {
  matcher.lastIndex = match[0].length === 0 ? matcher.lastIndex + 1 : match.index + match[0].length;
}

/** Every match on one line, in order. `matcher` must be global. */
export function findMatches(line: string, matcher: RegExp): LineMatch[] {
  const matches: LineMatch[] = [];
  matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line)) !== null) {
    // A pattern that can match the empty string is not a highlightable match.
    if (match[0].length > 0) matches.push({ column: match.index, length: match[0].length });
    advance(matcher, match);
  }
  return matches;
}

/** How many matches `text` holds, including zero-length ones. */
export function countMatches(text: string, matcher: RegExp): number {
  let count = 0;
  matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    count += 1;
    advance(matcher, match);
  }
  return count;
}

export interface TextReplacement {
  text: string;
  count: number;
}

/**
 * Apply `replacement` to every match in `text`.
 *
 * A literal query inserts the replacement verbatim: `$&` and `$1` in the
 * Replace field are just characters when the query is not a regex, so the
 * replacer function form is used. A regex query keeps `String.replace`'s
 * `$1` / `$&` expansion, which is what capture groups are for.
 */
export function replaceMatches(
  text: string,
  matcher: RegExp,
  replacement: string,
  useRegex: boolean,
): TextReplacement {
  const count = countMatches(text, matcher);
  if (count === 0) return { text, count: 0 };
  matcher.lastIndex = 0;
  const next = useRegex
    ? text.replace(matcher, replacement)
    : text.replace(matcher, () => replacement);
  return { text: next, count };
}
