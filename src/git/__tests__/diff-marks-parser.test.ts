import { describe, it, expect } from 'vitest';
import { parseUnifiedZeroMarks } from '../diff-marks-parser';

describe('parseUnifiedZeroMarks', () => {
  it('returns empty marks for an empty diff', () => {
    expect(parseUnifiedZeroMarks('')).toEqual({ added: [], modified: [], deleted: [] });
  });

  it('marks pure additions', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -2,0 +3,2 @@',
      '+three',
      '+four',
    ].join('\n');
    expect(parseUnifiedZeroMarks(diff)).toEqual({ added: [3, 4], modified: [], deleted: [] });
  });

  it('marks replaced lines as modified', () => {
    const diff = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parseUnifiedZeroMarks(diff)).toEqual({ added: [], modified: [1], deleted: [] });
  });

  it('marks a pure deletion on the line above the removal point', () => {
    const diff = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -3 +2,0 @@',
      '-removed',
    ].join('\n');
    expect(parseUnifiedZeroMarks(diff)).toEqual({ added: [], modified: [], deleted: [2] });
  });

  it('does not mistake the +++/--- file headers for content', () => {
    const diff = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    const marks = parseUnifiedZeroMarks(diff);
    expect(marks.modified).toEqual([1]);
    expect(marks.added).toEqual([]);
  });

  it('handles several hunks and dedupes/sorts', () => {
    const diff = [
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -10,0 +11,3 @@',
      '+x',
      '+y',
      '+z',
    ].join('\n');
    expect(parseUnifiedZeroMarks(diff)).toEqual({ added: [11, 12, 13], modified: [1], deleted: [] });
  });

  it('treats a header without a count as one line', () => {
    const diff = ['@@ -5 +5 @@', '-a', '+b'].join('\n');
    expect(parseUnifiedZeroMarks(diff).modified).toEqual([5]);
  });
});
