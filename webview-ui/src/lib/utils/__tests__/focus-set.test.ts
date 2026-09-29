import { describe, it, expect } from 'vitest';
import { collectFocusHashes } from '../focus-set';
import type { Commit } from '../../types';

function commit(hash: string, parents: string[], refs: Commit['refs'] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'A', email: 'a@x', date: '2024-01-01' },
    committer: { name: 'A', email: 'a@x', date: '2024-01-01' },
    subject: hash,
    body: '',
    parents,
    refs,
  };
}

// main:    m1 ← m2 ← m3 ← m4          (m4 is main's tip)
// feature:            ↳ f1 ← f2       (branched at m3)
const commits: Commit[] = [
  commit('m4', ['m3'], [{ type: 'branch', name: 'main' } as never]),
  commit('m3', ['m2']),
  commit('m2', ['m1']),
  commit('m1', []),
  commit('f2', ['f1'], [{ type: 'branch', name: 'feature' } as never]),
  commit('f1', ['m3']),
];

const isFeature = (c: Commit) => c.refs.some((r) => r.type === 'branch' && r.name === 'feature');

describe('collectFocusHashes', () => {
  it('covers the full ancestry when no fork point is known', () => {
    const set = collectFocusHashes(commits, isFeature, null)!;
    // m4 stays out: it is main's later commit, not an ancestor of feature.
    expect([...set].sort()).toEqual(['f1', 'f2', 'm1', 'm2', 'm3']);
  });

  it('covers only the branch own commits plus the fork point', () => {
    const set = collectFocusHashes(commits, isFeature, 'm3')!;
    // Matches `git log --boundary m3..feature`: f1/f2 plus the m3 boundary.
    expect([...set].sort()).toEqual(['f1', 'f2', 'm3']);
  });

  it('falls back to the full ancestry when the fork point is not loaded', () => {
    const set = collectFocusHashes(commits, isFeature, 'missing')!;
    expect([...set].sort()).toEqual(['f1', 'f2', 'm1', 'm2', 'm3']);
  });

  it('excludes base-branch ancestors even when a merge parent reaches them', () => {
    const withMerge = [
      ...commits,
      commit('f3', ['f2', 'x1'], [{ type: 'branch', name: 'feature' } as never]),
      commit('x1', ['m1']),
    ];
    const set = collectFocusHashes(withMerge, isFeature, 'm3')!;
    // x1 came in through a merge and stays (it is not reachable from m3), but
    // m1/m2 are ancestors of the fork point and must stay out.
    expect([...set].sort()).toEqual(['f1', 'f2', 'f3', 'm3', 'x1']);
  });

  it('returns null when nothing matches the focused refs', () => {
    expect(collectFocusHashes(commits, () => false, 'm3')).toBeNull();
  });
});
