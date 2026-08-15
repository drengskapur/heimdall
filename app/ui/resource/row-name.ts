import type { Descriptor } from "./registry";

/** A row's name, for menu headings, confirm dialogs and drawer titles.
 *
 *  This used to be `String(columns[0].render(row))`, on the assumption that the
 *  first column is the name. For Pods it is not — column 0 is the warning icon —
 *  so a pod with an issue stringified to "[object Object]" and a pod without one
 *  fell through to the literal "resource". The busiest page in the app never
 *  showed a pod's name in any of the three places this feeds.
 *
 *  `refOf` is the row's actual Kubernetes identity and is what any kind with one
 *  answers with. The `name` column is the fallback for descriptors that have no
 *  ref, such as Helm releases. A ReactNode is never stringified: when neither
 *  source yields a string or a number this returns "", and the caller decides
 *  what to say instead of printing an object.
 *
 *  Its own module rather than a helper inside resource-page.tsx so it can be
 *  tested without loading React and Blueprint; the `Descriptor` import is
 *  type-only and erases. */
export function rowName<T extends { id: string }>(descriptor: Descriptor<T>, row: T): string {
  const ref = descriptor.refOf?.(row);
  if (ref?.name) return ref.name;
  const named = descriptor.columns.find(column => column.id === "name");
  const value = named?.sortValue?.(row) ?? named?.render(row);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
