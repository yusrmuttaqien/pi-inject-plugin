/**
 * codeword.test.ts — unit tests for the pure helpers.
 *
 * The file-patching functions (inject/revert/status/findPiRoot) touch the live
 * pi install, so they are not unit-tested here; only the pure string helpers
 * and path resolution are.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";

import { escapeCodeword, unescapeCodeword, buildInjection, MARKER } from "../src/codeword.js";
import { expandPath } from "../src/file.js";

test("escapeCodeword escapes backslashes and double quotes", () => {
  assert.equal(escapeCodeword("plain"), "plain");
  assert.equal(escapeCodeword('a"b'), 'a\\"b');
  assert.equal(escapeCodeword("a\\b"), "a\\\\b");
});

test("unescapeCodeword inverts escapeCodeword", () => {
  for (const s of ["plain", 'a"b', "a\\b", 'x"\\y']) {
    assert.equal(unescapeCodeword(escapeCodeword(s)), s);
  }
});

test("buildInjection embeds the escaped codeword and carries the marker", () => {
  const codeword = 'hello "world"';
  const { comment, code } = buildInjection(codeword);
  assert.ok(comment.includes(MARKER));
  assert.ok(code.includes(MARKER));
  assert.ok(code.includes(escapeCodeword(codeword)));
  assert.ok(code.includes("\\n\\n"));
});

test("expandPath expands ~ and resolves relative paths", () => {
  assert.equal(expandPath("~", "/cwd"), homedir());
  assert.equal(expandPath("~/x", "/cwd"), `${homedir()}/x`);
  assert.equal(expandPath("rel.md", "/cwd"), "/cwd/rel.md");
  assert.equal(expandPath("/abs.md", "/cwd"), "/abs.md");
});
