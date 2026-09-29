import { describe, it, expect } from 'vitest';
import { formatAbsoluteTime, formatBlameLabel, formatRelativeTime } from '../blame-format';
import type { BlameLine } from '../../git/blame-parser';

const NOW = Date.parse('2024-06-15T12:00:00Z');
const nowSec = Math.round(NOW / 1000);

function blame(over: Partial<BlameLine> = {}): BlameLine {
  return {
    hash: 'a'.repeat(40),
    author: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    authorTime: nowSec - 3 * 24 * 3600,
    summary: 'fix the parser',
    line: 1,
    originalLine: 1,
    filename: 'src/app.ts',
    ...over,
  };
}

describe('formatRelativeTime', () => {
  it('handles the recent buckets', () => {
    expect(formatRelativeTime(nowSec - 5, NOW)).toBe('just now');
    expect(formatRelativeTime(nowSec - 60, NOW)).toBe('a minute ago');
    expect(formatRelativeTime(nowSec - 10 * 60, NOW)).toBe('10 minutes ago');
    expect(formatRelativeTime(nowSec - 3600, NOW)).toBe('an hour ago');
    expect(formatRelativeTime(nowSec - 5 * 3600, NOW)).toBe('5 hours ago');
    expect(formatRelativeTime(nowSec - 30 * 3600, NOW)).toBe('yesterday');
    expect(formatRelativeTime(nowSec - 3 * 24 * 3600, NOW)).toBe('3 days ago');
    expect(formatRelativeTime(nowSec - 40 * 24 * 3600, NOW)).toBe('a month ago');
    expect(formatRelativeTime(nowSec - 180 * 24 * 3600, NOW)).toBe('6 months ago');
    expect(formatRelativeTime(nowSec - 400 * 24 * 3600, NOW)).toBe('a year ago');
    expect(formatRelativeTime(nowSec - 800 * 24 * 3600, NOW)).toBe('2 years ago');
  });

  it('returns an empty string without a timestamp', () => {
    expect(formatRelativeTime(0, NOW)).toBe('');
  });
});

describe('formatAbsoluteTime', () => {
  it('formats a local date-time', () => {
    // Only assert the shape: the exact value depends on the test machine's TZ.
    expect(formatAbsoluteTime(1700000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatAbsoluteTime(0)).toBe('');
  });
});

describe('formatBlameLabel', () => {
  it('expands the supported tokens', () => {
    expect(formatBlameLabel(blame(), '{author}, {ago}', NOW)).toBe('Ada Lovelace, 3 days ago');
    expect(formatBlameLabel(blame(), '{sha} {summary}', NOW)).toBe('aaaaaaa fix the parser');
  });

  it('leaves unknown tokens untouched', () => {
    expect(formatBlameLabel(blame(), '{author} {nope}', NOW)).toBe('Ada Lovelace {nope}');
  });

  it('renders an uncommitted line without a dangling separator', () => {
    const label = formatBlameLabel(
      blame({ hash: '0'.repeat(40), author: 'You', summary: 'Not Committed Yet' }),
      '{author}, {ago}',
      NOW,
    );
    expect(label).toBe('You, uncommitted');
  });
});
