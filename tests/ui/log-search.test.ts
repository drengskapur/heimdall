import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, stepMatch } from "../../app/ui/resource/log-search";

test("findMatches finds all case-insensitive occurrences with correct spans", () => {
  const text = "Error: thing failed\nanother ERROR here\nok";
  const m = findMatches(text, "error");
  assert.equal(m.length, 2);
  assert.equal(text.slice(m[0].start, m[0].end).toLowerCase(), "error");
  assert.equal(text.slice(m[1].start, m[1].end).toLowerCase(), "error");
});

test("findMatches returns nothing for an empty query", () => {
  assert.deepEqual(findMatches("anything", ""), []);
});

test("findMatches handles overlapping-free repeated matches", () => {
  assert.equal(findMatches("aaaa", "aa").length, 2); // non-overlapping: [0,2) and [2,4)
});

test("findMatches returns [] when the needle is absent", () => {
  assert.deepEqual(findMatches("hello world", "xyz"), []);
});

test("stepMatch wraps around forward and backward", () => {
  assert.equal(stepMatch(0, 3, 1), 1);
  assert.equal(stepMatch(2, 3, 1), 0); // wrap to start
  assert.equal(stepMatch(0, 3, -1), 2); // wrap to end
  assert.equal(stepMatch(0, 0, 1), 0); // no matches → stays 0
});
