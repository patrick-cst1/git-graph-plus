import { describe, it, expect } from 'vitest';
import { simplifyCommits } from '../graph-simplify';
import { buildFullGraph } from '../git-graph-builder';
import type { Commit, Ref } from '../types';

function mk(hash: string, parents: string[] = [], refs: Ref[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    subject: hash,
    body: '',
    parents,
    refs,
    author: { name: '', email: '', date: '' },
    committer: { name: '', email: '', date: '' },
  };
}

const tip = (name: string): Ref => ({ type: 'head', name });

describe('simplifyCommits', () => {
  it('returns an empty list unchanged', () => {
    expect(simplifyCommits([])).toEqual([]);
  });

  it('collapses a linear run between structural commits and remaps parents', () => {
    // h0 (tip) → h1 → h2 → h3 (merge) → h4, h5 → h6 (root, also fork)
    const commits = [
      mk('h0', ['h1'], [tip('main')]),
      mk('h1', ['h2']),
      mk('h2', ['h3']),
      mk('h3', ['h4', 'h5']),
      mk('h4', ['h6']),
      mk('h5', ['h6']),
      mk('h6'),
    ];
    const out = simplifyCommits(commits);
    expect(out.map(c => c.hash)).toEqual(['h0', 'h3', 'h6']);
    // h0's hidden ancestor chain collapses onto the merge commit…
    expect(out[0].parents).toEqual(['h3']);
    // …and the merge's two parents both resolve to the same root: deduped.
    expect(out[1].parents).toEqual(['h6']);
    expect(out[2].parents).toEqual([]);
  });

  it('keeps the load-boundary commit even when it is not structural', () => {
    // a0 (tip) → a1 → a2 → a3 (plain, last loaded). a3's parent is outside the
    // window, so the remapped chain must keep the outside hash (the builder
    // draws it as a line running to the bottom edge).
    const commits = [
      mk('a0', ['a1'], [tip('main')]),
      mk('a1', ['a2']),
      mk('a2', ['a3']),
      mk('a3', ['outside']),
    ];
    const out = simplifyCommits(commits);
    expect(out.map(c => c.hash)).toEqual(['a0', 'a3']);
    expect(out[0].parents).toEqual(['a3']);
    expect(out[1].parents).toEqual(['outside']);
  });

  it('keeps fork points (a commit with more than one child in the window)', () => {
    const commits = [
      mk('b0', ['b3'], [tip('main')]),
      mk('b1', ['b4'], [{ type: 'branch', name: 'feature' } as Ref]),
      mk('b3', ['b4']),
      mk('b4', ['b5']),
      mk('b5'),
    ];
    const out = simplifyCommits(commits);
    // b3 is a plain linear commit and drops; b4 forks (children b1 + b3) and stays.
    expect(out.map(c => c.hash)).toEqual(['b0', 'b1', 'b4', 'b5']);
    expect(out[0].parents).toEqual(['b4']);
  });

  it('keeps branch, tag and remote tips', () => {
    const commits = [
      mk('c0', ['c1'], [{ type: 'remote-branch', name: 'main', remote: 'origin' } as Ref]),
      mk('c1', ['c2'], [{ type: 'tag', name: 'v1' } as Ref]),
      mk('c2', ['c3']),
      mk('c3'),
    ];
    const out = simplifyCommits(commits);
    expect(out.map(c => c.hash)).toEqual(['c0', 'c1', 'c3']);
  });

  it('does not mutate the input commits', () => {
    const commits = [
      mk('d0', ['d1'], [tip('main')]),
      mk('d1', ['d2']),
      mk('d2'),
    ];
    const snapshot = JSON.parse(JSON.stringify(commits));
    simplifyCommits(commits);
    expect(JSON.parse(JSON.stringify(commits))).toEqual(snapshot);
  });

  it('keeps every remaining dot connected in the rebuilt graph', () => {
    // A denser history: two branches, a merge, a fork and a linear run.
    const commits = [
      mk('e0', ['e1'], [tip('main')]),
      mk('e1', ['e2']),
      mk('e2', ['e3', 'e5']), // merge
      mk('e3', ['e4']),
      mk('e4', ['e7']),
      mk('e5', ['e6']),
      mk('e6', ['e7']),
      mk('e7', ['e8']),
      mk('e8'), // root
    ];
    const out = simplifyCommits(commits);
    const g = buildFullGraph(out, []);

    // Every simplified commit must be drawn at a dot…
    expect(g.dots.length).toBe(out.length);
    // …and every dot with a parent must sit on a drawn path (a vertex, or
    // collinear inside a straight run), so the simplified graph never shows a
    // dot floating without its line.
    const onSegment = (
      p: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) > 0.01) return false;
      const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      return dot >= -0.01 && dot <= len2 + 0.01;
    };
    const onPath = (x: number, y: number) =>
      g.paths.some(p => {
        for (let i = 1; i < p.points.length; i++) {
          if (onSegment({ x, y }, p.points[i - 1], p.points[i])) return true;
        }
        return false;
      });
    out.forEach((c, i) => {
      if (c.parents.length === 0) return;
      const dot = g.dots[i];
      expect(onPath(dot.center.x, dot.center.y), `dot ${i} ${c.hash} at ${dot.center.x},${dot.center.y} parents ${c.parents.join(',')}`).toBe(true);
    });
  });
});
