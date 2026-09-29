import type { Commit } from '../types';

export interface FocusTip {
  /** Tip hash of a focused branch/ref. */
  hash: string;
  /** The commit the branch was created from, or null when unknown. */
  baseHash: string | null;
}

/**
 * Hashes covered by a branch focus. For each focused tip this mirrors
 * `git log <base>..<tip>` — the tip's ancestry minus the ancestry of the fork
 * point — plus the fork point itself, which is kept as the boundary anchor
 * (git's `--boundary`). Tips without a known base contribute their full
 * ancestry, which is also what the callers fall back to.
 *
 * Returns null when no tips are given (nothing to focus).
 */
export function collectFocusHashes(commits: Commit[], tips: FocusTip[]): Set<string> | null {
  if (tips.length === 0) return null;
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

  const focused = new Set<string>();
  for (const tip of tips) {
    const reachable = ancestorsOf([tip.hash]);
    // The base's ancestry is not this branch's work; only the fork point stays.
    if (tip.baseHash && byHash.has(tip.baseHash)) {
      for (const hash of ancestorsOf([tip.baseHash])) {
        if (hash !== tip.baseHash) reachable.delete(hash);
      }
    }
    for (const hash of reachable) focused.add(hash);
  }
  return focused;
}
