import assert from "node:assert/strict";
import { test } from "node:test";
import { rowName } from "../../app/ui/resource/row-name";

// The regression these guard is specific: `rowName` replaced
// `String(columns[0].render(row))`, which assumed the first column is the name.
// On Pods it is the warning icon, so the row menu, the confirm dialog and the
// drawer title showed "[object Object]" for a pod with an issue and the literal
// "resource" for one without.

/** A stand-in for the shape of the Pods descriptor: icon first, name second. */
const podsLike = {
  columns: [
    { id: "warning", title: "", render: (r: Row) => (r.hasIssues ? { type: "icon" } : null) },
    { id: "name", title: "Name", render: (r: Row) => r.pod.ref.name },
  ],
  refOf: (r: Row) => r.pod.ref,
} as unknown as Parameters<typeof rowName<Row>>[0];

interface Row {
  id: string;
  hasIssues: boolean;
  pod: { ref: { name: string } };
}

const row = (name: string, hasIssues: boolean): Row => ({ id: name, hasIssues, pod: { ref: { name } } });

test("a row with a ref reports its name, not its first column", () => {
  assert.equal(rowName(podsLike, row("api-7d9f", false)), "api-7d9f");
});

test("an icon in the first column never reaches the caller as a string", () => {
  // The exact failure: render() returns an object, String() gave "[object Object]".
  const name = rowName(podsLike, row("api-7d9f", true));
  assert.equal(name, "api-7d9f");
  assert.doesNotMatch(name, /\[object/);
});

test("descriptors without a ref fall back to the name column", () => {
  const noRef = {
    columns: [{ id: "name", title: "Name", render: (r: { id: string; title: string }) => r.title }],
  } as unknown as Parameters<typeof rowName<{ id: string; title: string }>>[0];
  assert.equal(rowName(noRef, { id: "1", title: "ingress-nginx" }), "ingress-nginx");
});

test("sortValue is preferred over render, since render may be a node", () => {
  const withSort = {
    columns: [
      {
        id: "name",
        title: "Name",
        render: (_r: { id: string }) => ({ type: "link" }),
        sortValue: (r: { id: string }) => `sorted-${r.id}`,
      },
    ],
  } as unknown as Parameters<typeof rowName<{ id: string }>>[0];
  assert.equal(rowName(withSort, { id: "x" }), "sorted-x");
});

test("an unnameable row yields empty, so the caller chooses the wording", () => {
  // Returning "" rather than a guess is what lets the menu say "resource" while
  // the drawer title stays blank, instead of both printing an object.
  const opaque = {
    columns: [{ id: "status", title: "Status", render: () => ({ type: "tag" }) }],
  } as unknown as Parameters<typeof rowName<{ id: string }>>[0];
  assert.equal(rowName(opaque, { id: "x" }), "");
});
