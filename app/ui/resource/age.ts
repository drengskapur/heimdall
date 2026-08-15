/** Relative age from an ISO timestamp (kubectl-style: 45s / 12m / 3h / 6d).
 *
 *  Its own module because both `registry` and `custom-resources` need it and
 *  `registry` already imports the latter — importing back would close a cycle.
 *  It previously existed as two copies, and they drifted: only one guarded the
 *  unparseable case, so the other rendered "NaNd".
 */
export function age(iso?: string): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return "—";
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
