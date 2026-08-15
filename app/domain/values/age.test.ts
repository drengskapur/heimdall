import assert from "node:assert/strict";
import { test } from "node:test";
import { Age } from "./age";

const now = Date.parse("2026-01-02T00:00:00Z");

test("formats age in s/m/h/d", () => {
  assert.equal(Age.since("2026-01-01T23:59:30Z", now).format(), "30s");
  assert.equal(Age.since("2026-01-01T23:30:00Z", now).format(), "30m");
  assert.equal(Age.since("2026-01-01T20:00:00Z", now).format(), "4h");
  assert.equal(Age.since("2025-12-30T00:00:00Z", now).format(), "3d");
});

test("boundaries between units", () => {
  const at = (secondsAgo: number) => Age.since(new Date(now - secondsAgo * 1000).toISOString(), now).format();
  assert.equal(at(0), "0s");
  assert.equal(at(59), "59s");
  assert.equal(at(60), "1m");
  assert.equal(at(3599), "59m");
  assert.equal(at(3600), "1h");
  assert.equal(at(86399), "23h");
  assert.equal(at(86400), "1d");
});

test("future timestamps clamp to 0s", () => {
  assert.equal(Age.since(new Date(now + 5000).toISOString(), now).format(), "0s");
});

test("unknown/invalid timestamps", () => {
  assert.equal(Age.since(undefined, now).known, false);
  assert.equal(Age.since(undefined, now).format(), "");
  assert.equal(Age.since("not-a-date", now).known, false);
  assert.equal(Age.epochMillis(undefined), 0);
  assert.equal(Age.epochMillis("2026-01-01T00:00:00Z"), Date.parse("2026-01-01T00:00:00Z"));
});
