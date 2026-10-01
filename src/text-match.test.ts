import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMatcher, countMatches, findMatches, replaceMatches } from "./text-match";

const literal = { matchCase: false, wholeWord: false, useRegex: false };

test("a literal query matches case-insensitively by default", () => {
  const matcher = buildMatcher("foo", literal);
  assert.deepEqual(
    findMatches("Foo foo food", matcher).map((match) => match.column),
    [0, 4, 8],
  );
});

test("match case narrows a literal query", () => {
  const matcher = buildMatcher("foo", { ...literal, matchCase: true });
  assert.deepEqual(
    findMatches("Foo foo food", matcher).map((match) => match.column),
    [4, 8],
  );
});

test("whole word ignores matches inside a longer word", () => {
  const matcher = buildMatcher("foo", { ...literal, wholeWord: true });
  assert.deepEqual(
    findMatches("Foo foo food", matcher).map((match) => match.column),
    [0, 4],
  );
});

test("a literal query is escaped, not read as a pattern", () => {
  const matcher = buildMatcher("a.b", literal);
  assert.equal(findMatches("a.b axb", matcher).length, 1);
});

test("regex mode keeps capture groups", () => {
  const matcher = buildMatcher("f(o+)", { ...literal, useRegex: true });
  const replaced = replaceMatches("foo and fooo", matcher, "$1-$1", true);
  assert.equal(replaced.text, "oo-oo and ooo-ooo");
  assert.equal(replaced.count, 2);
});

test("a literal replacement inserts dollar signs verbatim", () => {
  const matcher = buildMatcher("a", literal);
  const replaced = replaceMatches("a", matcher, "$&b", false);
  assert.equal(replaced.text, "$&b");
  assert.equal(replaced.count, 1);
});

test("counts matches including repeats on one line", () => {
  const matcher = buildMatcher("foo", literal);
  assert.equal(countMatches("foo foo foo", matcher), 3);
});

test("an invalid regex is reported the moment it is built", () => {
  assert.throws(() => buildMatcher("(", { ...literal, useRegex: true }));
});
