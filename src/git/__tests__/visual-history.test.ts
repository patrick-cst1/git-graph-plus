import { describe, it, expect } from 'vitest';
import { buildVisualHistory } from '../visual-history';

const c = (date: string, author: string) => ({ hash: date + author, author, date });

describe('buildVisualHistory', () => {
  it('returns an empty chart for no commits', () => {
    const data = buildVisualHistory([]);
    expect(data.total).toBe(0);
    expect(data.buckets).toEqual([]);
    expect(data.authors).toEqual([]);
  });

  it('ignores commits with unparseable dates', () => {
    const data = buildVisualHistory([c('not-a-date', 'a'), c('2024-01-05T00:00:00Z', 'b')]);
    expect(data.total).toBe(1);
    expect(data.authors).toEqual([{ name: 'b', commits: 1 }]);
  });

  it('buckets a short history by day and fills empty days', () => {
    const data = buildVisualHistory([
      c('2024-01-01T10:00:00Z', 'alice'),
      c('2024-01-03T10:00:00Z', 'bob'),
      c('2024-01-03T11:00:00Z', 'alice'),
    ]);
    expect(data.unit).toBe('day');
    expect(data.buckets.map((b) => b.label)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(data.buckets.map((b) => b.total)).toEqual([1, 0, 2]);
    expect(data.buckets[2].byAuthor).toEqual({ alice: 1, bob: 1 });
    expect(data.authors).toEqual([{ name: 'alice', commits: 2 }, { name: 'bob', commits: 1 }]);
    expect(data.firstDate).toBe('2024-01-01T10:00:00Z');
    expect(data.lastDate).toBe('2024-01-03T11:00:00Z');
  });

  it('uses weeks for a history spanning a few months', () => {
    const data = buildVisualHistory([
      c('2024-01-01T00:00:00Z', 'a'),
      c('2024-03-15T00:00:00Z', 'a'),
    ]);
    expect(data.unit).toBe('week');
    // 2024-01-01 is a Monday, so the first bucket starts exactly there.
    expect(data.buckets[0].label).toBe('2024-01-01');
    expect(data.buckets[data.buckets.length - 1].total).toBe(1);
  });

  it('uses months for a multi-year history', () => {
    const data = buildVisualHistory([
      c('2020-01-15T00:00:00Z', 'a'),
      c('2023-06-15T00:00:00Z', 'a'),
    ]);
    expect(data.unit).toBe('month');
    expect(data.buckets[0].label).toBe('2020-01');
    expect(data.buckets[data.buckets.length - 1].label).toBe('2023-06');
  });

  it('caps the number of buckets by moving to a coarser unit', () => {
    const commits = [];
    for (let y = 2000; y <= 2024; y++) {
      commits.push(c(`${y}-06-15T00:00:00Z`, 'a'));
    }
    const data = buildVisualHistory(commits, { maxBuckets: 10 });
    expect(data.buckets.length).toBeLessThanOrEqual(10);
    expect(data.unit).toBe('year');
    expect(data.total).toBe(25);
    // 25 years chunked 3 at a time → 9 buckets, all commits still counted.
    expect(data.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(25);
  });

  it('keeps at most eight authors and sorts them by commit count', () => {
    const commits = [];
    for (let i = 0; i < 12; i++) {
      commits.push(c(`2024-01-0${(i % 9) + 1}T00:00:00Z`, `author-${i}`));
    }
    commits.push(c('2024-01-09T00:00:00Z', 'author-0'));
    const data = buildVisualHistory(commits);
    expect(data.authors).toHaveLength(8);
    expect(data.authors[0].name).toBe('author-0');
    expect(data.authors[0].commits).toBe(2);
  });
});
