// Case-insensitive substring search over log text — the pure core behind the
// logs viewer's find box (Lens's search-store equivalent). Returns every match
// span so the viewer can highlight and step through them.
export interface Match {
  readonly start: number;
  readonly end: number;
}

export function findMatches(text: string, query: string): Match[] {
  if (!query) return [];
  const matches: Match[] = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    matches.push({ start: i, end: i + needle.length });
    i = haystack.indexOf(needle, i + needle.length);
  }
  return matches;
}

/** Wrap-around step to the next/previous match index. */
export function stepMatch(current: number, total: number, delta: 1 | -1): number {
  if (total === 0) return 0;
  return (current + delta + total) % total;
}
