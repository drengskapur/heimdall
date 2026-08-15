// A URL path. Anyone can type one, link to one, or keep a stale bookmark.
// From .fuzz-build — see fuzz/quantity.fuzz.mjs for why. The localStorage
// shim below has to exist before the module is evaluated.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { href, parse } = await import("../.fuzz-build/app/ui/router.js");

export function fuzz(data) {
  const pathname = data.toString("utf8");
  const route = parse(pathname);
  if (typeof route.cluster !== "string" || typeof route.page !== "string") {
    throw new Error("parse returned a non-string field");
  }
  // Whatever it parsed to must be expressible as a path again: an unroundtrippable
  // route is one the address bar and the app disagree about.
  if (typeof href(route) !== "string") throw new Error("href did not return a string");
}
