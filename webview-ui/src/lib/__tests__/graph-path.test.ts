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

  it('keeps a half-row transition when the following vertical stub would exceed one row', () => {
    expect(normalizeGraphPoints([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 60 }], ROW)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 12 },
      { x: 100, y: 60 },
    ]);
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

  it('keeps a short transition tight when it cannot borrow a full row', () => {
    expect(buildGraphPathD([{ x: 0, y: 0 }, { x: 100, y: 12 }, { x: 100, y: 60 }], 'rounded', ROW)).toBe(
      'M 0 0 C 0 9.6, 100 2.4, 100 12 L 100 60',
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
