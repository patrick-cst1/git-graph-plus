import { describe, it, expect } from 'vitest';
import { buildGraphPathD, normalizeGraphPoints } from '../utils/graph-path';

const ROW = 24;

describe('normalizeGraphPoints', () => {
  it('merges a half-row right transition with the following vertical stub into a full-row transition', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 24 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 24 },
    ]);
  });

  it('merges a vertical stub + horizontal + stub chain into one full-row transition', () => {
    expect(
      normalizeGraphPoints([{ x: 0, y: 0 }, { x: 0, y: 12 }, { x: 100, y: 12 }, { x: 100, y: 24 }], ROW),
    ).toEqual([{ x: 0, y: 0 }, { x: 100, y: 24 }]);
  });

  it('sweeps a short transition to the cap by trimming a long straight run', () => {
    // cap = 3 rows: the transition grows to span 72px by trimming the straight
    // run that follows, leaving the rest of the run vertical.
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 200 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 72 },
      { x: 100, y: 200 },
    ]);
  });

  it('merges a chain into one transition when it fits the cap', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 60 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ]);
  });

  it('extends a stub-then-lane-change by trimming the stub', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 100, y: 212 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 140 },
      { x: 100, y: 212 },
    ]);
  });

  it('respects maxTransitionRows', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 200 }], ROW, { maxTransitionRows: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 24 },
      { x: 100, y: 200 },
    ]);
    // A transition already at the cap is left alone.
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 24 }, { x: 100, y: 200 }], ROW, { maxTransitionRows: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 24 },
      { x: 100, y: 200 },
    ]);
  });

  it('never smooths away a commit dot', () => {
    // The mid dot sits on the rail; the incoming transition must anchor at it
    // instead of being extended past it.
    const dots = [{ x: 48, y: 384 }];
    const pts = normalizeGraphPoints(
      [{ x: 16, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 12 }, { x: 48, y: 384 }, { x: 48, y: 420 }, { x: 16, y: 432 }],
      ROW,
      { dots },
    );
    expect(pts).toEqual([
      { x: 16, y: 0 },
      { x: 48, y: 72 },
      { x: 48, y: 384 },
      { x: 16, y: 432 },
    ]);
  });

  it('keeps a dot in the middle of a collinear run', () => {
    const pts = normalizeGraphPoints(
      [{ x: 48, y: 0 }, { x: 48, y: 24 }, { x: 48, y: 48 }],
      ROW,
      { dots: [{ x: 48, y: 24 }] },
    );
    expect(pts).toEqual([{ x: 48, y: 0 }, { x: 48, y: 24 }, { x: 48, y: 48 }]);
  });

  it('does not merge a vertical stub with an opposite-direction lane change', () => {
    // down 12, then up into another lane: a V shape, not a transition.
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 0, y: 12 }, { x: 100, y: 0 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: 100, y: 0 },
    ]);
  });

  it('leaves an already full-row left transition untouched', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 24 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 24 },
    ]);
  });

  it('collapses collinear vertical and horizontal runs', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 0, y: 12 }, { x: 0, y: 24 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 24 },
    ]);
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('drops consecutive duplicate points', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 24 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 24 },
    ]);
  });
});

describe('buildGraphPathD', () => {
  it('draws a normalised half-row right transition as one full-row cubic', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 24 }], 'rounded', ROW)).toBe(
      'M 0 0 C 0 19.2, 100 4.8, 100 24',
    );
  });

  it('draws a full-row lane change as a single cubic (mhutchie geometry)', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }, { x: 100, y: 24 }], 'rounded', ROW)).toBe(
      'M 0 0 C 0 19.2, 100 4.8, 100 24',
    );
  });

  it('sweeps a short transition across the whole cap when a long run follows', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 200 }], 'rounded', ROW)).toBe(
      'M 0 0 C 0 57.6, 100 14.4, 100 72 L 100 200',
    );
  });

  it('emits vertical runs as straight lines', () => {
    expect(buildGraphPathD([{ x: 8, y: 0 }, { x: 8, y: 12 }, { x: 8, y: 24 }], 'rounded', ROW)).toBe('M 8 0 L 8 24');
  });

  it('draws the angular style as a two-segment kink over the normalised span', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 24 }], 'angular', ROW)).toBe(
      'M 0 0 L 100 14.88 L 100 24',
    );
    // moving left locks the source lane: vertical first, then the diagonal.
    expect(buildGraphPathD([{ x: 100, y: 0 }, { x: 0, y: 24 }], 'angular', ROW)).toBe(
      'M 100 0 L 100 9.12 L 0 24',
    );
  });

  it('returns an empty path for fewer than two points', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }], 'rounded', ROW)).toBe('');
    expect(buildGraphPathD([], 'rounded', ROW)).toBe('');
  });
});
