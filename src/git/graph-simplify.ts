// Structural-commit filter for the graph's "Simplify" toggle (upstream #95).
//
// The loaded log is compressed down to the commits that carry the shape of the
// history:
//   - branch / tag / remote tips (any commit carrying a ref),
//   - merge commits,
//   - fork points (a commit with more than one child in the loaded window),
//   - root commits (the start of a line — keeps lines from dangling),
//   - the load-boundary commit (keeps the bottom of the graph anchored).
// Everything else — the linear in-between commits — is dropped, and each kept
// commit's parents are remapped to its nearest kept ancestors so the graph
// rebuilt from the result still connects every remaining dot.

import type { Commit } from './types';

/** Ref types that mark a commit as a tip worth keeping when simplifying. */
const TIP_REF_TYPES = new Set(['branch', 'head', 'tag', 'remote-branch']);

/**
 * Compress a loaded commit list to its structural commits. The input order is
 * preserved; the returned commits are the same objects unless their parent
 * list had to be remapped. Pure: never touches git.
 */
export function simplifyCommits(commits: Commit[]): Commit[] {
  if (commits.length === 0) return commits;

  const index = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) index.set(commits[i].hash, i);

  // Children within the loaded window — a commit with more than one is a fork
  // point where the history splits and must stay visible.
  const childCount = new Map<string, number>();
  for (const c of commits) {
    for (const p of c.parents) {
      if (index.has(p)) childCount.set(p, (childCount.get(p) ?? 0) + 1);
    }
  }

  const last = commits.length - 1;
  const kept: boolean[] = new Array(commits.length);
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    kept[i] =
      i === last || // load boundary: anchors the bottom of the graph
      c.parents.length === 0 || // root
      c.parents.length > 1 || // merge
      (childCount.get(c.hash) ?? 0) > 1 || // fork point
      c.refs.some(r => TIP_REF_TYPES.has(r.type)); // branch/tag/remote tip
  }

  // Resolve a parent hash to the nearest kept ancestor. Dropped commits are
  // single-parent by construction (merges and roots are always kept), so the
  // walk is linear. A chain that leaves the loaded window keeps its outermost
  // hash, which the graph builder already renders as a line running to the
  // bottom edge.
  const resolved = new Map<string, string>();
  const resolve = (hash: string): string => {
    const cached = resolved.get(hash);
    if (cached !== undefined) return cached;
    const chain: string[] = [];
    let cur = hash;
    for (;;) {
      const hit = resolved.get(cur);
      if (hit !== undefined) break;
      const i = index.get(cur);
      if (i === undefined || kept[i]) {
        resolved.set(cur, cur);
        break;
      }
      chain.push(cur);
      cur = commits[i].parents[0];
    }
    const result = resolved.get(cur)!;
    for (const h of chain) resolved.set(h, result);
    return result;
  };

  const out: Commit[] = [];
  for (let i = 0; i < commits.length; i++) {
    if (!kept[i]) continue;
    const c = commits[i];
    const seen = new Set<string>();
    const parents: string[] = [];
    for (const p of c.parents) {
      const r = resolve(p);
      if (!seen.has(r)) {
        seen.add(r);
        parents.push(r);
      }
    }
    const unchanged = parents.length === c.parents.length && parents.every((p, j) => p === c.parents[j]);
    out.push(unchanged ? c : { ...c, parents });
  }
  return out;
}
