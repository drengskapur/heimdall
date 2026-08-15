import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearDock,
  closeDockItem,
  dockState,
  openDock,
  setDockActive,
  setDockHeight,
  subscribe,
  toggleDock,
} from "../../app/ui/dock/dock-store";

const item = (id: string) => ({ id, kind: "logs" as const, title: id, render: () => null });

test("openDock adds an item, focuses it, and opens the panel", () => {
  clearDock();
  openDock(item("a"));
  const s = dockState();
  assert.equal(s.items.length, 1);
  assert.equal(s.activeId, "a");
  assert.equal(s.open, true);
});

test("openDock with an existing id focuses without duplicating", () => {
  clearDock();
  openDock(item("a"));
  openDock(item("b"));
  openDock(item("a")); // re-open a
  const s = dockState();
  assert.equal(s.items.length, 2);
  assert.equal(s.activeId, "a");
});

test("closeDockItem removes it and re-points active to the last remaining", () => {
  clearDock();
  openDock(item("a"));
  openDock(item("b"));
  closeDockItem("b");
  assert.equal(dockState().activeId, "a");
  closeDockItem("a");
  const s = dockState();
  assert.equal(s.items.length, 0);
  assert.equal(s.activeId, null);
  assert.equal(s.open, false, "closing the last tab collapses the dock");
});

test("toggleDock flips open only when there are items", () => {
  clearDock();
  toggleDock();
  assert.equal(dockState().open, false, "no items → stays closed");
  openDock(item("a"));
  toggleDock();
  assert.equal(dockState().open, false);
  toggleDock();
  assert.equal(dockState().open, true);
});

test("setDockHeight clamps to [140, 720]", () => {
  clearDock();
  setDockHeight(50);
  assert.equal(dockState().height, 140);
  setDockHeight(10000);
  assert.equal(dockState().height, 720);
  setDockHeight(333);
  assert.equal(dockState().height, 333);
});

test("dockState returns a stable snapshot between changes (useSyncExternalStore contract)", () => {
  clearDock();
  const s1 = dockState();
  const s2 = dockState();
  assert.equal(s1, s2, "same reference when nothing changed");
  openDock(item("a"));
  assert.notEqual(dockState(), s1, "new reference after a change");
});

test("subscribe fires on change and unsubscribe stops it", () => {
  clearDock();
  let count = 0;
  const unsub = subscribe(() => {
    count++;
  });
  openDock(item("a"));
  setDockActive("a");
  const afterTwo = count;
  assert.ok(afterTwo >= 2);
  unsub();
  closeDockItem("a");
  assert.equal(count, afterTwo, "no more notifications after unsubscribe");
});
