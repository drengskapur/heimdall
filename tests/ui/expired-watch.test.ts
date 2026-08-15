import assert from "node:assert/strict";
import { test } from "node:test";
import { isExpiredWatch } from "../../app/lib/kubernetes";

// A watch tracks the last resourceVersion it saw and reconnects with it. When
// that version ages out of the apiserver's watch cache the reconnect fails with
// 410 Gone — and reconnecting with the *same* version can only fail the same
// way, which turned an expired watch into a silent once-a-second loop with the
// table frozen on stale rows. This predicate is what tells the loop to drop the
// version and re-list, so its false negatives are the bug coming back.

test("a 410 status is recognised however the relay surfaces it", () => {
  assert.equal(isExpiredWatch(Object.assign(new Error("gone"), { status: 410 })), true);
  // Relays that keep the body but lose the status code.
  assert.equal(isExpiredWatch(new Error('{"kind":"Status","code":410,"reason":"Expired"}')), true);
  assert.equal(isExpiredWatch(new Error('{"kind":"Status","code": 410}')), true);
  assert.equal(
    isExpiredWatch(new Error("too old resource version: 12345 (67890)")),
    true,
    "the apiserver's own wording",
  );
});

test("ordinary failures are not mistaken for expiry", () => {
  // These must keep reporting through onError instead of silently re-listing.
  assert.equal(isExpiredWatch(new Error("network error")), false);
  assert.equal(isExpiredWatch(Object.assign(new Error("forbidden"), { status: 403 })), false);
  assert.equal(isExpiredWatch(Object.assign(new Error("server error"), { status: 500 })), false);
  // "Expired" alone is not enough — a certificate-expiry message must not make
  // the watch throw away its position and re-list forever.
  assert.equal(isExpiredWatch(new Error("client certificate has Expired")), false);
});

test("non-objects never match", () => {
  assert.equal(isExpiredWatch(null), false);
  assert.equal(isExpiredWatch(undefined), false);
  assert.equal(isExpiredWatch("410"), false);
});
