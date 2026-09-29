import type { Commit } from '../types';

/**
 * Hashes covered by a branch focus. Mirrors `git log <base>..<tip>` for the
 * focused refs — their tips' ancestry minus the ancestry of `baseHash` (the
 * commit the branch was created from) — plus the fork point itself, which is
 * kept as the boundary anchor (git's `--boundary`).
 *
 * Without a base the whole ancestry is covered, which is what a multi-branch
 * focus or an unresolved base falls back to.
 *
 * `matchesTip` decides whether a loaded commit carries one of the focused refs.
 * Returns null when no loaded commit matches (nothing to focus).
 */
export function collectFocusHashes(
  commits: Commit[],
  matchesTip: (commit: Commit) => boolean,
  baseHash: string | null,
): Set<string> | null {
  const byHash = new Map(commits.map((c) => [c.hash, c]));

  const ancestorsOf = (start: string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length > 0) {
      const hash = stack.pop()!;
      if (seen.has(hash)) continue;
      seen.add(hash);
      const commit = byHash.get(hash);
      if (commit) {
        for (const parent of commit.parents) {
          if (!seen.has(parent)) stack.push(parent);
        }
      }
    }
    return seen;
  };

  const tips: string[] = [];
  for (const c of commits) {
    if (matchesTip(c)) tips.push(c.hash);
  }
  if (tips.length === 0) return null;

  const reachable = ancestorsOf(tips);
  // The base's ancestry is not this branch's work; only the fork point stays.
  if (baseHash && byHash.has(baseHash)) {
    const baseAncestors = ancestorsOf([baseHash]);
    for (const hash of baseAncestors) {
      if (hash !== baseHash) reachable.delete(hash);
    }
  }
  return reachable;
}
