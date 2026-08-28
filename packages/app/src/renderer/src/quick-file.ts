export interface QuickFileMatch {
  path: string;
  matchIndices: number[];
  score: number;
}

function boundary(path: string, index: number): boolean {
  if (index === 0) return true;
  return "/._-".includes(path[index - 1] ?? "");
}

/**
 * Scores a case-insensitive subsequence match while favoring the filename, word
 * boundaries, and consecutive characters. The original path is retained for display.
 */
export function matchQuickFile(path: string, query: string): QuickFileMatch | null {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return { path, matchIndices: [], score: 0 };

  const haystack = path.toLocaleLowerCase();
  const basenameAt = haystack.lastIndexOf("/") + 1;
  const matchIndices: number[] = [];
  let from = 0;
  let score = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, from);
    if (index === -1) return null;
    const previous = matchIndices.at(-1);
    score += index >= basenameAt ? 8 : 2;
    if (boundary(haystack, index)) score += 10;
    if (previous !== undefined && index === previous + 1) score += 12;
    score -= Math.max(0, index - from);
    matchIndices.push(index);
    from = index + 1;
  }

  const contiguousAt = haystack.indexOf(needle);
  if (contiguousAt !== -1) score += contiguousAt >= basenameAt ? 80 : 40;
  score -= path.length / 100;
  return { path, matchIndices, score };
}

export function quickFileMatches(paths: string[], query: string): QuickFileMatch[] {
  return paths
    .map((path, order) => ({ match: matchQuickFile(path, query), order }))
    .filter((entry): entry is { match: QuickFileMatch; order: number } => entry.match !== null)
    .sort((left, right) => right.match.score - left.match.score || left.order - right.order)
    .map(({ match }) => match);
}
